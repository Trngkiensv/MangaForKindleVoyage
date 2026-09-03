# v33 multi-provider changes

- Added `crawlcomic` provider backed by TruyenQQ extraction logic adapted from `minhduc1212/Crawl_Comic`.
- Added provider cycling in the React header and Kindle Voyage ES5 UI.
- Provider cycle: MangaPill -> CrawlComic / TruyenQQ -> WeebCentral -> MangaDex.
- Active provider is persisted locally.
- Search, manga, chapter, and image-proxy calls now carry the active provider.
- React bookmarks/history are provider-scoped; old entries without a provider are treated as MangaPill entries.
- TruyenQQ manga/chapter URLs are recognized by the React search box; TruyenQQ manga URLs are recognized by Kindle ES5.
- Fixed direct MangaDex UUID handling in Kindle ES5 so it selects MangaDex.
- Added `CRAWL_COMIC_BASE_URL`, defaulting to `https://truyenqq.com.vn`.
- Removed the stale `package-lock.json`; run `npm install` to generate a lock matching the current `package.json`.

## Validation performed

- `node --check public/kindle-voyage.js`: passed.
- TypeScript syntax/type scan of modified files found no project-code errors; full dependency resolution could not run because this environment has no `node_modules` and cannot reach npm registry.
