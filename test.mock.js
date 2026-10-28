const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { uploadToNotion, uploadFile, uploadStream, NotionUploadError, inferBlockType } = require('./dist/index.js');

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
        if (url.endsWith('users/me')) return respond({});
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
        if (url.endsWith('users/me')) return Promise.resolve(respond({}));
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
    const file = tempFile('shrinking.zip', Buffer.alloc(25 * MiB));
    global.fetch = async (url) => {
        if (url.endsWith('file_uploads')) {
            return respond({ id: "mock-id", upload_url: "mock-url", complete_url: "mock-complete" });
        }
        if (url === 'mock-url') fs.truncateSync(file, 15 * MiB);
        return respond();
    };

    await assert.rejects(
        () => uploadFile("dummy-key", file, "application/zip", { concurrency: 1 }),
        /File changed during upload/
    );
});

test('Mock: API errors are NotionUploadErrors with Notion\'s code and status', async () => {
    global.fetch = async () => respond({ object: "error", status: 400, code: "validation_error", message: "bad request" }, 400);

    await assert.rejects(
        () => uploadToNotion("dummy-key", Buffer.from("hi"), "text/plain", "a.txt"),
        (err) => {
            assert.ok(err instanceof NotionUploadError);
            assert.strictEqual(err.code, "validation_error");
            assert.strictEqual(err.status, 400);
            assert.strictEqual(err.retryable, false);
            assert.match(err.message, /Notion API Error \(400\)/);
            return true;
        }
    );
});

test('Mock: failures after retries, timeouts, network errors and aborts have their own codes', async () => {
    global.fetch = async () => respond("busy", 503);
    await assert.rejects(
        () => uploadToNotion("dummy-key", Buffer.from("hi"), "text/plain", "a.txt", { retries: 0 }),
        { name: "NotionUploadError", code: "http_error", status: 503, retryable: true }
    );

    global.fetch = async () => { throw new TypeError("fetch failed"); };
    await assert.rejects(
        () => uploadToNotion("dummy-key", Buffer.from("hi"), "text/plain", "a.txt", { retries: 0 }),
        (err) => err.code === "network_error" && err.retryable === true && err.cause instanceof TypeError
    );

    global.fetch = (url, options) => new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    await assert.rejects(
        () => uploadToNotion("dummy-key", Buffer.from("hi"), "text/plain", "a.txt", { retries: 0, timeoutMs: 20 }),
        { code: "timeout", retryable: true }
    );

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
        () => uploadToNotion("dummy-key", Buffer.from("hi"), "text/plain", "a.txt", { signal: controller.signal }),
        { code: "aborted", retryable: false }
    );
});

test('Mock: unsupported file types are rejected before contacting Notion', async () => {
    let fetchCount = 0;
    global.fetch = async (url) => {
        fetchCount++;
        return respond({ id: "mock-id", upload_url: "mock-url" });
    };

    await assert.rejects(
        () => uploadToNotion("dummy-key", Buffer.from("x"), "application/octet-stream", "data.bin"),
        { code: "unsupported_file_type" }
    );
    assert.strictEqual(fetchCount, 0);

    // A supported extension is enough, even with a generic content type
    await uploadToNotion("dummy-key", Buffer.from("x"), "application/octet-stream", "notes.md");
    // So is a supported content type without an extension
    await uploadToNotion("dummy-key", Buffer.from("x"), "text/plain; charset=utf-8", "README");
    // preflight: false skips the check
    await uploadToNotion("dummy-key", Buffer.from("x"), "application/octet-stream", "data.bin", { preflight: false });
});

test('Mock: the MIME type is inferred from the extension when omitted', async () => {
    const contentTypes = [];
    global.fetch = async (url, options) => {
        if (url.endsWith('file_uploads')) {
            contentTypes.push(JSON.parse(options.body).content_type);
            return respond({ id: "mock-id", upload_url: "mock-url" });
        }
        return respond();
    };

    await uploadFile("dummy-key", tempFile('report.pdf', '%PDF-1.4'));
    await uploadToNotion("dummy-key", Buffer.from("x"), "", "clip.MOV");
    assert.deepStrictEqual(contentTypes, ["application/pdf", "video/quicktime"]);
});

