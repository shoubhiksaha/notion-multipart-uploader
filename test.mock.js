const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { uploadToNotion, uploadFile } = require('./dist/index.js');

const MiB = 1024 * 1024;

// Builds a real fetch Response so the library can read bodies and headers exactly as it would from Notion
const respond = (data = {}, status = 200, headers = {}) =>
    new Response(typeof data === 'string' ? data : JSON.stringify(data), { status, headers });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const tempFile = (name, contents) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmu-test-'));
    const file = path.join(dir, name);
    fs.writeFileSync(file, contents);
    return file;
};

// Bytes that differ per position, so a chunk read from the wrong offset is detectable
const patternedBuffer = (size) => {
    const buf = Buffer.alloc(size);
    for (let i = 0; i < size; i += 4) buf.writeUInt32LE(i, i);
    return buf;
};

test('Mock: Single part upload (<20MB) validates body', async () => {
    let createBody;
    global.fetch = async (url, options) => {
        if (url.includes('file_uploads')) {
            createBody = JSON.parse(options.body);
            return respond({ id: "mock-id", upload_url: "mock-url" });
        }
        return respond();
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
            return respond({ id: "mock-multi-id", upload_url: "mock-url", complete_url: "mock-complete" });
        }
        if (url === 'mock-url') {
            // It's FormData
            partsReceived++;
            return respond();
        }
        if (url === 'mock-complete') {
            completeCalled = true;
            return respond();
        }
        return respond();
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
        return respond("Bad Request Limit", 400);
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
            return respond({ id: "mock-id", upload_url: "mock-url", complete_url: "mock-complete" });
        }
        if (url === 'mock-url') {
            currentInFlight++;
            maxInFlight = Math.max(maxInFlight, currentInFlight);
            // Simulate real network latency so workers genuinely overlap
            await sleep(10);
            currentInFlight--;
            return respond();
        }
        return respond();
    };

    // 30MB = 3 chunks of 10MB each; with concurrency:3 all 3 should fire at once
    const bigBuffer = Buffer.alloc(30 * 1024 * 1024);
    await uploadToNotion("dummy-key", bigBuffer, "text/plain", "big.txt", { concurrency: 3 });

    assert.ok(maxInFlight > 1, `Expected >1 concurrent uploads, got max ${maxInFlight}`);
});

test('Mock: onProgress callback tracks progress in single-part upload', async () => {
    global.fetch = async (url, options) => {
        if (url.includes('file_uploads')) {
            return respond({ id: "mock-id", upload_url: "mock-url" });
        }
        return respond();
    };

    const progressUpdates = [];
    const buf = Buffer.from("hello world");
    const id = await uploadToNotion("dummy-key", buf, "text/plain", "test.txt", {
        onProgress: (uploaded, total) => progressUpdates.push({ uploaded, total })
    });

    assert.strictEqual(id, "mock-id");
    assert.deepStrictEqual(progressUpdates, [
        { uploaded: 0, total: buf.length },
        { uploaded: buf.length, total: buf.length }
    ]);
});

test('Mock: onProgress callback tracks chunk increments in multi-part upload', async () => {
    global.fetch = async (url, options) => {
        if (url.endsWith('file_uploads')) {
            return respond({ id: "mock-multi-id", upload_url: "mock-url", complete_url: "mock-complete" });
        }
        return respond();
    };

    const progressUpdates = [];
    // 25MB = 3 parts (10MB, 10MB, 5MB)
    const totalSize = 25 * 1024 * 1024;
    const bigBuffer = Buffer.alloc(totalSize);

    const id = await uploadToNotion("dummy-key", bigBuffer, "application/pdf", "large.pdf", {
        concurrency: 1, // Sequential for deterministic assertion
        onProgress: (uploaded, total) => progressUpdates.push({ uploaded, total })
    });

    assert.strictEqual(id, "mock-multi-id");
    assert.strictEqual(progressUpdates[0].uploaded, 0);
    assert.strictEqual(progressUpdates[0].total, totalSize);
    // Final update must be 100% (uploaded === total)
    assert.strictEqual(progressUpdates[progressUpdates.length - 1].uploaded, totalSize);
    assert.strictEqual(progressUpdates[progressUpdates.length - 1].total, totalSize);
    assert.strictEqual(progressUpdates.length, 4); // 0MB, 10MB, 20MB, 25MB
});

test('Mock: onProgress callback error does not break upload', async () => {
    global.fetch = async (url, options) => {
        if (url.includes('file_uploads')) {
            return respond({ id: "mock-id", upload_url: "mock-url" });
        }
        return respond();
    };

    const id = await uploadToNotion("dummy-key", Buffer.from("hello"), "text/plain", "test.txt", {
        onProgress: () => {
            throw new Error("UI callback exploded!");
        }
    });

    assert.strictEqual(id, "mock-id");
});

test('Mock: Empty buffer throws clear error', async () => {
    await assert.rejects(
        () => uploadToNotion("dummy-key", Buffer.alloc(0), "text/plain", "empty.txt"),
        { message: "File buffer is empty" }
    );
});

