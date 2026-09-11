# MangaDex anti-hotlink cover fix v43

## Root cause
MangaDex can return a branded "You can read this at MangaDex" image with HTTP 200 when a cover is hotlinked with an unsuitable Referer. The v42 dedicated cover proxy tried a neutral request first and accepted any 200 image, so it could cache/return the placeholder as if it were the real cover.

## Fix
- The dedicated `/api/mangadex-cover/:mangaId/:fileName` route now always sends `Referer: https://mangadex.org/`.
- Kindle no longer loads MangaDex covers directly from `uploads.mangadex.org`; it uses the dedicated route with `kindle=cover`, which also converts the result to baseline JPEG.
- React/browser keeps the direct `no-referrer` path and can still fall back to the dedicated route.

No dependency or database changes are required.
