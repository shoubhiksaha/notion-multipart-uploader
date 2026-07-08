const { uploadToNotion } = require('./index');

// Never hardcode your API keys in open source! Load them from environment variables instead.
const NOTION_KEY = process.env.NOTION_KEY || "YOUR_NOTION_API_KEY";
const DATABASE_ID = process.env.DATABASE_ID || "YOUR_NOTION_DATABASE_ID";

const fs = require('fs');

// A tiny valid 1x1 pixel transparent PNG
const dummyImageBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
const dummyAudioBuffer = Buffer.from('SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYxLjEuMTAwAAAAAAAAAAAAAAD/+0DAAAAAAAAAAAAAAAAAAAAAAABR0wAAA', 'base64');

async function runTests() {
    if (!NOTION_KEY || !DATABASE_ID) {
        console.error("❌ ERROR: Please set NOTION_KEY and DATABASE_ID in test.js to run the live tests.");
        return;
    }

    try {
        console.log("🚀 Testing Image Upload...");
        const imageId = await uploadToNotion(NOTION_KEY, dummyImageBuffer, 'image/png', 'test-image.png');
        console.log(`✅ Image Uploaded! Notion File ID: ${imageId}`);

        console.log("🚀 Testing Audio Upload...");
        const audioId = await uploadToNotion(NOTION_KEY, dummyAudioBuffer, 'audio/mp4', 'test-audio.m4a');
        console.log(`✅ Audio Uploaded! Notion File ID: ${audioId}`);

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
                    }
                ]
            })
        });

        if (!pageRes.ok) {
            console.error("❌ Failed to create page:", await pageRes.text());
        } else {
            const pageData = await pageRes.json();
            console.log("✅ Page Created Successfully! URL:", pageData.url);
        }

    } catch (err) {
        console.error("❌ Test Failed:", err);
    }
}

testUpload();
