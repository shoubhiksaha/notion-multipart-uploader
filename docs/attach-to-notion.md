# Attaching files to Notion

Once you have a `file_upload` ID, attach it with the official `@notionhq/client`. Attach it within an hour: Notion sets each upload's `expiry_time` to one hour after it's created, and an expired upload can't be attached.

```javascript
const { Client } = require("@notionhq/client");
const notion = new Client({ auth: process.env.NOTION_KEY });

const file = { type: "file_upload", file_upload: { id: fileId } };

// As a block on a page: image, video, audio, pdf or file
await notion.blocks.children.append({
  block_id: "your_page_id",
  children: [{ type: "video", video: file }]
});

// In a database's "Files & media" property
await notion.pages.update({
  page_id: "your_page_id",
  properties: { Attachments: { files: [{ ...file, name: "report.pdf" }] } }
});

// As a page cover (page icons work the same way)
await notion.pages.update({ page_id: "your_page_id", cover: file });
```

Comments accept up to three uploads through the `attachments` parameter of [Create comment](https://developers.notion.com/reference/create-a-comment).

Reference: [Working with files and media](https://developers.notion.com/guides/data-apis/working-with-files-and-media), [File upload object](https://developers.notion.com/reference/file-upload)
