# Differences from @notionhq/client

The official SDK exposes Notion's file upload endpoints (`fileUploads.create`, `send`, `complete`). `notion-multipart-uploader` builds the whole upload on top of the same API.

| Feature | @notionhq/client | notion-multipart-uploader |
|---|---|---|
| Single-part uploads (20 MiB or less) | You call create, then send | One call |
| Multi-part uploads (over 20 MiB) | You split the file, number and send each part, then call complete | One call, parts sent in parallel |
| Memory use for large files | You read and slice the file yourself | Reads 10 MiB at a time from disk or from a stream |
| Rate limits (`429`, `529`) | Retried, waiting for `Retry-After` | Retried, and all parallel parts pause together |
| Timeouts and network errors on parts | Up to you | Retried with backoff |
| A send or complete that went through despite an error | Up to you | Detected by checking the upload's status |
| Unsupported file types, long filenames, workspace size limit | Reported by Notion's API as errors | Checked before uploading, with a specific error `code` for each |
| Progress and cancellation | Up to you | `onProgress` and `signal` options |

Use the SDK to attach the returned `file_upload` ID to pages, blocks and properties. See [Attaching files to Notion](attach-to-notion.md).
