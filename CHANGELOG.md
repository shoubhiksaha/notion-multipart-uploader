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

### Fixed
- When one part of a multi-part upload failed, the other workers kept uploading the remaining parts after the promise had rejected. The upload now stops all workers and waits for them before rejecting.
- Aborting during a retry delay (for example a long `Retry-After`) now rejects immediately instead of after the delay.
- Requests that hit `timeoutMs` are now retried like other network failures instead of failing the whole upload. The timeout also covers reading the response body.
- `uploadFile` rejects empty files and directories before contacting Notion.
- `uploadFile` fails with a clear error if the file shrinks during the upload, instead of silently uploading zero-filled data.
- Unsupported `fileBuffer` values (such as streams or plain objects) now throw a `TypeError` instead of a misleading "File buffer is empty" error or a corrupted upload.

### Changed
- Requires Node.js 20 or later.
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
