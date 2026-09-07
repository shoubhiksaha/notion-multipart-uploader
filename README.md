# @shoubhiksaha/notion-multipart-uploader

A zero-dependency convenience wrapper around the Notion File Upload APIs.

> npm: https://www.npmjs.com/package/notion-multipart-uploader

## Description

`@shoubhiksaha/notion-multipart-uploader` simplifies Notion multipart upload workflows by handling create/send/complete steps for you. It supports large-file chunking, retries, timeout/abort controls, and clean integration with the Notion SDK.

## Features

- **Smart multi-part chunking** for files up to 5GB (paid Notion workspaces)
- **Concurrent uploads** — upload multiple chunks simultaneously (default: 3 parallel workers)
- **Real-time upload progress** via `onProgress(uploadedBytes, totalBytes)` callback — hook directly to frontend progress bars
- **Exponential backoff** retries for network resilience
- **AbortSignal and timeout** support for cancellable uploads
- **Fatal error detection** — 4xx errors are never retried (prevents infinite loops on billing limits)
- **Zero dependencies** — native `fetch` / `FormData` only
- Works with audio, video, images, PDFs, and any binary buffer

## Installation

```bash
npm install notion-multipart-uploader
```

## Usage

```javascript
const { uploadToNotion } = require("notion-multipart-uploader");
const { Client } = require("@notionhq/client");
const fs = require("fs");

async function run() {
  const fileBuffer = fs.readFileSync("./large-document.pdf");
  const apiKey = "secret_yourNotionApiKeyHere";

  const fileId = await uploadToNotion(
    apiKey,
    fileBuffer,
    "application/pdf",
    "large-document.pdf",
    {
      retries: 5,        // Auto-retry network failures 5 times
      timeoutMs: 60000,  // Kill request if it hangs for 60s
      concurrency: 3,    // Upload 3 chunks simultaneously (for large files)
      onProgress: (uploadedBytes, totalBytes) => {
        const percent = Math.round((uploadedBytes / totalBytes) * 100);
        console.log(`Uploading: ${percent}% (${uploadedBytes}/${totalBytes} bytes)`);
      }
    }
  );

  const notion = new Client({ auth: apiKey });
  await notion.pages.create({
    parent: { database_id: "your_database_id" },
    properties: {
      Title: { title: [{ text: { content: "My Uploaded PDF" } }] }
    },
    children: [{
      object: "block",
      type: "pdf",
      pdf: {
        type: "file_upload",
        file_upload: { id: fileId }
      }
    }]
  });
}

run();
```

### React / Frontend Progress Bar Example

```tsx
import React, { useState } from "react";
import { uploadToNotion } from "notion-multipart-uploader";

export function FileUploader({ notionApiKey }: { notionApiKey: string }) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>("");

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus("Uploading...");
    const fileId = await uploadToNotion(
      notionApiKey,
      file,
      file.type,
      file.name,
      {
        onProgress: (uploaded, total) => {
          setProgress(Math.round((uploaded / total) * 100));
        }
      }
    );
    setStatus(`Uploaded! Notion File ID: ${fileId}`);
  };

  return (
    <div>
      <input type="file" onChange={handleUpload} />
      {progress > 0 && <progress value={progress} max="100" />}
      <span>{progress}%</span>
      <p>{status}</p>
    </div>
  );
}
```

## Legacy Lightweight Version

If you are only uploading very small files (< 20MB) and want the absolute leanest version of this package without the multipart chunking or concurrency logic, you can install the legacy `v1.0.1`:

```bash
npm install notion-multipart-uploader@1.0.1
```

## License

MIT
