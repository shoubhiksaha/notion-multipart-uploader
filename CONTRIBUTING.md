# Contributing

We welcome contributions!

## Development setup

1. Clone the repository.
2. Run `npm install` to install dependencies (this also compiles the TypeScript code into `dist/`).
3. Run `npm run build` to recompile after changes.
4. Run `npm test` to run the mock test suite.
5. Run `npm run test:mcp` to test the MCP server in `mcp-server/` against your local build of the library.

## Integration Tests

To run integration tests, set your `NOTION_KEY` and `DATABASE_ID` environment variables and run `npm run test:integration`. 
Never commit these secrets.

## Pull Requests

1. Keep it small, focused, and tested.
2. Update the README and documentation if introducing user-facing changes.
3. Check that `npm test` and `npm run test:mcp` pass before submitting.

## Releasing

The MCP server depends on the published library, so release the library first:

1. Bump the library version (`npm version <version>`), update `CHANGELOG.md`, and run `npm publish`.
2. In `mcp-server/`, update the `notion-multipart-uploader` dependency to the new version and run `npm install` to refresh `package-lock.json`.
3. Run `npm test` in `mcp-server/`, then bump its version and run `npm publish` there.
