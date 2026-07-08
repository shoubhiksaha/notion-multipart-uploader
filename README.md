# @shoubhiksaha/notion-multipart-uploader

A zero-dependency convenience wrapper around the Notion File Upload APIs.

> npm: https://www.npmjs.com/package/notion-multipart-uploader

## Description

`@shoubhiksaha/notion-multipart-uploader` simplifies Notion multipart upload workflows by handling create/send/complete steps for you. It supports large-file chunking, retries, timeout/abort controls, and clean integration with the Notion SDK.

## Features

- Smart multi-part chunking for large files
- Automatic retry with exponential backoff
- AbortSignal and timeout support
- Clear errors for common Notion workspace/storage failures
- Zero dependencies (native `fetch` / `FormData`)
- Works with audio, video, images, PDFs, and binary buffers

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
  const fileBuffer = fs.readFileSync("./voice-note.m4a");
  const apiKey = "secret_yourNotionApiKeyHere";

  const fileId = await uploadToNotion(
    apiKey,
    fileBuffer,
    "audio/mp4",
    "voice-note.m4a",
    { retries: 5, timeoutMs: 60000 }
  );

  const notion = new Client({ auth: apiKey });
  await notion.pages.create({
    parent: { database_id: "your_database_id" },
    properties: {
      Title: { title: [{ text: { content: "My Voice Note" } }] }
    },
    children: [{
      object: "block",
      type: "audio",
      audio: {
        type: "file_upload",
        file_upload: { id: fileId }
      }
    }]
  });
}

run();
```

## License

MIT