test('Mock: retries: 0 attempts exactly once on failure without retrying', async () => {
    let attempts = 0;
    global.fetch = async () => {
        attempts++;
        return respond("Internal Server Error", 500);
    };

    await assert.rejects(
        () => uploadToNotion("dummy-key", Buffer.from("data"), "text/plain", "test.txt", { retries: 0 }),
        (err) => {
            assert.ok(err.message.includes("Notion API Failed (500)"));
            return true;
        }
    );
    assert.strictEqual(attempts, 1, `Expected exactly 1 attempt, but got ${attempts}`);
});

test('Mock: concurrency: 0 safely defaults to at least 1 worker', async () => {
    let partsReceived = 0;
    global.fetch = async (url) => {
        if (url.endsWith('file_uploads')) {
            return respond({ id: "mock-id", upload_url: "mock-url", complete_url: "mock-complete" });
        }
        if (url === 'mock-url') {
            partsReceived++;
        }
        return respond();
    };

    const bigBuffer = Buffer.alloc(21 * 1024 * 1024);
    const id = await uploadToNotion("dummy-key", bigBuffer, "text/plain", "big.txt", { concurrency: 0 });
    assert.strictEqual(id, "mock-id");
    assert.strictEqual(partsReceived, 3);
});

test('Mock: 429 with Retry-After is retried and then succeeds', async () => {
    let createAttempts = 0;
    global.fetch = async (url) => {
        if (url.endsWith('file_uploads')) {
            createAttempts++;
            if (createAttempts === 1) return respond("rate limited", 429, { 'Retry-After': '0' });
            return respond({ id: "mock-id", upload_url: "mock-url" });
        }
        return respond();
    };

    const id = await uploadToNotion("dummy-key", Buffer.from("hello"), "text/plain", "test.txt");
    assert.strictEqual(id, "mock-id");
    assert.strictEqual(createAttempts, 2);
});

test('Mock: timed-out requests are retried', async () => {
    let calls = 0;
    global.fetch = (url, options) => {
        calls++;
        if (calls === 1) {
            // Never answers; only the timeout can end this request
            return new Promise((_, reject) => {
                options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            });
        }
        if (url.endsWith('file_uploads')) return Promise.resolve(respond({ id: "mock-id", upload_url: "mock-url" }));
        return Promise.resolve(respond());
    };

    const id = await uploadToNotion("dummy-key", Buffer.from("hello"), "text/plain", "test.txt", { timeoutMs: 50 });
    assert.strictEqual(id, "mock-id");
    assert.strictEqual(calls, 3); // timed-out create, retried create, upload
});

test('Mock: timeout on every attempt fails with a timeout error', async () => {
    global.fetch = (url, options) => new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });

    await assert.rejects(
        () => uploadToNotion("dummy-key", Buffer.from("hello"), "text/plain", "test.txt", { timeoutMs: 20, retries: 0 }),
        { message: "Upload timed out" }
    );
});

test('Mock: aborting during a retry delay rejects immediately', async () => {
    global.fetch = async () => respond("rate limited", 429, { 'Retry-After': '30' });

    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 50);

    await assert.rejects(
        () => uploadToNotion("dummy-key", Buffer.from("hello"), "text/plain", "test.txt", { signal: controller.signal }),
        { message: "Upload aborted by user" }
    );
    assert.ok(Date.now() - started < 1000, `Abort took ${Date.now() - started}ms`);
});

test('Mock: a failed part stops the other workers before the upload rejects', async () => {
    let partRequests = 0;
    let completeCalled = false;
    global.fetch = async (url, options) => {
        if (url.endsWith('file_uploads')) {
            return respond({ id: "mock-id", upload_url: "mock-url", complete_url: "mock-complete" });
        }
        if (url === 'mock-complete') {
            completeCalled = true;
            return respond();
        }
        partRequests++;
        const partNumber = Number(options.body.get('part_number'));
        await sleep(20);
        if (partNumber === 1) return respond("invalid part", 400);
        return respond();
    };

    // 100 MiB = 10 parts; part 1 fails while parts 2 and 3 are in flight
    await assert.rejects(
        () => uploadToNotion("dummy-key", Buffer.alloc(100 * MiB), "video/mp4", "v.mp4", { concurrency: 3 }),
        (err) => err.message.includes("Notion API Error (400)")
    );
    const requestsAtRejection = partRequests;
    await sleep(200);

    assert.strictEqual(partRequests, requestsAtRejection, "Part uploads continued after the upload failed");
    assert.ok(requestsAtRejection < 10, `Expected the upload to stop early, got ${requestsAtRejection} part requests`);
    assert.strictEqual(completeCalled, false);
});

