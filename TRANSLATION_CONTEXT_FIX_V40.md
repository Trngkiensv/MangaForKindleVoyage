# v40 - Context-aware faithful manga translation

## Why the previous translation drifted

The v30 translation path sent every OCR bubble to Workers AI in a separate request and explicitly told the model not to use page context. That is weak for English dialogue whose meaning depends on a previous line, especially negative questions and short replies such as:

- `WON'T IT BE BORING...?`
- `BUT...`
- `NOT AT ALL!`

`NOT AT ALL!` cannot be translated reliably without knowing what it replies to. Depending on context it can mean `Không hề!`, `Không đâu!`, or `Không có gì!`.

## v40 behavior

- One page-level Cloudflare request receives all useful OCR regions in reading order.
- Every region has a stable numeric ID.
- The model may use neighboring dialogue only to resolve context, polarity, idioms, pronouns, ellipsis, and short replies.
- The model must return one translation per input ID and is not allowed to merge bubbles.
- Negative English questions are translated by intended Vietnamese meaning instead of mechanically preserving English negation.
- If page JSON is incomplete, only missing IDs are retried with PREVIOUS/TARGET/NEXT context.
- Translation cache version is bumped from 15 to 16, so old bad translations are not reused.

## Expected style for the reported example

A reasonable Vietnamese rendering is approximately:

- `WON'T IT BE BORING...?` -> `Không phải sẽ chán sao...?` / `Sẽ không chán sao...?`
- `BUT...` -> `Nhưng...`
- `NOT AT ALL!` -> `Không hề!` / `Không đâu!`

The exact wording may vary by model, but the conversational meaning and polarity should stay correct.

## Files changed

- `translation/ocrspace-cloudflare-en-vi.ts`

No dependency or database change is required.
