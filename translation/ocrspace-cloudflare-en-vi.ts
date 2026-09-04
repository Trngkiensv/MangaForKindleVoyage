import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import type { MangaProvider, ProviderChapterPagesResponse } from '../providers/types';

export interface TranslationBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TranslationRegion {
  text: string;
  translated: string;
  box: TranslationBox;
}

export interface TranslatedPage {
  status: 'ready';
  sourceLanguage: 'en';
  targetLanguage: 'vi';
  imageWidth: number;
  imageHeight: number;
  regions: TranslationRegion[];
  cached: boolean;
}

interface OcrRegion {
  text: string;
  box: TranslationBox;
}

interface OcrPage {
  imageWidth: number;
  imageHeight: number;
  regions: OcrRegion[];
}

interface PageJobContext {
  provider: MangaProvider;
  chapterId: string;
  pageIndex: number;
  imageUrl: string;
}

interface FetchedImage {
  buffer: Buffer;
  contentType: string;
}

interface PreparedOcrImage {
  buffer: Buffer;
  width: number;
  height: number;
}

interface OcrLine {
  text: string;
  box: TranslationBox;
}

const SOURCE_LANGUAGE = 'en' as const;
const TARGET_LANGUAGE = 'vi' as const;
const OCR_SPACE_URL = 'https://api.ocr.space/parse/image';
const DEFAULT_CF_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
const DEFAULT_CF_FALLBACK_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const CACHE_VERSION = 15;
const MAX_REGIONS = 80;
const FREE_OCR_MAX_BYTES = 950 * 1024;


const SFX_WORDS = new Set([
  'BAM', 'BANG', 'BOOM', 'BONK', 'BUMP', 'BUZZ', 'CLACK', 'CLICK', 'CLINK', 'CRACK', 'CRASH',
  'CREAK', 'DING', 'DRIP', 'FWOOSH', 'GASP', 'GRR', 'GULP', 'HISS', 'KNOCK', 'PLIP', 'PLOP',
  'RING', 'RUSTLE', 'SIGH', 'SLAM', 'SNAP', 'SNIFF', 'SPLASH', 'STEP', 'SWISH', 'SWOOSH',
  'TAP', 'THUD', 'THUMP', 'TICK', 'TOCK', 'WHOOSH', 'WHAM', 'WHACK', 'ZAP', 'ZIP', 'ZOOM',
]);

const COMMON_SHORT_DIALOGUE_WORDS = new Set([
  'AH', 'EH', 'HM', 'HMM', 'HUH', 'OH', 'OW', 'HEY', 'HI', 'BYE', 'NO', 'YES', 'YEAH', 'OK', 'OKAY',
  'WAIT', 'STOP', 'HELP', 'RUN', 'GO', 'COME', 'LOOK', 'WHAT', 'WHEN', 'WHERE', 'WHO', 'WHY', 'HOW',
  'SORRY', 'THANKS', 'PLEASE', 'DAMN', 'IDIOT', 'FOOL', 'RIGHT', 'WRONG', 'REALLY', 'SURE', 'FINE',
]);

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return !/^(0|false|no|off)$/i.test(value.trim());
}

function positiveInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = parseInt(value || '', 10);
  if (!isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function cleanText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
}

function errorText(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item || '')).filter(Boolean).join('; ');
  return String(value || '');
}

function boxFromWords(words: any[], line: any): TranslationBox | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  words.forEach((word) => {
    if (!word) return;
    const left = Number(word.Left ?? word.left ?? 0);
    const top = Number(word.Top ?? word.top ?? line?.MinTop ?? 0);
    const width = Number(word.Width ?? word.width ?? 0);
    const height = Number(word.Height ?? word.height ?? line?.MaxHeight ?? 0);
    if (!isFinite(left) || !isFinite(top)) return;
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, left + Math.max(1, isFinite(width) ? width : 1));
    maxY = Math.max(maxY, top + Math.max(1, isFinite(height) ? height : 1));
  });

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
    const left = Number(line?.MinLeft ?? 0);
    const top = Number(line?.MinTop ?? 0);
    const width = Number(line?.MaxWidth ?? 0);
    const height = Number(line?.MaxHeight ?? 0);
    if (!isFinite(left) || !isFinite(top) || !isFinite(width) || !isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    return { x: Math.max(0, Math.round(left)), y: Math.max(0, Math.round(top)), width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }

  return {
    x: Math.max(0, Math.round(minX)),
    y: Math.max(0, Math.round(minY)),
    width: Math.max(1, Math.round(maxX - minX)),
    height: Math.max(1, Math.round(maxY - minY)),
  };
}

