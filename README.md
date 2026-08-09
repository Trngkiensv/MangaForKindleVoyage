# Kindle Voyage Manga Reader

A lightweight manga reader designed specifically for **Kindle Voyage and other old WebKit-based Kindle browsers**.

The project uses a small Node.js server as a compatibility layer between the Kindle browser and manga providers. It also includes an **optional English-to-Vietnamese OCR translation pipeline** using OCR.Space and Cloudflare Workers AI.

The Kindle frontend is intentionally written in **ES5-compatible JavaScript** to work on older Kindle WebKit engines.

---

## Features

### Kindle Voyage Reader

- ES5-compatible frontend for old Kindle browsers
- Large touch-friendly controls
- Tap the manga page to go to the **next page**
- Fixed **Previous Page** rail on the left side
- Translation toggle directly above the Previous Page rail
- Fixed top toolbar
- Previous / next chapter controls
- Enter a chapter number and jump directly to it
- Fit Page / Fit Width reading modes
- Adjustable zoom
- Image preloading for smoother page changes
- Reading history with direct resume
- Resume the exact page previously read
- Optimized chapter pagination for very long series

### Manga Provider

The current default provider is:

```text
WeebCentral
```

The backend uses a provider abstraction so additional providers can be added without rewriting the Kindle frontend.

### Optional English → Vietnamese Translation

Translation is completely optional.

The translation pipeline is:

```text
Manga image
    ↓
OCR.Space
    ↓
OCR line grouping
    ↓
Cloudflare Workers AI
    ↓
Vietnamese text overlay
    ↓
Kindle reader
```

Important behavior:

```text
VI OFF
= no new OCR requests
= no new Cloudflare translation requests
= no translation prefetch
```

Translation starts only after you manually enable **VI ON** in the reader.

Image preloading continues even when translation is disabled.

---

# Requirements

Recommended:

- Node.js 20+
- npm
- Windows, macOS, or Linux
- Kindle Voyage or another browser on the same network

For optional translation:

- OCR.Space API key
- Cloudflare account
- Cloudflare Workers AI API token

---

# Quick Start

Clone the repository:

```bash
git clone <your-repository-url>
cd kindle-manga-reader
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

By default the server runs on port:

```text
3000
```

On your computer:

```text
http://localhost:3000/kindle
```

On your Kindle, use the local IP address of the computer running the server:

```text
http://YOUR_PC_IP:3000/kindle
```

Example:

```text
http://192.168.1.25:3000/kindle
```

Your Kindle and computer normally need to be reachable on the same local network.

---

# Basic Configuration

Create a `.env` file or set environment variables in your shell.

Minimum configuration:

```env
MANGA_PROVIDER=weebcentral
```

Translation is optional. You can use the reader without configuring OCR.Space or Cloudflare.

---

# Optional English → Vietnamese Translation

## 1. OCR.Space

Create an OCR.Space API key and set:

```env
OCR_SPACE_API_KEY=YOUR_OCR_SPACE_KEY
```

## 2. Cloudflare Workers AI

Set your Cloudflare account ID:

```env
CLOUDFLARE_ACCOUNT_ID=YOUR_ACCOUNT_ID
```

Set a Workers AI API token:

```env
CLOUDFLARE_API_TOKEN=YOUR_API_TOKEN
```

Recommended translation model:

```env
CLOUDFLARE_MANGA_LLM_MODEL=@cf/qwen/qwen3-30b-a3b-fp8
```

Fallback model:

```env
CLOUDFLARE_FALLBACK_MODEL=@cf/meta/llama-3.1-8b-instruct-fast
```

Maximum generation tokens:

```env
CLOUDFLARE_MAX_TOKENS=3072
```

Enable the server-side translation API:

```env
MANGA_TRANSLATION=true
```

Optional translation prefetch:

```env
TRANSLATION_PREFETCH_AHEAD=3
```

A complete example:

```env
MANGA_PROVIDER=weebcentral

MANGA_TRANSLATION=true
TRANSLATION_PREFETCH_AHEAD=3

OCR_SPACE_API_KEY=YOUR_OCR_SPACE_KEY

CLOUDFLARE_ACCOUNT_ID=YOUR_ACCOUNT_ID
CLOUDFLARE_API_TOKEN=YOUR_API_TOKEN

