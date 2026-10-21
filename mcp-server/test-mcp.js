const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

const serverPath = path.join(__dirname, "index.js");
const mockPath = path.join(__dirname, "test-fetch-mock.js");

// realpath because the server reports resolved paths (e.g. /var -> /private/var on macOS)
const workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nmu-mcp-test-")));
const pdfPath = path.join(workDir, "report.pdf");
fs.writeFileSync(pdfPath, "%PDF-1.4 mock");

// Starts the real server over stdio with fetch replaced by the fake Notion API
async function connect(env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--require", mockPath, serverPath],
    env: { ...process.env, NOTION_KEY: "secret_test_mock", NOTION_API_KEY: "", NOTION_TOKEN: "", ...env },
    stderr: "inherit"
  });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function withServer(env, fn) {
  const client = await connect(env);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

const textOf = (result) => result.content.map((c) => c.text).join("\n");

function readRequestLog(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

test("lists the three tools with block type enums", () => withServer({}, async (client) => {
  const { tools } = await client.listTools();
  assert.deepStrictEqual(tools.map((t) => t.name), [
    "upload_large_file_to_notion",
    "upload_and_attach_to_notion",
    "attach_file_upload_to_notion"
  ]);
  assert.deepStrictEqual(tools[1].inputSchema.properties.blockType.enum, ["video", "pdf", "image", "audio", "file"]);
  assert.strictEqual(client.getServerVersion().version, require("./package.json").version);
}));

test("upload_large_file_to_notion uploads through the library and reports progress", () => withServer({}, async (client) => {
  const progress = [];
  const result = await client.callTool(
    { name: "upload_large_file_to_notion", arguments: { filePath: pdfPath } },
    undefined,
    { onprogress: (p) => progress.push(p) }
  );

  assert.ok(!result.isError, textOf(result));
  assert.match(textOf(result), /File ID: fu_mock/);
  assert.match(textOf(result), /MIME: application\/pdf/);
  const size = fs.statSync(pdfPath).size;
  assert.deepStrictEqual(progress.at(-1), { progress: size, total: size });
}));

test("upload_and_attach_to_notion appends an inferred block with the same Notion version", async () => {
  const logPath = path.join(workDir, "attach.log");
  await withServer({ MOCK_REQUEST_LOG: logPath }, async (client) => {
    const result = await client.callTool({
      name: "upload_and_attach_to_notion",
      arguments: { filePath: pdfPath, blockId: "page_123", caption: "  Quarterly report  " }
    });
    assert.ok(!result.isError, textOf(result));
    assert.match(textOf(result), /Block ID: blk_mock/);
  });

  const [create, append] = readRequestLog(logPath);
  assert.strictEqual(append.notionVersion, create.notionVersion);
  assert.match(append.url, /\/blocks\/page_123\/children$/);
  assert.deepStrictEqual(append.body.children[0].pdf, {
    type: "file_upload",
    file_upload: { id: "fu_mock" },
    caption: [{ type: "text", text: { content: "Quarterly report" } }]
  });
});

test("a failed attachment returns the uploaded file ID so it can be retried", () => withServer({ MOCK_NOTION_SCENARIO: "attach_fail" }, async (client) => {
  const result = await client.callTool({
    name: "upload_and_attach_to_notion",
    arguments: { filePath: pdfPath, blockId: "missing-page" }
  });
  assert.strictEqual(result.isError, true);
  assert.match(textOf(result), /File ID: fu_mock/);
  assert.match(textOf(result), /Could not find block/);
  assert.match(textOf(result), /attach_file_upload_to_notion/);
}));

test("attach_file_upload_to_notion attaches an existing upload", async () => {
  const logPath = path.join(workDir, "attach-existing.log");
  await withServer({ MOCK_REQUEST_LOG: logPath }, async (client) => {
    const result = await client.callTool({
      name: "attach_file_upload_to_notion",
      arguments: { fileUploadId: "fu_existing", blockId: "page_456", blockType: "video" }
    });
    assert.ok(!result.isError, textOf(result));
  });

  const [append] = readRequestLog(logPath);
  assert.deepStrictEqual(append.body.children[0].video, { type: "file_upload", file_upload: { id: "fu_existing" } });
});

test("rejects invalid arguments before uploading", () => withServer({}, async (client) => {
  const badType = await client.callTool({
    name: "upload_and_attach_to_notion",
    arguments: { filePath: pdfPath, blockId: "page_123", blockType: "Video" }
  });
  assert.strictEqual(badType.isError, true);
  assert.match(textOf(badType), /blockType must be one of/);

  const relative = await client.callTool({
    name: "upload_large_file_to_notion",
    arguments: { filePath: "report.pdf" }
  });
  assert.strictEqual(relative.isError, true);
  assert.match(textOf(relative), /must be an absolute path/);

  const missing = await client.callTool({
    name: "upload_large_file_to_notion",
    arguments: { filePath: path.join(workDir, "nope.mp4") }
  });
  assert.strictEqual(missing.isError, true);
  assert.match(textOf(missing), /File not found/);
}));

test("reports a missing Notion token", () => withServer({ NOTION_KEY: "" }, async (client) => {
  const result = await client.callTool({ name: "upload_large_file_to_notion", arguments: { filePath: pdfPath } });
  assert.strictEqual(result.isError, true);
  assert.match(textOf(result), /Missing Notion integration token/);
}));

test("NOTION_UPLOAD_ALLOWED_DIRS limits which files can be uploaded", async () => {
  const allowedDir = path.join(workDir, "allowed");
  fs.mkdirSync(allowedDir, { recursive: true });
  const insideFile = path.join(allowedDir, "clip.mp4");
  fs.writeFileSync(insideFile, "video");
  const escapingLink = path.join(allowedDir, "escape.pdf");
  fs.rmSync(escapingLink, { force: true });
  fs.symlinkSync(pdfPath, escapingLink);

  await withServer({ NOTION_UPLOAD_ALLOWED_DIRS: allowedDir }, async (client) => {
    const inside = await client.callTool({ name: "upload_large_file_to_notion", arguments: { filePath: insideFile } });
    assert.ok(!inside.isError, textOf(inside));

    const outside = await client.callTool({ name: "upload_large_file_to_notion", arguments: { filePath: pdfPath } });
    assert.strictEqual(outside.isError, true);
    assert.match(textOf(outside), /Access denied/);

    const viaSymlink = await client.callTool({ name: "upload_large_file_to_notion", arguments: { filePath: escapingLink } });
    assert.strictEqual(viaSymlink.isError, true);
    assert.match(textOf(viaSymlink), /Access denied/);
  });
});

test("cancelling a tool call aborts the upload", async () => {
  const marker = path.join(workDir, "aborted.marker");
  fs.rmSync(marker, { force: true });

  await withServer({ MOCK_NOTION_SCENARIO: "hang", MOCK_ABORT_MARKER: marker }, async (client) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    await assert.rejects(client.callTool(
      { name: "upload_large_file_to_notion", arguments: { filePath: pdfPath } },
      undefined,
      { signal: controller.signal }
    ));

    for (let i = 0; i < 50 && !fs.existsSync(marker); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(fs.existsSync(marker), "Server kept uploading after the request was cancelled");
  });
});

test.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
