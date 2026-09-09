# notion-multipart-uploader

Production multipart uploader for the Notion API. Upload local files over 20 MiB without external hosting—automatic 10 MiB chunking, progress, retries, cancellation, and concurrent part uploads. Returns a Notion file_upload ID ready to attach to pages and blocks.

## When to use this package

| Need | Recommended approach |
|---|---|
| File ≤ 20 MiB | `@notionhq/client` / native Notion MCP |
| Local file > 20 MiB | `notion-multipart-uploader` |
| File > 20 MiB from an AI workflow | this package, ideally through an MCP wrapper |

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
Agents can use a companion MCP server (`notion-large-file-upload-mcp`) built on top of this package, or call `uploadFile` directly in their generated code to get a valid `file_upload` object for Notion.

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
