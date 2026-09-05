# Provider fixes v38

This patch fixes the MangaDex regressions reported after v37.

## MangaDex language filter 400

Express can parse bracket-style query parameters such as `translatedLanguage[]=en`
into nested values before `req.query` is read. v37 rebuilt the provider query from
`req.query`, which turned MangaDex's required array into a scalar and caused:

`Error validating /translatedLanguage: String value found, but an array is required`

Provider search/chapter routes now rebuild `URLSearchParams` from the raw request query
string, preserving `translatedLanguage[]`, `contentRating[]`, and `order[chapter]` exactly.
The MangaDex provider also normalizes either scalar/bracket input back into repeated
`translatedLanguage[]` parameters before calling the upstream API.

## MangaDex chapter order

MangaDex feeds are now forced to `order[chapter]=desc` in both the client and provider.
A defensive local sort keeps numeric chapters high-to-low and orders duplicate chapter
releases by newest readable/publish date.

## MangaDex cover

MangaDex cards now prefer the generated JPEG cover thumbnails (`.256.jpg` / `.512.jpg`)
instead of the original cover format. Kindle uses the 256px version and React uses the
requested 256/512 size. The image proxy retries the original cover if a thumbnail is
missing, and Kindle still normalizes covers to baseline JPEG when possible.

## MangaDex language buttons

The language selector now includes all languages actually returned in
`availableTranslatedLanguages`, not only the old hard-coded subset. Common MangaDex codes
such as `zh`, `zh-hk`, `ja-ro`, `ko-ro`, and `zh-ro` are labelled explicitly.

## Files changed

- `server.ts`
- `providers/mangadex-provider.ts`
- `src/services/provider.ts`
- `src/components/MangaDetail.tsx`
- `public/kindle-voyage.js`

No dependency change is required. Keep the working `package-lock.json` already committed
in the Northflank repository.
