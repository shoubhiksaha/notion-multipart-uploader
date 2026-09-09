# notion-large-file-upload-mcp

[![npm version](https://img.shields.io/npm/v/notion-large-file-upload-mcp.svg)](https://www.npmjs.com/package/notion-large-file-upload-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A Model Context Protocol (MCP) server that empowers AI agents (Claude Desktop, Cursor, Zed, Claude Code) to upload large files (**> 20 MiB up to 5 GB**) directly to Notion using streaming multipart chunking.

---

### Why this server is needed

Official Notion MCP servers and standard client upload APIs **cap out at 20 MiB** for single uploads.

When autonomous AI workflows generate local assets (video recordings, screen captures, audio podcasts, large datasets, or PDFs over 20 MiB), standard MCP tools fail.

`notion-large-file-upload-mcp` wraps [`notion-multipart-uploader`](https://www.npmjs.com/package/notion-multipart-uploader) to provide:
- **Streaming 10 MiB chunking**: Does not load 5 GB files into RAM.
- **Concurrent chunk uploads**: Parallelizes multi-part uploads with worker queues.
- **Resilient retry engine**: Automatically handles rate limits (`429`), server overload (`529`), exponential backoff with jitter, and `Retry-After` headers.
- **Direct Block Attachment**: Can attach the uploaded asset directly to pages, databases, or blocks (`video`, `pdf`, `image`, `audio`, `file`).

---

## Quick Setup

### 1. Claude Desktop

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "notion-large-files": {
      "command": "npx",
      "args": ["-y", "notion-large-file-upload-mcp"],
      "env": {
        "NOTION_KEY": "secret_your_notion_integration_token"
      }
    }
  }
}
```

Config location:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

---

### 2. Cursor IDE

1. Open **Cursor Settings** -> **Features** -> **MCP**.
2. Click **Add New MCP Server**.
3. Configure:
   - **Name**: `notion-large-files`
   - **Type**: `command`
   - **Command**: `npx -y notion-large-file-upload-mcp`
   - **Environment Variables**: `NOTION_KEY=secret_...`

---

### 3. Claude Code / CLI

```bash
claude mcp add notion-large-files npx -y notion-large-file-upload-mcp -e NOTION_KEY=secret_...
```

---

## Available Tools

### `upload_large_file_to_notion`
Uploads a local file over 20 MiB (up to 5 GB) to Notion and returns the Notion `file_upload` ID.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `filePath` | string | **Yes** | Absolute path to the local file on disk |
| `mimeType` | string | No | MIME type (e.g., `video/mp4`). Automatically inferred if omitted |

---

### `upload_and_attach_to_notion`
Uploads the local file and immediately creates a child block on the target Notion page or block.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `filePath` | string | **Yes** | Absolute path to the local file on disk |
| `blockId` | string | **Yes** | Target Notion Page ID or parent Block ID |
| `blockType` | string | No | `video`, `pdf`, `image`, `audio`, or `file` (inferred from MIME if omitted) |
| `mimeType` | string | No | MIME type (inferred if omitted) |
| `caption` | string | No | Optional caption text displayed under the block |

---

## Local Development

```bash
git clone https://github.com/shoubhiksaha/notion-multipart-uploader.git
cd notion-multipart-uploader/mcp-server
npm install
NOTION_KEY="secret_..." node index.js
```

## License

MIT © [Shoubhik Saha](https://github.com/shoubhiksaha)
