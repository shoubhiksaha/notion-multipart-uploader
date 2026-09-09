# Differences from @notionhq/client

| Feature | @notionhq/client | notion-multipart-uploader |
|---|---|---|
| Single-part (<= 20 MiB) | Supported | Supported |
| Multi-part (> 20 MiB) | Endpoints only | Fully automated chunking |
| Large file memory | Loads into RAM | `uploadFile` streams from disk |
| Retry limits | Basic | Exponential backoff, jitter, `Retry-After`, `529` handling |
| Concurrency | None | Concurrent chunk uploads |
