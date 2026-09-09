export interface UploadOptions {
    /** Override the default Notion API version (default: '2026-03-11') */
    notionVersion?: string;
    /** Number of times to retry failed network requests with exponential backoff (default: 3) */
    retries?: number;
    /** Timeout in milliseconds for each network request */
    timeoutMs?: number;
    /** Standard AbortSignal to cancel the upload at any time */
    signal?: AbortSignal;
    /** Number of chunks to upload simultaneously for massive files (default: 3) */
    concurrency?: number;
    /** Callback reporting upload progress in bytes: (uploadedBytes, totalBytes) => void */
    onProgress?: (uploadedBytes: number, totalBytes: number) => void;
}

const isNode = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

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
    const filename = pathModule.basename(filePath);
    
    return uploadToNotionInternal(apiKey, { type: 'path', filePath, size: stat.size }, mimeType, filename, options);
}

/**
 * Uploads a binary file directly to Notion's servers using native fetch.
 * Automatically handles single-part (<= 20MB) and multi-part (> 20MB) chunking.
 * 
 * @param apiKey - Your Notion Integration Token
 * @param fileBuffer - The binary data of the file (audio, image, pdf, etc.)
 * @param mimeType - e.g., 'audio/mp4', 'image/jpeg', 'application/pdf'
 * @param filename - The name of the file (e.g., 'voice-note.m4a')
 * @param options - Additional options like retries or Notion API version
 * @returns The Notion File ID to use in your blocks
 */
export async function uploadToNotion(
    apiKey: string,
    fileBuffer: Uint8Array | Blob | any,
    mimeType: string,
    filename?: string,
    options: UploadOptions = {}
): Promise<string> {
    const size = fileBuffer.size ?? fileBuffer.length ?? fileBuffer.byteLength;
    if (typeof size !== "number" || size <= 0) {
        throw new Error("File buffer is empty");
    }
    return uploadToNotionInternal(apiKey, { type: 'buffer', buffer: fileBuffer, size }, mimeType, filename || "uploaded-file", options);
}

