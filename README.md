# notion-multipart-uploader

Upload files larger than 20 MB (up to 5 GB) to Notion with the Notion API, from Node.js or from AI agents. Notion accepts at most 20 MiB per request, so bigger files must be split into parts, sent and completed as a multi-part upload. This package does all of that for you, reading 10 MiB at a time from disk or from a stream, with retries, rate-limit handling, progress and cancellation. It returns a Notion `file_upload` ID that you can attach to pages, blocks, database properties, covers and comments. No S3 or public URLs needed, and no dependencies.

## Quick start

```bash
npm install notion-multipart-uploader
```

```javascript
import { Client } from "@notionhq/client";
import { uploadFile } from "notion-multipart-uploader";

// Splits the file into parts, uploads them in parallel and completes the upload
const fileId = await uploadFile(process.env.NOTION_KEY, "./demo-recording.mp4");

// Attach it to a page as a video block
const notion = new Client({ auth: process.env.NOTION_KEY });
await notion.blocks.children.append({
  block_id: process.env.NOTION_PAGE_ID,
  children: [{ type: "video", video: { type: "file_upload", file_upload: { id: fileId } } }]
});
```

Requires Node.js 20 or later. Works with both `import` and `require`, and ships TypeScript types. Using Claude, Cursor or another AI agent? See the [MCP server](mcp-server/README.md).

## When to use this package

