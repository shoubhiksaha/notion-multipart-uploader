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
export declare function uploadFile(apiKey: string, filePath: string, mimeType: string, options?: UploadOptions): Promise<string>;
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
export declare function uploadToNotion(apiKey: string, fileBuffer: Uint8Array | Blob | any, mimeType: string, filename?: string, options?: UploadOptions): Promise<string>;
