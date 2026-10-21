import { inferMimeType, isSupportedFileType } from './file-types.js';

export { inferMimeType, isSupportedFileType };

export interface UploadOptions {
    /** Override the default Notion API version (default: '2026-03-11') */
    notionVersion?: string;
    /** Number of times to retry failed network requests with exponential backoff (default: 3) */
    retries?: number;
    /** Timeout in milliseconds for each network request, including reading the response. Timed-out requests are retried. */
    timeoutMs?: number;
    /** Standard AbortSignal to cancel the upload at any time */
    signal?: AbortSignal;
    /** Number of chunks to upload simultaneously for massive files (default: 3) */
    concurrency?: number;
    /** Callback reporting upload progress in bytes: (uploadedBytes, totalBytes) => void */
    onProgress?: (uploadedBytes: number, totalBytes: number) => void;
    /** Check that Notion supports the file type and that the file fits the workspace's upload limit before uploading (default: true) */
    preflight?: boolean;
}

export interface UploadFileOptions extends UploadOptions {
    /** Filename shown in Notion (default: the file's name on disk) */
    filename?: string;
}

export interface UploadStreamOptions extends UploadOptions {
    /** Exact length of the stream in bytes. Notion needs the number of parts before the upload starts. */
    size: number;
}

/** Binary file contents accepted by uploadToNotion. Strings are encoded as UTF-8. */
export type FileData = Blob | ArrayBuffer | ArrayBufferView | string;

/** Streams accepted by uploadStream: Node.js Readable streams, web ReadableStreams, or any async iterable of bytes. */
export type StreamData = AsyncIterable<Uint8Array | string>;

/**
 * Error thrown for failed uploads.
 *
 * `code` is Notion's error code for API errors (e.g. 'validation_error', 'unauthorized', 'rate_limited'),
 * or one of: 'aborted', 'timeout', 'network_error', 'invalid_response', 'empty_file', 'not_a_file',
 * 'file_too_large', 'unsupported_file_type', 'file_changed', 'size_mismatch'.
 */
export class NotionUploadError extends Error {
    /** Notion's error code, or one of this library's codes listed above */
    readonly code: string;
    /** HTTP status of the failed Notion response, if there was one */
    readonly status?: number;
    /** Whether trying the upload again later might succeed */
    readonly retryable: boolean;

    constructor(message: string, details: { code: string, status?: number, retryable?: boolean, cause?: unknown }) {
        super(message, details.cause === undefined ? undefined : { cause: details.cause });
        this.name = "NotionUploadError";
        this.code = details.code;
        this.status = details.status;
        this.retryable = details.retryable ?? false;
    }
}

const isNode = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;  // Notion's absolute limit (paid workspaces)
const FREE_WORKSPACE_LIMIT = 5 * 1024 * 1024;  // Every workspace accepts files up to this size
const SINGLE_PART_LIMIT = 20 * 1024 * 1024;    // Larger files must use multi-part uploads
// 10 MiB is Notion's recommended part size; 5 GB / 10 MiB = 512 parts, under Notion's 1,000-part limit.
const CHUNK_SIZE = 10 * 1024 * 1024;

type UploadSource =
    | { type: 'path', filePath: string, size: number }
    | { type: 'data', data: Blob | Uint8Array, size: number }
    | { type: 'stream', reader: StreamReader, size: number };

/**
 * Uploads a local file from disk to Notion's servers (Node.js only).
 * Uses bounded memory chunk reads to support files up to 5GB without memory bloat.
 *
 * @param apiKey - Your Notion Integration Token
 * @param filePath - The absolute or relative path to the file on disk
 * @param mimeType - e.g., 'audio/mp4', 'image/jpeg', 'application/pdf'. Inferred from the file extension if omitted.
 * @param options - Additional options like retries, Notion API version, or the filename shown in Notion
 * @returns The Notion File ID to use in your blocks
 */
export async function uploadFile(
    apiKey: string,
    filePath: string,
    mimeType?: string,
    options: UploadFileOptions = {}
): Promise<string> {
    if (!isNode) throw new Error("uploadFile is only supported in Node.js environments. For browsers, use uploadToNotion.");

    const fs = await import('fs/promises');
    const pathModule = await import('path');

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new NotionUploadError(`Not a regular file: ${filePath}`, { code: 'not_a_file' });
    if (stat.size === 0) throw new NotionUploadError(`File is empty: ${filePath}`, { code: 'empty_file' });
    const filename = options.filename || pathModule.basename(filePath);

    return uploadToNotionInternal(apiKey, { type: 'path', filePath, size: stat.size }, mimeType, filename, options);
}

