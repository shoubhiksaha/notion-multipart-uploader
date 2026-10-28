#!/usr/bin/env node

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { uploadFile, inferMimeType } = require("notion-multipart-uploader");
const { Client } = require("@notionhq/client");
const fs = require("fs/promises");
const path = require("path");
const { version } = require("./package.json");

// Same API version notion-multipart-uploader uses, so uploads and attachments agree
const NOTION_VERSION = "2026-03-11";
const BLOCK_TYPES = ["video", "pdf", "image", "audio", "file"];
// Notion's limit for the content of a single rich text item
const MAX_CAPTION_LENGTH = 2000;

// Directories (separated like PATH) that files may be uploaded from. Upload tools refuse to run without it.
const ALLOWED_DIRS = (process.env.NOTION_UPLOAD_ALLOWED_DIRS || "")
  .split(path.delimiter)
  .map((dir) => dir.trim())
  .filter(Boolean)
  .map((dir) => path.resolve(dir));

function getMimeType(filePath, providedMime) {
  if (providedMime && typeof providedMime === "string" && providedMime.trim() !== "") {
    return providedMime.trim();
  }
  return inferMimeType(path.basename(filePath)) || "application/octet-stream";
}

// CAD drawings use image/* types but Notion attaches them as file blocks
const FILE_BLOCK_MIME_TYPES = ["image/vnd.dwg", "image/vnd.dxf"];

function inferBlockType(mimeType) {
  // Agents sometimes pass "Video/MP4" or "image/png; charset=binary"
  const type = String(mimeType).split(";")[0].trim().toLowerCase();
  if (FILE_BLOCK_MIME_TYPES.includes(type)) return "file";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf") return "pdf";
  return "file";
}

