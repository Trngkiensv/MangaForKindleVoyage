# Kindle Voyage multi-provider setup (v32)

Visible manga sources on Kindle:

- WeebCentral
- MangaFire
- MangaKatana

## Render

No new required environment variables are needed. Keep the existing Render variables. Recommended default:

```env
MANGA_PROVIDER=mangakatana
```

Optional overrides (normally leave them unset):

```env
MANGAFIRE_BASE_URL=https://mangafire.to/
MANGAKATANA_BASE_URL=https://mangakatana.com/
```

The Kindle remembers only the selected provider as a tiny reader setting. Manga content, Saved state, History, and reading progress are not copied into growing localStorage.

## Neon

This build expects provider-aware manga tables:

```text
reading_progress PRIMARY KEY (user_id, provider, chapter_id)
saved_manga      PRIMARY KEY (user_id, provider, manga_id)
```

If the existing database already has those keys/columns, do not drop or recreate the tables. Old rows remain under `weebcentral`; the new providers are stored under `mangafire` and `mangakatana`.

## Provider behavior

- WeebCentral: existing adapter, unchanged.
- MangaFire: current JSON API with server-side request VRF and image proxy.
- MangaKatana: direct HTML metadata/chapter parsing, lazy page-image parsing, and image proxy.

Third-party sites can change markup/API behavior without notice. A source failing does not alter or corrupt another source's Neon rows because provider is part of every manga data key.


## v34 strict mode

Current clients always send an explicit `provider=`. Missing/invalid provider keys return HTTP 400; there is no fallback to WeebCentral. MangaKatana chapter pages also parse the full JavaScript image array when the initial HTML contains only one page.
