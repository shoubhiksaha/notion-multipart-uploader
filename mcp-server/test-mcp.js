const { spawn } = require("child_process");
const path = require("path");
const assert = require("assert");

const serverPath = path.join(__dirname, "index.js");
const proc = spawn("node", [serverPath], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, NOTION_KEY: "secret_test_mock" }
});

let buffer = "";

proc.stdout.on("data", (data) => {
  buffer += data.toString();
  checkMessages();
});

let initialized = false;

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  proc.stdin.write(json + "\n");
}

function checkMessages() {
  const lines = buffer.split("\n");
  buffer = lines.pop(); // keep last incomplete line

  for (const line of lines) {
    if (!line.trim()) continue;
    const res = JSON.parse(line);
    
    if (res.id === 1) {
      assert.ok(res.result.capabilities.tools, "Should return tools capability");
      console.error("✅ Initialize responded with valid capabilities");
      
      // Send notification initialized
      sendMessage({
        jsonrpc: "2.0",
        method: "notifications/initialized"
      });

      // Send tools/list request
      sendMessage({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {}
      });
    } else if (res.id === 2) {
      const tools = res.result.tools;
      assert.strictEqual(tools.length, 2, "Should return 2 tools");
      assert.strictEqual(tools[0].name, "upload_large_file_to_notion");
      assert.strictEqual(tools[1].name, "upload_and_attach_to_notion");
      console.error("✅ tools/list responded with:", tools.map(t => t.name).join(", "));
      
      console.error("🎉 ALL MCP PROTOCOL TESTS PASSED!");
      proc.kill();
      process.exit(0);
    }
  }
}

// 1. Send initialize request
sendMessage({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" }
  }
});

setTimeout(() => {
  console.error("❌ Test timed out waiting for MCP response");
  proc.kill();
  process.exit(1);
}, 5000);