function isInside(dir, target) {
  const relative = path.relative(dir, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

// Resolves symlinks before the allow-list check so a link can't point outside an allowed directory
async function resolveUploadPath(filePath) {
  if (!path.isAbsolute(filePath)) {
    throw new Error(`filePath must be an absolute path, got: ${filePath}`);
  }

  let realPath;
  try {
    realPath = await fs.realpath(filePath);
  } catch (err) {
    if (err.code === "ENOENT") throw new Error(`File not found: ${filePath}`);
    throw err;
  }

  const allowedDirs = await Promise.all(ALLOWED_DIRS.map((dir) => fs.realpath(dir).catch(() => dir)));
  if (!allowedDirs.some((dir) => isInside(dir, realPath))) {
    throw new Error(`Access denied: ${filePath} is outside the directories allowed by NOTION_UPLOAD_ALLOWED_DIRS (${ALLOWED_DIRS.join(path.delimiter)})`);
  }

  return realPath;
}

function validateAttachArgs({ blockId, blockType, caption }) {
  if (!blockId || typeof blockId !== "string") return "blockId must be a Notion page or block ID.";
  // null and "" mean "not given", which agents often send for optional parameters
  if (blockType != null && blockType !== "" && !BLOCK_TYPES.includes(blockType)) {
    return `blockType must be one of: ${BLOCK_TYPES.join(", ")}.`;
  }
  if (caption !== undefined && (typeof caption !== "string" || caption.trim().length > MAX_CAPTION_LENGTH)) {
    return `caption must be a string of at most ${MAX_CAPTION_LENGTH} characters.`;
  }
  return null;
}

async function uploadForTool(apiKey, filePath, mimeType, request, extra) {
  const resolvedPath = await resolveUploadPath(filePath);
  // Name and type come from the path the agent gave, so a symlink keeps its own name in Notion
  const filename = path.basename(filePath);
  const resolvedMime = getMimeType(filename, mimeType);
  const progressToken = request.params._meta?.progressToken;

  const fileId = await uploadFile(apiKey, resolvedPath, resolvedMime, {
    filename,
    retries: 4,
    concurrency: 3,
    signal: extra.signal,
    onProgress: progressToken === undefined ? undefined : (uploaded, total) => {
      extra.sendNotification({
        method: "notifications/progress",
        params: { progressToken, progress: uploaded, total }
      }).catch(() => {});
    }
  });

  return { fileId, resolvedPath, resolvedMime };
}

async function attachFileUpload(apiKey, { fileId, blockId, blockType, caption }) {
  const blockPayload = {
    object: "block",
    type: blockType,
    [blockType]: {
      type: "file_upload",
      file_upload: { id: fileId }
    }
  };

  if (caption && caption.trim().length > 0) {
    blockPayload[blockType].caption = [
      {
        type: "text",
        text: { content: caption.trim() }
      }
    ];
  }

  const notion = new Client({ auth: apiKey, notionVersion: NOTION_VERSION });
  const appendRes = await notion.blocks.children.append({
    block_id: blockId,
    children: [blockPayload]
  });

  const createdBlock = appendRes.results && appendRes.results[0];
  return createdBlock ? createdBlock.id : "created";
}

const errorResult = (text) => ({ isError: true, content: [{ type: "text", text }] });

const blockTypeSchema = {
  type: "string",
  enum: BLOCK_TYPES
};

const captionSchema = {
  type: "string",
  maxLength: MAX_CAPTION_LENGTH,
  description: "Optional text caption to display beneath the file block in Notion."
};

const server = new Server(
  {
    name: "notion-large-file-upload-mcp",
    version
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
        description: "Uploads a local file (especially > 20 MiB up to 5 GB) to Notion using streaming multipart chunking. Bypasses Notion MCP's 20 MiB limit. Returns the Notion file_upload ID, which must be attached to a page or block before it expires.",
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
              ...blockTypeSchema,
              description: "Optional block type. If omitted, inferred from MIME type."
            },
            caption: captionSchema
          },
          required: ["filePath", "blockId"]
        }
      },
      {
        name: "attach_file_upload_to_notion",
        description: "Attaches a file that was already uploaded (a Notion file_upload ID) as a block to a Notion page or parent block. Use it after upload_large_file_to_notion, or to retry a failed attachment without uploading again.",
        inputSchema: {
          type: "object",
          properties: {
            fileUploadId: {
              type: "string",
              description: "The Notion file_upload ID returned by an upload tool."
            },
            blockId: {
              type: "string",
              description: "The Notion page ID or parent block ID where the file should be appended."
            },
            blockType: {
              ...blockTypeSchema,
              description: "The block type to create for the file."
            },
            caption: captionSchema
          },
          required: ["fileUploadId", "blockId", "blockType"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const apiKey = process.env.NOTION_KEY || process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
  if (!apiKey) {
    return errorResult("Missing Notion integration token. Please set the NOTION_KEY (or NOTION_API_KEY) environment variable.");
  }

  const { name, arguments: args } = request.params;

  if (name !== "attach_file_upload_to_notion" && ALLOWED_DIRS.length === 0) {
    return errorResult("NOTION_UPLOAD_ALLOWED_DIRS is not set. Set it to the directories files may be uploaded from (separated by \"" + path.delimiter + "\"), so the server can't be used to upload arbitrary files from this machine.");
  }

  try {
    if (name === "upload_large_file_to_notion") {
      const { filePath, mimeType } = args || {};
      if (!filePath || typeof filePath !== "string") {
        return errorResult("filePath parameter is required.");
      }

      const { fileId, resolvedPath, resolvedMime } = await uploadForTool(apiKey, filePath, mimeType, request, extra);

      return {
        content: [
          {
            type: "text",
            text: `✅ File successfully uploaded to Notion via multipart uploader!\n- File ID: ${fileId}\n- File Path: ${resolvedPath}\n- MIME: ${resolvedMime}\n\nAttach it before it expires with attach_file_upload_to_notion, or reference it in page properties or blocks using: { "type": "file_upload", "file_upload": { "id": "${fileId}" } }`
          }
        ]
      };
    }

    if (name === "upload_and_attach_to_notion") {
      const { filePath, blockId, mimeType, blockType, caption } = args || {};
      if (!filePath || typeof filePath !== "string" || !blockId) {
        return errorResult("Both filePath and blockId parameters are required.");
      }
      const invalid = validateAttachArgs({ blockId, blockType, caption });
      if (invalid) return errorResult(invalid);

      const { fileId, resolvedPath, resolvedMime } = await uploadForTool(apiKey, filePath, mimeType, request, extra);
      const targetBlockType = blockType || inferBlockType(resolvedMime);

      let createdBlockId;
      try {
        createdBlockId = await attachFileUpload(apiKey, { fileId, blockId, blockType: targetBlockType, caption });
      } catch (error) {
        return errorResult(`The file was uploaded, but attaching it to ${blockId} failed: ${error.message || String(error)}\n- File ID: ${fileId}\n- Block Type: ${targetBlockType}\n\nDon't upload it again: fix the problem (for example, share the page with the integration) and call attach_file_upload_to_notion with this file ID before the upload expires.`);
      }

      return {
        content: [
          {
            type: "text",
            text: `✅ File successfully uploaded and attached to Notion block/page ${blockId}!\n- File ID: ${fileId}\n- Block Type: ${targetBlockType}\n- Block ID: ${createdBlockId}\n- File Path: ${resolvedPath}`
          }
        ]
      };
    }

    if (name === "attach_file_upload_to_notion") {
      const { fileUploadId, blockId, blockType, caption } = args || {};
      if (!fileUploadId || typeof fileUploadId !== "string" || !blockType) {
        return errorResult("fileUploadId, blockId and blockType parameters are required.");
      }
      const invalid = validateAttachArgs({ blockId, blockType, caption });
      if (invalid) return errorResult(invalid);

      const createdBlockId = await attachFileUpload(apiKey, { fileId: fileUploadId, blockId, blockType, caption });

      return {
        content: [
          {
            type: "text",
            text: `✅ File attached to Notion block/page ${blockId}!\n- File ID: ${fileUploadId}\n- Block Type: ${blockType}\n- Block ID: ${createdBlockId}`
          }
        ]
      };
    }

    return errorResult(`Unknown tool name: ${name}`);
  } catch (error) {
    const action = name === "attach_file_upload_to_notion" ? "Attach" : "Upload";
    return errorResult(`${action} failed: ${error.message || String(error)}`);
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