function lineFromOcrSpace(rawLine: any): OcrLine | null {
  const words = Array.isArray(rawLine?.Words) ? rawLine.Words : [];
  const text = cleanText(
    words.length
      ? words.map((word: any) => word?.WordText ?? word?.wordText ?? '').join(' ')
      : rawLine?.LineText ?? rawLine?.Text ?? '',
  );
  if (!text || !/[A-Za-z]/.test(text)) return null;
  const box = boxFromWords(words, rawLine);
  if (!box) return null;
  return { text: text.slice(0, 1500), box };
}


/**
 * Join OCR.Space physical lines and remove a line-break hyphen when it is
 * clearly being used only to continue the same word on the next manga line.
 * Example:
 *
 *   SCOT-
 *   FREE
 *
 * becomes "SCOTFREE" before translation. This prevents the OCR layout mark
 * from being treated as punctuation by the translator. Hyphens that occur
 * inside a physical OCR line are left untouched.
 */
export function joinWrappedOcrLines(previousText: string, nextText: string): string {
  const left = cleanText(previousText);
  const right = cleanText(nextText);
  if (!left) return right;
  if (!right) return left;

  if (/[A-Za-z]\s*[-\u00ad]\s*$/.test(left) && /^[A-Za-z]/.test(right)) {
    const normalizedLeft = left.replace(/\s*[-\u00ad]\s*$/, '');
    return cleanText(`${normalizedLeft}${right}`);
  }

  return cleanText(`${left} ${right}`);
}

function horizontalOverlap(a: TranslationBox, b: TranslationBox): number {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const overlap = Math.max(0, right - left);
  return overlap / Math.max(1, Math.min(a.width, b.width));
}

function mergeBox(a: TranslationBox, b: TranslationBox): TranslationBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

/**
 * OCR.Space returns one overlay object per physical text line. A single manga
 * speech bubble often contains multiple centered lines, for example:
 *
 *   ARE YOU
 *   SERIOUS?
 *
 * Treating those as separate translation regions breaks the sentence and the
 * overlay. This grouper joins vertically-neighbouring, horizontally-aligned
 * lines before anything is sent to the LLM. It is intentionally stricter after
 * sentence-ending punctuation so two nearby speech bubbles are less likely to
 * be combined.
 */
function boxCenterX(box: TranslationBox): number {
  return box.x + box.width / 2;
}

