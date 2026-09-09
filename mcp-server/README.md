# notion-large-file-upload-mcp

An MCP Server to accompany `notion-multipart-uploader`. Use when a local file exceeds Notion MCP’s 20 MiB upload limit.

## Tools

- `upload_large_file_to_notion`
- `upload_and_attach_to_notion`

## Setup

```json
{
  "mcpServers": {
    "notion-large-file-upload": {
      "command": "node",
      "args": ["/path/to/notion-multipart-uploader/mcp-server/index.js"],
      "env": {
        "NOTION_KEY": "your-notion-api-key"
      }
    }
  }
}
```
