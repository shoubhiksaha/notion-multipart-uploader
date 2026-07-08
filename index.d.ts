export interface UploadOptions {
    /** Override the default Notion API version (default: '2022-06-28') */
    notionVersion?: string;
    /** Number of times to retry failed network requests with exponential backoff (default: 3) */
    retries?: number;
}

export declare function uploadToNotion(
    apiKey: string,
    fileBuffer: Buffer | Blob | Uint8Array,
    mimeType: string,
    filename?: string,
    options?: UploadOptions
): Promise<string>;
