/**
 * Uploads a binary file directly to Notion's servers using native fetch.
 * Automatically handles single-part (<= 20MB) and multi-part (> 20MB) chunking.
 * 
 * @param {string} apiKey - Your Notion Integration Token
 * @param {Buffer|Blob} fileBuffer - The binary data of the file (audio, image, pdf, etc.)
 * @param {string} mimeType - e.g., 'audio/mp4', 'image/jpeg', 'application/pdf'
 * @param {string} filename - The name of the file (e.g., 'voice-note.m4a')
 * @param {object} options - Additional options like retries or Notion API version
 * @returns {Promise<string>} The Notion File ID to use in your blocks
 */
async function uploadToNotion(apiKey, fileBuffer, mimeType, filename, options = {}) {
    if (!apiKey) throw new Error("Notion API Key is required");
    if (!fileBuffer) throw new Error("File buffer is required");

    const notionVersion = options.notionVersion || "2026-03-11";
    const maxRetries = options.retries || 3;
    const timeoutMs = options.timeoutMs;
    const userSignal = options.signal;

    const size = fileBuffer.length || fileBuffer.size || fileBuffer.byteLength;
    
    // Notion strictly limits files to 5GB (paid workspaces)
    if (size > 5 * 1024 * 1024 * 1024) {
        throw new Error("File exceeds Notion's absolute maximum size limit of 5GB.");
    }

    const isMultiPart = size > 20971520; // Notion's 20MB limit
    const mode = isMultiPart ? "multi_part" : "single_part";
    
    // Default to 10MB chunks, but dynamically scale up if we hit the 1000 part limit
    let CHUNK_SIZE = 10 * 1024 * 1024;
    let numParts = isMultiPart ? Math.ceil(size / CHUNK_SIZE) : 1;

    if (numParts > 1000) {
        CHUNK_SIZE = Math.ceil(size / 1000);
        numParts = 1000;
    }

    // Exponential backoff retry wrapper with Abort/Timeout support
    const fetchWithRetry = async (url, fetchOptions, retries = maxRetries) => {
        for (let i = 0; i < retries; i++) {
            const controller = new AbortController();
            let timeoutId;
            
            if (timeoutMs) {
                timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            }

            let abortHandler;
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
                
                // Notion Workspace Limit Check or Bad Request: Don't retry 4xx errors except 429 (Rate Limit)
                if (res.status >= 400 && res.status < 500 && res.status !== 429) {
                    const error = new Error(`Notion API Error (${res.status}): ${await res.text()}`);
                    error.isFatal = true;
                    throw error;
                }
                
                if (i === retries - 1) throw new Error(`Notion API Failed (${res.status}): ${await res.text()}`);
            } catch (err) {
                if (timeoutId) clearTimeout(timeoutId);
                if (userSignal && abortHandler) userSignal.removeEventListener("abort", abortHandler);
                
                if (err.name === 'AbortError') throw new Error(userSignal?.aborted ? "Upload aborted by user" : "Upload timed out");
                if (err.isFatal) throw err;
                if (i === retries - 1) throw err;
            }
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i))); 
        }
    };

    const createBody = {
        filename: filename || "uploaded-file",
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

    // Step 2: Upload the binary data
    if (!isMultiPart) {
        // Single-part upload
        const form = new FormData();
        const blob = new Blob([fileBuffer], { type: mimeType });
        form.append("file", blob, filename || "uploaded-file");

        await fetchWithRetry(upload_url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Notion-Version": notionVersion
            },
            body: form
        });
        return id;
    }

    // Multi-part chunked upload (Concurrent Promise Pool)
    const concurrency = options.concurrency || 3;
    let currentPart = 0;

    const uploadWorker = async () => {
        while (true) {
            // Atomically claim the next part index before any await
            const part = currentPart++;
            if (part >= numParts) break; // Guard: stop if no more parts remain

            const start = part * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, size);
            
            // Handle slice for both Buffer and Blob
            const chunk = typeof fileBuffer.slice === 'function' ? fileBuffer.slice(start, end) : fileBuffer.subarray(start, end);

            const form = new FormData();
            const blob = new Blob([chunk], { type: mimeType });
            form.append("file", blob, filename || "uploaded-file");
            form.append("part_number", (part + 1).toString()); // 1-indexed

            await fetchWithRetry(upload_url, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Notion-Version": notionVersion
                },
                body: form
            });
        }
    };

    // Spin up multiple workers to process chunks in parallel
    const workers = [];
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

module.exports = { uploadToNotion };
