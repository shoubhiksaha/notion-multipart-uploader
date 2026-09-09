# Attaching files to Notion

Once you have a `file_upload` ID, attach it using the official `@notionhq/client`.

```javascript
const { Client } = require("@notionhq/client");
const notion = new Client({ auth: process.env.NOTION_KEY });

await notion.blocks.children.append({
  block_id: "your_page_id",
  children: [{
    type: "video",
    video: {
      type: "file_upload",
      file_upload: { id: fileId }
    }
  }]
});
```

Reference: [Notion Blocks API](https://developers.notion.com/reference/block)
