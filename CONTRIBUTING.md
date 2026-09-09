# Contributing

We welcome contributions!

## Development setup

1. Clone the repository.
2. Run `npm install` to install dependencies.
3. Run `npm run build` to compile the TypeScript code.
4. Run `npm test` to run the mock test suite.

## Integration Tests

To run integration tests, set your `NOTION_KEY` and `DATABASE_ID` environment variables and run `npm run test:integration`. 
Never commit these secrets.

## Pull Requests

1. Keep it small, focused, and tested.
2. Update the README and documentation if introducing user-facing changes.
3. Check that `npm test` passes before submitting.