test('Mock: uploadFile uses the filename option in Notion', async () => {
    let createBody;
    global.fetch = async (url, options) => {
        if (url.endsWith('file_uploads')) {
            createBody = JSON.parse(options.body);
            return respond({ id: "mock-id", upload_url: "mock-url" });
        }
        assert.strictEqual(options.body.get('file').name, "Quarterly report.pdf");
        return respond();
    };

    await uploadFile("dummy-key", tempFile('tmp-8f3a.pdf', '%PDF-1.4'), "application/pdf", { filename: "Quarterly report.pdf" });
    assert.strictEqual(createBody.filename, "Quarterly report.pdf");
});

test('Mock: files over the workspace upload limit fail before uploading', async () => {
    const requests = [];
    global.fetch = async (url) => {
        requests.push(url);
        if (url.endsWith('users/me')) {
            return respond({ object: "user", type: "bot", bot: { workspace_limits: { max_file_upload_size_in_bytes: 5 * MiB } } });
        }
        return respond({ id: "mock-id", upload_url: "mock-url" });
    };

    await assert.rejects(
        () => uploadToNotion("dummy-key", Buffer.alloc(6 * MiB), "video/mp4", "v.mp4"),
        (err) => err.code === "file_too_large" && /up to 5\.0 MiB/.test(err.message)
    );
    assert.deepStrictEqual(requests, ["https://api.notion.com/v1/users/me"]);
});

test('Mock: the workspace limit is only checked for files over 5 MiB, and skipped if unavailable', async () => {
    const requests = [];
    global.fetch = async (url) => {
        requests.push(url);
        if (url.endsWith('users/me')) return respond({ object: "error", code: "restricted_resource" }, 403);
        return respond({ id: "mock-id", upload_url: "mock-url" });
    };

    await uploadToNotion("dummy-key", Buffer.alloc(1024), "text/plain", "a.txt");
    assert.ok(!requests.some((url) => url.endsWith('users/me')));

    requests.length = 0;
    await uploadToNotion("dummy-key", Buffer.alloc(6 * MiB), "video/mp4", "v.mp4");
    assert.strictEqual(requests[0], "https://api.notion.com/v1/users/me");
    assert.ok(requests.includes("mock-url"), "The upload should continue when the limit can't be read");

    requests.length = 0;
    await uploadToNotion("dummy-key", Buffer.alloc(6 * MiB), "video/mp4", "v.mp4", { preflight: false });
    assert.ok(!requests.some((url) => url.endsWith('users/me')));
});

test('Mock: uploadStream uploads a Node.js stream in order', async () => {
    const contents = patternedBuffer(25 * MiB);
    // Odd-sized pieces so parts span several stream chunks
    const pieces = [];
    for (let i = 0; i < contents.length; i += 3 * MiB + 7) pieces.push(contents.subarray(i, i + 3 * MiB + 7));

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

    const id = await uploadStream("dummy-key", Readable.from(pieces), "video/mp4", "clip.mp4", { size: contents.length, concurrency: 3 });
    assert.strictEqual(id, "mock-id");
    assert.strictEqual(createBody.number_of_parts, 3);
    assert.ok(Buffer.concat([parts.get(1), parts.get(2), parts.get(3)]).equals(contents), "Uploaded parts do not match the stream");
});

test('Mock: uploadStream accepts web ReadableStreams and string chunks', async () => {
    const uploads = [];
    global.fetch = async (url, options) => {
        if (url.endsWith('file_uploads')) return respond({ id: "mock-id", upload_url: "mock-url" });
        uploads.push(Buffer.from(await options.body.get('file').arrayBuffer()).toString());
        return respond();
    };

    const web = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode("hello "));
            controller.enqueue(new TextEncoder().encode("world"));
            controller.close();
        }
    });
    await uploadStream("dummy-key", web, "text/plain", "a.txt", { size: 11 });

    async function* strings() {
        yield "héllo ";
        yield "✓";
    }
    await uploadStream("dummy-key", strings(), "text/plain", "b.txt", { size: Buffer.byteLength("héllo ✓") });

    assert.deepStrictEqual(uploads, ["hello world", "héllo ✓"]);
});