function endsStrongSentence(text: string): boolean {
  return /[.!?…][\"'’”)}\]]*$/.test(cleanText(text));
}

interface WorkingOcrRegion extends OcrRegion {
  lastLineBox: TranslationBox;
  lineCount: number;
}

function lineFitsRegion(region: WorkingOcrRegion, line: OcrLine): { ok: boolean; score: number } {
  const prev = region.lastLineBox;
  const gap = line.box.y - (prev.y + prev.height);
  const height = Math.max(1, Math.max(prev.height, line.box.height));
  const overlap = horizontalOverlap(prev, line.box);
  const centerDistance = Math.abs(boxCenterX(prev) - boxCenterX(line.box));
  const widest = Math.max(prev.width, line.box.width, 1);
  const tightVertical = gap >= -height * 0.45 && gap <= height * 0.55;
  const continuingSentence = !endsStrongSentence(region.text);
  const maxGap = continuingSentence ? Math.max(10, height * 1.55) : Math.max(7, height * 0.72);
  const centered = centerDistance <= widest * (continuingSentence ? 0.58 : 0.38);
  const overlapsEnough = overlap >= (continuingSentence ? 0.08 : 0.30);

  if (gap < -height * 0.45 || gap > maxGap) return { ok: false, score: Number.POSITIVE_INFINITY };
  if (!(centered || overlapsEnough)) return { ok: false, score: Number.POSITIVE_INFINITY };
  if (region.lineCount >= 8 && !tightVertical) return { ok: false, score: Number.POSITIVE_INFINITY };

  // Prefer the closest line vertically, then a shared horizontal center. A
  // continuation without terminal punctuation gets a small bonus.
  const score = Math.max(0, gap) / height + centerDistance / widest + (continuingSentence ? 0 : 0.35);
  return { ok: true, score };
}

export function normalizeOcrSpaceLines(linesInput: any[]): OcrRegion[] {
  const lines = (Array.isArray(linesInput) ? linesInput : [])
    .map(lineFromOcrSpace)
    .filter((line): line is OcrLine => !!line)
    .sort((a, b) => (a.box.y - b.box.y) || (a.box.x - b.box.x));

  const regions: WorkingOcrRegion[] = [];

  lines.forEach((line) => {
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    // A line can belong to a region that was not literally the previous item
    // in reading order (two bubbles can be side by side), so examine a small
    // recent window rather than only regions[regions.length - 1].
    const firstCandidate = Math.max(0, regions.length - 6);
    for (let i = firstCandidate; i < regions.length; i += 1) {
      const match = lineFitsRegion(regions[i], line);
      if (match.ok && match.score < bestScore) {
        bestIndex = i;
        bestScore = match.score;
      }
    }

    if (bestIndex >= 0) {
      const region = regions[bestIndex];
      region.text = joinWrappedOcrLines(region.text, line.text).slice(0, 1500);
      region.box = mergeBox(region.box, line.box);
      region.lastLineBox = line.box;
      region.lineCount += 1;
      return;
    }

    if (regions.length < MAX_REGIONS) {
      regions.push({
        text: line.text,
        box: line.box,
        lastLineBox: line.box,
        lineCount: 1,
      });
    }
  });

  return regions
    .sort((a, b) => (a.box.y - b.box.y) || (a.box.x - b.box.x))
    .map((region) => ({ text: region.text, box: region.box }));
}

export class EnglishVietnameseTranslationService {
  readonly sourceLanguage = SOURCE_LANGUAGE;
  readonly targetLanguage = TARGET_LANGUAGE;
  readonly prefetchAhead = positiveInt(process.env.TRANSLATION_PREFETCH_AHEAD, 2, 0, 2);

  private readonly enabledByEnv = boolEnv(process.env.MANGA_TRANSLATION, true);
  private readonly cacheDir = path.resolve(
    process.env.TRANSLATION_CACHE_DIR || path.join(process.cwd(), '.cache', 'en-vi-translation'),
  );
  private readonly ocrEngine = String(process.env.OCR_SPACE_ENGINE || '2').trim() || '2';
  private readonly ocrMaxWidth = positiveInt(process.env.OCR_SPACE_MAX_WIDTH, 1600, 900, 2200);
  private readonly cloudflareModel = String(process.env.CLOUDFLARE_MANGA_LLM_MODEL || DEFAULT_CF_MODEL).trim() || DEFAULT_CF_MODEL;
  private readonly cloudflareFallbackModel = String(process.env.CLOUDFLARE_FALLBACK_MODEL || DEFAULT_CF_FALLBACK_MODEL).trim() || DEFAULT_CF_FALLBACK_MODEL;
  private readonly cloudflareMaxTokens = positiveInt(process.env.CLOUDFLARE_MAX_TOKENS, 3072, 256, 4096);
  private readonly allowFallback = boolEnv(process.env.TRANSLATION_ALLOW_FALLBACK, false);
  private pending = new Map<string, Promise<TranslatedPage>>();
  private prefetchQueue: Array<{
    key: string;
    providerKey: string;
    chapterId: string;
    pageIndex: number;
    run: () => Promise<void>;
  }> = [];
  private queuedPrefetchKeys = new Set<string>();
  private prefetchRunning = false;
  private activePrefetchProviderKey = '';
  private activePrefetchChapterId = '';
  private activePrefetchPageIndex = -1;

  async getStatus(): Promise<{
    enabled: boolean;
    sourceLanguage: 'en';
    targetLanguage: 'vi';
    prefetchAhead: number;
    ocrProvider: 'ocr.space';
    translationProvider: 'cloudflare-workers-ai';
    model: string;
    fallbackModel: string;
    reason?: string;
  }> {
    const base = {
      sourceLanguage: SOURCE_LANGUAGE,
      targetLanguage: TARGET_LANGUAGE,
      prefetchAhead: this.prefetchAhead,
      ocrProvider: 'ocr.space' as const,
      translationProvider: 'cloudflare-workers-ai' as const,
      model: this.cloudflareModel,
      fallbackModel: this.cloudflareFallbackModel,
    };
    if (!this.enabledByEnv) return { enabled: false, ...base, reason: 'MANGA_TRANSLATION is disabled' };
    if (!process.env.OCR_SPACE_API_KEY) {
      return { enabled: false, ...base, reason: 'Set OCR_SPACE_API_KEY on the PC server' };
    }
    if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
      return { enabled: false, ...base, reason: 'Set CLOUDFLARE_ACCOUNT_ID on the PC server' };
    }
    if (!process.env.CLOUDFLARE_API_TOKEN) {
      return { enabled: false, ...base, reason: 'Set CLOUDFLARE_API_TOKEN on the PC server' };
    }
    return { enabled: true, ...base };
  }

  private async fetchProviderImage(provider: MangaProvider, imageUrl: string): Promise<FetchedImage> {
    const parsed = new URL(imageUrl);
    if (!provider.isAllowedImageUrl(parsed)) throw new Error('Translation image host is not allowed by the active provider');
    const providerHeaders = provider.getImageRequestHeaders ? provider.getImageRequestHeaders(parsed) : {};
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'KindleVoyageMangaReader/3.1 (OCR.Space OCR)',
        Accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8,*/*;q=0.5',
        ...providerHeaders,
      },
    });
    if (!response.ok) throw new Error(`OCR image fetch failed (${response.status})`);
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: String(response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim(),
    };
  }

  /**
   * OCR.Space Free accepts files up to 1 MB. Create a grayscale OCR-only JPEG
   * copy under that limit while leaving the reader's original image untouched.
   * Overlay coordinates remain valid because the client uses percentages.
   */
  private async prepareOcrImage(image: FetchedImage): Promise<PreparedOcrImage> {
    const attempts = [
      { width: this.ocrMaxWidth, quality: 84 },
      { width: Math.min(this.ocrMaxWidth, 1450), quality: 78 },
      { width: Math.min(this.ocrMaxWidth, 1300), quality: 74 },
      { width: Math.min(this.ocrMaxWidth, 1150), quality: 70 },
      { width: Math.min(this.ocrMaxWidth, 1000), quality: 66 },
    ];
    let last: PreparedOcrImage | null = null;

    for (const attempt of attempts) {
      const result = await sharp(image.buffer, { failOn: 'none' })
        .rotate()
        .resize({ width: attempt.width, withoutEnlargement: true })
        .grayscale()
        .jpeg({ quality: attempt.quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      last = { buffer: result.data, width: result.info.width, height: result.info.height };
      if (result.data.length <= FREE_OCR_MAX_BYTES) return last;
    }

    if (!last) throw new Error('Could not prepare manga page for OCR.Space');
    if (last.buffer.length > 1024 * 1024) {
      throw new Error(`OCR.Space Free image is still too large (${Math.ceil(last.buffer.length / 1024)} KB). Lower OCR_SPACE_MAX_WIDTH.`);
    }
    return last;
  }

  private async ocrEnglish(image: FetchedImage): Promise<OcrPage> {
    const apiKey = String(process.env.OCR_SPACE_API_KEY || '').trim();
    if (!apiKey) throw new Error('OCR_SPACE_API_KEY is not configured');
    const prepared = await this.prepareOcrImage(image);
    const form = new FormData();
    form.set('file', new Blob([prepared.buffer], { type: 'image/jpeg' }), 'manga-page.jpg');
    form.set('language', 'eng');
    form.set('isOverlayRequired', 'true');
    form.set('OCREngine', this.ocrEngine);
    form.set('scale', 'true');
    form.set('detectOrientation', 'false');

    const response = await fetch(OCR_SPACE_URL, {
      method: 'POST',
      headers: { apikey: apiKey },
      body: form,
    });
    if (!response.ok) throw new Error(`OCR.Space failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    const json: any = await response.json();
    if (json?.IsErroredOnProcessing) {
      const message = errorText(json.ErrorMessage) || errorText(json.ErrorDetails) || 'OCR.Space processing error';
      throw new Error(`OCR.Space: ${message}`);
    }
    const parsed = Array.isArray(json?.ParsedResults) ? json.ParsedResults[0] : null;
    if (!parsed) throw new Error('OCR.Space did not return ParsedResults');
    const overlay = parsed?.TextOverlay;
    const lines = Array.isArray(overlay?.Lines) ? overlay.Lines : [];
    return {
      imageWidth: prepared.width,
      imageHeight: prepared.height,
      regions: normalizeOcrSpaceLines(lines),
    };
  }

  private mangaSentenceSystemPrompt(): string {
    return [
      'Translate exactly one English manga utterance into Vietnamese.',
      'Translate literally and faithfully using only the supplied utterance.',
      'Do not infer context from other speech bubbles, the rest of the page, speaker identity, gender, relationships, or unstated meaning.',
      'Preserve names and proper nouns. Keep punctuation, emotion, profanity, and tone.',
      'Return only the Vietnamese translation. Do not explain, add notes, or answer the utterance.',
    ].join(' ');
  }

  private localSkipReason(source: string): string | null {
    const raw = cleanText(source);
    if (!raw) return 'empty';

    if (/^(?:https?:\/\/|www\.)\S+$/i.test(raw)) return 'url';
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return 'email';
    if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?$/i.test(raw)) return 'hostname';

    // Standalone Japanese-style honorific names should stay visible in the
    // original artwork instead of spending an LLM request just to echo them.
    if (/^[A-Z][A-Z'’.-]{1,24}\s*(?:-|\s)\s*(?:CHAN|SAN|SAMA|KUN|SENPAI|SENSEI)[!?.,]*$/i.test(raw)) {
      return 'proper-name';
    }

    const tokens = raw.split(/\s+/).filter(Boolean);
    if (tokens.length === 2) {
      const titleWord = /^[A-Z][A-Za-z'’-]+[!?.,]*$/;
      const initial = /^[A-Z]\.?$/;
      if (titleWord.test(tokens[0]) && titleWord.test(tokens[1])) return 'proper-name';
      if (initial.test(tokens[0]) && titleWord.test(tokens[1])) return 'proper-name';
    }

    const words = (raw.toUpperCase().match(/[A-Z]+/g) || []).filter(Boolean);
    if (words.length && words.length <= 4 && words.some((word) => SFX_WORDS.has(word))) return 'sfx';

    // OCR noise / stylized SFX often arrives as one short consonant-heavy
    // token such as "SUGNP". Keep common dialogue words so "WAIT!" or "NO!"
    // still gets translated.
    if (words.length === 1) {
      const word = words[0];
      if (SFX_WORDS.has(word)) return 'sfx';
      if (!COMMON_SHORT_DIALOGUE_WORDS.has(word) && word.length >= 4 && word.length <= 8) {
        const vowels = (word.match(/[AEIOUY]/g) || []).length;
        const vowelRatio = vowels / Math.max(1, word.length);
        if (vowelRatio <= 0.20 || /[BCDFGHJKLMNPQRSTVWXZ]{4,}/.test(word)) return 'ocr-noise';
      }
    }

    return null;
  }

  private looksLikeMetaResponse(source: string, translated: string): boolean {
    const value = cleanText(translated);
    if (!value) return true;
    const lower = value.toLowerCase();
    if (value.length > Math.max(160, cleanText(source).length * 3.5)) return true;
    return /(?:tôi không thể|không thể tìm thấy|không tìm thấy.*(?:văn bản|thông tin)|vui lòng (?:cung cấp|gửi)|hãy cung cấp|i cannot|i can't|cannot find|please provide|as an ai|no text (?:was )?found)/i.test(lower);
  }

  private isLikelyNonTranslatableSource(source: string): boolean {
    const raw = cleanText(source);
    if (!raw) return true;

    // URLs, email addresses, and bare hostnames should stay unchanged.
    if (/^(?:https?:\/\/|www\.)\S+$/i.test(raw)) return true;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return true;

    // A single token is often a name, place, acronym, number, or SFX label.
    // The old echo detector already ignored most one-word output, so keep that behavior.
    const tokens = raw.split(/\s+/).filter(Boolean);
    if (tokens.length <= 1) return true;

    // Two-token title-cased names such as "Shoto Shirabishi" are expected to
    // survive translation unchanged. Do not treat that as a failed translation.
    // Also allow an initial + title-cased noun, e.g. "K University".
    if (tokens.length === 2) {
      const titleWord = /^[A-Z][A-Za-z'’-]+$/;
      const initial = /^[A-Z]\.?$/;
      if (titleWord.test(tokens[0]) && titleWord.test(tokens[1])) return true;
      if (initial.test(tokens[0]) && titleWord.test(tokens[1])) return true;
    }

    return false;
  }

  private looksUntranslated(source: string, translated: string): boolean {
    const normalize = (value: string) => cleanText(value).toLowerCase().replace(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/g, ' ').trim();
    const sourceNormalized = normalize(source);
    const translatedNormalized = normalize(translated);
    if (!sourceNormalized || !translatedNormalized) return false;

    if (sourceNormalized === translatedNormalized) {
      if (this.isLikelyNonTranslatableSource(source)) return false;
      if (sourceNormalized.split(/\s+/).length >= 2) return true;
    }

    const sourceWords = sourceNormalized.split(/\s+/).filter(Boolean);
    const translatedWords = translatedNormalized.split(/\s+/).filter(Boolean);
    if (sourceWords.length < 3 || translatedWords.length < 3) return false;
    const translatedSet = new Set(translatedWords);
    const overlap = sourceWords.filter((word) => translatedSet.has(word)).length / sourceWords.length;
    return overlap >= 0.82;
  }

  private cloudflareTextFromResponse(json: any): string {
    const result = json?.result ?? json;

    const textFromValue = (value: any): string => {
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (!value || typeof value !== 'object') return '';
      if (Array.isArray(value)) {
        const joined = value
          .map((part: any) => textFromValue(part))
          .filter(Boolean)
          .join('\n')
          .trim();
        return joined;
      }
      const candidates = [
        value.content,
        value.text,
        value.output_text,
        value.response,
        value.message?.content,
        value.delta?.content,
      ];
      for (const candidate of candidates) {
        const found = textFromValue(candidate);
        if (found) return found;
      }
      return '';
    };

    // Classic Workers AI text-generation models return result.response. In
    // JSON Mode that field can itself be a JSON object instead of a string.
    const direct = result?.response ?? json?.response;
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      try { return JSON.stringify(direct); } catch (_error) {}
    }
    const directText = textFromValue(direct);
    if (directText) return directText;

    // Qwen3 uses an OpenAI-style choices[] response. Inspect every choice, not
    // only index 0, because some backends can emit an empty first choice.
    const choices = Array.isArray(result?.choices) ? result.choices : Array.isArray(json?.choices) ? json.choices : [];
    for (const choice of choices) {
      const found = textFromValue(choice?.message?.content ?? choice?.text ?? choice?.delta?.content);
      if (found) return found;
    }

    const outputText = textFromValue(result?.output_text ?? json?.output_text ?? result?.output ?? json?.output);
    if (outputText) return outputText;
    return '';
  }

  private cloudflareResponseDiagnostic(json: any): string {
    const result = json?.result ?? json;
    const choices = Array.isArray(result?.choices) ? result.choices : [];
    const choice = choices.length ? choices[0] : null;
    const content = choice?.message?.content;
    const reasoning = choice?.message?.reasoning_content;
    const direct = result?.response;
    const finishReason = choice?.finish_reason ?? choice?.stop_reason ?? '';
    const describe = (value: any): string => {
      if (value === null) return 'null';
      if (value === undefined) return 'undefined';
      if (typeof value === 'string') return `string:${value.length}`;
      if (Array.isArray(value)) return `array:${value.length}`;
      return typeof value;
    };
    return [
      `choices=${choices.length}`,
      `finish=${finishReason || 'none'}`,
      `content=${describe(content)}`,
      `reasoning=${describe(reasoning)}`,
      `response=${describe(direct)}`,
    ].join(', ');
  }

  private async runCloudflareLlm(
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    maxTokens: number,
    model: string = this.cloudflareModel,
    responseFormat?: any,
  ): Promise<string> {
    const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
    const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
    if (!accountId || !token) throw new Error('Cloudflare Workers AI credentials are not configured');
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`;
    const body: any = {
      messages,
      max_tokens: maxTokens,
      temperature: 0.0,
      top_p: 1.0,
    };
    if (responseFormat) body.response_format = responseFormat;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Cloudflare Workers AI failed (${response.status}) on ${model}: ${(await response.text()).slice(0, 700)}`);
    const json: any = await response.json();
    if (json && json.success === false) {
      throw new Error(`Cloudflare Workers AI on ${model}: ${errorText(json.errors) || 'request failed'}`);
    }
    const text = this.cloudflareTextFromResponse(json);
    if (!text) {
      throw new Error(`Cloudflare Workers AI returned no assistant text on ${model} (${this.cloudflareResponseDiagnostic(json)})`);
    }
    return text;
  }

  async translateSelectedText(input: string): Promise<{
    sourceLanguage: 'auto';
    targetLanguage: 'vi';
    translation: string;
  }> {
    const source = String(input || '').replace(/\r\n/g, '\n').trim();
    if (!source) throw new Error('No text selected');
    if (!this.enabledByEnv) throw new Error('Translation is disabled');
    if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
      throw new Error('Cloudflare Workers AI is not configured');
    }

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      {
        role: 'system',
        content: 'Translate the user-selected text into natural Vietnamese. Return only the Vietnamese translation. Do not explain, add notes, or answer the text.',
      },
      {
        role: 'user',
        content: `/no_think\nTranslate this into Vietnamese:\n${source}`,
      },
    ];
    const maxTokens = Math.max(256, Math.min(this.cloudflareMaxTokens, 192 + Math.ceil(source.length * 0.8)));
    let translated = await this.runCloudflareLlm(messages, maxTokens, this.cloudflareModel);
    translated = translated
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/^```(?:text)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    if (!translated) throw new Error('Cloudflare returned an empty translation');
    return {
      sourceLanguage: 'auto',
      targetLanguage: TARGET_LANGUAGE,
      translation: translated,
    };
  }



  /** Translate one OCR utterance with zero page-level context. */
  private async translateOneMangaRegion(sourceInput: string): Promise<string | null> {
    const source = cleanText(sourceInput);
    if (!source) return null;

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      { role: 'system', content: this.mangaSentenceSystemPrompt() },
      {
        role: 'user',
        content: `/no_think\nTranslate this utterance literally into Vietnamese. Use only this text; no page context:\n${source}`,
      },
    ];
    const maxTokens = Math.max(128, Math.min(this.cloudflareMaxTokens, 96 + Math.ceil(source.length * 0.9)));

    const runModel = async (model: string): Promise<string | null> => {
      try {
        let translated = await this.runCloudflareLlm(messages, maxTokens, model);
        translated = translated
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/^```(?:text)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .replace(/^['"]|['"]$/g, '')
          .trim();
        if (!translated) return null;
        if (this.looksUntranslated(source, translated) || this.looksLikeMetaResponse(source, translated)) return null;
        return cleanText(translated).slice(0, 1200);
      } catch (error: any) {
        console.warn(`Manga utterance translation failed on ${model}: ${error?.message || error}`);
        return null;
      }
    };

    let translated = await runModel(this.cloudflareModel);
    if (!translated && this.allowFallback) {
      translated = await runModel(this.cloudflareFallbackModel);
    }
    return translated;
  }

  /**
   * Translate every OCR region independently. No request contains another
   * speech bubble from the same page, so the model cannot use page-level
   * context to guess pronouns, relationships, tone, or omitted meaning.
   *
   * A tiny worker pool keeps latency reasonable without blasting Cloudflare
   * with all bubbles simultaneously. Each request still contains exactly one
   * utterance.
   */
  private async translateEnglishToVietnamese(texts: string[]): Promise<Array<string | null>> {
    if (!texts.length) return [];
    const output: Array<string | null> = new Array(texts.length).fill(null);
    let nextIndex = 0;
    const workerCount = Math.min(3, texts.length);

    const worker = async (): Promise<void> => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= texts.length) return;
        output[index] = await this.translateOneMangaRegion(texts[index]);
      }
    };

    await Promise.all(new Array(workerCount).fill(null).map(() => worker()));

    const missing = output.filter((value) => !value).length;
    if (missing) {
      console.warn(
        `Translation incomplete: ${missing}/${texts.length} region(s) left in original artwork; ` +
        `${this.allowFallback ? 'each failed utterance may use one fallback model call' : 'fallback/retry is disabled to save neurons'}.`,
      );
    }
    return output;
  }

  private cacheKey(context: PageJobContext): string {
    return sha256([
      CACHE_VERSION,
      context.provider.key,
      context.chapterId,
      context.pageIndex,
      context.imageUrl,
      SOURCE_LANGUAGE,
      TARGET_LANGUAGE,
      'ocr.space',
      this.ocrEngine,
      this.ocrMaxWidth,
      'cloudflare-workers-ai',
      this.cloudflareModel,
    ].join('|'));
  }

  private async readCache(cacheKey: string): Promise<TranslatedPage | null> {
    try {
      const raw = await fs.readFile(path.join(this.cacheDir, `${cacheKey}.json`), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === CACHE_VERSION && parsed.data && parsed.data.status === 'ready') {
        const data = parsed.data as TranslatedPage;
        const regions = Array.isArray(data.regions)
          ? data.regions.filter((region) => {
              const source = cleanText(region?.text || '');
              const translated = cleanText(region?.translated || '');
              if (this.localSkipReason(source)) return false;
              if (this.looksLikeMetaResponse(source, translated)) return false;
              return !!translated;
            })
          : [];
        return { ...data, regions, cached: true } as TranslatedPage;
      }
    } catch (_error) {}
    return null;
  }

  private async writeCache(cacheKey: string, data: TranslatedPage): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    const target = path.join(this.cacheDir, `${cacheKey}.json`);
    const temp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify({ version: CACHE_VERSION, data: { ...data, cached: false } }), 'utf8');
    await fs.rename(temp, target);
  }

  async translatePage(context: PageJobContext): Promise<TranslatedPage> {
    const status = await this.getStatus();
    if (!status.enabled) throw new Error(status.reason || 'English to Vietnamese translation is not configured');

    const key = this.cacheKey(context);
    const cached = await this.readCache(key);
    if (cached) return cached;
    const existing = this.pending.get(key);
    if (existing) return existing;

    const job = (async () => {
      const image = await this.fetchProviderImage(context.provider, context.imageUrl);
      const ocr = await this.ocrEnglish(image);
      const candidates: Array<{ region: OcrRegion; originalIndex: number }> = [];
      const skippedReasons: Record<string, number> = {};
      ocr.regions.forEach((region, originalIndex) => {
        const reason = this.localSkipReason(region.text);
        if (reason) {
          skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
        } else {
          candidates.push({ region, originalIndex });
        }
      });

      const candidateTexts = candidates.map((item) => item.region.text);
      const translations = await this.translateEnglishToVietnamese(candidateTexts);
      const translatedRegions: TranslationRegion[] = [];
      candidates.forEach((item, candidateIndex) => {
        const translated = cleanText(translations[candidateIndex] || '');
        if (!translated) return;
        translatedRegions.push({
          text: item.region.text,
          translated,
          box: item.region.box,
        });
      });

      const skippedCount = ocr.regions.length - candidates.length;
      if (skippedCount) {
        const summary = Object.keys(skippedReasons).map((reason) => `${reason}:${skippedReasons[reason]}`).join(', ');
        console.info(`Skipped ${skippedCount} OCR region(s) locally before Cloudflare (${summary}).`);
      }

      const data: TranslatedPage = {
        status: 'ready',
        sourceLanguage: SOURCE_LANGUAGE,
        targetLanguage: TARGET_LANGUAGE,
        imageWidth: ocr.imageWidth,
        imageHeight: ocr.imageHeight,
        // Skipped SFX/noise/names and failed translations are omitted entirely,
        // so the original manga lettering stays visible with no redundant box.
        regions: translatedRegions,
        cached: false,
      };
      await this.writeCache(key, data);
      return data;
    })();

    this.pending.set(key, job);
    try {
      return await job;
    } finally {
      this.pending.delete(key);
    }
  }

  queuePrefetch(context: PageJobContext): void {
    if (this.prefetchQueue.length >= 12) return;
    const key = this.cacheKey(context);
    if (this.pending.has(key) || this.queuedPrefetchKeys.has(key)) return;
    this.queuedPrefetchKeys.add(key);
    this.prefetchQueue.push({
      key,
      providerKey: context.provider.key,
      chapterId: context.chapterId,
      pageIndex: context.pageIndex,
      run: async () => {
        try {
          await this.translatePage(context);
        } catch (error: any) {
          console.warn(
            `Translation prefetch failed for ${context.chapterId} page ${context.pageIndex + 1}:`,
            error && error.message ? error.message : error,
          );
        }
      },
    });
    void this.runPrefetchQueue();
  }

  cancelPrefetch(chapterId?: string, providerKey?: string): { cancelled: number; active: boolean; activePage?: number } {
    const target = String(chapterId || '');
    const providerTarget = String(providerKey || '');
    let cancelled = 0;
    const kept: typeof this.prefetchQueue = [];
    for (const task of this.prefetchQueue) {
      const providerMatches = !providerTarget || task.providerKey === providerTarget;
      if ((!target || task.chapterId === target) && providerMatches) {
        this.queuedPrefetchKeys.delete(task.key);
        cancelled += 1;
      } else {
        kept.push(task);
      }
    }
    this.prefetchQueue = kept;
    const active = !!target && this.activePrefetchChapterId === target && (!providerTarget || this.activePrefetchProviderKey === providerTarget);
    return {
      cancelled,
      active,
      ...(active ? { activePage: this.activePrefetchPageIndex + 1 } : {}),
    };
  }

  private async runPrefetchQueue(): Promise<void> {
    if (this.prefetchRunning) return;
    this.prefetchRunning = true;
    try {
      while (this.prefetchQueue.length) {
        const task = this.prefetchQueue.shift();
        if (!task) continue;
        this.activePrefetchProviderKey = task.providerKey;
        this.activePrefetchChapterId = task.chapterId;
        this.activePrefetchPageIndex = task.pageIndex;
        try {
          await task.run();
        } finally {
          this.queuedPrefetchKeys.delete(task.key);
          this.activePrefetchProviderKey = '';
          this.activePrefetchChapterId = '';
          this.activePrefetchPageIndex = -1;
        }
      }
    } finally {
      this.prefetchRunning = false;
      this.activePrefetchProviderKey = '';
      this.activePrefetchChapterId = '';
      this.activePrefetchPageIndex = -1;
    }
  }

  makeContext(
    provider: MangaProvider,
    chapterId: string,
    pageIndex: number,
    pages: ProviderChapterPagesResponse,
  ): PageJobContext {
    const pageList = pages.pages && pages.pages.length ? pages.pages : pages.dataSaverPages || [];
    const imageUrl = pageList[pageIndex];
    if (!imageUrl) throw new Error(`Page ${pageIndex + 1} does not exist in chapter ${chapterId}`);
    return { provider, chapterId, pageIndex, imageUrl };
  }
}
