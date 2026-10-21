// ES module entry point. It re-exports the CommonJS build instead of compiling a second copy,
// so code that mixes import and require shares one NotionUploadError class and `instanceof` works.
export { uploadFile, uploadToNotion, uploadStream, NotionUploadError, inferMimeType, isSupportedFileType } from './index.js';
export type { UploadOptions, UploadFileOptions, UploadStreamOptions, FileData, StreamData } from './index.js';