test('Mock: uploadStream rejects streams shorter or longer than the declared size', async () => {
    let uploadRequests = 0;
    let completeCalled = false;
    global.fetch = async (url) => {
        if (url.endsWith('users/me')) return respond({});
        if (url.endsWith('file_uploads')) return respond({ id: "mock-id", upload_url: "mock-url", complete_url: "mock-complete" });
        if (url === 'mock-complete') completeCalled = true;
        else uploadRequests++;
        return respond();
    };

    await assert.rejects(
        () => uploadStream("dummy-key", Readable.from([Buffer.alloc(25 * MiB)]), "video/mp4", "v.mp4", { size: 30 * MiB }),
        { code: "size_mismatch" }
    );
    assert.strictEqual(completeCalled, false);

    uploadRequests = 0;
    await assert.rejects(
        () => uploadStream("dummy-key", Readable.from([Buffer.alloc(1000)]), "text/plain", "a.txt", { size: 999 }),
        { code: "size_mismatch" }
    );
    assert.strictEqual(uploadRequests, 0, "A single-part stream should be checked before it is sent");
});

test('Mock: a failed stream upload stops reading and destroys the stream', async () => {
    global.fetch = async (url) => {
        if (url.endsWith('users/me')) return respond({});
        if (url.endsWith('file_uploads')) return respond({ id: "mock-id", upload_url: "mock-url", complete_url: "mock-complete" });
        return respond("invalid part", 400);
    };

    let piecesRead = 0;
    const stream = Readable.from((function* () {
        for (let i = 0; i < 50; i++) {
            piecesRead++;
            yield Buffer.alloc(MiB);
        }
    })());

    await assert.rejects(
        () => uploadStream("dummy-key", stream, "video/mp4", "v.mp4", { size: 50 * MiB, concurrency: 1 }),
        { code: "http_error", status: 400 }
    );
    assert.strictEqual(stream.destroyed, true);
    assert.ok(piecesRead < 50, `Read ${piecesRead} of 50 pieces after the upload failed`);
});

test('Mock: uploadStream validates its arguments', async () => {
    await assert.rejects(() => uploadStream("dummy-key", Readable.from([]), "text/plain", "a.txt", {}), TypeError);
    await assert.rejects(() => uploadStream("dummy-key", Readable.from([]), "text/plain", "a.txt", { size: -1 }), TypeError);
    await assert.rejects(() => uploadStream("dummy-key", Readable.from([]), "text/plain", "a.txt", { size: 0 }), { code: "empty_file" });
    await assert.rejects(() => uploadStream("dummy-key", Buffer.from("hi"), "text/plain", "a.txt", { size: 2 }), TypeError);
});

test('Mock: a 429 pauses every worker until Retry-After has passed', async () => {
    let rateLimitedAt;
    const partStarts = [];
    global.fetch = async (url, options) => {
        if (url.endsWith('users/me')) return respond({});
        if (url.endsWith('file_uploads')) return respond({ id: "mock-id", upload_url: "mock-url", complete_url: "mock-complete" });
        if (url === 'mock-complete') return respond();
        partStarts.push({ part: Number(options.body.get('part_number')), at: Date.now() });
        if (rateLimitedAt === undefined) {
            rateLimitedAt = Date.now();
            return respond("slow down", 429, { 'Retry-After': '1' });
        }
        await sleep(10);
        return respond();
    };

    // 50 MiB = 5 parts. Parts 2 and 3 are already in flight when part 1 is rate-limited,
    // but parts 4 and 5 must wait for the Retry-After second like the retry of part 1.
    await uploadToNotion("dummy-key", Buffer.alloc(50 * MiB), "video/mp4", "v.mp4", { concurrency: 3 });

    const sentDuringPause = partStarts.filter((s) => s.part >= 4 && s.at < rateLimitedAt + 950).map((s) => s.part);
    assert.deepStrictEqual(sentDuringPause, [], "Workers kept sending parts while Notion was rate-limiting");
    assert.strictEqual(partStarts.length, 6); // 5 parts + the retried part 1
});

test('Mock: a 429 for a blocked connection is not retried', async () => {
    let calls = 0;
    global.fetch = async () => {
        calls++;
        return respond({
            object: "error", status: 429, code: "rate_limited", message: "API access restricted",
            additional_data: { rate_limit_reason: "public_api_request_blocked" }
        }, 429, { 'Retry-After': '0' });
    };

    await assert.rejects(
        () => uploadToNotion("dummy-key", Buffer.from("hi"), "text/plain", "a.txt"),
        { code: "rate_limited", status: 429, retryable: false }
    );
    assert.strictEqual(calls, 1);
});

