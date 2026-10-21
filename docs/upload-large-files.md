# Uploading large files > 20MB with Node.js

Use `uploadFile` to stream large files (up to 5GB) without blowing up memory.

```javascript
const { uploadFile } = require("notion-multipart-uploader");

async function upload() {
  const fileId = await uploadFile(
    process.env.NOTION_KEY, 
    "./massive-video.mp4", 
    "video/mp4",
    { retries: 5, concurrency: 3 }
  );
  console.log("File uploaded with ID:", fileId);
}
```

The MIME type is optional: `uploadFile(process.env.NOTION_KEY, "./massive-video.mp4")` infers `video/mp4` from the extension.

## Streaming from another source

If the file isn't on disk, for example an incoming HTTP request or a download from another service, use `uploadStream` with the stream's exact size:

```javascript
const { uploadStream } = require("notion-multipart-uploader");

const fileId = await uploadStream(process.env.NOTION_KEY, req, "video/mp4", "recording.mp4", {
  size: Number(req.headers["content-length"])
});
```

Reference: [Notion File Uploads API](https://developers.notion.com/docs/working-with-files-and-media)
