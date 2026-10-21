const { uploadToNotion, uploadFile } = require('./dist/index.js');

// Never hardcode your API keys in open source! Load them from environment variables instead.
const NOTION_KEY = process.env.NOTION_KEY;
const DATABASE_ID = process.env.DATABASE_ID;

const fs = require('fs');
const os = require('os');
const path = require('path');

// A tiny valid 1x1 pixel transparent PNG
const dummyImageBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
const dummyAudioBuffer = Buffer.from('SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYxLjEuMTAwAAAAAAAAAAAAAAD/+0DAAAAAAAAAAAAAAAAAAAAAAABR0wAAA', 'base64');

async function runTests() {
    if (!NOTION_KEY || !DATABASE_ID) {
        console.error("❌ ERROR: Set the NOTION_KEY and DATABASE_ID environment variables to run the live tests.");
        process.exitCode = 1;
        return;
    }

    try {
        console.log("🚀 Testing Image Upload...");
        const imageId = await uploadToNotion(NOTION_KEY, dummyImageBuffer, 'image/png', 'test-image.png');
        console.log(`✅ Image Uploaded! Notion File ID: ${imageId}`);

        console.log("🚀 Testing Audio Upload...");
        const audioId = await uploadToNotion(NOTION_KEY, dummyAudioBuffer, 'audio/mp4', 'test-audio.m4a');
        console.log(`✅ Audio Uploaded! Notion File ID: ${audioId}`);

        console.log("🚀 Testing File Upload from disk...");
        const textPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nmu-integration-')), 'test-note.txt');
        fs.writeFileSync(textPath, 'Uploaded from disk by notion-multipart-uploader');
        const textId = await uploadFile(NOTION_KEY, textPath, 'text/plain');
        console.log(`✅ File Uploaded! Notion File ID: ${textId}`);

        console.log("📝 Creating a Notion Page to attach these files...");
        const pageRes = await fetch("https://api.notion.com/v1/pages", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${NOTION_KEY}`,
                "Content-Type": "application/json",
                "Notion-Version": "2026-03-11"
            },
            body: JSON.stringify({
                parent: { database_id: DATABASE_ID },
                properties: {
                    "Name": { title: [{ text: { content: "NPM Package Test" } }] }
                },
                children: [
                    {
                        object: 'block',
                        type: 'paragraph',
                        paragraph: { rich_text: [{ text: { content: "Testing the notion-multipart-uploader package!" } }] }
                    },
                    {
                        object: 'block',
                        type: 'image',
                        image: { type: 'file_upload', file_upload: { id: imageId } }
                    },
                    {
                        object: 'block',
                        type: 'file', // Using 'file' block for dummy audio to avoid format rejection if it checks bytes
                        file: { type: 'file_upload', file_upload: { id: audioId } }
                    },
                    {
                        object: 'block',
                        type: 'file',
                        file: { type: 'file_upload', file_upload: { id: textId } }
                    }
                ]
            })
        });

        if (!pageRes.ok) {
            console.error("❌ Failed to create page:", await pageRes.text());
            process.exitCode = 1;
        } else {
            const pageData = await pageRes.json();
            console.log("✅ Page Created Successfully! URL:", pageData.url);
        }

    } catch (err) {
        console.error("❌ Test Failed:", err);
        process.exitCode = 1;
    }
}

runTests();
