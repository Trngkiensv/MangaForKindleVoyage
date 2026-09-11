# MangaDex cover direct fix v42

- MangaDex cover thumbnails now load directly from `https://uploads.mangadex.org/covers/...`.
- React cards/detail fall back to `/api/mangadex-cover/...` only if the direct image fails.
- Kindle uses the direct `.256.jpg` thumbnail URL.
- No dependency or database changes.
