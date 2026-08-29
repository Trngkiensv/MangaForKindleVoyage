# English -> Vietnamese manga translation (Kindle Voyage ES5 v14)

This build keeps the lightweight v10 pipeline but changes the translation stage:

- OCR: **OCR.Space Free API**
- Translation: **Cloudflare Workers AI instruction LLM**
- Default model: `@cf/qwen/qwen3-30b-a3b-fp8`
- Source: English (`en`)
- Target: Vietnamese (`vi`)
- Kindle still receives only lightweight overlay boxes. OCR and AI run on the PC/Node server.


## v14 reliability fix

Some Qwen3 responses contain `choices` and `reasoning_content` but no final `message.content`. This usually happens when a reasoning model uses its output budget before emitting the final answer. v14 keeps Qwen3 as the primary faithful translator, raises the default output budget to 3072 tokens, and automatically retries the whole page with `@cf/meta/llama-3.1-8b-instruct-fast` when the Qwen result has no final text or valid page JSON. The fallback model uses Cloudflare JSON Mode, which Cloudflare officially supports for this model. Only regions still missing after both page-level attempts are retried one-by-one.

The Kindle toolbar no longer relies on CSS `position: sticky`. Voyage WebKit can report the CSS value as supported even though it does not actually stick during scrolling. v14 uses a fixed-position toolbar plus a layout spacer, which behaves like a sticky top bar on Voyage, phones, and desktop browsers.

## v13 Cloudflare/Qwen response fix

Qwen3 on Workers AI returns chat output under `result.choices[0].message.content`. Older models used by previous builds often returned `result.response`. v12 only read the older shape, so a successful Qwen request looked empty to the app. That caused the page JSON parser to fail and the fallback path to eventually reuse the English OCR text. v13 reads both response shapes, rejects English echo output, and bumps the disk-cache version so incorrect English-overlay cache entries are ignored automatically.

If PowerShell previously printed `Cloudflare manga LLM returned incomplete/invalid JSON; translating missing regions individually.` for nearly every prefetched page, restart the server with v13. The warning may still appear occasionally when a model genuinely returns malformed JSON, but individual fallback translation now uses the correct Qwen assistant content instead of silently falling back to English.

## What v13 fixes

### Wrapped English text is translated as one sentence

OCR.Space returns physical text lines. A bubble like:

```text
ARE YOU
SERIOUS?
```

used to become two translation boxes. v12 first merges nearby, vertically consecutive, horizontally aligned OCR lines. It therefore sends:

```text
Are you serious?
```

as one region to the LLM and draws one Vietnamese overlay box covering the combined area.

The grouping becomes stricter after sentence-ending punctuation to reduce accidental merging of separate speech bubbles.

### Manga-aware page context

v10 translated each OCR region independently with a machine-translation model. v12 sends all merged regions from one manga page to the instruction LLM in one request. The model can use nearby dialogue as context while still returning exactly one translation per region.

The v12 prompt is faithful-first: preserve lexical meaning before localization, use page context only for ambiguity/pronouns, keep normal Vietnamese capitalization, and silently verify verbs/nouns/actions before returning JSON.

If the page-level LLM response is incomplete, only missing regions are retried individually.


### Faithful translation profile (v12)

The previous prompt could over-localize a clear action phrase. For example, `ALL RIGHT... COMMENCING BREAK-IN!!` could drift into an unrelated Vietnamese phrase. v12 lowers generation randomness and explicitly requires dictionary-faithful treatment of clear compounds and action verbs. The intended style is closer to `Được rồi... bắt đầu đột nhập!!` than a creative paraphrase.

### Sticky reader controls

The Kindle reader control shell is sticky at the top of the viewport. Browsers without CSS sticky support use a lightweight fixed-position fallback plus a spacer so manga pages are not hidden underneath the toolbar.

## Environment variables

```powershell
$env:MANGA_PROVIDER="weebcentral"
$env:OCR_SPACE_API_KEY="YOUR_OCR_SPACE_KEY"
$env:CLOUDFLARE_ACCOUNT_ID="YOUR_ACCOUNT_ID"
$env:CLOUDFLARE_API_TOKEN="YOUR_API_TOKEN"
$env:CLOUDFLARE_MANGA_LLM_MODEL="@cf/qwen/qwen3-30b-a3b-fp8"
$env:MANGA_TRANSLATION="true"
$env:TRANSLATION_PREFETCH_AHEAD="2"
```

