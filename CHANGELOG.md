# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.5.0] - Unreleased

### Added
- `uploadFile(apiKey, path, mimeType, options)` method for bounded-memory file uploads, reading chunks natively from disk without blowing up memory. Ideal for huge files.
- Smart rate-limit handling using exponential backoff with jitter and `Retry-After` header support.
- Automatically handles `529 Server Overloaded` responses for better stability under load.
- Expanded SDK support for robust server integrations and AI agent usage.
- `uploadToNotion` accepts `ArrayBuffer` and other typed array views, and encodes strings as UTF-8.
- `uploadStream(apiKey, stream, mimeType, filename, { size })` uploads Node.js streams, web `ReadableStream`s and async iterables without buffering the whole file.
- `NotionUploadError` with `code`, `status` and `retryable`, thrown for every failed upload.
- `preflight` option (on by default): rejects file types Notion doesn't support, filenames over Notion's 900-byte limit (`filename_too_long`), and files larger than the workspace's upload limit, before uploading anything.
- `uploadFile`'s `mimeType` is optional and inferred from the file extension; new `filename` option to change the name shown in Notion.
- `inferMimeType` and `isSupportedFileType` helpers based on Notion's supported file types.
- ES module entry point (`import { uploadFile } from "notion-multipart-uploader"`) that shares one copy of the code with `require`.
- When Notion responds with `429`, all parallel parts pause until `Retry-After` has passed instead of only the rate-limited one.
- Uses the wait in the response body (`additional_data.retry_after`) when a `429` or `529` has no `Retry-After` header.
- The MCP server has a `server.json` and `mcpName` so releases are listed in the official MCP Registry.

### Fixed
- When one part of a multi-part upload failed, the other workers kept uploading the remaining parts after the promise had rejected. The upload now stops all workers and waits for them before rejecting.
- Aborting during a retry delay (for example a long `Retry-After`) now rejects immediately instead of after the delay.
- Requests that hit `timeoutMs` are now retried like other network failures instead of failing the whole upload. The timeout also covers reading the response body.
- `uploadFile` rejects empty files and directories before contacting Notion.
- `uploadFile` fails with a clear error if the file shrinks during the upload, instead of silently uploading zero-filled data.
- Unsupported `fileBuffer` values (such as streams or plain objects) now throw a `TypeError` instead of a misleading "File buffer is empty" error or a corrupted upload.
- A `429` saying the connection's API access is blocked (`public_api_request_blocked`) is no longer retried, as Notion's docs advise.
- A send or complete that Notion processed but answered with a `5xx` or a timeout is no longer reported as failed. When the retry is rejected because the upload isn't pending anymore, the library checks the upload's status.

### Changed
- Requires Node.js 20 or later.
- Errors are now `NotionUploadError` instances. Messages are unchanged, except that network failures are wrapped as `Network error: ...` with the original error as `cause`.
- `package.json` now has an `exports` map, so only the package root (and `package.json`) can be imported; deep imports such as `notion-multipart-uploader/dist/index.js` no longer work.
- `dist/` is no longer committed; it is built by the `prepare` script on install from git and before packing or publishing.

## [2.4.1] - 2026-09-08

### Fixed
- Clear error for empty buffers, and lower bounds for the `retries` and `concurrency` options.

### Added
- Security note about keeping integration tokens on the server.

## [2.4.0] - 2026-09-08

### Added
- `onProgress(uploadedBytes, totalBytes)` callback for upload progress tracking (#3).

## [2.3.0] - 2026-07-21

### Changed
- Migrated the codebase to TypeScript and ship type declarations.

## [2.2.3] - 2026-07-13

### Fixed
- Enforce Notion's 5 MiB minimum part size.

## [2.2.2] - 2026-07-13

### Added
- Documentation for installing the legacy v1 release.

## [2.2.1] - 2026-07-13

### Fixed
- Race condition guard in the concurrent upload worker.

## [2.2.0] - 2026-07-13

### Added
- `concurrency` option to upload multi-part chunks in parallel (#1).

## [2.1.4] - 2026-07-08

### Added
- Documentation for installing the legacy v1.0.1 release.

## [2.1.3] - 2026-07-08

### Added
- Enforce Notion's 5 GB file size limit and keep uploads under 1,000 parts.

## [2.1.2] - 2026-07-08

### Fixed
- TypeScript buffer type, attachment example in the README, and isolated integration test paths.

## [2.1.1] - 2026-07-08

### Changed
- Use 10 MiB parts, and run the mock tests by default.

### Fixed
- Retry logic bug.

## [2.1.0] - 2026-07-08

### Added
- `timeoutMs` and `signal` options for timeouts and cancellation.

## [2.0.0] - 2026-07-08

### Added
- Automatic multi-part chunking for files over 20 MB, with exponential backoff retries.

## [1.0.1] - 2026-07-08

### Added
- Initial release: zero-dependency single-part file uploader for the Notion API.