/**
 * Uploads a binary file directly to Notion's servers using native fetch.
 * Automatically handles single-part (<= 20MB) and multi-part (> 20MB) chunking.
 *
 * @param apiKey - Your Notion Integration Token
 * @param fileBuffer - The binary data of the file (Buffer, Uint8Array, ArrayBuffer, Blob, or a UTF-8 string)
 * @param mimeType - e.g., 'audio/mp4', 'image/jpeg', 'application/pdf'. Pass '' to infer it from the filename.
 * @param filename - The name of the file (e.g., 'voice-note.m4a')
 * @param options - Additional options like retries or Notion API version
 * @returns The Notion File ID to use in your blocks
 */
export async function uploadToNotion(
    apiKey: string,
    fileBuffer: FileData,
    mimeType: string,
    filename?: string,
    options: UploadOptions = {}
): Promise<string> {
    const data = toBinary(fileBuffer);
    const size = data instanceof Uint8Array ? data.byteLength : data.size;
    if (size === 0) {
        throw new NotionUploadError("File buffer is empty", { code: 'empty_file' });
    }
    return uploadToNotionInternal(apiKey, { type: 'data', data, size }, mimeType, filename || "uploaded-file", options);
}

/**
 * Uploads a stream of known length to Notion without buffering the whole file,
 * e.g. an incoming HTTP request body or a download from another service.
 * At most `concurrency` parts (10 MiB each) are held in memory at once.
 *
 * @param apiKey - Your Notion Integration Token
 * @param stream - A Node.js Readable, a web ReadableStream, or any async iterable of bytes
 * @param mimeType - e.g., 'video/mp4'. Pass '' to infer it from the filename.
 * @param filename - The name of the file (e.g., 'recording.mp4')
 * @param options - Must include `size`, the exact length of the stream in bytes
 * @returns The Notion File ID to use in your blocks
 */
export async function uploadStream(
    apiKey: string,
    stream: StreamData,
    mimeType: string,
    filename: string,
    options: UploadStreamOptions
): Promise<string> {
    const size = options?.size;
    if (!Number.isSafeInteger(size) || size < 0) {
        throw new TypeError("options.size must be the stream's length in bytes");
    }
    if (size === 0) throw new NotionUploadError("Stream is empty", { code: 'empty_file' });
    if (stream == null || typeof (stream as any)[Symbol.asyncIterator] !== 'function') {
        throw new TypeError("stream must be a Readable stream, a ReadableStream, or an async iterable of bytes");
    }

    const reader = new StreamReader(stream);
    try {
        return await uploadToNotionInternal(apiKey, { type: 'stream', reader, size }, mimeType, filename, options);
    } finally {
        // Stops (and for Node.js streams, destroys) the source if the upload ended early
        await reader.close();
    }
}

function toBinary(fileData: unknown): Blob | Uint8Array {
    if (typeof Blob !== 'undefined' && fileData instanceof Blob) return fileData;
    if (fileData instanceof ArrayBuffer) return new Uint8Array(fileData);
    if (ArrayBuffer.isView(fileData)) return new Uint8Array(fileData.buffer, fileData.byteOffset, fileData.byteLength);
    if (typeof fileData === 'string') return new TextEncoder().encode(fileData);
    throw new TypeError("fileBuffer must be a Buffer, Uint8Array, ArrayBuffer, Blob, or string");
}

// Reads exact-length chunks from an async iterable that yields arbitrarily sized pieces
class StreamReader {
    private readonly iterator: AsyncIterator<Uint8Array | string>;
    private pending: Uint8Array = new Uint8Array(0);
    private finished = false;

    constructor(stream: StreamData) {
        this.iterator = stream[Symbol.asyncIterator]();
    }

