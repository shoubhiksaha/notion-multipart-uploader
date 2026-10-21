# notion-multipart-uploader

Production multipart uploader for the Notion API. Upload local files over 20 MiB without external hosting—automatic 10 MiB chunking, progress, retries, cancellation, and concurrent part uploads. Returns a Notion file_upload ID ready to attach to pages and blocks.

## When to use this package

| Need | Recommended approach |
|---|---|
| File ≤ 20 MiB | `@notionhq/client` / native Notion MCP |
| Local file > 20 MiB | `notion-multipart-uploader` |
| File > 20 MiB from an AI workflow | this package, ideally through an MCP wrapper |

## Installation

```bash
npm install notion-multipart-uploader
```

Requires Node.js 20 or later. Works with both `require` and `import`, and ships TypeScript types.

```javascript
import { uploadFile, uploadStream, NotionUploadError } from "notion-multipart-uploader";
```

## API

### `uploadFile(apiKey, filePath, mimeType?, options?)`

Node.js only. Reads the file from disk in 10 MiB chunks, so memory use stays bounded even for 5 GB files. If `mimeType` is omitted, it's inferred from the file extension. Accepts an extra `filename` option to change the name shown in Notion. Returns the Notion `file_upload` ID.

### `uploadToNotion(apiKey, fileData, mimeType, filename?, options?)`

Uploads data that is already in memory: a `Buffer`, `Uint8Array`, `ArrayBuffer`, `Blob`, or a string (encoded as UTF-8). `filename` defaults to `uploaded-file`. Pass `""` as `mimeType` to infer it from `filename`. Returns the Notion `file_upload` ID.

### `uploadStream(apiKey, stream, mimeType, filename, { size, ...options })`

Uploads a stream without buffering the whole file, for example an incoming HTTP request or a download from another service. Accepts a Node.js `Readable`, a web `ReadableStream`, or any async iterable of bytes. `size` must be the exact length of the stream in bytes, because Notion needs the number of parts before the upload starts. At most `concurrency` parts (10 MiB each) are held in memory at once. If the stream turns out shorter or longer than `size`, the upload fails with `size_mismatch`.

```javascript
// Forward an upload from an HTTP request straight to Notion
const fileId = await uploadStream(process.env.NOTION_KEY, req, req.headers["content-type"], "recording.mp4", {
  size: Number(req.headers["content-length"])
});
```

### `inferMimeType(filename)` and `isSupportedFileType(filename, mimeType)`

Helpers for Notion's [supported file types](https://developers.notion.com/docs/working-with-files-and-media). `inferMimeType` returns the MIME type for a supported extension, or `undefined`.

### Options

| Option | Default | Description |
|---|---|---|
| `retries` | `3` | Retries for network errors, timeouts, `429` and `5xx` responses, using exponential backoff with jitter and the `Retry-After` header. Other `4xx` errors fail immediately. |
| `timeoutMs` | none | Timeout for each request, including reading the response. Timed-out requests are retried. |
| `signal` | none | `AbortSignal` that cancels the upload, including in-flight requests and retry delays. |
| `concurrency` | `3` | Number of parts uploaded at the same time for files over 20 MiB. |
| `onProgress` | none | `(uploadedBytes, totalBytes) => void`, called when the upload starts and after each part. Errors thrown by the callback are ignored. |
| `preflight` | `true` | Before uploading, check that Notion supports the file type and, for files over 5 MiB, that the file fits the workspace's upload limit (read from `GET /v1/users/me`). Set to `false` to skip both checks. |
| `notionVersion` | `2026-03-11` | `Notion-Version` header sent with every request. |

If any part of a multi-part upload fails, the remaining parts are stopped and the promise rejects with the first error.

Notion allows an average of 3 requests per second per integration. The default `concurrency` of 3 stays close to that. When Notion answers with `429 Too Many Requests`, every part waits for the `Retry-After` time before sending more requests.

### Errors

Failed uploads reject with a `NotionUploadError`:

| Property | Description |
|---|---|
| `code` | Notion's error code for API errors (such as `validation_error`, `unauthorized`, `rate_limited`), or one of `aborted`, `timeout`, `network_error`, `invalid_response`, `empty_file`, `not_a_file`, `file_too_large`, `unsupported_file_type`, `file_changed`, `size_mismatch` |
| `status` | HTTP status of the failed Notion response, if there was one |
| `retryable` | `true` when trying again later might succeed (rate limits, server errors, timeouts, network errors) |

```javascript
try {
  await uploadFile(process.env.NOTION_KEY, "./video.mp4");
} catch (err) {
  if (err instanceof NotionUploadError && err.code === "file_too_large") {
    console.log("This workspace's plan doesn't allow files this large");
  } else if (err instanceof NotionUploadError && err.retryable) {
    // Try again later
  } else {
    throw err;
  }
}
```

## Frequently Asked Questions

### How do I upload a file larger than 20 MB to Notion with Node.js?

Use the `uploadFile` method to upload massive files using bounded-memory chunk reads. This prevents holding 5 GB files entirely in memory:

```javascript
const { uploadFile } = require("notion-multipart-uploader");

async function uploadLargeVideo() {
  const fileId = await uploadFile(
    process.env.NOTION_KEY, 
    "./massive-video.mp4", 
    "video/mp4",
    {
      retries: 5,
      concurrency: 3, 
      onProgress: (uploaded, total) => console.log(`${Math.round(uploaded/total * 100)}%`)
    }
  );
  console.log("File uploaded with ID:", fileId);
}
```

### How can an AI agent attach a local PDF/video to Notion?

AI workflows generate large files locally. Standard Notion MCP servers stop at 20 MiB.
Agents can use a companion MCP server ([`notion-large-file-upload-mcp`](mcp-server/README.md)) built on top of this package, or call `uploadFile` directly in their generated code to get a valid `file_upload` object for Notion.

### How do I upload a file to Notion without S3 or public URLs?

Notion supports "direct uploads", meaning you send binary data directly to their servers. `notion-multipart-uploader` abstracts the entire direct upload API (create, send chunks, complete) so you don't need AWS S3, Cloudinary, or public URLs.

### How does this differ from `@notionhq/client`?

The official `@notionhq/client` supports simple single-part uploads for small files, but only exposes the raw, low-level endpoints for multipart chunking. `notion-multipart-uploader` is a **convenience wrapper** that implements:
- Automatic 10 MiB chunking (memory-safe with `uploadFile`)
- Smart rate-limit handling (429, 529, `Retry-After`, Jitter)
- Concurrent parallel chunk uploads
- Upload progress callbacks

### How do I attach the uploaded result to a page, database property, image, PDF, audio, or video block?

You pass the returned `file_upload.id` to the standard Notion API (e.g. `@notionhq/client`):

```javascript
const { Client } = require("@notionhq/client");
const notion = new Client({ auth: process.env.NOTION_KEY });

// Attach as a PDF block
await notion.blocks.children.append({
  block_id: "your_page_id",
  children: [{
    object: "block",
    type: "pdf",
    pdf: {
      type: "file_upload",
      file_upload: { id: fileId }
    }
  }]
});
```

## Security Best Practices

**Never** leak your Notion Integration Tokens (`secret_...`) to frontend client code. 
If building a web app, proxy the upload through a secure backend route:

```javascript
// Express.js Backend Example
app.post("/upload-to-notion", upload.single("file"), async (req, res) => {
  try {
    const fileId = await uploadToNotion(
      process.env.NOTION_KEY, // Kept secure on server
      req.file.buffer, 
      req.file.mimetype,
      req.file.originalname
    );
    res.json({ success: true, fileId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

## License

MIT
