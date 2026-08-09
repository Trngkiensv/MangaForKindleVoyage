# Kindle Voyage ES5 v3

This build keeps the Kindle UI in plain ES5 + XMLHttpRequest for compatibility with the Kindle Voyage browser.

## New in v3

- Simplified chapter list: no translator/source-group or language selector.

- Loads all provider chapter-feed pages instead of stopping at the first 100 releases.
- Shows unique chapter-number count, total release count, and latest numeric chapter.
- Full-screen reader mode hides the site header while reading.
- Fit Page mode scales the whole image to the available Kindle viewport.
- Fit Width mode fills the screen width and allows vertical scrolling.
- Zoom controls from 50% to 300%.
- Saver / HQ image-quality toggle.
- Reading progress is saved per chapter and resumes at the last page.

## Run

```powershell
npm install
npm run build
npm start
```

Open the LAN address printed by the server, for example:

```text
http://192.168.1.6:3000/?v=3
```

Useful routes:

- `/` - Kindle Voyage ES5 app
- `/kindle` - same Kindle Voyage ES5 app
- `/kindle-test.html` - HTML/JS/API diagnostic
- `/modern` - React interface for modern phones/desktops
- `/api/health` - local server health check

The Kindle reader talks only to the local PC. Provider API/HTML requests and image HTTPS requests are proxied by the Node server.


## Kindle Voyage JavaScript parse compatibility

The Kindle build intentionally avoids ES2015+ syntax. In particular, do not add trailing commas to function calls such as `fn(value,)`; old Kindle JavaScriptCore can fail while parsing the entire file. The Kindle HTML includes a small pre-script watchdog and uses a versioned query such as `?v=6` for cache busting so parse/load failures are visible on-device.

## Voyage ES5 v7 performance, paging, and reader controls


The chapter pager now has an editable page field. Type a page number (for example,
`18`) and press `Go` or Enter to jump directly to that 40-release slice. Values below
1 or above the last page are clamped safely.

The manga reader now uses one collapsible control panel. It starts collapsed so Fit
Page has almost the entire Voyage viewport available. Tap the full-width `Controls v`
bar to expand large Chapters / Prev / Next / Fit / Zoom / Quality controls, then tap
`Controls ^` to collapse them again. The old duplicate bottom navigation bar was
removed. The manga image itself still advances to the next page when tapped.

The Kindle client no longer downloads or renders an entire chapter feed when a
series is opened. It requests 40 releases at a time and exposes First/Prev/Next/Last
chapter-page controls. A 1,000-release series therefore keeps only about 40 chapter
buttons in the Kindle DOM instead of 1,000.

For the WeebCentral provider, the upstream full chapter-list HTML is parsed once on
the Node server and the compact parsed list is cached for 10 minutes (up to 12 series).
Subsequent chapter-page requests are served from that server-side cache and only the
requested slice is sent to the Kindle. WeebCentral release names such as `Scene 155`,
`Page 115`, `Volume 6`, and ordinary `Chapter 12` are normalized to the same chapter
shape; unknown labels on real chapter links fall back to their first release number.

The modern React view also pages chapter feeds (60 releases per page). E-ink mode
caps image preloading at one next page, and resuming a history item loads only that
chapter instead of fetching hundreds of chapter records first.


## Voyage ES5 v8 reader behavior

- Reader control toggle is taller for easier touch use.
- Zoom +/- changes by 10 percentage points per press.
- Page images are hidden while a new image loads and are revealed only after the saved fit/zoom is applied, preventing the brief 100% -> custom zoom flash on old Kindle WebKit.

## ES5 v14: resilient Cloudflare fallback + fixed reader controls

See `README_TRANSLATION_EN_VI.md` for OCR.Space and Cloudflare setup. OCR/translation runs on the Node server, not on the Kindle. Qwen3 remains the primary translator; if it returns reasoning without final assistant text or malformed page JSON, the server retries with Llama 3.1 8B Fast using Cloudflare JSON Mode. The Voyage reader uses a fixed top control bar because its old WebKit does not reliably implement CSS sticky.


## ES5 v16: left Previous rail + chapter navigation

- Tap the manga page itself for Next Page.
- A fixed left rail contains Vietnamese translation ON/OFF and a tall Previous Page button.
- The collapsible top controls now include Previous Chapter, chapter-number input + Go, and Next Chapter.
- History entries open the saved chapter directly; page progress is restored from local storage.


## ES5 v16: translation is opt-in

- Vietnamese translation starts OFF on every browser/app session, even if an older build saved VI ON in localStorage.
- While VI is OFF, the Kindle does not request page OCR, Cloudflare translation, or translation prefetch. Image preloading continues normally.
- Turning VI OFF asks the server to remove not-yet-started prefetch jobs for the current chapter. A request that has already reached OCR.Space/Cloudflare may still finish, because already-sent API usage cannot be recovered.
- Switching chapters also cancels queued translation prefetch jobs from the previous chapter.
- Turning VI ON explicitly translates the current page and warms the configured pages ahead.
