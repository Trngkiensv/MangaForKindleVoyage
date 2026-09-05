# Provider fixes v37

This update targets four issues reported after moving the app to Northflank.

## MangaKatana description

`MangaKatanaProvider.getManga()` now extracts the synopsis from multiple current/older layouts:

- summary/description class variants
- description id variants
- a literal `Description` heading followed by paragraph/div content
- meta-description fallback

The extracted text is cleaned so the heading itself is not returned as part of the synopsis.

## MangaDex covers

MangaDex manga responses now normalize the `cover_art` relationship into an explicit
`uploads.mangadex.org/covers/<manga-id>/<fileName>` URL.  The image proxy also sends a
MangaDex referer and browser-compatible request headers.  Kindle still requests the cover
through `/api/image-proxy?kindle=cover` so the existing Kindle JPEG normalization remains in place.

## MangaDex chapter language selector

MangaDex chapter feeds can now be filtered with `translatedLanguage[]`.

- React UI: language buttons in the Chapter List panel.
- Kindle ES5 UI: language buttons on the manga detail screen.
- The last Kindle/MangaDex language is saved in reader settings/local storage.
- Buttons prefer languages actually listed by MangaDex in `availableTranslatedLanguages`.

This chooses the language of the uploaded MangaDex chapter/scanlation. It is separate from the
OCR/AI English-to-Vietnamese overlay feature.

## MangaFire invalid token

MangaFire's current upstream API rejects the old static VRF request signer with HTTP 403
`Invalid token` / `Missing token` / `captcha_required`.  The provider now reports this as a
clear HTTP 503 upstream-token error instead of surfacing it as a generic 502.

No automatic provider fallback is added.  If MangaFire is selected, the app stays on MangaFire.
The app does not attempt to bypass MangaFire's Cloudflare/session challenge.

## Files changed

- `providers/mangakatana-provider.ts`
- `providers/mangadex-provider.ts`
- `providers/mangafire-provider.ts`
- `src/services/provider.ts`
- `src/components/MangaDetail.tsx`
- `public/kindle-voyage.js`
- `public/kindle-voyage.css`

## Validation

- Kindle ES5 JS: `node --check public/kindle-voyage.js`
- Standalone TypeScript syntax checks for all changed TS/TSX files
- MangaKatana description regression fixtures: heading + paragraph, summary block, meta fallback

The archive intentionally contains no regenerated `package-lock.json`. Keep the working lock file
already committed in the Northflank repository, or run `npm install` before committing if dependencies
need to be regenerated.
