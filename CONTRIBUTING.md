# Contributing

We welcome contributions!

## Development setup

The repository is an [npm workspace](https://docs.npmjs.com/cli/using-npm/workspaces) with two packages: the library at the root and the MCP server in `mcp-server/`. One `npm install` at the root sets up both, and the server's `notion-multipart-uploader` dependency is linked to the root folder, so the server always runs against your local build of the library. (The root lists itself in `workspaces` for that reason: npm only links packages that are workspace members.)

1. Clone the repository.
2. Run `npm install` at the root. This installs the dependencies of both packages into one `node_modules`, with one `package-lock.json`, and compiles the TypeScript code into `dist/`.
3. Run `npm run build` to recompile after changes. The MCP server picks the new build up immediately.
4. Run `npm test` to run the library's mock test suite.
5. Run `npm run test:mcp` to build the library and run the MCP server's tests against it. To run a script of the server directly, use `-w`, for example `npm start -w mcp-server`.

Don't run `npm install` inside `mcp-server/`; npm would treat it as part of the workspace anyway, and the server has no lockfile of its own on purpose.

## Integration Tests

To run integration tests, set `NOTION_KEY` and `NOTION_PAGE_ID` (a page shared with your integration) and run `npm run test:integration`. The test appends the uploaded files to that page. Set `NOTION_TEST_LARGE=1` to also run 25 MiB multi-part uploads, which need a paid workspace.
Never commit these secrets.

CI runs the same test on pushes to `main` once the `NOTION_KEY` and `NOTION_PAGE_ID` repository secrets are set.

## Pull Requests

1. Keep it small, focused, and tested.
2. Update the README and documentation if introducing user-facing changes. After editing `docs/`, run `npm run docs:llms` to rebuild `docs/llms-full.txt`.
3. Check that `npm test` and `npm run test:mcp` pass before submitting.

## Releasing

Releases are published by the `Release` GitHub workflow when a version tag is pushed. It uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers), so there is no npm token to manage: each package's **Settings → Trusted Publisher** on npmjs.com names this repository and the `release.yml` workflow (with `npm publish` allowed), and npm adds provenance automatically. A trusted publisher that isn't used within 2 days of being configured expires and has to be set up again.

The MCP server depends on the published library, so release the library first:

1. Bump the library version (`npm version <version>`), update `CHANGELOG.md`, and push the commit and its `v<version>` tag. The workflow checks that the tag matches `package.json`, runs the tests, and publishes.
2. In `mcp-server/`, update the `notion-multipart-uploader` dependency range if the new version needs it. Users run `npx -y notion-large-file-upload-mcp`, which resolves that range from npm, so the release workflow tests the server from a copy outside the repository, installed from npm the same way, rather than against the workspace link.
3. Bump the version in `mcp-server/package.json` and in both `version` fields of `mcp-server/server.json` (the tests check they match), commit, and push an `mcp-v<version>` tag. The workflow tests the server against the published library, publishes it to npm, and then lists it in the [MCP Registry](https://registry.modelcontextprotocol.io) using the workflow's GitHub OIDC token, so no extra secret is needed.
