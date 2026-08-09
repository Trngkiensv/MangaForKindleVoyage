# Provider / crawler adapter

The frontend is now source-neutral. Both the React UI and the Kindle ES5 UI use the same backend provider contract.

This pass ports the high-level `manga-tui` provider design into the project. A source implementation owns only the network requests, HTML/API parsing, and image-host allowlist; the reader UI does not need to know where the data came from.

## Current status

- Built-in working provider: MangaDex API.
- Provider-neutral backend routes: complete.
- React frontend migrated to provider routes: complete.
- Kindle ES5 frontend migrated to provider routes: complete.
- HTML provider base class: included in `providers/html-provider-template.ts`.
- Mangago-specific selectors/parser: not included in this pass because the site HTML could not be fetched from the available web tooling, so hard-coding selectors would be guesswork.

## Provider contract

A provider implements:

1. `search(params)`
2. `getManga(id)`
3. `getChapters(mangaId, params)`
4. `getChapter(chapterId)`
5. `getChapterPages(chapterId)`
6. `isAllowedImageUrl(url)`

The reader-facing page response is intentionally simple:

```json
{
  "result": "ok",
  "pages": [
    "https://cdn.example/chapter/001.jpg",
    "https://cdn.example/chapter/002.jpg"
  ],
  "dataSaverPages": []
}
```

## Backend routes

- `GET /api/provider/search?...`
- `GET /api/provider/manga/:id`
- `GET /api/provider/manga/:id/chapters?...`
- `GET /api/provider/chapter/:id`
- `GET /api/provider/chapter/:id/pages`
- `GET /api/image-proxy?url=...`

## Adding a site-specific HTML crawler

Extend `HtmlProviderTemplate`, keep all selectors and URL-building logic inside that class, then register the provider in `providers/registry.ts`.

For a site whose live HTML cannot be accessed from the development environment, use saved HTML fixtures for these four pages before writing selectors:

- search result page
- manga detail page
- chapter list page
- chapter reader/page-list response

That makes the crawler testable without changing the frontend and avoids coupling UI code to brittle site markup.
