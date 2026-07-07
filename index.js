/**
 * Uploads a binary file directly to Notion's servers using a 2-step multipart flow.
 * 
 * @param {string} apiKey - Your Notion Integration Token
 * @param {Buffer|Blob} fileBuffer - The binary data of the file (audio, image, pdf, etc.)
 * @param {string} mimeType - e.g., 'audio/mp4', 'image/jpeg', 'application/pdf'
 * @param {string} filename - The name of the file (e.g., 'voice-note.m4a')
 * @returns {Promise<string>} The Notion File ID to use in your blocks
 */
async function uploadToNotion(apiKey, fileBuffer, mimeType, filename) {
    if (!apiKey) throw new Error("Notion API Key is required");
    if (!fileBuffer) throw new Error("File buffer is required");

    // Step 1: Initialize the upload with Notion
    const createRes = await fetch("https://api.notion.com/v1/file_uploads", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Notion-Version": "2022-06-28"
        },
        body: JSON.stringify({
            filename: filename || "uploaded-file",
            content_type: mimeType
        })
    });

    if (!createRes.ok) {
        throw new Error(`Notion Init Upload Failed: ${await createRes.text()}`);
    }
    
    const { id, upload_url } = await createRes.json();

    // Step 2: Upload the binary data via Multipart FormData
    const form = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    form.append("file", blob, filename || "uploaded-file");

    const uploadRes = await fetch(upload_url, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Notion-Version": "2022-06-28"
        },
        body: form
    });

    if (!uploadRes.ok) {
        throw new Error(`Notion Binary Upload Failed: ${await uploadRes.text()}`);
    }

    return id;
}

module.exports = { uploadToNotion };
