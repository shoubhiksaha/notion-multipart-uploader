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

Reference: [Notion File Uploads API](https://developers.notion.com/docs/working-with-files-and-media)