CLOUDFLARE_MANGA_LLM_MODEL=@cf/qwen/qwen3-30b-a3b-fp8
CLOUDFLARE_FALLBACK_MODEL=@cf/meta/llama-3.1-8b-instruct-fast
CLOUDFLARE_MAX_TOKENS=3072
```

Then start the server:

```bash
npm run dev
```

---

# Translation Usage

Translation is **OFF by default** when the Kindle reader starts.

The button on the left side of the reader displays:

```text
VI OFF
```

Tap it to enable translation:

```text
VI ON
```

When enabled, the current page is OCR'd and translated. Nearby pages may also be prepared in the background according to `TRANSLATION_PREFETCH_AHEAD`.

When translation is turned off:

- no new OCR requests are created
- no new Cloudflare translation requests are created
- new translation prefetch work stops
- untranslated manga images continue to work normally

Requests that were already sent to an external API before translation was disabled cannot be undone.

Translation results are cached on the server to reduce repeated OCR and AI requests.

---

# Kindle Controls

## Page Navigation

### Next Page

Tap directly on the manga image.

```text
Tap manga page → Next Page
```

### Previous Page

Use the fixed rail on the left side of the screen.

```text
Previous Page
```

The translation toggle is located above this rail.

---

# Chapter Navigation

Open the top controls panel.

Available controls include:

```text
Prev Chapter
Chapter input
Go
Next Chapter
```

Example:

```text
155
```

Enter `155` and press **Go** to jump to chapter 155 when available.

The chapter system is optimized so the Kindle does not need to render thousands of chapters at once.

---

# Reading History

The reader stores reading progress locally.

History entries can resume directly into the chapter instead of returning to the manga details screen.

Example:

```text
Claymore — Chapter 120
Resume — Page 14
```

Selecting the entry opens:

```text
Chapter 120
Page 14
```

---

# Reader Modes

Available image controls include:

```text
Fit Page
Fit Width
Zoom -
Zoom +
```

Zoom is stored locally on the Kindle.

The reader applies the desired zoom before showing a newly loaded image to reduce visible resizing or flashing.

---

# Translation Cache

Translation results are stored under the server cache directory.

Typical location:

```text
.cache/
```

The cache prevents the same manga page from repeatedly consuming OCR.Space requests and Cloudflare Workers AI neurons.

The cache is disposable. Deleting it does not delete your manga library, but previously translated pages may need to be processed again.

Do not commit the cache directory to Git.

---

# Project Architecture

Simplified request flow:

```text
Kindle Voyage
      ↓
Node / Express server
      ↓
Provider layer
      ↓
WeebCentral
```

Image flow:

```text
Provider image
      ↓
Server image proxy
      ↓
Kindle
```

Optional translation flow:

```text
Provider image
      ↓
Server
      ↓
OCR.Space
      ↓
OCR region grouping
      ↓
Cloudflare Workers AI
      ↓
Translation cache
      ↓
Vietnamese overlay
      ↓
Kindle
```

The API keys stay on the server. They are not sent to the Kindle browser.

---

# Provider API

The backend exposes provider-oriented routes such as:

```text
/api/provider/search
/api/provider/manga/:id
/api/provider/manga/:id/chapters
/api/provider/chapter/:id
/api/provider/chapter/:id/pages
```

The frontend does not need to know provider-specific scraping or parsing logic.

---

# Adding Another Provider

Providers should implement the existing backend provider contract.

Typical responsibilities include:

- search manga
- load manga metadata
- load chapter lists
- load chapter metadata
- load chapter pages
- validate image URLs

Keep provider-specific parsing inside the provider implementation rather than inside the Kindle frontend.

---

# Kindle Browser Compatibility

The Kindle Voyage browser uses an old WebKit engine.

For code that runs directly on the Kindle, avoid modern JavaScript syntax such as:

```text
let
const
arrow functions
template literals
optional chaining
```

Prefer ES5-compatible syntax:

```js
var page = 1;

