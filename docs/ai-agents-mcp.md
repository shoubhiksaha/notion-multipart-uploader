# Using with AI Agents and MCP

Standard Notion MCP servers can only upload files up to 20 MiB. AI generated videos, audio, datasets, and complex exports often exceed this limit.

## Companion MCP Server: `notion-large-file-upload-mcp`

You can connect AI agents (Claude Desktop, Cursor, Zed, Claude Code) directly to our companion MCP server.

### Quick Setup

#### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "notion-large-files": {
      "command": "npx",
      "args": ["-y", "notion-large-file-upload-mcp"],
      "env": {
        "NOTION_KEY": "secret_your_notion_api_key"
      }
    }
  }
}
```

#### Cursor IDE
1. Go to **Settings** -> **Features** -> **MCP**.
2. Click **Add New MCP Server**.
3. Set type to `command`, command to `npx -y notion-large-file-upload-mcp`, and add `NOTION_KEY`.

#### Claude Code
```bash
claude mcp add notion-large-files -e NOTION_KEY=secret_... -- npx -y notion-large-file-upload-mcp
```

### Restricting which files can be uploaded
The server can read any file its process can access. Set `NOTION_UPLOAD_ALLOWED_DIRS` to the folders your agent writes to (separated by `:`, or `;` on Windows) so a prompt injection can't make it upload files such as `~/.ssh/id_rsa` or `.env`.

### Available MCP Tools
- `upload_large_file_to_notion`: Uploads any local file up to 5 GB to Notion using streaming multipart chunking. Returns the file ID.
- `upload_and_attach_to_notion`: Uploads and immediately creates a child block (`video`, `pdf`, `image`, `audio`, `file`) on a Notion page. If attaching fails, the error includes the file ID so the agent can retry the attachment without uploading again.
- `attach_file_upload_to_notion`: Attaches an already uploaded file ID as a block. Notion discards uploads that aren't attached within an hour.
