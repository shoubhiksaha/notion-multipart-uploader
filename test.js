const { uploadToNotion } = require('./index');

// Never hardcode your API keys in open source! Load them from environment variables instead.
const NOTION_KEY = process.env.NOTION_KEY || "YOUR_NOTION_API_KEY";
const DATABASE_ID = process.env.DATABASE_ID || "YOUR_NOTION_DATABASE_ID";

const fs = require('fs');
// Load the awesome logo we generated!
const dummyImageBuffer = fs.readFileSync('/Users/domgeshworld/.gemini/antigravity-ide/brain/b6aad6b7-aee3-4d1c-9750-dc71915b3cf9/npm_package_logo_1783465227145.png');

// A dummy text file masquerading as audio for testing
const dummyAudioBuffer = Buffer.from('Testing audio upload content');

async function testUpload() {
    console.log("🚀 Testing Image Upload...");
    try {
        const imageId = await uploadToNotion(NOTION_KEY, dummyImageBuffer, "image/png", "test-image.png");
        console.log("✅ Image Uploaded! Notion File ID:", imageId);
        
        console.log("🚀 Testing Audio Upload...");
        const audioId = await uploadToNotion(NOTION_KEY, dummyAudioBuffer, "audio/mp4", "test-audio.m4a");
        console.log("✅ Audio Uploaded! Notion File ID:", audioId);

        console.log("📝 Creating a Notion page to verify them...");
        const pageRes = await fetch("https://api.notion.com/v1/pages", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${NOTION_KEY}`,
                "Content-Type": "application/json",
                "Notion-Version": "2022-06-28"
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
