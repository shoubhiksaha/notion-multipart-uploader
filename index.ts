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
}

/** Binary file contents accepted by uploadToNotion. Strings are encoded as UTF-8. */
export type FileData = Blob | ArrayBuffer | ArrayBufferView | string;

const isNode = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;  // Notion's absolute limit (paid workspaces)
const SINGLE_PART_LIMIT = 20 * 1024 * 1024;    // Larger files must use multi-part uploads
// 10 MiB is Notion's recommended part size; 5 GB / 10 MiB = 512 parts, under Notion's 1,000-part limit.
const CHUNK_SIZE = 10 * 1024 * 1024;

/**
 * Uploads a local file from disk to Notion's servers (Node.js only).
 * Uses bounded memory chunk reads to support files up to 5GB without memory bloat.
 *
 * @param apiKey - Your Notion Integration Token
 * @param filePath - The absolute or relative path to the file on disk
 * @param mimeType - e.g., 'audio/mp4', 'image/jpeg', 'application/pdf'
 * @param options - Additional options like retries or Notion API version
 * @returns The Notion File ID to use in your blocks
 */
export async function uploadFile(
    apiKey: string,
    filePath: string,
    mimeType: string,
    options: UploadOptions = {}
): Promise<string> {
    if (!isNode) throw new Error("uploadFile is only supported in Node.js environments. For browsers, use uploadToNotion.");

    const fs = await import('fs/promises');
    const pathModule = await import('path');

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error(`Not a regular file: ${filePath}`);
    if (stat.size === 0) throw new Error(`File is empty: ${filePath}`);
    const filename = pathModule.basename(filePath);

    return uploadToNotionInternal(apiKey, { type: 'path', filePath, size: stat.size }, mimeType, filename, options);
}

/**
 * Uploads a binary file directly to Notion's servers using native fetch.
 * Automatically handles single-part (<= 20MB) and multi-part (> 20MB) chunking.
 *
 * @param apiKey - Your Notion Integration Token
 * @param fileBuffer - The binary data of the file (Buffer, Uint8Array, ArrayBuffer, Blob, or a UTF-8 string)
 * @param mimeType - e.g., 'audio/mp4', 'image/jpeg', 'application/pdf'
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
        throw new Error("File buffer is empty");
    }
    return uploadToNotionInternal(apiKey, { type: 'data', data, size }, mimeType, filename || "uploaded-file", options);
}

function toBinary(fileData: unknown): Blob | Uint8Array {
    if (typeof Blob !== 'undefined' && fileData instanceof Blob) return fileData;
    if (fileData instanceof ArrayBuffer) return new Uint8Array(fileData);
    if (ArrayBuffer.isView(fileData)) return new Uint8Array(fileData.buffer, fileData.byteOffset, fileData.byteLength);
    if (typeof fileData === 'string') return new TextEncoder().encode(fileData);
    throw new TypeError("fileBuffer must be a Buffer, Uint8Array, ArrayBuffer, Blob, or string");
}

async function uploadToNotionInternal(
    apiKey: string,
    source: { type: 'path', filePath: string, size: number } | { type: 'data', data: Blob | Uint8Array, size: number },
    mimeType: string,
    filename: string,
    options: UploadOptions
): Promise<string> {
    if (!apiKey) throw new Error("Notion API Key is required");

    const notionVersion = options.notionVersion || "2026-03-11";
    const maxRetries = Math.max(0, options.retries ?? 3);
    const totalAttempts = maxRetries + 1;
    const timeoutMs = options.timeoutMs;
    const userSignal = options.signal;
    const size = source.size;

    if (size > MAX_FILE_SIZE) {
        throw new Error("File exceeds Notion's absolute maximum size limit of 5GB.");
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

    const abortedError = () => new Error(userSignal?.aborted ? "Upload aborted by user" : "Upload aborted after another part failed");

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

    // Exponential backoff retry wrapper with Abort/Timeout, Jitter, and Retry-After support.
    // Resolves with the response body so the timeout also covers reading it.
    const fetchWithRetry = async (url: string, fetchOptions: RequestInit): Promise<string> => {
        for (let attempt = 1; ; attempt++) {
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
                if (attempt >= totalAttempts) throw timedOut ? new Error("Upload timed out") : err;
                // Network failures and timeouts are transient, so back off and retry
                await sleep(1000 * Math.pow(2, attempt - 1) + Math.random() * 1000);
                continue;
            } finally {
                clearTimeout(timeoutId);
                uploadSignal.removeEventListener("abort", onAbort);
            }

            if (res.ok) return body;

            // Retry only on Rate Limits (429) and Server Overload/Unavailable (5xx)
            if (res.status >= 400 && res.status < 500 && res.status !== 429) {
                throw new Error(`Notion API Error (${res.status}): ${body}`);
            }

            if (attempt >= totalAttempts) throw new Error(`Notion API Failed (${res.status}): ${body}`);

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
            await sleep(delayMs + Math.random() * 1000);
        }
    };

    // Helper to get chunk as Blob
    const getChunkBlob = async (start: number, end: number): Promise<Blob> => {
        if (source.type === 'data') {
            const data = source.data;
            const chunk = data instanceof Uint8Array ? data.subarray(start, end) : data.slice(start, end);
            return new Blob([chunk as BlobPart], { type: mimeType });
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
                        throw new Error(`File changed during upload (it is now smaller than ${size} bytes): ${source.filePath}`);
                    }
                    filled += bytesRead;
                }
                return new Blob([buffer], { type: mimeType });
            } finally {
                await fileHandle.close();
            }
        }
    };

    const reportProgress = (uploadedBytes: number) => {
        if (options.onProgress) {
            try { options.onProgress(uploadedBytes, size); } catch {}
        }
    };

    try {
        const createBody: Record<string, unknown> = {
            filename: filename,
            content_type: mimeType,
            mode: mode
        };
        if (isMultiPart) {
            createBody.number_of_parts = numParts;
        }

        // Step 1: Initialize the upload with Notion
        const createData = JSON.parse(await fetchWithRetry("https://api.notion.com/v1/file_uploads", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "Notion-Version": notionVersion
            },
            body: JSON.stringify(createBody)
        }));
        const { id, upload_url, complete_url } = createData;
        if (!id || !upload_url) {
            throw new Error(`Unexpected response from Notion when creating the upload: ${JSON.stringify(createData)}`);
        }

        reportProgress(0);

        // Step 2: Upload the binary data
        if (!isMultiPart) {
            const form = new FormData();
            const blob = await getChunkBlob(0, size);
            form.append("file", blob, filename);

            await fetchWithRetry(upload_url, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Notion-Version": notionVersion
                },
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
                        headers: {
                            "Authorization": `Bearer ${apiKey}`,
                            "Notion-Version": notionVersion
                        },
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

        // Step 3: Complete multi-part upload
        const targetCompleteUrl = complete_url || `https://api.notion.com/v1/file_uploads/${id}/complete`;
        await fetchWithRetry(targetCompleteUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "Notion-Version": notionVersion
            },
            body: JSON.stringify({})
        });

        return id;
    } finally {
        userSignal?.removeEventListener("abort", abortUpload);
    }
}
