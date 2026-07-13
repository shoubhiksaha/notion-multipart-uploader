const test = require('node:test');
const assert = require('node:assert');
const { uploadToNotion } = require('./index.js');

test('Mock: Single part upload (<20MB) validates body', async () => {
    let createBody;
    global.fetch = async (url, options) => {
        if (url.includes('file_uploads')) {
            createBody = JSON.parse(options.body);
            return { ok: true, json: async () => ({ id: "mock-id", upload_url: "mock-url" }) };
        }
        return { ok: true };
    };
    
    const id = await uploadToNotion("dummy-key", Buffer.from("hello"), "text/plain", "test.txt");
    assert.strictEqual(id, "mock-id");
    assert.strictEqual(createBody.mode, "single_part");
    assert.strictEqual(createBody.content_type, "text/plain");
    assert.strictEqual(createBody.filename, "test.txt");
    assert.strictEqual(createBody.number_of_parts, undefined);
});

test('Mock: Multi part upload (>20MB) validates chunking and completion', async () => {
    let createBody;
    let partsReceived = 0;
    let completeCalled = false;
    
    global.fetch = async (url, options) => {
        if (url.endsWith('file_uploads')) {
            createBody = JSON.parse(options.body);
            return { ok: true, json: async () => ({ id: "mock-multi-id", upload_url: "mock-url", complete_url: "mock-complete" }) };
        }
        if (url === 'mock-url') {
            // It's FormData
            partsReceived++;
            return { ok: true };
        }
        if (url === 'mock-complete') {
            completeCalled = true;
            return { ok: true };
        }
        return { ok: true };
    };
    
    // 10MB chunk size, so 21MB = 3 parts
    const bigBuffer = Buffer.alloc(21 * 1024 * 1024); 
    const id = await uploadToNotion("dummy-key", bigBuffer, "text/plain", "big.txt");
    
    assert.strictEqual(id, "mock-multi-id");
    assert.strictEqual(createBody.mode, "multi_part");
    assert.strictEqual(createBody.number_of_parts, 3);
    assert.strictEqual(partsReceived, 3);
    assert.strictEqual(completeCalled, true);
});

test('Mock: Abort signal kills upload instantly', async () => {
    const controller = new AbortController();
    controller.abort(); 
    
    try {
        await uploadToNotion("dummy-key", Buffer.from("hello"), "text/plain", "test.txt", { signal: controller.signal });
        assert.fail("Should have thrown Abort error");
    } catch (e) {
        assert.strictEqual(e.message, "Upload aborted by user");
    }
});

test('Mock: 400 Bad Request triggers fatal error, no retries', async () => {
    let fetchCount = 0;
    global.fetch = async (url) => {
        fetchCount++;
        return { 
            ok: false, 
            status: 400, 
            text: async () => "Bad Request Limit" 
        };
    };
    
    try {
        await uploadToNotion("dummy-key", Buffer.from("hello"), "text/plain", "test.txt");
        assert.fail("Should have thrown fatal error");
    } catch (e) {
        assert.ok(e.message.includes("Notion API Error (400)"));
        assert.strictEqual(fetchCount, 1); // Only tried once, no retries
    }
});

test('Mock: concurrency option causes parallel chunk uploads', async () => {
    let maxInFlight = 0;
    let currentInFlight = 0;

    global.fetch = async (url, options) => {
        if (url.endsWith('file_uploads')) {
            return { ok: true, json: async () => ({ id: "mock-id", upload_url: "mock-url", complete_url: "mock-complete" }) };
        }
        if (url === 'mock-url') {
            currentInFlight++;
            maxInFlight = Math.max(maxInFlight, currentInFlight);
            // Simulate real network latency so workers genuinely overlap
            await new Promise(r => setTimeout(r, 10));
            currentInFlight--;
            return { ok: true };
        }
        if (url === 'mock-complete') return { ok: true };
        return { ok: true };
    };

    // 30MB = 3 chunks of 10MB each; with concurrency:3 all 3 should fire at once
    const bigBuffer = Buffer.alloc(30 * 1024 * 1024);
    await uploadToNotion("dummy-key", bigBuffer, "text/plain", "big.txt", { concurrency: 3 });

    assert.ok(maxInFlight > 1, `Expected >1 concurrent uploads, got max ${maxInFlight}`);
});
