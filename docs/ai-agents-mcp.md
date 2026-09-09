# Using with AI Agents and MCP

Standard Notion MCP servers can only upload files up to 20 MiB. AI generated videos and datasets often exceed this.

**Recommended approach for agents:**
Use the `notion-large-file-upload-mcp` server which wraps `notion-multipart-uploader`.

Alternatively, if generating code, use this package directly to handle the >20 MiB multi-part requirements automatically.
