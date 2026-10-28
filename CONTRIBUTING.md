# Contributing

We welcome contributions!

## Development setup

1. Clone the repository.
2. Run `npm install` to install dependencies (this also compiles the TypeScript code into `dist/`).
3. Run `npm run build` to recompile after changes.
4. Run `npm test` to run the mock test suite.
5. Run `npm run test:mcp` to test the MCP server in `mcp-server/` against your local build of the library.

## Integration Tests

To run integration tests, set `NOTION_KEY` and `NOTION_PAGE_ID` (a page shared with your integration) and run `npm run test:integration`. The test appends the uploaded files to that page. Set `NOTION_TEST_LARGE=1` to also run 25 MiB multi-part uploads, which need a paid workspace.
Never commit these secrets.

CI runs the same test on pushes to `main` once the `NOTION_KEY` and `NOTION_PAGE_ID` repository secrets are set.

## Pull Requests

1. Keep it small, focused, and tested.
2. Update the README and documentation if introducing user-facing changes. After editing `docs/`, run `npm run docs:llms` to rebuild `docs/llms-full.txt`.
3. Check that `npm test` and `npm run test:mcp` pass before submitting.

## Releasing

Releases are published by the `Release` GitHub workflow when a version tag is pushed. It publishes with npm provenance, using [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) if it's configured for the package on npmjs.com, or an `NPM_TOKEN` repository secret otherwise.

The MCP server depends on the published library, so release the library first:

1. Bump the library version (`npm version <version>`), update `CHANGELOG.md`, and push the commit and its `v<version>` tag. The workflow checks that the tag matches `package.json`, runs the tests, and publishes.
2. In `mcp-server/`, update the `notion-multipart-uploader` dependency to the new version and run `npm install` to refresh `package-lock.json`.
3. Bump the version in `mcp-server/package.json` and in both `version` fields of `mcp-server/server.json` (the tests check they match), commit, and push an `mcp-v<version>` tag. The workflow tests the server against the published library, publishes it to npm, and then lists it in the [MCP Registry](https://registry.modelcontextprotocol.io) using the workflow's GitHub OIDC token, so no extra secret is needed.
