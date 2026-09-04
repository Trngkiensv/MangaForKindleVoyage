# v34: strict providers + MangaKatana full chapter pages

## What changed

- Provider requests are strict. Manga, chapter, page, image-proxy, reading-progress, saved-state, and translation chapter endpoints require an explicit `provider=` query parameter.
- An unknown or missing provider now returns HTTP 400. It is never replaced with WeebCentral or any other source.
- The server default used by `/api/health` is MangaKatana (`MANGA_PROVIDER=mangakatana`), but this default is not used as a fallback for reader API requests.
- React and Kindle Voyage both persist the user's selected provider and send it with every provider-specific request.
- Saved/history items keep their own provider. Opening one explicitly switches to the provider stored on that item.
- MangaDex is now also exposed in the Kindle source buttons.

## MangaKatana one-page fix

The old MangaKatana parser stopped after seeing one server-rendered image. MangaKatana can render one initial page while the rest of the chapter is stored in JavaScript and later inserted into `#imgs`.

The v34 parser now:

1. Collects all visible `#page* img` and `#imgs` lazy image attributes.
2. Continues parsing even when one DOM image was already found.
3. Scans assigned JavaScript arrays without assuming a stable variable name.
4. Scores candidate arrays and prefers the chapter image array matching the already observed image host.
5. Preserves the original array order and avoids combining alternate image servers.
6. Registers every selected image host with the provider image proxy.

A synthetic regression fixture with one DOM image plus an 18-image JavaScript array returns all 18 pages in order.

## Neon

Existing `reading_progress` and `saved_manga` primary keys already include `provider`. During database initialization v34 also drops the old `DEFAULT 'weebcentral'` from those provider columns. Provider values must therefore come from the selected source rather than a database default.

No rows are deleted and no tables are recreated.

## Render

Recommended environment value:

```text
MANGA_PROVIDER=mangakatana
```

This controls the provider reported by `/api/health`. Current clients still send an explicit provider for reader requests.

Deploy normally:

```bash
npm ci
npm run build
npm start
```