function nextPage() {
  page += 1;
}
```

Modern JavaScript and TypeScript may still be used on the Node.js server.

---

# Troubleshooting

## Kindle says JavaScript did not start

The Kindle browser is very sensitive to unsupported JavaScript syntax.

Check the Kindle frontend file with:

```bash
node --check public/kindle-voyage.js
```

Also make sure no unsupported ES6+ syntax was introduced.

---

## Kindle still loads an old UI

The Kindle browser may aggressively cache JavaScript.

Try opening the reader with a cache-busting query parameter:

```text
http://YOUR_PC_IP:3000/kindle?t=16
```

You can increment the value when testing a new frontend build.

---

## Translation shows English text instead of Vietnamese

Check the server terminal for Cloudflare errors.

Verify:

```env
OCR_SPACE_API_KEY
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
CLOUDFLARE_MANGA_LLM_MODEL
CLOUDFLARE_FALLBACK_MODEL
```

Also verify that translation is enabled server-side:

```env
MANGA_TRANSLATION=true
```

---

## Cloudflare returns incomplete output

The project can use a fallback Workers AI model when the primary manga translation model fails to return usable output.

Recommended fallback:

```env
CLOUDFLARE_FALLBACK_MODEL=@cf/meta/llama-3.1-8b-instruct-fast
```

---

## OCR splits one speech bubble into multiple lines

The translation pipeline includes OCR line grouping.

For example:

```text
ARE YOU
SERIOUS?
```

should be grouped before translation as:

```text
ARE YOU SERIOUS?
```

This helps preserve sentence meaning across manga line breaks.

---

## Translation uses too much quota

Leave translation disabled:

```text
VI OFF
```

With VI OFF, new pages should not trigger OCR or Cloudflare translation work.

You can also reduce:

```env
TRANSLATION_PREFETCH_AHEAD=1
```

or disable server-side translation entirely:

```env
MANGA_TRANSLATION=false
```

---

## Provider suddenly stops working

Provider websites can change their HTML structure or endpoints.

If search, chapters, or images stop loading, the provider parser may need to be updated.

---

# Security

Never commit real API keys.

Keep secrets in environment variables or a local `.env` file.

Your `.gitignore` should exclude at least:

```gitignore
.env
.env.*
.cache/
node_modules/
```

If `.env.example` is included in the repository, it should contain placeholders only.

If an API token is accidentally pushed to a public repository, revoke it immediately and create a replacement token.

---

# Privacy

OCR and translation are optional external services.

When translation is enabled, manga page data or extracted text may be sent to third-party services such as:

- OCR.Space
- Cloudflare Workers AI

Review the terms and privacy policies of those services before enabling translation.

---

# Limitations

- Kindle Voyage has limited RAM and an old browser engine.
- OCR accuracy depends on font style, image quality, orientation, and speech bubble layout.
- AI translation may occasionally mistranslate names, slang, jokes, or ambiguous dialogue.
- Provider websites may change without notice.
- External OCR and AI services have their own quotas and rate limits.
- Translation overlays are generated from OCR coordinates and may not perfectly cover every speech bubble.

---

# Responsible Use

Use this software only with content and services you are authorized to access.

This project is intended as a personal reading interface and compatibility layer. It does not include manga files in the repository.

Users are responsible for complying with the terms of service, copyright rules, and applicable laws for any provider or content they access.

---

# Development Notes

Useful checks before committing Kindle frontend changes:

```bash
node --check public/kindle-voyage.js
```

Recommended workflow:

```text
Modify Kindle frontend
        ↓
ES5 syntax check
        ↓
Restart server
        ↓
Open /kindle?t=NEW_VERSION
        ↓
Test directly on Kindle Voyage
```

Testing only on Chrome, Safari, or a phone is not enough because the Kindle browser behaves differently.

---

# Version

Current Kindle interface documented by this README:

```text
Kindle Voyage ES5 v16
```

Major v16 behavior:

- translation defaults to OFF
- OCR/Cloudflare translation is opt-in
- cancelable translation prefetch
- fixed Previous Page rail
- tap manga page for Next Page
- translation toggle on the left rail
- previous / next chapter controls
- direct chapter number jump
- History direct resume
- long-series chapter pagination
- OCR line grouping
- Cloudflare primary + fallback translation models

---

# License

Add a license before publishing the repository if you want other people to reuse, modify, or redistribute the project.

A common choice for open-source personal projects is the MIT License.

