# Manga scraper migration

The MangaPill provider now follows the extraction strategy used by:

`https://github.com/basirulakhlakborno/manga-scraper`

## What changed

- MangaPill is now the default provider.
- Manga IDs are normalized to the numeric MangaPill ID.
- Chapter IDs are normalized from `/chapters/<chapterId>/...` URLs.
- Search uses `/search?q=...&page=...`.
- Empty catalogue browsing uses `/mangas/new?page=...`.
- Manga detail and chapter lists are parsed with Cheerio-style selectors.
- Chapter page extraction uses the upstream scraper's multi-selector strategy.
- Chapter page extraction also falls back to `images`, `pages`, or `chapter_images` arrays embedded in scripts.
- Image host allow-listing is learned from URLs returned by the active MangaPill scrape.
- Kindle starts on MangaPill by default.

## Dependency

The provider requires `cheerio`, added to `package.json`.

Run:

```bash
npm install
npm run build
```

The existing `package-lock.json` in this source archive was already out of sync with `package.json`, so regenerate it with your normal `npm install` before using `npm ci` in deployment.

## Environment

```env
MANGA_PROVIDER=mangapill
MANGAPILL_BASE_URL=https://mangapill.com/
```

`MANGAPILL_BASE_URL` is optional and can be changed for testing.
