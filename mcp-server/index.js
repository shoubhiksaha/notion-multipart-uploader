#!/usr/bin/env node

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { uploadFile } = require("notion-multipart-uploader");
const { Client } = require("@notionhq/client");
const path = require("path");

function getMimeType(filePath, providedMime) {
  if (providedMime && typeof providedMime === "string" && providedMime.trim() !== "") {
    return providedMime.trim();
  }
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".csv": "text/csv",
    ".json": "application/json",
    ".txt": "text/plain"
  };
  return map[ext] || "application/octet-stream";
}

function inferBlockType(mimeType) {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "pdf";
  return "file";
}

const server = new Server(
  {
    name: "notion-large-file-upload-mcp",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "upload_large_file_to_notion",
        description: "Uploads a local file (especially > 20 MiB up to 5 GB) to Notion using streaming multipart chunking. Bypasses Notion MCP's 20 MiB limit. Returns the Notion file_upload ID.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: {
              type: "string",
              description: "Absolute path to the local file (e.g., /path/to/large-video.mp4)."
            },
            mimeType: {
              type: "string",
              description: "Optional MIME type (e.g., video/mp4, application/pdf). If omitted, inferred from file extension."
            }
          },
          required: ["filePath"]
        }
      },
      {
        name: "upload_and_attach_to_notion",
        description: "Uploads a large local file (> 20 MiB up to 5 GB) and immediately attaches it as a block to a Notion page or parent block.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: {
              type: "string",
              description: "Absolute path to the local file to upload."
            },
            blockId: {
              type: "string",
              description: "The Notion page ID or parent block ID where the file should be appended."
            },
            mimeType: {
              type: "string",
              description: "Optional MIME type. If omitted, inferred from file extension."
            },
            blockType: {
              type: "string",
              description: "Optional block type: 'video', 'pdf', 'image', 'audio', or 'file'. If omitted, inferred from MIME type."
            },
            caption: {
              type: "string",
              description: "Optional text caption to display beneath the file block in Notion."
            }
          },
          required: ["filePath", "blockId"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const apiKey = process.env.NOTION_KEY || process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
  if (!apiKey) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "Missing Notion integration token. Please set the NOTION_KEY (or NOTION_API_KEY) environment variable."
        }
      ]
    };
  }

  const { name, arguments: args } = request.params;

  try {
    if (name === "upload_large_file_to_notion") {
      const { filePath, mimeType } = args || {};
      if (!filePath) {
        return {
          isError: true,
          content: [{ type: "text", text: "filePath parameter is required." }]
        };
      }

      const resolvedMime = getMimeType(filePath, mimeType);
      const fileId = await uploadFile(apiKey, filePath, resolvedMime, {
        retries: 4,
        concurrency: 3
      });

      return {
        content: [
          {
            type: "text",
            text: `✅ File successfully uploaded to Notion via multipart uploader!\n- File ID: ${fileId}\n- File Path: ${filePath}\n- MIME: ${resolvedMime}\n\nYou can now reference this file in page properties or blocks using: { "type": "file_upload", "file_upload": { "id": "${fileId}" } }`
          }
        ]
      };
    }

    if (name === "upload_and_attach_to_notion") {
      const { filePath, blockId, mimeType, blockType, caption } = args || {};
      if (!filePath || !blockId) {
        return {
          isError: true,
          content: [{ type: "text", text: "Both filePath and blockId parameters are required." }]
        };
      }

      const resolvedMime = getMimeType(filePath, mimeType);
      const targetBlockType = blockType || inferBlockType(resolvedMime);

      const fileId = await uploadFile(apiKey, filePath, resolvedMime, {
        retries: 4,
        concurrency: 3
      });

      const notion = new Client({ auth: apiKey });

      const blockPayload = {
        object: "block",
        type: targetBlockType,
        [targetBlockType]: {
          type: "file_upload",
          file_upload: { id: fileId }
        }
      };

      if (caption && typeof caption === "string" && caption.trim().length > 0) {
        blockPayload[targetBlockType].caption = [
          {
            type: "text",
            text: { content: caption.trim() }
          }
        ];
      }

      const appendRes = await notion.blocks.children.append({
        block_id: blockId,
        children: [blockPayload]
      });

      const createdBlock = appendRes.results && appendRes.results[0];
      const createdBlockId = createdBlock ? createdBlock.id : "created";

      return {
        content: [
          {
            type: "text",
            text: `✅ File successfully uploaded and attached to Notion block/page ${blockId}!\n- File ID: ${fileId}\n- Block Type: ${targetBlockType}\n- Block ID: ${createdBlockId}\n- File Path: ${filePath}`
          }
        ]
      };
    }

    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool name: ${name}` }]
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Upload failed: ${error.message || String(error)}`
        }
      ]
    };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

run().catch((err) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});