Optional tuning:

```powershell
$env:CLOUDFLARE_MAX_TOKENS="3072"
$env:CLOUDFLARE_FALLBACK_MODEL="@cf/meta/llama-3.1-8b-instruct-fast"
$env:CLOUDFLARE_FALLBACK_CONCURRENCY="2"
$env:OCR_SPACE_MAX_WIDTH="1600"
$env:OCR_SPACE_ENGINE="2"
```

## Test Cloudflare first

```powershell
.\TEST_CLOUDFLARE_TRANSLATION.ps1 -AccountId $env:CLOUDFLARE_ACCOUNT_ID -ApiToken $env:CLOUDFLARE_API_TOKEN
```

A successful test prints a Vietnamese response for `Are you serious?`.

## Development start

```powershell
npm install
npm run dev
```

Open:

```text
http://YOUR_PC_IP:3000/kindle?t=14
```

The header should say:

```text
Voyage ES5 v14 - resilient Cloudflare fallback + fixed controls
```

## Pipeline

```text
WeebCentral page
    -> server downloads image
    -> server creates <= 1 MB OCR-only grayscale JPEG
    -> OCR.Space returns English physical lines + coordinates
    -> v12 groups wrapped lines into speech/caption regions
    -> obvious SFX/noise/names/URLs are filtered locally
    -> remaining dialogue/narration regions go to Cloudflare together
    -> EN -> natural concise VI
    -> result is cached on disk
    -> Kindle overlays Vietnamese on the original image
```

v19 translates the current page on demand and warms the next two pages sequentially when `TRANSLATION_PREFETCH_AHEAD=2`. The Kindle also keeps the five most recently viewed translation results in a small in-memory hot cache for instant backtracking. Successful results remain in `.cache/en-vi-translation/` on the server as a longer-lived quota-saving cache.

## Prompt behavior

The server's manga prompt enforces these rules:

- English -> Vietnamese only.
- Semantic accuracy first; natural Vietnamese second.
- Do not invent actions or meanings that are absent from the English source.
- Translate phrasal verbs and hyphenated compounds by their conventional contextual meaning.
- Use neighboring regions only to resolve genuine ambiguity, pronouns, omitted subjects, or tone.
- Preserve names/proper nouns where appropriate.
- Preserve emotion, insults, jokes, hesitation, and punctuation.
- Use normal Vietnamese capitalization instead of copying ALL-CAPS manga lettering.
- Keep translations concise enough for the original speech bubble without sacrificing meaning.
- Treat every merged OCR region as one complete utterance.
- Never split one region into multiple outputs.
- Never combine two different region IDs.
- Use the rest of the current page only as context.
- Return JSON only so overlays stay mapped to the correct coordinates.

## Cache note after upgrading from v10

v12 uses a new cache version. Old v10 translation cache entries are ignored automatically, so pages are OCR'd/translated again once and then cached using the corrected merged-region layout.

## Troubleshooting

### Translation unavailable

Open on the PC:

```text
http://localhost:3000/api/translation/status
```

The response explains which environment variable is missing.

### Cloudflare 401/403

Check the Account ID and Workers AI API token. Keep the token only on the PC server.

### A wrapped sentence is still split

The grouping uses OCR coordinates, so very unusual typography or widely separated words can still appear as separate regions. Capture the page and compare the OCR.Space overlay coordinates; the thresholds can be tuned without changing Kindle code.

### Two separate bubbles were merged

The v12 grouper is deliberately conservative after `.`, `!`, `?`, and `…`. If a particular page still merges two bubbles, the line-grouping thresholds in `normalizeOcrSpaceLines()` can be tightened.


## v30: literal per-bubble manga translation

Manga OCR translation no longer sends all speech bubbles from a page in one Cloudflare request. Each useful OCR region is translated in its own request, so the model only sees that utterance and cannot infer meaning from other bubbles on the page. This favors literal/faithful translation over contextual rewriting.

OCR physical lines are also joined more carefully. When one line ends in a hyphen and the next line starts with a letter, no artificial space is inserted. For example `OFF SCOT-` + `FREE` becomes `OFF SCOT-FREE` before translation instead of `OFF SCOT- FREE`. Hyphens already inside a physical OCR line are unchanged.

Because one Cloudflare inference is now used per translated OCR region instead of one inference per page, manga translation can consume more request overhead/neurons on dialogue-heavy pages.