test('Mock: aborting a multi-part upload stops in-flight parts', async () => {
    const controller = new AbortController();
    let partRequests = 0;
    let abortedAt;
    global.fetch = (url, options) => {
        if (url.endsWith('file_uploads')) {
            return Promise.resolve(respond({ id: "mock-id", upload_url: "mock-url", complete_url: "mock-complete" }));
        }
        // Parts only finish when aborted; cancel once all three workers have a part in flight
        if (++partRequests === 3) {
            setTimeout(() => {
                abortedAt = Date.now();
                controller.abort();
            }, 10);
        }
        return new Promise((_, reject) => {
            options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
    };

    await assert.rejects(
        () => uploadToNotion("dummy-key", Buffer.alloc(100 * MiB), "video/mp4", "v.mp4", { signal: controller.signal }),
        { message: "Upload aborted by user" }
    );
    assert.ok(Date.now() - abortedAt < 1000, `Abort took ${Date.now() - abortedAt}ms`);
    assert.strictEqual(partRequests, 3);
});

test('Mock: strings are uploaded as UTF-8 bytes', async () => {
    let uploaded;
    global.fetch = async (url, options) => {
        if (url.endsWith('file_uploads')) return respond({ id: "mock-id", upload_url: "mock-url" });
        uploaded = Buffer.from(await options.body.get('file').arrayBuffer());
        return respond();
    };

    await uploadToNotion("dummy-key", "héllo ✓", "text/plain", "note.txt");
    assert.deepStrictEqual(uploaded, Buffer.from("héllo ✓", "utf8"));
});

test('Mock: typed array views upload only their own bytes', async () => {
    let uploaded;
    global.fetch = async (url, options) => {
        if (url.endsWith('file_uploads')) return respond({ id: "mock-id", upload_url: "mock-url" });
        uploaded = Buffer.from(await options.body.get('file').arrayBuffer());
        return respond();
    };

    const backing = Buffer.from("XXXXhelloXXXX");
    await uploadToNotion("dummy-key", new Uint8Array(backing.buffer, backing.byteOffset + 4, 5), "text/plain", "a.txt");
    assert.strictEqual(uploaded.toString(), "hello");

    await uploadToNotion("dummy-key", new TextEncoder().encode("abc").buffer, "text/plain", "b.txt");
    assert.strictEqual(uploaded.toString(), "abc");
});

test('Mock: unsupported input types throw a TypeError', async () => {
    await assert.rejects(
        () => uploadToNotion("dummy-key", { length: 5 }, "text/plain", "x.txt"),
        TypeError
    );
    await assert.rejects(
        () => uploadToNotion("dummy-key", undefined, "text/plain", "x.txt"),
        TypeError
    );
});

test('Mock: uploadFile sends a small file as a single part', async () => {
    const file = tempFile('note.txt', 'hello from disk');
    let createBody;
    let uploaded;
    global.fetch = async (url, options) => {
        if (url.endsWith('file_uploads')) {
            createBody = JSON.parse(options.body);
            return respond({ id: "mock-id", upload_url: "mock-url" });
        }
        uploaded = Buffer.from(await options.body.get('file').arrayBuffer());
        return respond();
    };

    const id = await uploadFile("dummy-key", file, "text/plain");
    assert.strictEqual(id, "mock-id");
    assert.strictEqual(createBody.mode, "single_part");
    assert.strictEqual(createBody.filename, "note.txt");
    assert.strictEqual(uploaded.toString(), 'hello from disk');
});

test('Mock: uploadFile reads each part from the right offset of the file', async () => {
    const contents = patternedBuffer(25 * MiB);
    const file = tempFile('video.mp4', contents);
    const parts = new Map();
    let createBody;
    global.fetch = async (url, options) => {
        if (url.endsWith('file_uploads')) {
            createBody = JSON.parse(options.body);
            return respond({ id: "mock-id", upload_url: "mock-url", complete_url: "mock-complete" });
        }
        if (url === 'mock-url') {
            parts.set(Number(options.body.get('part_number')), Buffer.from(await options.body.get('file').arrayBuffer()));
        }
        return respond();
    };

    const id = await uploadFile("dummy-key", file, "video/mp4", { concurrency: 2 });
    assert.strictEqual(id, "mock-id");
    assert.strictEqual(createBody.number_of_parts, 3);
    assert.ok(Buffer.concat([parts.get(1), parts.get(2), parts.get(3)]).equals(contents), "Uploaded parts do not match the file");
});

test('Mock: uploadFile rejects empty files and directories', async () => {
    let fetchCount = 0;
    global.fetch = async () => {
        fetchCount++;
        return respond();
    };

    const empty = tempFile('empty.txt', '');
    await assert.rejects(() => uploadFile("dummy-key", empty, "text/plain"), /File is empty/);
    await assert.rejects(() => uploadFile("dummy-key", path.dirname(empty), "text/plain"), /Not a regular file/);
    assert.strictEqual(fetchCount, 0);
});

test('Mock: uploadFile fails if the file shrinks during the upload', async () => {
    const file = tempFile('shrinking.bin', Buffer.alloc(25 * MiB));
    global.fetch = async (url) => {
        if (url.endsWith('file_uploads')) {
            return respond({ id: "mock-id", upload_url: "mock-url", complete_url: "mock-complete" });
        }
        if (url === 'mock-url') fs.truncateSync(file, 15 * MiB);
        return respond();
    };

    await assert.rejects(
        () => uploadFile("dummy-key", file, "application/octet-stream", { concurrency: 1 }),
        /File changed during upload/
    );
});
