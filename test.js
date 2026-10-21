const { uploadToNotion, uploadFile, uploadStream } = require('./dist/index.js');

// Never hardcode your API keys in open source! Load them from environment variables instead.
const NOTION_KEY = process.env.NOTION_KEY;
// A page shared with the integration; the uploaded files are appended to it
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID;
// Set to 1 to also test multi-part uploads (needs a paid workspace; uploads about 50 MiB)
const TEST_LARGE = process.env.NOTION_TEST_LARGE === '1';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

// A tiny valid 1x1 pixel transparent PNG
const dummyImageBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
const dummyAudioBuffer = Buffer.from('SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYxLjEuMTAwAAAAAAAAAAAAAAD/+0DAAAAAAAAAAAAAAAAAAAAAAABR0wAAA', 'base64');

const MiB = 1024 * 1024;
const LARGE_FILE_SIZE = 25 * MiB; // 3 parts

async function notion(method, endpoint, body) {
    const res = await fetch(`https://api.notion.com/v1/${endpoint}`, {
        method,
        headers: {
            "Authorization": `Bearer ${NOTION_KEY}`,
            "Content-Type": "application/json",
            "Notion-Version": "2026-03-11"
        },
        body: body && JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${endpoint} failed (${res.status}): ${JSON.stringify(data)}`);
    return data;
}

const fileBlock = (type, fileId, caption) => ({
    object: 'block',
    type,
    [type]: {
        type: 'file_upload',
        file_upload: { id: fileId },
        caption: [{ type: 'text', text: { content: caption } }]
    }
});

async function runTests() {
    if (!NOTION_KEY || !NOTION_PAGE_ID) {
        console.error("❌ ERROR: Set the NOTION_KEY and NOTION_PAGE_ID environment variables to run the live tests.");
        process.exitCode = 1;
        return;
    }

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmu-integration-'));
    const blocks = [{
        object: 'block',
        type: 'heading_3',
        heading_3: { rich_text: [{ text: { content: `notion-multipart-uploader integration test (${new Date().toISOString()})` } }] }
    }];

    try {
        console.log("🚀 Checking error codes with an invalid token...");
        try {
            await uploadToNotion("invalid-token", dummyImageBuffer, 'image/png', 'test-image.png');
            throw new Error("Upload with an invalid token should have failed");
        } catch (err) {
            if (err.code !== 'unauthorized' || err.status !== 401) throw err;
            console.log("✅ Invalid token rejected with code 'unauthorized'");
        }

        console.log("🚀 Testing Image Upload...");
        const imageId = await uploadToNotion(NOTION_KEY, dummyImageBuffer, 'image/png', 'test-image.png');
        blocks.push(fileBlock('image', imageId, 'uploadToNotion (image)'));
        console.log(`✅ Image Uploaded! Notion File ID: ${imageId}`);

        console.log("🚀 Testing Audio Upload...");
        const audioId = await uploadToNotion(NOTION_KEY, dummyAudioBuffer, 'audio/mp4', 'test-audio.m4a');
        // Using 'file' block for dummy audio to avoid format rejection if it checks bytes
        blocks.push(fileBlock('file', audioId, 'uploadToNotion (audio)'));
        console.log(`✅ Audio Uploaded! Notion File ID: ${audioId}`);

        console.log("🚀 Testing File Upload from disk...");
        const textPath = path.join(workDir, 'test-note.txt');
        fs.writeFileSync(textPath, 'Uploaded from disk by notion-multipart-uploader');
        const textId = await uploadFile(NOTION_KEY, textPath);
        blocks.push(fileBlock('file', textId, 'uploadFile'));
        console.log(`✅ File Uploaded! Notion File ID: ${textId}`);

        console.log("🚀 Testing Stream Upload...");
        const streamText = 'Streamed by notion-multipart-uploader';
        const streamId = await uploadStream(NOTION_KEY, Readable.from([Buffer.from(streamText)]), 'text/plain', 'test-stream.txt', { size: streamText.length });
        blocks.push(fileBlock('file', streamId, 'uploadStream'));
        console.log(`✅ Stream Uploaded! Notion File ID: ${streamId}`);

        if (TEST_LARGE) {
            const me = await notion('GET', 'users/me');
            const limit = me.bot?.workspace_limits?.max_file_upload_size_in_bytes;
            if (typeof limit === 'number' && limit < LARGE_FILE_SIZE) {
                console.log(`⏭️  Skipping multi-part tests: this workspace allows uploads up to ${limit} bytes`);
            } else {
                const largePath = path.join(workDir, 'large-test.txt');
                const line = 'notion-multipart-uploader multi-part integration test\n';
                fs.writeFileSync(largePath, line.repeat(Math.ceil(LARGE_FILE_SIZE / line.length)).slice(0, LARGE_FILE_SIZE));

                console.log("🚀 Testing Multi-part File Upload (25 MiB)...");
                const largeId = await uploadFile(NOTION_KEY, largePath, 'text/plain', {
                    onProgress: (uploaded, total) => console.log(`   ${Math.round(uploaded / total * 100)}%`)
                });
                blocks.push(fileBlock('file', largeId, 'uploadFile (multi-part)'));
                console.log(`✅ Multi-part File Uploaded! Notion File ID: ${largeId}`);

                console.log("🚀 Testing Multi-part Stream Upload (25 MiB)...");
                const largeStreamId = await uploadStream(NOTION_KEY, fs.createReadStream(largePath), 'text/plain', 'large-stream-test.txt', { size: LARGE_FILE_SIZE });
                blocks.push(fileBlock('file', largeStreamId, 'uploadStream (multi-part)'));
                console.log(`✅ Multi-part Stream Uploaded! Notion File ID: ${largeStreamId}`);
            }
        }

        console.log("📝 Attaching the uploads to the Notion page...");
        await notion('PATCH', `blocks/${NOTION_PAGE_ID}/children`, { children: blocks });
        console.log(`✅ Attached ${blocks.length - 1} files to page ${NOTION_PAGE_ID}`);

    } catch (err) {
        console.error("❌ Test Failed:", err);
        process.exitCode = 1;
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
}

runTests();