async function uploadToNotionInternal(
    apiKey: string,
    source: { type: 'path', filePath: string, size: number } | { type: 'buffer', buffer: any, size: number },
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
    
    // Notion strictly limits files to 5GB (paid workspaces)
    if (size > 5 * 1024 * 1024 * 1024) {
        throw new Error("File exceeds Notion's absolute maximum size limit of 5GB.");
    }

    const isMultiPart = size > 20971520; // Notion's 20MB limit
    const mode = isMultiPart ? "multi_part" : "single_part";
    
    const MIN_CHUNK_SIZE = 5 * 1024 * 1024;   // 5 MiB — Notion's documented minimum
    const MAX_PARTS = 1000;                     // Practical upper bound

    let CHUNK_SIZE = 10 * 1024 * 1024;         // 10 MiB — Notion's recommended default
    let numParts = isMultiPart ? Math.ceil(size / CHUNK_SIZE) : 1;

    if (numParts > MAX_PARTS) {
        // Scale chunk size up, but never below Notion's 5 MiB minimum per part
        CHUNK_SIZE = Math.max(Math.ceil(size / MAX_PARTS), MIN_CHUNK_SIZE);
        numParts = Math.ceil(size / CHUNK_SIZE);
    }

    // Exponential backoff retry wrapper with Abort/Timeout, Jitter, and Retry-After support
    const fetchWithRetry = async (url: string, fetchOptions: RequestInit, attempts = totalAttempts): Promise<Response> => {
        for (let i = 0; i < attempts; i++) {
            const controller = new AbortController();
            let timeoutId: ReturnType<typeof setTimeout> | undefined;
            
            if (timeoutMs) {
                timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            }

            let abortHandler: (() => void) | undefined;
            if (userSignal) {
                if (userSignal.aborted) throw new Error("Upload aborted by user");
                abortHandler = () => controller.abort();
                userSignal.addEventListener("abort", abortHandler);
            }

            try {
                const res = await fetch(url, { ...fetchOptions, signal: controller.signal });
                if (timeoutId) clearTimeout(timeoutId);
                if (userSignal && abortHandler) userSignal.removeEventListener("abort", abortHandler);
                
                if (res.ok) return res;
                
                // Retry only on Rate Limits (429) and Server Overload/Unavailable (5xx)
                if (res.status >= 400 && res.status < 500 && res.status !== 429) {
                    const error: any = new Error(`Notion API Error (${res.status}): ${await res.text()}`);
                    error.isFatal = true;
                    throw error;
                }
                
                if (i === attempts - 1) throw new Error(`Notion API Failed (${res.status}): ${await res.text()}`);
                
                // Calculate delay: Respect Retry-After header if present, otherwise exponential backoff with jitter
                let delayMs = 1000 * Math.pow(2, i);
                const retryAfter = res.headers.get('Retry-After');
                if (retryAfter) {
                    const parsed = parseInt(retryAfter, 10);
                    if (!isNaN(parsed)) {
                        delayMs = parsed * 1000;
                    }
                }
                
                // Add jitter to avoid thundering herd problem
                const jitter = Math.random() * 1000;
                await new Promise(r => setTimeout(r, delayMs + jitter));
                
            } catch (err: any) {
                if (timeoutId) clearTimeout(timeoutId);
                if (userSignal && abortHandler) userSignal.removeEventListener("abort", abortHandler);
                
                if (err.name === 'AbortError') throw new Error(userSignal?.aborted ? "Upload aborted by user" : "Upload timed out");
                if (err.isFatal) throw err;
                if (i === attempts - 1) throw err;
                
                // Delay for network failures
                const delayMs = 1000 * Math.pow(2, i);
                const jitter = Math.random() * 1000;
                await new Promise(r => setTimeout(r, delayMs + jitter));
            }
        }
        throw new Error("Unreachable");
    };

    const createBody: any = {
        filename: filename,
        content_type: mimeType,
        mode: mode
    };
    if (isMultiPart) {
        createBody.number_of_parts = numParts;
    }

    // Step 1: Initialize the upload with Notion
    const createRes = await fetchWithRetry("https://api.notion.com/v1/file_uploads", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Notion-Version": notionVersion
        },
        body: JSON.stringify(createBody)
    });

    const createData = await createRes.json();
    const { id, upload_url, complete_url } = createData;

    if (options.onProgress) {
        try { options.onProgress(0, size); } catch {}
    }

    // Helper to get chunk as Blob
    const getChunkBlob = async (start: number, end: number): Promise<Blob> => {
        if (source.type === 'buffer') {
            const fileBuffer = source.buffer;
            const chunk = typeof fileBuffer.slice === 'function' ? fileBuffer.slice(start, end) : fileBuffer.subarray(start, end);
            return new Blob([chunk], { type: mimeType });
        } else {
            const fs = await import('fs/promises');
            const fileHandle = await fs.open(source.filePath, 'r');
            try {
                const length = end - start;
                const buffer = Buffer.alloc(length);
                await fileHandle.read(buffer, 0, length, start);
                return new Blob([buffer], { type: mimeType });
            } finally {
                await fileHandle.close();
            }
        }
    };

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

        if (options.onProgress) {
            try { options.onProgress(size, size); } catch {}
        }
        return id;
    }

    // Multi-part chunked upload (Concurrent Promise Pool)
    const concurrency = Math.max(1, options.concurrency ?? 3);
    let currentPart = 0;
    let uploadedBytes = 0;

    const uploadWorker = async () => {
        while (true) {
            const part = currentPart++;
            if (part >= numParts) break;

            const start = part * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, size);
            const chunkSize = end - start;
            
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

            uploadedBytes += chunkSize;
            if (options.onProgress) {
                try { options.onProgress(uploadedBytes, size); } catch {}
            }
        }
    };

    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(concurrency, numParts); i++) {
        workers.push(uploadWorker());
    }
    await Promise.all(workers);

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
}
