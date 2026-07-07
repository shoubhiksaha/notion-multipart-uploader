export declare function uploadToNotion(
    apiKey: string,
    fileBuffer: Buffer | Blob,
    mimeType: string,
    filename?: string
): Promise<string>;