    /** Reads `length` bytes, or fewer if the stream ends first */
    async read(length: number): Promise<Uint8Array> {
        const out = new Uint8Array(length);
        let filled = 0;
        while (filled < length && await this.fill()) {
            const n = Math.min(this.pending.byteLength, length - filled);
            out.set(this.pending.subarray(0, n), filled);
            this.pending = this.pending.subarray(n);
            filled += n;
        }
        return filled === length ? out : out.subarray(0, filled);
    }

    /** Whether the stream has more bytes */
    async hasMore(): Promise<boolean> {
        return this.fill();
    }

    async close(): Promise<void> {
        if (this.finished) return;
        this.finished = true;
        await this.iterator.return?.();
    }

    // Makes sure `pending` has bytes unless the stream is finished
    private async fill(): Promise<boolean> {
        while (this.pending.byteLength === 0) {
            if (this.finished) return false;
            const next = await this.iterator.next();
            if (next.done) {
                this.finished = true;
                return false;
            }
            const value: unknown = next.value;
            if (typeof value === 'string') {
                this.pending = new TextEncoder().encode(value);
            } else if (ArrayBuffer.isView(value)) {
                this.pending = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
            } else {
                throw new TypeError("stream must yield Uint8Array, Buffer or string chunks");
            }
        }
        return true;
    }
}

const formatBytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

// Notion error responses are JSON with a `code` such as 'validation_error'
function notionErrorCode(body: string): string | undefined {
    try {
        const code = JSON.parse(body)?.code;
        return typeof code === 'string' ? code : undefined;
    } catch {
        return undefined;
    }
}

