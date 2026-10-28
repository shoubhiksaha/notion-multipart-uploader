# Uploading large files over 20 MB to Notion with Node.js

Notion's API accepts at most 20 MiB per request. Larger files, up to 5 GB on paid workspaces, have to be sent as a multi-part upload: create the upload with the number of parts, send each part, then complete it. `uploadFile` does all of that and reads the file 10 MiB at a time, so memory use stays low.

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

Free workspaces accept files up to 5 MiB. The upload fails with `file_too_large` before sending anything if the file is over the workspace's limit.

## Streaming from another source

If the file isn't on disk, for example an incoming HTTP request or a download from another service, use `uploadStream` with the stream's exact size:

```javascript
const { uploadStream } = require("notion-multipart-uploader");

const fileId = await uploadStream(process.env.NOTION_KEY, req, "video/mp4", "recording.mp4", {
  size: Number(req.headers["content-length"])
});
```

To copy a file that's already in Notion, download its URL (valid for an hour) and pass the response body to `uploadStream`:

```javascript
const res = await fetch(block.video.file.url);
const fileId = await uploadStream(process.env.NOTION_KEY, res.body, res.headers.get("content-type"), "recording.mp4", {
  size: Number(res.headers.get("content-length"))
});
```

Attach the returned ID within an hour of starting the upload. See [Attaching files to Notion](attach-to-notion.md).

Reference: [Uploading larger files](https://developers.notion.com/guides/data-apis/sending-larger-files)
