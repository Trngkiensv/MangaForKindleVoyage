# Kindle Voyage Manga Reader - ES5 v3

A local provider-based manga reader optimized for the Kindle Voyage Experimental Browser.

The Kindle-facing UI at `/` is plain ES5 JavaScript and XMLHttpRequest. React remains available at `/modern` for newer browsers.

## v3 highlights

- Simplified chapter list: no translator/source-group or language selector.

- Load the complete chapter feed in 100-item pages.
- Show unique chapter-number count, total releases, and latest numeric chapter.
- Full-screen reader layout on Kindle.
- Fit Page, Fit Width, and 50%-300% zoom modes.
- Saver/HQ image quality switch.
- Remember the last page read for each chapter.
- Keep one manga image active at a time to reduce Kindle memory pressure.

## Windows setup

```powershell
npm install
npm run build
npm start
```

Or run:

```powershell
.\SETUP_KINDLE.ps1
.\START_KINDLE.ps1
```

The server prints a LAN URL such as:

```text
Kindle/LAN: http://192.168.1.6:3000
```

Open the printed LAN URL on the Kindle while both devices are on the same Wi-Fi. If the old UI is cached, use:

```text
http://192.168.1.6:3000/?v=3
```

## Reader controls

- `Fit page`: scale the complete manga page into the available screen area. This is the default.
- `Fit width`: fill the Kindle width and scroll vertically.
- `-` / `+`: zoom from 50% to 300%.
- `Saver` / `HQ`: use a provider data-saver image set when available, otherwise fall back to the original pages.
- Tap the image in Fit Page mode to go to the next page.

## Diagnostic

```text
http://YOUR-PC-IP:3000/kindle-test.html
```

The test page checks HTML, old-style JavaScript, and the local API.

## Provider architecture (manga-tui style)

The backend is now provider-neutral. The UI talks to `/api/provider/...` rather than directly to a source-specific API. Built-in providers are MangaDex and WeebCentral. Set `MANGA_PROVIDER=mangadex` or `MANGA_PROVIDER=weebcentral` in the environment; the frontend still has no source selector. `providers/html-provider-template.ts` remains the starting point for additional server-rendered HTML sources.

See `providers/ADDING_PROVIDER.md` for the adapter contract.

## Use WeebCentral

PowerShell:

```powershell
$env:MANGA_PROVIDER="weebcentral"
npm run dev
```

macOS/Linux:

```bash
MANGA_PROVIDER=weebcentral npm run dev
```

The frontend remains provider-neutral; changing `MANGA_PROVIDER` selects the backend provider.

### Long-series performance

Voyage ES5 v7 uses paged chapter feeds (40 releases per request/DOM page) and accepts WeebCentral release labels such as Chapter, Scene, Page, Volume, and other numeric chapter-link labels.
WeebCentral chapter metadata is cached server-side for 10 minutes, so browsing a
1,000+ chapter series does not repeatedly download and parse the full chapter-list
HTML. The React UI uses 60 releases per chapter page.

Voyage ES5 v7 also adds direct chapter-page jumping (`Page [n] / total Go`) and a
collapsible full-width reader control panel with larger touch targets. Collapsing the
panel gives Fit Page substantially more viewport space on the Voyage.

## English -> Vietnamese live translation

Kindle Voyage ES5 v14 can overlay context-aware Vietnamese translations on English manga pages using server-side OCR.Space + a Cloudflare Workers AI instruction LLM. See `README_TRANSLATION_EN_VI.md`.


Kindle Voyage ES5 v16 adds a left Previous-page rail, direct tap-to-next reading, chapter jump/navigation controls, and direct History resume.


## ES5 v16: translation is opt-in

- Vietnamese translation starts OFF on every browser/app session, even if an older build saved VI ON in localStorage.
- While VI is OFF, the Kindle does not request page OCR, Cloudflare translation, or translation prefetch. Image preloading continues normally.
- Turning VI OFF asks the server to remove not-yet-started prefetch jobs for the current chapter. A request that has already reached OCR.Space/Cloudflare may still finish, because already-sent API usage cannot be recovered.
- Switching chapters also cancels queued translation prefetch jobs from the previous chapter.
- Turning VI ON explicitly translates the current page and warms the configured pages ahead.

## ES5 v17: proper-name-safe translation fallback

- Proper names and URLs may remain unchanged without being treated as failed translation.
- A single failed OCR region no longer aborts translation for the whole page.
- Successfully translated regions are still shown; only the failed region falls back to its source text.

## ES5 v18: five-page reading window + lean translation