test('Mock: the wait in a 429 body is used when there is no Retry-After header', async () => {
    const random = Math.random;
    Math.random = () => 0; // No jitter, so the default backoff would be exactly 1 second
    try {
        let calls = 0;
        global.fetch = async (url) => {
            calls++;
            if (calls === 1) return respond({ object: "error", status: 429, code: "rate_limited", additional_data: { retry_after: "0" } }, 429);
            if (url.endsWith('file_uploads')) return respond({ id: "mock-id", upload_url: "mock-url" });
            return respond();
        };
        const start = Date.now();
        await uploadToNotion("dummy-key", Buffer.from("hi"), "text/plain", "a.txt");
        assert.ok(Date.now() - start < 500, "Waited for the default backoff instead of the body's retry_after");
    } finally {
        Math.random = random;
    }
});

test('Mock: a send or complete that went through despite a 5xx is not reported as failed', async () => {
    // Notion saves the last request but answers 504, then rejects the retry because the upload is no longer pending
    const mockSavedThen504 = (lastUrl, status) => {
        const requests = [];
        let answered504 = false;
        global.fetch = async (url, options) => {
            requests.push(`${options.method} ${url}`);
            if (url.endsWith('users/me')) return respond({});
            if (url.endsWith('file_uploads')) return respond({ id: "mock-id", upload_url: "mock-url", complete_url: "mock-complete" });
            if (url.endsWith('file_uploads/mock-id')) return respond({ object: "file_upload", id: "mock-id", status });
            if (url === lastUrl) {
                if (!answered504) {
                    answered504 = true;
                    return respond("gateway timeout", 504, { 'Retry-After': '0' });
                }
                return respond({ object: "error", status: 400, code: "validation_error", message: "File upload is not pending" }, 400);
            }
            return respond();
        };
        return requests;
    };

    const random = Math.random;
    Math.random = () => 0;
    try {
        let requests = mockSavedThen504('mock-url', 'uploaded');
        assert.strictEqual(await uploadToNotion("dummy-key", Buffer.from("hi"), "text/plain", "a.txt"), "mock-id");
        assert.ok(requests.includes("GET https://api.notion.com/v1/file_uploads/mock-id"));

        mockSavedThen504('mock-complete', 'uploaded');
        assert.strictEqual(await uploadToNotion("dummy-key", Buffer.alloc(21 * MiB), "video/mp4", "v.mp4"), "mock-id");

        // If the upload isn't actually uploaded, Notion's error is reported
        mockSavedThen504('mock-url', 'pending');
        await assert.rejects(
            () => uploadToNotion("dummy-key", Buffer.from("hi"), "text/plain", "a.txt"),
            { code: "validation_error", status: 400 }
        );

        // A 400 without an earlier 5xx fails straight away, without checking the upload
        requests = [];
        global.fetch = async (url, options) => {
            requests.push(`${options.method} ${url}`);
            if (url.endsWith('file_uploads')) return respond({ id: "mock-id", upload_url: "mock-url" });
            return respond({ object: "error", status: 400, code: "validation_error", message: "bad file" }, 400);
        };
        await assert.rejects(() => uploadToNotion("dummy-key", Buffer.from("hi"), "text/plain", "a.txt"), { code: "validation_error" });
        assert.deepStrictEqual(requests, ["POST https://api.notion.com/v1/file_uploads", "POST mock-url"]);
    } finally {
        Math.random = random;
    }
});

test('Mock: filenames over Notion\'s 900-byte limit are rejected before contacting Notion', async () => {
    let fetchCount = 0;
    global.fetch = async () => {
        fetchCount++;
        return respond({ id: "mock-id", upload_url: "mock-url" });
    };

    // 450 two-byte characters plus ".txt" is 904 bytes in UTF-8, although it's only 454 characters
    await assert.rejects(
        () => uploadToNotion("dummy-key", Buffer.from("x"), "text/plain", "é".repeat(450) + ".txt"),
        { code: "filename_too_long" }
    );
    assert.strictEqual(fetchCount, 0);

    // Exactly 900 bytes is allowed
    await uploadToNotion("dummy-key", Buffer.from("x"), "text/plain", "a".repeat(896) + ".txt");
});

