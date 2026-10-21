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

Requires Node.js 20 or later.

## API

### `uploadFile(apiKey, filePath, mimeType, options?)`

Node.js only. Reads the file from disk in 10 MiB chunks, so memory use stays bounded even for 5 GB files. Returns the Notion `file_upload` ID.

### `uploadToNotion(apiKey, fileData, mimeType, filename?, options?)`

Uploads data that is already in memory: a `Buffer`, `Uint8Array`, `ArrayBuffer`, `Blob`, or a string (encoded as UTF-8). `filename` defaults to `uploaded-file`. Returns the Notion `file_upload` ID.

### Options

| Option | Default | Description |
|---|---|---|
| `retries` | `3` | Retries for network errors, timeouts, `429` and `5xx` responses, using exponential backoff with jitter and the `Retry-After` header. Other `4xx` errors fail immediately. |
| `timeoutMs` | none | Timeout for each request, including reading the response. Timed-out requests are retried. |
| `signal` | none | `AbortSignal` that cancels the upload, including in-flight requests and retry delays. |
| `concurrency` | `3` | Number of parts uploaded at the same time for files over 20 MiB. |
| `onProgress` | none | `(uploadedBytes, totalBytes) => void`, called when the upload starts and after each part. Errors thrown by the callback are ignored. |
| `notionVersion` | `2026-03-11` | `Notion-Version` header sent with every request. |

If any part of a multi-part upload fails, the remaining parts are stopped and the promise rejects with the first error.

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