- While reading, the Kindle retains a five-page image window: two previous pages, the current page, and two following pages. Near chapter boundaries the window naturally contains fewer pages.
- VI ON translates the current page immediately and warms the configured following pages in the background. The current page is no longer duplicated in the prefetch queue.
- The Kindle keeps the five most recently viewed translation results in a small in-memory hot cache, so stepping back through recently read pages does not even need another translation HTTP request.
- The server-side `.cache/en-vi-translation/` cache is still preserved as the longer-lived quota-saving layer, so revisiting older translated pages should not consume Cloudflare/OCR quota again while that server cache still exists.


## ES5 v19: SFX quota saver + two-page translation warmup

When `VI ON`, the current page is translated immediately and the next **two** pages are warmed sequentially into the Kindle five-page translation hot cache. Image reading still keeps a five-page window (`-2, -1, current, +1, +2`).

Before Cloudflare is called, obvious URLs, standalone proper names/honorifics, common manga SFX, and consonant-heavy OCR noise are filtered locally. Skipped regions stay untouched in the original artwork and consume **no LLM neurons**. The Qwen prompt uses `/no_think`, is shorter, and applies a dynamic output cap.

Quota-saving mode is the default:

```env
TRANSLATION_PREFETCH_AHEAD=2
TRANSLATION_ALLOW_FALLBACK=false
```

With fallback disabled, an incomplete Qwen page is not retried with Llama and missing regions are simply left in the original artwork. Set `TRANSLATION_ALLOW_FALLBACK=true` only if you prefer completeness over neuron usage.

## ES5 v20: Neon accounts + server-side reading history

ES5 v20 moves growing user data off the Kindle browser and into PostgreSQL/Neon:

- username + email + password account
- persistent server sessions via a small HttpOnly cookie
- reading history and chapter/page progress
- Saved Manga
- password reset using a 6-digit email code
- History API/UI pagination at 40 rows per page

The Kindle no longer writes new history/progress/bookmark collections to localStorage.
Only fixed-size reader settings (fit mode, image quality, zoom) remain persistent on
the Kindle. The five-page translation hot cache and image preload window remain RAM-only.

See `NEON_ACCOUNT_SETUP.md` and `.env.example` for Render/Neon/email configuration.


## v22 reader behavior

- Five-page image window is retained as a sliding cache: after the initial window, moving one page normally creates only one new image preload.
- Reading progress is debounced while paging and force-saved when leaving the reader or changing chapters.
- Last page automatically opens the next chapter when one exists.
- Reader button is labeled **To title**.
- Saved manga chapter pages mark chapters already present in server reading progress with **(READ)**.
- **Random** samples and displays up to 10 manga per press.


### v22 fixes

- Kindle cover thumbnails are normalized to baseline JPEG through the server proxy for old Voyage WebKit compatibility.
- **To title** always re-enters the normal 40-release chapter pager, including after direct resume from History.
- Saved state is batch-synced from Neon on Search/Random lists. Cards show **Save** or **Remove Saved** consistently with the title page.

## v24 Google Drive paged ebook reader

The Kindle ES5 UI now has a **Books** section for `.epub` and `.azw3` files stored in one configured Google Drive folder.

- Google Drive access is server-side only.
- EPUB/AZW3 parsing is server-side; Kindle receives only the current sanitized section plus Kindle-safe image URLs.
- EPUB/AZW3 inline images are served through the backend and normalized to baseline JPEG for Voyage compatibility.
- Text is paginated to the visible Kindle viewport using screen width/height, font size, typeface, line spacing and left/right margin.
- `Margin = 0` uses the full screen width; larger values reduce the text column equally from both sides.
- Prev/Next turn pages and automatically cross section boundaries.
- Book list is paged at 40 files/page.
- When logged in, book reading position is stored in Neon (`book_progress`).
- Kindle localStorage keeps only small fixed reader preferences: font size, typeface, margin and line spacing.
- Supported text-reader settings: font size, Serif/Sans/Mono, left/right margin, line spacing.

See `GOOGLE_DRIVE_BOOKS_SETUP.md` for service-account and folder-sharing setup.

## v25 user-controlled ebook pagination

The Kindle text-book reader now paginates by a user-selected number of line-heights per page. The `Aa` panel includes `Lines - / Lines +` (5-40 lines/page). Left/right book margin changes in 10 px steps (`0, 10, ... 80`). Font size, line spacing, typeface and margin still trigger repagination while preserving the approximate reading position. Images remain inline and consume vertical page space, so image-heavy pages can naturally contain fewer text lines.