test('Mock: aborting while the stream source has stalled rejects immediately', async () => {
    global.fetch = async (url) => {
        if (url.endsWith('users/me')) return respond({});
        if (url.endsWith('file_uploads')) return respond({ id: "mock-id", upload_url: "mock-url", complete_url: "mock-complete" });
        return respond();
    };

    // Delivers the first part, then never produces more (like a download that stalls)
    const stream = new Readable({ read() {} });
    stream.push(Buffer.alloc(10 * MiB));

    const controller = new AbortController();
    const upload = uploadStream("dummy-key", stream, "video/mp4", "v.mp4", { size: 25 * MiB, signal: controller.signal });
    await sleep(100); // Let the first part go out and the second read stall
    controller.abort();
    const start = Date.now();
    await assert.rejects(upload, { code: "aborted" });
    assert.ok(Date.now() - start < 200, "The upload kept waiting for the stalled source after the abort");
    assert.strictEqual(stream.destroyed, true);
});

test('Mock: a non-JSON create response fails with invalid_response', async () => {
    global.fetch = async () => respond("<html>captive portal</html>", 200);
    await assert.rejects(
        () => uploadToNotion("dummy-key", Buffer.from("hi"), "text/plain", "a.txt"),
        { name: "NotionUploadError", code: "invalid_response" }
    );
});

test('Mock: the workspace limit probe makes one attempt and does not delay the upload', async () => {
    let probes = 0;
    global.fetch = async (url) => {
        if (url.endsWith('users/me')) {
            probes++;
            return respond("down", 503, { 'Retry-After': '5' });
        }
        if (url.endsWith('file_uploads')) return respond({ id: "mock-id", upload_url: "mock-url", complete_url: "mock-complete" });
        return respond();
    };

    const start = Date.now();
    await uploadToNotion("dummy-key", Buffer.alloc(21 * MiB), "video/mp4", "v.mp4");
    assert.strictEqual(probes, 1);
    assert.ok(Date.now() - start < 1000, "The failed probe was retried before the upload started");
});

test('Mock: uploadFile reads every part from the file it opened, even if the path is replaced', async () => {
    const original = patternedBuffer(25 * MiB);
    const file = tempFile("video.mp4", original);
    const parts = new Map();
    global.fetch = async (url, options) => {
        if (url.endsWith('users/me')) return respond({});
        if (url.endsWith('file_uploads')) return respond({ id: "mock-id", upload_url: "mock-url", complete_url: "mock-complete" });
        if (url === 'mock-url') {
            const part = Number(options.body.get('part_number'));
            parts.set(part, Buffer.from(await options.body.get('file').arrayBuffer()));
            // After the first part is sent, replace the file on disk with different content
            if (part === 1) {
                const replacement = tempFile("other.mp4", Buffer.alloc(25 * MiB, 0xff));
                fs.renameSync(replacement, file);
            }
        }
        return respond();
    };

    await uploadFile("dummy-key", file, "video/mp4", { concurrency: 1 });
    assert.ok(Buffer.concat([parts.get(1), parts.get(2), parts.get(3)]).equals(original), "Parts were read from the replacement file");
});

test('Mock: inferBlockType picks the block type Notion attaches each file as', () => {
    // From the extension
    assert.strictEqual(inferBlockType("clip.MP4"), "video");
    assert.strictEqual(inferBlockType("photo.heic"), "image");
    assert.strictEqual(inferBlockType("voice.m4a"), "audio");
    assert.strictEqual(inferBlockType("report.pdf"), "pdf");
    assert.strictEqual(inferBlockType("notes.docx"), "file");
    assert.strictEqual(inferBlockType("model.glb"), "file");
    assert.strictEqual(inferBlockType("README"), "file");
    // CAD drawings have image/* types but only attach as file blocks
    assert.strictEqual(inferBlockType("plan.dwg"), "file");
    assert.strictEqual(inferBlockType("plan", "image/vnd.dxf"), "file");
    // A given MIME type wins over the extension, and is matched loosely
    assert.strictEqual(inferBlockType("upload.bin", "Video/MP4"), "video");
    assert.strictEqual(inferBlockType("scan", "image/png; charset=binary"), "image");
    assert.strictEqual(inferBlockType("clip.mp4", "application/octet-stream"), "file");
    assert.strictEqual(inferBlockType("clip.mp4", ""), "video");
});
