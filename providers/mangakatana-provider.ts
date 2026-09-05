import type {
  MangaProvider,
  ProviderChapterPagesResponse,
  ProviderListResponse,
  ProviderSearchResponse,
} from './types';
import { decodeHtml, firstMeta, getAttr, safeRemoteHost, stripTags, toChapterShape, toMangaShape, type SimpleChapter } from './simple-provider-shapes';

const DEFAULT_BASE_URL = 'https://mangakatana.com/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0 Safari/537.36';

function encodeOpaque(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeOpaque(value: string): string {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch (_error) {
    return '';
  }
}

function mangaIdFromHref(href: string): string {
  const match = String(href || '').match(/\/manga\/([^\/?#]+)/i);
  return match ? decodeHtml(match[1]) : '';
}

function chapterNumberFromText(value: string, href?: string): string {
  const text = stripTags(value);
  const explicit = text.match(/(?:Chapter|Ch\.?)[\s#]*([0-9]+(?:\.[0-9]+)?)/i);
  if (explicit) return explicit[1];
  const pathMatch = String(href || '').match(/\/c([0-9]+(?:\.[0-9]+)?)(?:[/?#]|$)/i);
  return pathMatch ? pathMatch[1] : '';
}

function chapterTitleFromText(value: string): string | null {
  const text = stripTags(value);
  if (!text) return null;
  const cleaned = text.replace(/^(?:Chapter|Ch\.?)\s*[#]?[0-9]+(?:\.[0-9]+)?\s*(?::|-)?\s*/i, '').trim();
  return cleaned && cleaned !== text ? cleaned : null;
}

function firstElementText(html: string, tag: string): string {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(html);
  return match ? stripTags(match[1]) : '';
}

function firstClassText(html: string, className: string): string {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<([a-z0-9:-]+)\\b[^>]*class\\s*=\\s*(["'])[^"']*\\b${escaped}\\b[^"']*\\2[^>]*>([\\s\\S]*?)<\\/\\1>`, 'i').exec(html);
  return match ? stripTags(match[3]) : '';
}

function extractImageFromHtml(html: string): string {
  const meta = firstMeta(html, 'og:image');
  if (meta) return meta;
  const coverMatch = /<[^>]+class\s*=\s*(["'])[^"']*\bcover\b[^"']*\1[^>]*>[\s\S]{0,900}?<img\b[^>]*>/i.exec(html);
  if (coverMatch) {
    const imageTag = /<img\b[^>]*>/i.exec(coverMatch[0]);
    if (imageTag) return getAttr(imageTag[0], 'data-src') || getAttr(imageTag[0], 'src') || '';
  }
  return '';
}

function cleanDescriptionText(value: string): string {
  return String(value || '')
    .replace(/^\s*Description\s*/i, '')
    .replace(/^\s*(?:Bookmark|Read offline)\s*/i, '')
    .trim();
}

function extractDescription(html: string): string {
  // MangaKatana's detail layout currently keeps the synopsis in the .info
  // section under a visible "Description" label. Older layouts used generic
  // summary/description classes, so keep those selectors first.
  const classCandidates = [
    'summary',
    'description',
    'manga-description',
    'manga_description',
    'book-description',
    'book_description',
    'single-book-description',
    'single_book_description',
  ];
  for (const className of classCandidates) {
    const text = cleanDescriptionText(firstClassText(html, className));
    if (text && text.length > 20) return text;
  }

  // ID-based variants used by several MangaKatana templates.
  const idRegex = /<([a-z0-9:-]+)\b[^>]*\bid\s*=\s*(["'])(?:description|manga[_-]?description|book[_-]?description|single[_-]?book[_-]?description)\2[^>]*>([\s\S]*?)<\/\1>/gi;
  let idMatch: RegExpExecArray | null;
  while ((idMatch = idRegex.exec(html))) {
    const text = cleanDescriptionText(stripTags(idMatch[3]));
    if (text && text.length > 20) return text;
  }

  // Current MangaKatana pages expose a literal Description heading. Rather
  // than consuming the whole page, examine only the block after that heading
  // and stop before the chapter list / scripts. This avoids pulling chapter
  // labels into the synopsis.
  const marker = /<([a-z0-9:-]+)\b[^>]*>\s*Description\s*<\/\1>/i.exec(html);
  if (marker && typeof marker.index === 'number') {
    let tail = html.slice(marker.index + marker[0].length);
    const stopPatterns = [
      /<[^>]+class\s*=\s*(["'])[^"']*\bchapters\b[^"']*\1/i,
      /<[^>]+id\s*=\s*(["'])[^"']*chapter[^"']*\1/i,
      /<script\b/i,
      /<h[1-6]\b[^>]*>\s*Chapters?\s*<\/h[1-6]>/i,
    ];
    let stop = tail.length;
    for (const pattern of stopPatterns) {
      const found = pattern.exec(tail);
      if (found && found.index < stop) stop = found.index;
    }
    tail = tail.slice(0, Math.min(stop, 12000));

    // Prefer the first meaningful paragraph. If the template uses divs only,
    // fall back to the cleaned text from this tightly scoped region.
    const paragraphRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    let paragraph: RegExpExecArray | null;
    while ((paragraph = paragraphRegex.exec(tail))) {
      const text = cleanDescriptionText(stripTags(paragraph[1]));
      if (text && text.length > 20) return text;
    }
    const fallback = cleanDescriptionText(stripTags(tail));
    if (fallback.length > 20) return fallback;
  }

  const meta = firstMeta(html, 'description') || firstMeta(html, 'og:description');
  return meta || '';
}

function parseStatus(html: string): string {
  const text = stripTags(html);
  const match = text.match(/\bStatus\s*:\s*(Ongoing|Completed|Complete|Hiatus|Cancelled|Canceled)\b/i);
  return match ? match[1] : '';
}

function parseAuthors(html: string): string[] {
  const textBlock = /Author\(s\)\s*\/\s*Artist\(s\)\s*:\s*([\s\S]{0,600}?)(?:Genres\s*:|Status\s*:|<\/div>)/i.exec(html);
  if (!textBlock) return [];
  const values: string[] = [];
  const anchorRegex = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(textBlock[1]))) {
    const name = stripTags(match[1]);
    if (name && values.indexOf(name) === -1) values.push(name);
  }
  if (!values.length) {
    const plain = stripTags(textBlock[1]);
    plain.split(/[,;/]/).forEach((piece) => {
      const name = piece.trim();
      if (name && values.indexOf(name) === -1) values.push(name);
    });
  }
  return values.slice(0, 8);
}

function parseGenres(html: string): string[] {
  const block = /Genres\s*:\s*([\s\S]{0,800}?)(?:Status\s*:|Latest chapter|<\/div>)/i.exec(html);
  if (!block) return [];
  const values: string[] = [];
  const anchorRegex = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(block[1]))) {
    const name = stripTags(match[1]);
    if (name && values.indexOf(name) === -1) values.push(name);
  }
  return values.slice(0, 30);
}


function decodeJavaScriptEscapes(value: string): string {
  return String(value || '')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\//g, '/')
    .replace(/\\([\\"'])/g, '$1')
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
}

function stringLiteralsFromJavaScript(source: string): string[] {
  const values: string[] = [];
  let i = 0;
  while (i < source.length) {
    const quote = source[i];
    if (quote !== '"' && quote !== "'" && quote !== '`') {
      i += 1;
      continue;
    }
    let raw = '';
    let escaped = false;
    let hasTemplateExpression = false;
    i += 1;
    while (i < source.length) {
      const ch = source[i];
      if (escaped) {
        raw += `\\${ch}`;
        escaped = false;
        i += 1;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        i += 1;
        continue;
      }
      if (quote === '`' && ch === '$' && source[i + 1] === '{') hasTemplateExpression = true;
      if (ch === quote) {
        i += 1;
        break;
      }
      raw += ch;
      i += 1;
    }
    if (!hasTemplateExpression) values.push(decodeJavaScriptEscapes(raw));
  }
  return values;
}

function matchingArrayEnd(source: string, start: number): number {
  if (source[start] !== '[') return -1;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '[') depth += 1;
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function assignedJavaScriptArrays(source: string): Array<{ name: string; values: string[] }> {
  const arrays: Array<{ name: string; values: string[] }> = [];
  const assignment = /(?:\b(?:var|let|const)\s+)?([A-Za-z_$][\w$]*)\s*=\s*\[/g;
  let match: RegExpExecArray | null;
  while ((match = assignment.exec(source))) {
    const open = source.indexOf('[', match.index + match[0].length - 1);
    if (open < 0) continue;
    const close = matchingArrayEnd(source, open);
    if (close < 0) continue;
    const values = stringLiteralsFromJavaScript(source.slice(open + 1, close));
    if (values.length) arrays.push({ name: match[1], values });
    assignment.lastIndex = close + 1;
  }
  return arrays;
}

export class MangaKatanaProvider implements MangaProvider {
  readonly key = 'mangakatana';
  readonly displayName = 'MangaKatana';

  private readonly baseUrl: string;
  private readonly seenImageHosts = new Set<string>();
  private readonly chapterCache = new Map<string, { expiresAt: number; chapters: SimpleChapter[] }>();
  private readonly chapterCacheTtlMs = 10 * 60 * 1000;

  constructor(baseUrl = process.env.MANGAKATANA_BASE_URL || DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    try { this.seenImageHosts.add(new URL(this.baseUrl).hostname.toLowerCase()); } catch (_error) {}
  }

  private rememberImage(value?: string): string | undefined {
    const raw = String(value || '').trim().replace(/\\\//g, '/');
    if (!raw || raw.indexOf('data:') === 0) return undefined;
    try {
      const url = new URL(raw, this.baseUrl);
      if (url.protocol !== 'https:' || !safeRemoteHost(url.hostname)) return undefined;
      this.seenImageHosts.add(url.hostname.toLowerCase());
      return url.toString();
    } catch (_error) {
      return undefined;
    }
  }

  private async fetchPage(pathOrUrl: string): Promise<{ html: string; url: string }> {
    const url = new URL(pathOrUrl, this.baseUrl);
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.8',
        Referer: this.baseUrl,
      },
    });
    const html = await response.text();
    if (!response.ok) throw new Error(`MangaKatana returned HTTP ${response.status}: ${html.slice(0, 240)}`);
    if (/Just a moment|cf-chl-|Cloudflare Ray ID/i.test(html)) {
      throw new Error('MangaKatana returned a Cloudflare challenge instead of manga HTML');
    }
    return { html, url: response.url || url.toString() };
  }

  private parseSearchHtml(html: string, limit: number): any[] {
    const results: any[] = [];
    const seen = new Set<string>();
    const regex = /<h3\b[^>]*class\s*=\s*(["'])[^"']*\btitle\b[^"']*\1[^>]*>[\s\S]*?<a\b([^>]*)href\s*=\s*(["'])([^"']*\/manga\/[^"']+)\3([^>]*)>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) && results.length < limit) {
      const href = decodeHtml(match[4]);
      const id = mangaIdFromHref(href);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const aroundStart = Math.max(0, match.index - 1800);
      const aroundEnd = Math.min(html.length, regex.lastIndex + 1800);
      const around = html.slice(aroundStart, aroundEnd);
      const imageTag = /<img\b[^>]*>/i.exec(around);
      const cover = imageTag ? this.rememberImage(getAttr(imageTag[0], 'data-src') || getAttr(imageTag[0], 'src')) : undefined;
      const statusMatch = stripTags(around).match(/\b(Ongoing|Completed|Complete|Hiatus|Cancelled|Canceled)\b/i);
      results.push(toMangaShape(this.key, {
        id,
        title: stripTags(match[6]) || id,
        coverUrl: cover,
        status: statusMatch ? statusMatch[1] : undefined,
      }));
    }

    // Some directory templates do not wrap the title link in h3.title. Keep a
    // conservative fallback that only accepts direct /manga/ links and dedups.
    if (!results.length) {
      const linkRegex = /<a\b[^>]*href\s*=\s*(["'])([^"']*\/manga\/[^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi;
      while ((match = linkRegex.exec(html)) && results.length < limit) {
        const href = decodeHtml(match[2]);
        const id = mangaIdFromHref(href);
        const title = stripTags(match[3]);
        if (!id || !title || title.length > 180 || seen.has(id)) continue;
        seen.add(id);
        results.push(toMangaShape(this.key, { id, title }));
      }
    }
    return results;
  }

  async search(params: URLSearchParams): Promise<ProviderSearchResponse> {
    const title = String(params.get('title') || '').trim();
    const requestedLimit = Math.max(1, Math.min(24, Number(params.get('limit') || 20) || 20));
    const offset = Math.max(0, Number(params.get('offset') || 0) || 0);
    const page = Math.floor(offset / requestedLimit) + 1;
    const path = title
      ? (page <= 1
        ? `?search=${encodeURIComponent(title)}&search_by=book_name`
        : `page/${page}?search=${encodeURIComponent(title)}&search_by=book_name`)
      : `manga/page/${page}`;
    const result = await this.fetchPage(path);
    const redirectedId = mangaIdFromHref(result.url);
    if (title && redirectedId && /\/manga\//i.test(new URL(result.url).pathname)) {
      const manga = await this.parseDetail(redirectedId, result.html);
      return { data: [manga], total: 1, offset: 0, limit: requestedLimit };
    }
    const data = this.parseSearchHtml(result.html, requestedLimit);
    const hasNext = /(?:rel\s*=\s*["']next["']|>\s*Next\s*<|class\s*=\s*["'][^"']*next[^"']*["'])/i.test(result.html);
    return {
      data,
      total: offset + data.length + (hasNext || data.length >= requestedLimit ? requestedLimit : 0),
      offset,
      limit: requestedLimit,
    };
  }

  private async parseDetail(id: string, html: string): Promise<any> {
    const title = firstElementText(html, 'h1') || firstMeta(html, 'og:title') || id;
    return toMangaShape(this.key, {
      id,
      title: title.replace(/\s*[|\-]\s*MangaKatana.*$/i, '').trim(),
      coverUrl: this.rememberImage(extractImageFromHtml(html)),
      description: extractDescription(html),
      status: parseStatus(html),
      authors: parseAuthors(html),
      tags: parseGenres(html),
    });
  }

  async getManga(id: string): Promise<any> {
    const { html } = await this.fetchPage(`manga/${encodeURIComponent(id)}`);
    return this.parseDetail(id, html);
  }

  private parseChapters(mangaId: string, html: string): SimpleChapter[] {
    const chapters: SimpleChapter[] = [];
    const seen = new Set<string>();
    const regex = /<a\b([^>]*)href\s*=\s*(["'])([^"']*\/manga\/[^"']+\/c[0-9.]+[^"']*)\2([^>]*)>([\s\S]*?)<\/a>/gi;
    const normalizedMangaId = (() => {
      try { return decodeURIComponent(mangaId).trim().toLowerCase(); } catch (_error) { return mangaId.trim().toLowerCase(); }
    })();
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html))) {
      const href = decodeHtml(match[3]);
      let relative: string;
      try {
        const url = new URL(href, this.baseUrl);
        const pathMatch = url.pathname.match(/^\/manga\/([^/]+)\/c([0-9]+(?:\.[0-9]+)?)(?:\/)?$/i);
        if (!pathMatch) continue;

        // MangaKatana detail pages also contain chapter links for recommended,
        // latest and related series. The old parser accepted every /manga/*/c*
        // link in the entire HTML document, so chapters from unrelated manga
        // were merged into the selected title. Keep only links whose manga slug
        // is exactly the manga currently being loaded.
        let linkedMangaId = pathMatch[1];
        try { linkedMangaId = decodeURIComponent(linkedMangaId); } catch (_error) {}
        if (linkedMangaId.trim().toLowerCase() !== normalizedMangaId) continue;

        relative = url.pathname + url.search;
      } catch (_error) {
        continue;
      }

      const number = chapterNumberFromText(match[5], href);
      if (!number) continue;
      const id = encodeOpaque(relative);
      if (seen.has(id)) continue;
      seen.add(id);
      chapters.push({ id, number, title: chapterTitleFromText(match[5]), mangaId });
    }
    chapters.sort((a, b) => {
      const an = parseFloat(a.number);
      const bn = parseFloat(b.number);
      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return bn - an;
      return b.number.localeCompare(a.number);
    });
    return chapters;
  }

  private async loadChapterList(mangaId: string): Promise<SimpleChapter[]> {
    const cached = this.chapterCache.get(mangaId);
    if (cached && cached.expiresAt > Date.now()) return cached.chapters;
    if (cached) this.chapterCache.delete(mangaId);
    const { html } = await this.fetchPage(`manga/${encodeURIComponent(mangaId)}`);
    const chapters = this.parseChapters(mangaId, html);
    if (!chapters.length && /\/c[0-9.]+/i.test(html)) {
      throw new Error(`MangaKatana chapter parser found chapter links but could not normalize them for ${mangaId}`);
    }
    this.chapterCache.set(mangaId, { expiresAt: Date.now() + this.chapterCacheTtlMs, chapters });
    return chapters;
  }

  async getChapters(mangaId: string, params: URLSearchParams): Promise<ProviderListResponse> {
    const all = (await this.loadChapterList(mangaId)).slice();
    const direction = (params.get('order[chapter]') || 'desc').toLowerCase();
    if (direction === 'asc') all.reverse();
    const offset = Math.max(0, Number(params.get('offset') || 0) || 0);
    const limit = Math.max(1, Math.min(100, Number(params.get('limit') || 40) || 40));
    return { data: all.slice(offset, offset + limit).map(toChapterShape), total: all.length };
  }

  private chapterPath(chapterId: string): string {
    const relative = decodeOpaque(chapterId);
    if (!relative || !/^\/manga\/[^/]+\/c[0-9.]+(?:\?|$)/i.test(relative)) {
      throw new Error('Invalid MangaKatana chapter id');
    }
    return relative;
  }

  async getChapter(chapterId: string): Promise<any> {
    const relative = this.chapterPath(chapterId);
    const { html } = await this.fetchPage(relative);
    const pathMatch = relative.match(/^\/manga\/([^/]+)\/c([0-9.]+)/i);
    const mangaId = pathMatch ? pathMatch[1] : undefined;
    const number = pathMatch ? pathMatch[2] : chapterNumberFromText(firstMeta(html, 'og:title') || '', relative);
    const docTitle = firstMeta(html, 'og:title') || firstElementText(html, 'title');
    return toChapterShape({
      id: chapterId,
      number,
      title: chapterTitleFromText(docTitle),
      mangaId,
    });
  }

  async getChapterPages(chapterId: string): Promise<ProviderChapterPagesResponse> {
    const relative = this.chapterPath(chapterId);
    const { html } = await this.fetchPage(relative);
    const domPages: string[] = [];
    const domSeen = new Set<string>();
    const addDom = (raw?: string) => {
      const url = this.rememberImage(raw);
      if (url && !domSeen.has(url)) {
        domSeen.add(url);
        domPages.push(url);
      }
    };

    // MangaKatana can render only the first page in the server HTML and build
    // the rest of #imgs in JavaScript. Collect every explicit #page* image we
    // can see, but do not stop after finding the first one.
    const pageNodeRegex = /<div\b[^>]*id\s*=\s*(["'])page[^"']*\1[^>]*>[\s\S]*?<img\b[^>]*>/gi;
    let pageNodeMatch: RegExpExecArray | null;
    while ((pageNodeMatch = pageNodeRegex.exec(html))) {
      const tagMatch = /<img\b[^>]*>/i.exec(pageNodeMatch[0]);
      if (!tagMatch) continue;
      addDom(getAttr(tagMatch[0], 'data-src') || getAttr(tagMatch[0], 'data-original') || getAttr(tagMatch[0], 'src'));
    }

    // Also scan the reader block even when one page was already found. The old
    // implementation only entered this branch when pages.length === 0, which
    // is why a chapter whose HTML contained one eager image was truncated to a
    // single page.
    const imgsBlockMatch = /<[^>]+id\s*=\s*(["'])imgs\1[^>]*>([\s\S]*?)(?:<\/body>|<script\b)/i.exec(html);
    const imageScope = imgsBlockMatch ? imgsBlockMatch[2] : '';
    if (imageScope) {
      const imageRegex = /<img\b[^>]*>/gi;
      let imageMatch: RegExpExecArray | null;
      while ((imageMatch = imageRegex.exec(imageScope))) {
        const tag = imageMatch[0];
        const raw = getAttr(tag, 'data-src') || getAttr(tag, 'data-original') || getAttr(tag, 'data-lazy-src') || getAttr(tag, 'src');
        if (raw) addDom(raw);
      }
    }

    // The current reader frequently carries the full chapter as a JavaScript
    // array whose variable name is not stable. Parse every assigned array,
    // normalize URL-like strings, and choose the strongest page-list candidate
    // instead of assuming a hard-coded variable name.
    const preferredHost = (() => {
      try { return domPages.length ? new URL(domPages[0]).hostname.toLowerCase() : ''; } catch (_error) { return ''; }
    })();
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    const arrayCandidates: Array<{ urls: string[]; score: number }> = [];
    let scriptMatch: RegExpExecArray | null;
    while ((scriptMatch = scriptRegex.exec(html))) {
      const script = scriptMatch[1];
      assignedJavaScriptArrays(script).forEach((entry) => {
        const urls: string[] = [];
        const seen = new Set<string>();
        let imageLike = 0;
        let preferred = 0;
        entry.values.forEach((rawValue) => {
          const value = decodeJavaScriptEscapes(rawValue).trim();
          if (!value || !/^(?:https?:)?\/\//i.test(value)) return;
          if (/\.(?:js|css|svg|ico|woff2?|ttf|eot)(?:[?#]|$)/i.test(value)) return;
          const url = this.rememberImage(value.indexOf('//') === 0 ? `https:${value}` : value);
          if (!url || seen.has(url)) return;
          seen.add(url);
          urls.push(url);
          if (/\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)/i.test(url)) imageLike += 1;
          try {
            if (preferredHost && new URL(url).hostname.toLowerCase() === preferredHost) preferred += 1;
          } catch (_error) {}
        });
        if (urls.length >= 2) {
          const sameHostBonus = preferredHost && preferred === urls.length ? 10000 : preferred * 100;
          const nameBonus = /(?:img|image|page|src|chapter)/i.test(entry.name) ? 500 : 0;
          arrayCandidates.push({ urls, score: sameHostBonus + nameBonus + imageLike * 20 + urls.length });
        }
      });
    }

    arrayCandidates.sort((a, b) => b.score - a.score || b.urls.length - a.urls.length);
    const scriptPages = arrayCandidates.length ? arrayCandidates[0].urls : [];

    // Prefer the JavaScript list when it is longer. This preserves page order
    // exactly as MangaKatana sends it and avoids mixing alternate image servers
    // into one chapter. If no suitable array exists, use all DOM pages found.
    let pages = scriptPages.length > domPages.length ? scriptPages : domPages;

    // Last-resort extraction for older templates that contain quoted page URLs
    // but no normal assignment expression. Only use it when both structured
    // methods failed, otherwise unrelated assets could pollute the chapter.
    if (!pages.length) {
      const fallbackPages: string[] = [];
      const fallbackSeen = new Set<string>();
      const normalizedScript = decodeJavaScriptEscapes(html);
      const urlRegex = /https?:\/\/[^"'`\s,\]]+?(?:\.(?:jpe?g|png|webp|avif|gif)(?:\?[^"'`\s,\]]*)?|\/[^"'`\s,\]]*image[^"'`\s,\]]*)/gi;
      let match: RegExpExecArray | null;
      while ((match = urlRegex.exec(normalizedScript))) {
        const url = this.rememberImage(match[0]);
        if (url && !fallbackSeen.has(url)) {
          fallbackSeen.add(url);
          fallbackPages.push(url);
        }
      }
      pages = fallbackPages;
    }

    if (!pages.length) throw new Error(`MangaKatana returned no chapter images for ${chapterId}`);
    return { result: 'ok', pages, dataSaverPages: [] };
  }

  isAllowedImageUrl(url: URL): boolean {
    return url.protocol === 'https:' && safeRemoteHost(url.hostname) && this.seenImageHosts.has(url.hostname.toLowerCase());
  }

  getImageRequestHeaders(_url: URL): Record<string, string> {
    return { Referer: this.baseUrl, 'Accept-Language': 'en-US,en;q=0.8' };
  }
}
