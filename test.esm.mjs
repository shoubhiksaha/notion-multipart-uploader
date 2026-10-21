import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import * as esm from 'notion-multipart-uploader';

const require = createRequire(import.meta.url);
const cjs = require('notion-multipart-uploader');

test('ESM: the import entry point exposes the same functions as require', () => {
    assert.deepStrictEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
    for (const name of Object.keys(cjs)) {
        assert.strictEqual(esm[name], cjs[name], `${name} differs between import and require`);
    }
});

test('ESM: errors are instances of the same NotionUploadError class', async () => {
    await assert.rejects(
        () => esm.uploadToNotion("dummy-key", "", "text/plain", "empty.txt"),
        (err) => err instanceof cjs.NotionUploadError && err.code === "empty_file"
    );
});
