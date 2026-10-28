# notion-large-file-upload-mcp

[![npm version](https://img.shields.io/npm/v/notion-large-file-upload-mcp.svg)](https://www.npmjs.com/package/notion-large-file-upload-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

An MCP server that lets AI agents (Claude Desktop, Claude Code, Cursor, Zed) upload local files of **up to 5 GB** to Notion and attach them to pages. It reads each file from disk by path, so the file never passes through the model's context.

---

### Why this server is needed

- **Notion's hosted MCP server stops at 20 MiB.** Its `notion-create-file-upload` tool only does single-part uploads, and Notion's open-source MCP server no longer accepts uploads at all.
- **Base64 fills the context window.** Some MCP servers can send larger files, but the agent has to pass the file through the conversation as base64, which uses up the model's context after a few files.
- **Agents give up on big files.** Without a way to upload them, agents fall back to thumbnails or links instead of the screen recording, meeting audio, test screenshots or PDF report they produced.

`notion-large-file-upload-mcp` wraps [`notion-multipart-uploader`](https://www.npmjs.com/package/notion-multipart-uploader) to provide:
- **Streaming 10 MiB chunking**: Does not load 5 GB files into RAM.
- **Concurrent chunk uploads**: Parallelizes multi-part uploads with worker queues.
- **Resilient retry engine**: Automatically handles rate limits (`429`), server overload (`529`), exponential backoff with jitter, and `Retry-After` headers.
- **Direct Block Attachment**: Can attach the uploaded asset to a page or block as a `video`, `pdf`, `image`, `audio` or `file` block.
- **Progress and cancellation**: Reports MCP progress notifications while uploading and stops the upload when the client cancels the tool call.

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
        "NOTION_KEY": "secret_your_notion_integration_token",
        "NOTION_UPLOAD_ALLOWED_DIRS": "/Users/me/Videos/exports:/Users/me/Documents/reports"
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
   - **Environment Variables**: `NOTION_KEY=secret_...` and `NOTION_UPLOAD_ALLOWED_DIRS=/path/to/exports`

---

### 3. Claude Code / CLI

```bash
claude mcp add notion-large-files -e NOTION_KEY=secret_... -e NOTION_UPLOAD_ALLOWED_DIRS=/path/to/exports -- npx -y notion-large-file-upload-mcp
```

---

## Configuration

| Environment variable | Required | Description |
|---|---|---|
| `NOTION_KEY` | **Yes** | Notion integration token. `NOTION_API_KEY` and `NOTION_TOKEN` are also accepted. |
| `NOTION_UPLOAD_ALLOWED_DIRS` | **Yes** | Directories files may be uploaded from, separated by `:` (`;` on Windows). The upload tools refuse to run without it. |

### Restricting which files can be uploaded

The tools read files from the machine the server runs on. Without a limit, an agent that is tricked by a prompt injection could upload sensitive files such as `~/.ssh/id_rsa` or `.env` to Notion. That's why `NOTION_UPLOAD_ALLOWED_DIRS` is required: set it to the folders your agent actually produces files in.

Paths must be absolute, and symlinks are resolved before the check, so a link inside an allowed folder can't point outside it. A link that stays inside an allowed folder is uploaded under the link's name.

Before uploading, the server also checks that Notion supports the file type and that the file fits the workspace's upload limit (5 MiB per file on free workspaces), so the agent gets a clear error instead of a failed multi-GB upload.

---

## Available Tools

### `upload_large_file_to_notion`
Uploads a local file of any size up to 5 GB to Notion and returns the Notion `file_upload` ID.

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
| `caption` | string | No | Optional caption text displayed under the block (up to 2,000 characters) |

If the upload succeeds but attaching fails (for example, the page isn't shared with the integration), the error includes the file ID so the agent can retry with `attach_file_upload_to_notion` instead of uploading again.

---

### `attach_file_upload_to_notion`
Attaches an already uploaded file to a Notion page or block. Notion expires uploads that aren't attached within an hour of being created.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `fileUploadId` | string | **Yes** | The `file_upload` ID returned by an upload tool |
| `blockId` | string | **Yes** | Target Notion Page ID or parent Block ID |
| `blockType` | string | **Yes** | `video`, `pdf`, `image`, `audio`, or `file` |
| `caption` | string | No | Optional caption text displayed under the block (up to 2,000 characters) |

---

## Limitations

- The server reads files from the computer it runs on, so it needs an MCP client that runs local servers. Files attached in a chat on claude.ai or ChatGPT aren't on that disk.
- Free Notion workspaces accept files up to 5 MiB. Paid plans allow up to 5 GB.
- Each upload has to be attached within an hour of starting, so a 5 GB file needs about 12 Mbit/s of upload bandwidth.

Its name in the [MCP Registry](https://registry.modelcontextprotocol.io) is `io.github.shoubhiksaha/notion-large-file-upload`.

---

## Local Development

```bash
git clone https://github.com/shoubhiksaha/notion-multipart-uploader.git
cd notion-multipart-uploader
npm install          # one install for the library and the server (npm workspace)
npm run test:mcp     # builds the library and runs the server's tests against it
NOTION_KEY="secret_..." NOTION_UPLOAD_ALLOWED_DIRS="$PWD" npm start -w mcp-server
```

The server is linked to the library in this checkout, so a change to the library is picked up as soon as it's built. The tests start the server over stdio with a fake Notion API, so they don't need a token or network access. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the release process.

## License

MIT © [Shoubhik Saha](https://github.com/shoubhiksaha)
