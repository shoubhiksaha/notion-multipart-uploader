export interface UploadOptions {
    /** Override the default Notion API version (default: '2026-03-11') */
    notionVersion?: string;
    /** Number of times to retry failed network requests with exponential backoff (default: 3) */
    retries?: number;
    /** Timeout in milliseconds for each network request */
    timeoutMs?: number;
    /** Standard AbortSignal to cancel the upload at any time */
    signal?: AbortSignal;
}

export declare function uploadToNotion(
    apiKey: string,
    fileBuffer: Uint8Array | Blob | any,
    mimeType: string,
    filename?: string,
    options?: UploadOptions
): Promise<string>;
