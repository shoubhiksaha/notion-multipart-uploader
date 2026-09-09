# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.5.0] - 2026-09-09

### Added
- `uploadFile(apiKey, path, mimeType, options)` method for bounded-memory file uploads, reading chunks natively from disk without blowing up memory. Ideal for huge files.
- Smart rate-limit handling using exponential backoff with jitter and `Retry-After` header support.
- Automatically handles `529 Server Overloaded` responses for better stability under load.
- Expanded SDK support for robust server integrations and AI agent usage.
