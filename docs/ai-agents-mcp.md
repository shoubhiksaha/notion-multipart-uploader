# Using with AI Agents and MCP

Notion's hosted MCP server uploads files up to 20 MiB, and Notion's open-source MCP server no longer accepts uploads. Screen recordings, meeting audio, test screenshots and exported reports from AI workflows are often larger. Some other MCP servers can send larger files, but only by having the agent pass the file through the conversation as base64, which fills the model's context window.

## Companion MCP Server: `notion-large-file-upload-mcp`

The companion MCP server uploads local files of up to 5 GB to Notion by path. It reads the file from disk, so the file never passes through the model. It works with MCP clients that run local servers, such as Claude Desktop, Claude Code, Cursor and Zed.

### Quick Setup

#### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "notion-large-files": {
      "command": "npx",
      "args": ["-y", "notion-large-file-upload-mcp"],
      "env": {
        "NOTION_KEY": "secret_your_notion_api_key",
        "NOTION_UPLOAD_ALLOWED_DIRS": "/Users/me/Videos/exports"
      }
    }
  }
}
```

#### Cursor IDE
1. Go to **Settings** -> **Features** -> **MCP**.
2. Click **Add New MCP Server**.
3. Set type to `command`, command to `npx -y notion-large-file-upload-mcp`, and add `NOTION_KEY` and `NOTION_UPLOAD_ALLOWED_DIRS`.

#### Claude Code
```bash
claude mcp add notion-large-files -e NOTION_KEY=secret_... -e NOTION_UPLOAD_ALLOWED_DIRS=/path/to/exports -- npx -y notion-large-file-upload-mcp
```

### Restricting which files can be uploaded
`NOTION_UPLOAD_ALLOWED_DIRS` is required. Set it to the folders your agent writes to (separated by `:`, or `;` on Windows) so a prompt injection can't make the server upload files such as `~/.ssh/id_rsa` or `.env`.

### Available MCP Tools
- `upload_large_file_to_notion`: Uploads any local file up to 5 GB to Notion using streaming multipart chunking. Returns the file ID.
- `upload_and_attach_to_notion`: Uploads and immediately creates a child block (`video`, `pdf`, `image`, `audio`, `file`) on a Notion page. If attaching fails, the error includes the file ID so the agent can retry the attachment without uploading again.
- `attach_file_upload_to_notion`: Attaches an already uploaded file ID as a block. Notion expires uploads that aren't attached within an hour.

### Limitations
- The server reads files from the computer it runs on. Files attached in a chat on claude.ai or ChatGPT aren't on that disk, and web and mobile apps can't run local MCP servers.
- Free Notion workspaces accept files up to 5 MiB. The server reports this before uploading.
