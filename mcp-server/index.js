#!/usr/bin/env node

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { uploadFile } = require("notion-multipart-uploader");
const { Client } = require("@notionhq/client");
const path = require("path");

const server = new Server(
  { name: "notion-large-file-upload-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "upload_large_file_to_notion",
        description: "Uploads a local file over 20 MiB to Notion using multipart chunking. Returns the file_upload id.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "Absolute path to the local file." },
            mimeType: { type: "string", description: "MIME type (e.g., video/mp4, application/pdf)" }
          },
          required: ["filePath", "mimeType"]
        }
      },
      {
        name: "upload_and_attach_to_notion",
        description: "Uploads a large local file and attaches it to an existing Notion page or block.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string" },
            mimeType: { type: "string" },
            blockId: { type: "string", description: "The ID of the Notion block/page to attach to." },
            blockType: { type: "string", description: "Type of block to create (e.g., video, pdf, file)" }
          },
          required: ["filePath", "mimeType", "blockId", "blockType"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const apiKey = process.env.NOTION_KEY;
  if (!apiKey) throw new Error("NOTION_KEY environment variable is required.");

  if (request.params.name === "upload_large_file_to_notion") {
    const { filePath, mimeType } = request.params.arguments;
    const fileId = await uploadFile(apiKey, filePath, mimeType, { concurrency: 3 });
    return { content: [{ type: "text", text: `Successfully uploaded. File ID: ${fileId}` }] };
  }

  if (request.params.name === "upload_and_attach_to_notion") {
    const { filePath, mimeType, blockId, blockType } = request.params.arguments;
    const fileId = await uploadFile(apiKey, filePath, mimeType, { concurrency: 3 });
    
    const notion = new Client({ auth: apiKey });
    await notion.blocks.children.append({
      block_id: blockId,
      children: [{
        type: blockType,
        [blockType]: { type: "file_upload", file_upload: { id: fileId } }
      }]
    });
    return { content: [{ type: "text", text: `Successfully uploaded and attached to block ${blockId}.` }] };
  }
  
  throw new Error("Unknown tool");
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

run().catch(console.error);
