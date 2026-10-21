// Preloaded into the MCP server by test-mcp.js (node --require) to replace fetch with a fake Notion API.
// MOCK_NOTION_SCENARIO picks the behavior: "ok", "attach_fail" or "hang" (uploads never finish until aborted).
const fs = require("fs");

const scenario = process.env.MOCK_NOTION_SCENARIO || "ok";
const UPLOAD_ID = "fu_mock";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const log = (entry) => {
  if (process.env.MOCK_REQUEST_LOG) fs.appendFileSync(process.env.MOCK_REQUEST_LOG, JSON.stringify(entry) + "\n");
};

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const notionVersion = new Headers(init.headers).get("notion-version");

  if (url.endsWith("/v1/file_uploads")) {
    log({ type: "create", notionVersion, body: JSON.parse(init.body) });
    return json({
      object: "file_upload",
      id: UPLOAD_ID,
      upload_url: `https://api.notion.com/v1/file_uploads/${UPLOAD_ID}/send`,
      complete_url: `https://api.notion.com/v1/file_uploads/${UPLOAD_ID}/complete`
    });
  }

  if (url.endsWith("/send")) {
    if (scenario === "hang") {
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => {
          fs.writeFileSync(process.env.MOCK_ABORT_MARKER, "aborted");
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }
    return json({ object: "file_upload", id: UPLOAD_ID, status: "uploaded" });
  }

  if (url.endsWith("/complete")) {
    return json({ object: "file_upload", id: UPLOAD_ID, status: "uploaded" });
  }

  if (/\/v1\/blocks\/[^/]+\/children/.test(url)) {
    if (scenario === "attach_fail") {
      return json({ object: "error", status: 404, code: "object_not_found", message: "Could not find block with ID: missing-page." }, 404);
    }
    log({ type: "append", notionVersion, url, body: JSON.parse(init.body) });
    return json({ object: "list", results: [{ object: "block", id: "blk_mock" }] });
  }

  return json({ object: "error", status: 400, code: "validation_error", message: `Unexpected request: ${url}` }, 400);
};
