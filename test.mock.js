const test = require('node:test');
const assert = require('node:assert');
const { uploadToNotion } = require('./index.js');

test('Mock: Single part upload (<20MB)', async () => {
    global.fetch = async (url) => {
        if (url.includes('file_uploads')) {
            return { ok: true, json: async () => ({ id: "mock-id", upload_url: "mock-url" }) };
        }
        return { ok: true };
    };
    
    const id = await uploadToNotion("dummy-key", Buffer.from("hello"), "text/plain", "test.txt");
    assert.strictEqual(id, "mock-id");
});

test('Mock: Multi part upload (>20MB)', async () => {
    global.fetch = async (url) => {
        if (url.includes('file_uploads') && !url.includes('complete')) {
            return { ok: true, json: async () => ({ id: "mock-multi-id", upload_url: "mock-url", complete_url: "mock-complete" }) };
        }
        return { ok: true };
    };
    
    const bigBuffer = Buffer.alloc(21 * 1024 * 1024); // 21MB
    const id = await uploadToNotion("dummy-key", bigBuffer, "text/plain", "big.txt");
    assert.strictEqual(id, "mock-multi-id");
});

test('Mock: Abort signal kills upload', async () => {
    const controller = new AbortController();
    controller.abort(); // Cancel immediately
    
    try {
        await uploadToNotion("dummy-key", Buffer.from("hello"), "text/plain", "test.txt", { signal: controller.signal });
        assert.fail("Should have thrown Abort error");
    } catch (e) {
        assert.strictEqual(e.message, "Upload aborted by user");
    }
});