| Situation | What to use |
|---|---|
| A file over 20 MiB on disk, in memory, or streamed from another service | This package |
| An AI agent (Claude Desktop, Claude Code, Cursor) that needs to upload local files | [`notion-large-file-upload-mcp`](mcp-server/README.md), built on this package |
| A small file (20 MiB or less) | `@notionhq/client`'s `fileUploads` methods work fine. This package still saves you the create and send steps and the error handling. |
| A file at a public HTTPS URL | Notion can import it for you with an [`external_url` upload](https://developers.notion.com/guides/data-apis/importing-external-files). Use this package when the URL needs authentication, or when the source isn't a URL. |
| A free Notion workspace | Notion limits free workspaces to 5 MiB per file, and no tool can get around that. This package reports it before uploading anything. |

## API

### `uploadFile(apiKey, filePath, mimeType?, options?)`

Node.js only. Reads the file from disk in 10 MiB chunks, so memory use stays bounded even for 5 GB files. If `mimeType` is omitted, it's inferred from the file extension. Accepts an extra `filename` option to change the name shown in Notion. Returns the Notion `file_upload` ID.

### `uploadToNotion(apiKey, fileData, mimeType, filename?, options?)`

Uploads data that is already in memory: a `Buffer`, `Uint8Array`, `ArrayBuffer`, `Blob`, or a string (encoded as UTF-8). `filename` defaults to `uploaded-file`. Pass `""` as `mimeType` to infer it from `filename`. Returns the Notion `file_upload` ID.

### `uploadStream(apiKey, stream, mimeType, filename, { size, ...options })`

Uploads a stream without buffering the whole file, for example an incoming HTTP request or a download from S3, Google Drive or another Notion page. Accepts a Node.js `Readable`, a web `ReadableStream`, or any async iterable of bytes. `size` must be the exact length of the stream in bytes, because Notion needs the number of parts before the upload starts. At most `concurrency` parts (10 MiB each) are held in memory at once. If the stream turns out shorter or longer than `size`, the upload fails with `size_mismatch`.

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
| `retries` | `3` | Retries for network errors, timeouts, `429` and `5xx` responses, using exponential backoff with jitter and Notion's `Retry-After` wait. Other `4xx` errors fail immediately. |
| `timeoutMs` | none | Timeout for each request, including reading the response. Timed-out requests are retried. |
| `signal` | none | `AbortSignal` that cancels the upload, including in-flight requests and retry delays. |
| `concurrency` | `3` | Number of parts uploaded at the same time for files over 20 MiB. |
| `onProgress` | none | `(uploadedBytes, totalBytes) => void`, called when the upload starts and after each part. Errors thrown by the callback are ignored. |
| `preflight` | `true` | Before uploading, check that Notion supports the file type, that the filename fits Notion's 900-byte limit and, for files over 5 MiB, that the file fits the workspace's upload limit (read from `GET /v1/users/me`). Set to `false` to skip these checks. |
| `notionVersion` | `2026-03-11` | `Notion-Version` header sent with every request. |

If any part of a multi-part upload fails, the remaining parts are stopped and the promise rejects with the first error.

Notion [limits each connection](https://developers.notion.com/reference/request-limits) to 180 requests per minute (600 on Business and Enterprise plans), plus a limit shared by the whole workspace. When Notion answers with `429 Too Many Requests`, every part waits for the `Retry-After` time before sending more requests. A `429` saying the connection's API access is blocked isn't retried, because waiting won't help.

If a request to send or complete the upload goes through but Notion still answers with an error (such as a `504` on a slow complete), the retry would normally fail because the upload is no longer pending. The library checks the upload's status in that case and treats it as a success.

### Errors

Failed uploads reject with a `NotionUploadError`:

| Property | Description |
|---|---|
| `code` | Notion's error code for API errors (such as `validation_error`, `unauthorized`, `rate_limited`), or one of `aborted`, `timeout`, `network_error`, `invalid_response`, `empty_file`, `not_a_file`, `file_too_large`, `unsupported_file_type`, `filename_too_long`, `file_changed`, `size_mismatch` |
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

## Attaching the upload

Attach the returned ID within an hour. Notion sets each upload's `expiry_time` to [one hour after it's created](https://developers.notion.com/reference/file-upload), and an upload that expires can't be attached. The hour starts before the upload, so a very large file needs a fast enough connection to finish in time: a 5 GB file takes about 12 Mbit/s of upload bandwidth to finish within the hour.

With [`@notionhq/client`](https://github.com/makenotion/notion-sdk-js):

```javascript
const file = { type: "file_upload", file_upload: { id: fileId } };

// As a block on a page: image, video, audio, pdf or file
await notion.blocks.children.append({ block_id: pageId, children: [{ type: "pdf", pdf: file }] });

// In a database's "Files & media" property
await notion.pages.update({
  page_id: pageId,
  properties: { Attachments: { files: [{ ...file, name: "report.pdf" }] } }
});

// As a page cover (page icons work the same way)
await notion.pages.update({ page_id: pageId, cover: file });
```

You can also attach up to three uploads to a comment with the [Create comment](https://developers.notion.com/reference/create-a-comment) API.

## Frequently asked questions

### How do I upload a file larger than 20 MB to Notion with Node.js?

Use `uploadFile`. Notion's API rejects single requests over 20 MiB, so larger files have to be sent as a multi-part upload: create the upload with the number of parts, send each part with its part number, then complete it. `uploadFile` does all three steps, reading 10 MiB at a time so even a 5 GB file doesn't have to fit in memory:

```javascript
const { uploadFile } = require("notion-multipart-uploader");

const fileId = await uploadFile(process.env.NOTION_KEY, "./massive-video.mp4", "video/mp4", {
  retries: 5,
  concurrency: 3,
  onProgress: (uploaded, total) => console.log(`${Math.round(uploaded / total * 100)}%`)
});
```

### Why does my upload fail on a free Notion workspace?

Free workspaces accept files up to 5 MiB, and they can't use multi-part uploads at all. Paid plans allow up to 5 GB per file. The limit belongs to the workspace you upload to, not to your integration. This package reads the limit before uploading and fails with `file_too_large`, so you don't send gigabytes only to have them rejected.

### How can Claude, Cursor or another AI agent upload large files to Notion?

Use the companion MCP server, [`notion-large-file-upload-mcp`](mcp-server/README.md). Notion's own hosted MCP server uploads files up to 20 MiB, and its open-source MCP server no longer accepts uploads. This server uploads files of up to 5 GB by path: it reads them from disk, so screen recordings, videos and PDFs never pass through the model's context as base64. Agents can also call `uploadFile` directly in code they write.

### How do I copy a file from one Notion page or database to another?

Notion gives you a download URL for each file that's valid for an hour, and the API won't accept that URL as an external file. Download it and stream it into a new upload, without saving it to disk:

```javascript
const { uploadStream } = require("notion-multipart-uploader");

const res = await fetch(block.video.file.url); // The URL from a block, property or comment
const fileId = await uploadStream(process.env.NOTION_KEY, res.body, res.headers.get("content-type"), "recording.mp4", {
  size: Number(res.headers.get("content-length"))
});
```

The same approach moves attachments in from Google Drive, S3, or a migration from OneNote, Confluence or Obsidian.

### Why does Notion say the content type doesn't match the original content type?

Notion rejects a part whose content type differs from the one given when the upload was created. This package sends the same content type with the create request and with every part, so you won't run into it.

### Why does attaching fail with an expired or invalid upload?

Uploads must be attached within an hour of being created (see [Attaching the upload](#attaching-the-upload)). Attach the ID as soon as the upload resolves. If attaching fails, you can retry with the same ID while it's still valid.

### How do I upload a file to Notion without S3 or public URLs?

Notion supports direct uploads, where you send the file's bytes to Notion itself. This package handles the whole direct upload flow (create, send parts, complete), so you don't need AWS S3, Cloudinary or a public URL.

### How is this different from `@notionhq/client`?

The official SDK gives you the raw `fileUploads` endpoints and retries rate-limited requests. For a multi-part upload you still split the file, number and send each part, track progress and call complete yourself. This package does that, and also:
- Uploads parts in parallel, pausing all of them when Notion rate-limits one
- Streams from disk or from any stream without loading the file into memory
- Retries timeouts and network errors for every part
- Checks file type, filename length and the workspace's size limit before uploading
- Reports progress, supports cancellation, and throws typed errors

See [the full comparison](docs/differences-from-sdk.md).

## Security

**Never** expose your Notion integration token (`secret_...` or `ntn_...`) in browser code. Notion's API accepts requests from browsers, but anyone could read the token from your page. Upload through your own backend instead:

```javascript
// Express.js backend
app.post("/upload-to-notion", upload.single("file"), async (req, res) => {
  try {
    const fileId = await uploadToNotion(
      process.env.NOTION_KEY, // Stays on the server
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

## More documentation

- [Uploading large files](docs/upload-large-files.md)
- [Attaching files to Notion](docs/attach-to-notion.md)
- [Using with AI agents and MCP](docs/ai-agents-mcp.md)
- [Differences from @notionhq/client](docs/differences-from-sdk.md)
- [Everything in one file for LLMs](docs/llms-full.txt)
- [Changelog](CHANGELOG.md)

## License

MIT
