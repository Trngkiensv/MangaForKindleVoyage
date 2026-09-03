# CrawlComic / TruyenQQ provider

Provider key: `crawlcomic`

Default source:

```text
https://truyenqq.com.vn
```

Optional environment override:

```bash
CRAWL_COMIC_BASE_URL=https://truyenqq.com.vn
```

## What was integrated

The GitHub project `minhduc1212/Crawl_Comic` is a downloader/userscript rather than a REST API. This app therefore ports its TruyenQQ extraction strategy into `providers/crawlcomic-provider.ts` while keeping the existing `MangaProvider` interface.

The adapter uses Crawl_Comic's TruyenQQ selectors as primary hints:

- chapter links: `.works-chapter-list a`
- reader content: `.chapter_content`
- image source preference: `data-src`, `data-original`, then `src`

Additional selectors are included for newer TruyenQQ layouts.

## Provider switching

Both frontends can switch between:

1. MangaPill
2. CrawlComic / TruyenQQ
3. WeebCentral
4. MangaDex

The active source is persisted locally. Provider query parameters are attached to manga, chapter, and image-proxy requests. React bookmarks/history and the Kindle database flow preserve provider identity so IDs from different sources do not collide.

## Direct URLs

The React search box recognizes TruyenQQ manga/chapter URLs. The Kindle ES5 search box recognizes TruyenQQ manga URLs and automatically selects `crawlcomic`.

## Install note

`cheerio` is required by both the MangaPill and CrawlComic HTML adapters. If dependencies are not already installed, run `npm install` before `npm run build`.
