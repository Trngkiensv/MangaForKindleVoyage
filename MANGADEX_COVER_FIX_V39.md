# MangaDex cover fix v39

## Problem

v38 still built MangaDex CDN URLs in the client and sent them through the generic image proxy. That made a failed thumbnail look like a generic broken image on Kindle and left no reliable fallback path.

## v39 change

MangaDex covers now use a dedicated backend route:

`/api/mangadex-cover/:mangaId/:fileName?size=256&provider=mangadex`

For Kindle the client adds `kindle=cover`.

The server tries, in order:

1. requested MangaDex thumbnail size (`.256.jpg` or `.512.jpg`)
2. the alternate thumbnail size
3. the original cover file

Each candidate gets a neutral browser-like request first and a provider-header retry second. Kindle covers are normalized to a non-progressive baseline JPEG before being returned.

If every candidate fails, the runtime log now prints the manga id, cover filename, last upstream HTTP status, and last attempted URL.

## Files changed

- `server.ts`
- `src/services/provider.ts`
- `public/kindle-voyage.js`

No dependency or database change is required.
