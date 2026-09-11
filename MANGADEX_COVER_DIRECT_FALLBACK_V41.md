# MangaDex cover direct/fallback fix v41

This patch changes MangaDex cover loading to avoid depending on the hosting provider's outbound access to `uploads.mangadex.org`.

Flow:
1. Browser/Kindle loads the official MangaDex `.256.jpg` / `.512.jpg` CDN URL directly.
2. If the thumbnail fails, it retries the original cover file directly.
3. If that also fails, it falls back to the app's `/api/mangadex-cover/...` proxy.

It also prevents old saved MangaDex cover proxy URLs from being wrapped inside `/api/image-proxy` a second time.

No dependencies or database migrations are added.
