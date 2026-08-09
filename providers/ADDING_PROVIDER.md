# Adding an HTML provider (manga-tui style)

The backend now follows the same high-level separation used by `manga-tui`:

1. search
2. manga detail
3. chapter list
4. chapter detail
5. chapter page URLs
6. image download/proxy restricted to provider-owned/authorized hosts

## Files

- `types.ts` - normalized provider contract.
- `registry.ts` - providers available to the app.
- `mangadex-provider.ts` - working built-in API provider.
- `weebcentral-provider.ts` - HTML-backed WeebCentral provider ported from manga-tui's provider flow.
- `html-provider-template.ts` - base class for an HTML-backed provider.

## Implementing a source

Create a class extending `HtmlProviderTemplate` and implement:

- `search(params)`
- `getManga(id)`
- `getChapters(mangaId, params)`
- `getChapter(chapterId)`
- `getChapterPages(chapterId)`

Keep all site-specific CSS selectors/HTML parsing in that provider. Normalize output to the existing frontend shapes. Register the instance in `registry.ts`.

The frontend does not need source-specific changes. Both React and Kindle ES5 call:

- `GET /api/provider/search`
- `GET /api/provider/manga/:id`
- `GET /api/provider/manga/:id/chapters`
- `GET /api/provider/chapter/:id`
- `GET /api/provider/chapter/:id/pages`

The pages endpoint returns:

```json
{
  "result": "ok",
  "pages": ["https://cdn.example/page-001.jpg"],
  "dataSaverPages": []
}
```

Only add image/CDN hosts to `allowedImageHosts` when you are authorized to fetch them.


## Using WeebCentral

Set the backend provider before starting the app:

```env
MANGA_PROVIDER=weebcentral
```

The UI still has no source selector. The backend chooses the provider from `MANGA_PROVIDER`.
WeebCentral search, manga detail, chapter list, chapter detail, and chapter page URLs are normalized to the same MangaDex-shaped objects the existing frontend already understands.
