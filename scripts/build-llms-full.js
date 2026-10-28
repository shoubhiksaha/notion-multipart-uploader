// Rebuilds docs/llms-full.txt from docs/llms.txt and the docs pages, so AI tools get every page in one file.
// Run with `npm run docs:llms` after changing any of them.
const fs = require("fs");
const path = require("path");

const docs = path.join(__dirname, "..", "docs");
const pages = ["upload-large-files.md", "attach-to-notion.md", "ai-agents-mcp.md", "differences-from-sdk.md"];

const sections = ["llms.txt", ...pages].map((file) => fs.readFileSync(path.join(docs, file), "utf8").trim());
fs.writeFileSync(path.join(docs, "llms-full.txt"), sections.join("\n\n---\n\n") + "\n");