async function uploadToNotionInternal(
    apiKey: string,
    source: UploadSource,
    mimeType: string | undefined,
    filename: string,
    options: UploadOptions
): Promise<string> {
    if (!apiKey) throw new Error("Notion API Key is required");

    const contentType = mimeType || inferMimeType(filename) || "application/octet-stream";
    const notionVersion = options.notionVersion || "2026-03-11";
    const maxRetries = Math.max(0, options.retries ?? 3);
    const totalAttempts = maxRetries + 1;
    const timeoutMs = options.timeoutMs;
    const userSignal = options.signal;
    const preflight = options.preflight !== false;
    const size = source.size;

    if (size > MAX_FILE_SIZE) {
        throw new NotionUploadError("File exceeds Notion's absolute maximum size limit of 5GB.", { code: 'file_too_large' });
    }
    if (preflight && !isSupportedFileType(filename, contentType)) {
        throw new NotionUploadError(
            `Notion doesn't accept "${filename}" (${contentType}). Use a supported file type (https://developers.notion.com/docs/working-with-files-and-media), or pass preflight: false to skip this check.`,
            { code: 'unsupported_file_type' }
        );
    }

    const isMultiPart = size > SINGLE_PART_LIMIT;
    const mode = isMultiPart ? "multi_part" : "single_part";
    const numParts = isMultiPart ? Math.ceil(size / CHUNK_SIZE) : 1;

    // Aborted when the caller cancels or when any part fails, so in-flight requests,
    // retry delays and idle workers all stop instead of continuing in the background.
    const uploadController = new AbortController();
    const uploadSignal = uploadController.signal;
    const abortUpload = () => uploadController.abort();
    if (userSignal?.aborted) abortUpload();
    userSignal?.addEventListener("abort", abortUpload);

    const abortedError = () => userSignal?.aborted
        ? new NotionUploadError("Upload aborted by user", { code: 'aborted' })
        : new NotionUploadError("Upload aborted after another part failed", { code: 'aborted' });

    const sleep = (ms: number) => new Promise<void>((resolve, reject) => {
        if (uploadSignal.aborted) return reject(abortedError());
        const onAbort = () => {
            clearTimeout(timer);
            reject(abortedError());
        };
        const timer = setTimeout(() => {
            uploadSignal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        uploadSignal.addEventListener("abort", onAbort, { once: true });
    });

    // When Notion rate-limits one request, every worker waits until this time before sending more
    let rateLimitedUntil = 0;

    // Exponential backoff retry wrapper with Abort/Timeout, Jitter, and Retry-After support.
    // Resolves with the response body so the timeout also covers reading it.
    const fetchWithRetry = async (url: string, fetchOptions: RequestInit): Promise<string> => {
        for (let attempt = 1; ; attempt++) {
            const rateLimitWait = rateLimitedUntil - Date.now();
            if (rateLimitWait > 0) await sleep(rateLimitWait);
            if (uploadSignal.aborted) throw abortedError();

            const controller = new AbortController();
            const onAbort = () => controller.abort();
            uploadSignal.addEventListener("abort", onAbort);
            let timedOut = false;
            const timeoutId = timeoutMs ? setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, timeoutMs) : undefined;

            let res: Response;
            let body: string;
            try {
                res = await fetch(url, { ...fetchOptions, signal: controller.signal });
                body = await res.text();
            } catch (err) {
                if (uploadSignal.aborted) throw abortedError();
                if (attempt >= totalAttempts) {
                    throw timedOut
                        ? new NotionUploadError("Upload timed out", { code: 'timeout', retryable: true })
                        : new NotionUploadError(`Network error: ${(err as Error)?.message ?? err}`, { code: 'network_error', retryable: true, cause: err });
                }
                // Network failures and timeouts are transient, so back off and retry
                await sleep(1000 * Math.pow(2, attempt - 1) + Math.random() * 1000);
                continue;
            } finally {
                clearTimeout(timeoutId);
                uploadSignal.removeEventListener("abort", onAbort);
            }

            if (res.ok) return body;

            const code = notionErrorCode(body);

            // Retry only on Rate Limits (429) and Server Overload/Unavailable (5xx)
            if (res.status >= 400 && res.status < 500 && res.status !== 429) {
                throw new NotionUploadError(`Notion API Error (${res.status}): ${body}`, { code: code ?? 'http_error', status: res.status });
            }

            if (attempt >= totalAttempts) {
                throw new NotionUploadError(`Notion API Failed (${res.status}): ${body}`, { code: code ?? 'http_error', status: res.status, retryable: true });
            }

            // Calculate delay: Respect Retry-After header if present, otherwise exponential backoff
            let delayMs = 1000 * Math.pow(2, attempt - 1);
            const retryAfter = res.headers.get('Retry-After');
            if (retryAfter) {
                const parsed = parseInt(retryAfter, 10);
                if (!isNaN(parsed)) {
                    delayMs = parsed * 1000;
                }
            }

            // Add jitter to avoid thundering herd problem
            delayMs += Math.random() * 1000;
            if (res.status === 429) {
                rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + delayMs);
            }
            await sleep(delayMs);
        }
    };

    const notionHeaders = (json: boolean): Record<string, string> => ({
        "Authorization": `Bearer ${apiKey}`,
        ...(json ? { "Content-Type": "application/json" } : {}),
        "Notion-Version": notionVersion
    });

    // Fails fast instead of uploading a file the workspace will reject (free workspaces allow 5 MiB per file)
    const checkWorkspaceLimit = async () => {
        let limit: unknown;
        try {
            const me = JSON.parse(await fetchWithRetry("https://api.notion.com/v1/users/me", {
                method: "GET",
                headers: notionHeaders(false)
            }));
            limit = me?.bot?.workspace_limits?.max_file_upload_size_in_bytes;
        } catch (err) {
            if (uploadSignal.aborted) throw err;
            // The limit couldn't be read, so leave it to Notion to enforce
            return;
        }
        if (typeof limit === 'number' && size > limit) {
            throw new NotionUploadError(
                `File is ${formatBytes(size)}, but this workspace accepts uploads up to ${formatBytes(limit)}. Free workspaces are limited to 5 MiB per file.`,
                { code: 'file_too_large' }
            );
        }
    };

    // Stream chunks must be read in order, so reads are queued in the order parts are requested
    let streamQueue: Promise<unknown> = Promise.resolve();

    // Helper to get chunk as Blob
    const getChunkBlob = async (start: number, end: number): Promise<Blob> => {
        if (source.type === 'stream') {
            const read = streamQueue.then(() => source.reader.read(end - start));
            streamQueue = read.catch(() => {});
            const bytes = await read;
            if (bytes.byteLength !== end - start) {
                throw new NotionUploadError(`Stream ended after ${start + bytes.byteLength} bytes, but options.size is ${size}`, { code: 'size_mismatch' });
            }
            return new Blob([bytes as BlobPart], { type: contentType });
        } else if (source.type === 'data') {
            const data = source.data;
            const chunk = data instanceof Uint8Array ? data.subarray(start, end) : data.slice(start, end);
            return new Blob([chunk as BlobPart], { type: contentType });
        } else {
            const fs = await import('fs/promises');
            const fileHandle = await fs.open(source.filePath, 'r');
            try {
                const length = end - start;
                const buffer = Buffer.alloc(length);
                // A single read may return fewer bytes than requested, so keep reading until the chunk is full
                let filled = 0;
                while (filled < length) {
                    const { bytesRead } = await fileHandle.read(buffer, filled, length - filled, start + filled);
                    if (bytesRead === 0) {
                        throw new NotionUploadError(`File changed during upload (it is now smaller than ${size} bytes): ${source.filePath}`, { code: 'file_changed' });
                    }
                    filled += bytesRead;
                }
                return new Blob([buffer], { type: contentType });
            } finally {
                await fileHandle.close();
            }
        }
    };

    const ensureStreamFullyRead = async () => {
        if (source.type === 'stream' && await source.reader.hasMore()) {
            throw new NotionUploadError(`Stream is longer than options.size (${size} bytes)`, { code: 'size_mismatch' });
        }
    };

    const reportProgress = (uploadedBytes: number) => {
        if (options.onProgress) {
            try { options.onProgress(uploadedBytes, size); } catch {}
        }
    };

    try {
        if (preflight && size > FREE_WORKSPACE_LIMIT) {
            await checkWorkspaceLimit();
        }

        const createBody: Record<string, unknown> = {
            filename: filename,
            content_type: contentType,
            mode: mode
        };
        if (isMultiPart) {
            createBody.number_of_parts = numParts;
        }

        // Step 1: Initialize the upload with Notion
        const createData = JSON.parse(await fetchWithRetry("https://api.notion.com/v1/file_uploads", {
            method: "POST",
            headers: notionHeaders(true),
            body: JSON.stringify(createBody)
        }));
        const { id, upload_url, complete_url } = createData;
        if (!id || !upload_url) {
            throw new NotionUploadError(`Unexpected response from Notion when creating the upload: ${JSON.stringify(createData)}`, { code: 'invalid_response' });
        }

        reportProgress(0);

        // Step 2: Upload the binary data
        if (!isMultiPart) {
            const form = new FormData();
            const blob = await getChunkBlob(0, size);
            await ensureStreamFullyRead();
            form.append("file", blob, filename);

            await fetchWithRetry(upload_url, {
                method: "POST",
                headers: notionHeaders(false),
                body: form
            });

            reportProgress(size);
            return id;
        }

        // Multi-part chunked upload (Concurrent Promise Pool)
        const concurrency = Math.max(1, options.concurrency ?? 3);
        let currentPart = 0;
        let uploadedBytes = 0;
        let failure: unknown;

        const uploadWorker = async () => {
            try {
                while (!uploadSignal.aborted) {
                    const part = currentPart++;
                    if (part >= numParts) return;

                    const start = part * CHUNK_SIZE;
                    const end = Math.min(start + CHUNK_SIZE, size);

                    const blob = await getChunkBlob(start, end);
                    const form = new FormData();
                    form.append("file", blob, filename);
                    form.append("part_number", (part + 1).toString());

                    await fetchWithRetry(upload_url, {
                        method: "POST",
                        headers: notionHeaders(false),
                        body: form
                    });

                    uploadedBytes += end - start;
                    reportProgress(uploadedBytes);
                }
            } catch (err) {
                // Keep the first error and stop the other workers
                if (failure === undefined) failure = err;
                abortUpload();
            }
        };

        const workers: Promise<void>[] = [];
        for (let i = 0; i < Math.min(concurrency, numParts); i++) {
            workers.push(uploadWorker());
        }
        // Workers never reject, so this waits until every worker has stopped
        await Promise.all(workers);
        if (failure !== undefined) throw failure;
        if (uploadSignal.aborted) throw abortedError();
        await ensureStreamFullyRead();

        // Step 3: Complete multi-part upload
        const targetCompleteUrl = complete_url || `https://api.notion.com/v1/file_uploads/${id}/complete`;
        await fetchWithRetry(targetCompleteUrl, {
            method: "POST",
            headers: notionHeaders(true),
            body: JSON.stringify({})
        });

        return id;
    } finally {
        userSignal?.removeEventListener("abort", abortUpload);
    }
}
