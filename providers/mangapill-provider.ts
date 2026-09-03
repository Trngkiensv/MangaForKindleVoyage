import type {
  MangaProvider,
  ProviderChapterPagesResponse,
  ProviderListResponse,
  ProviderSearchResponse,
} from './types';

const DEFAULT_BASE_URL = 'https://mangapill.com/';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function getAttr(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const quoted = new RegExp(`\\b${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(tag);
  if (quoted) return decodeHtml(quoted[2].trim());
  const bare = new RegExp(`\\b${escaped}\\s*=\\s*([^\\s>]+)`, 'i').exec(tag);
  return bare ? decodeHtml(bare[1].trim()) : undefined;
}

function normalizePath(raw: string): string {
  let value = decodeHtml(raw || '').trim();
  try {
    if (/^https?:\/\//i.test(value)) value = new URL(value).pathname;
  } catch (_error) {}
  return value.replace(/^\/+/, '');
}

function normalizeStatus(raw?: string): string {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'finished' || value === 'complete' || value === 'completed') return 'completed';
  if (value === 'on hiatus' || value === 'hiatus') return 'hiatus';
  if (value === 'discontinued' || value === 'cancelled' || value === 'canceled') return 'cancelled';
  return 'ongoing';
}

function makeTag(name: string, index: number): any {
  return {
    id: `mangapill-tag-${index}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    type: 'tag',
    attributes: {
      name: { en: name },
      description: {},
      group: 'genre',
      version: 1,
    },
  };
}

function toMangaShape(input: {
  id: string;
  title: string;
  coverUrl?: string;
  description?: string;
  status?: string;
  tags?: string[];
}): any {
  const now = new Date().toISOString();
  const relationships: any[] = [];
  if (input.coverUrl) {
    relationships.push({
      id: `mangapill-cover-${input.id.replace(/[^a-z0-9]+/gi, '-')}`,
      type: 'cover_art',
      attributes: { url: input.coverUrl, coverUrl: input.coverUrl },
    });
  }
  return {
    id: input.id,
    type: 'manga',
    attributes: {
      title: { en: input.title || 'Untitled Manga' },
      altTitles: [],
      description: input.description ? { en: input.description } : {},
      isLocked: false,
      links: {},
      originalLanguage: 'en',
      lastVolume: null,
      lastChapter: null,
      publicationDemographic: null,
      status: normalizeStatus(input.status),
      year: null,
      contentRating: 'safe',
      tags: (input.tags || []).map(makeTag),
      state: 'published',
      chapterNumbersResetOnNewVolume: false,
      createdAt: now,
      updatedAt: now,
      version: 1,
      availableTranslatedLanguages: ['en'],
      latestUploadedChapter: null,
    },
    relationships,
  };
}

function toChapterShape(id: string, mangaId: string | undefined, number: string): any {
  const now = new Date().toISOString();
  const relationships: any[] = [];
  if (mangaId) relationships.push({ id: mangaId, type: 'manga' });
  return {
    id,
    type: 'chapter',
    attributes: {
      title: null,
      volume: null,
      chapter: number || '0',
      pages: 0,
      translatedLanguage: 'en',
      uploader: null,
      externalUrl: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      publishAt: now,
      readableAt: now,
    },
    relationships,
  };
}

function extractMeta(html: string, key: string): string | undefined {
  const regex = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    const tag = match[0];
    const prop = (getAttr(tag, 'property') || getAttr(tag, 'name') || '').toLowerCase();
    if (prop === key.toLowerCase()) {
      const value = getAttr(tag, 'content');
      if (value) return value;
    }
  }
  return undefined;
}

function extractH1(html: string): string | undefined {
  const match = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const value = match ? stripTags(match[1]) : '';
  return value || undefined;
}

function extractFirstParagraphAfterH1(html: string): string | undefined {
  const h1 = /<h1\b[^>]*>[\s\S]*?<\/h1>/i.exec(html);
  const start = h1 ? (h1.index || 0) + h1[0].length : 0;
  const match = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html.slice(start));
  const value = match ? stripTags(match[1]) : '';
  return value || undefined;
}

function extractDetailCover(html: string): string | undefined {
  const mainStart = html.search(/class\s*=\s*(["'])[^"']*\bsm:flex-row\b[^"']*\1/i);
  const segment = mainStart >= 0 ? html.slice(Math.max(0, mainStart - 500), mainStart + 10000) : html.slice(0, 20000);
  const imgRegex = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(segment))) {
    const value = getAttr(match[0], 'data-src') || getAttr(match[0], 'src');
    if (value && /^https:\/\//i.test(value)) return value;
  }
  return extractMeta(html, 'og:image');
}

function extractGenres(html: string): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  const regex = /<a\b([^>]*class\s*=\s*(["'])[^"']*\btext-sm\b[^"']*\2[^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    const value = stripTags(match[3]);
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      values.push(value);
    }
  }
  return values;
}

function extractStatus(html: string): string | undefined {
  const plain = stripTags(html);
  const match = plain.match(/\b(Ongoing|Publishing|Finished|Completed|On Hiatus|Hiatus|Discontinued|Cancelled|Canceled)\b/i);
  return match ? match[1] : undefined;
}

export class MangaPillProvider implements MangaProvider {
  readonly key = 'mangapill';
  readonly displayName = 'MangaPill';

  private readonly baseUrl: string;
  private readonly seenImageHosts = new Set<string>(['cdn.readdetectiveconan.com']);

  constructor(baseUrl = process.env.MANGAPILL_BASE_URL || DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  private rememberImageUrl(value?: string): string | undefined {
    if (!value) return undefined;
    try {
      const parsed = new URL(value, this.baseUrl);
      if (parsed.protocol !== 'https:') return undefined;
      const host = parsed.hostname.toLowerCase();
      if (host === 'cdn.readdetectiveconan.com' || host.endsWith('.readdetectiveconan.com')) {
        this.seenImageHosts.add(host);
        return parsed.toString();
      }
    } catch (_error) {}
    return undefined;
  }

  private async fetchHtml(pathOrUrl: string): Promise<string> {
    const url = new URL(pathOrUrl, this.baseUrl);
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        Referer: this.baseUrl,
        DNT: '1',
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`MangaPill returned HTTP ${response.status}: ${body.slice(0, 240)}`);
    }
    return response.text();
  }

  private parseSearch(html: string, requestedLimit: number): any[] {
    const items: any[] = [];
    const seen = new Set<string>();
    const regex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) && items.length < requestedLimit) {
      const openTag = `<a${match[1]}>`;
      const href = getAttr(openTag, 'href') || '';
      const className = getAttr(openTag, 'class') || '';
      const id = normalizePath(href);

      // MangaPill's current search cards are `div.grid > div` containing an
      // `a.mb-2`. Keep the class check to avoid navigation links, but normalize
      // the href first so both relative and absolute MangaPill URLs work.
      if (!/(^|\s)mb-2(\s|$)/.test(className) || !/^manga\//i.test(id)) continue;
      if (!id || seen.has(id)) continue;
      seen.add(id);

      // The first div inside a.mb-2 is the title in the current MangaPill
      // markup. Falling back to all anchor text keeps the scraper tolerant to
      // small markup changes without turning year/status text into the title.
      const titleDiv = /<div\b[^>]*>([\s\S]*?)<\/div>/i.exec(match[2]);
      const title =
        (titleDiv ? stripTags(titleDiv[1]) : '') ||
        stripTags(match[2]) ||
        id.split('/').pop() ||
        'Untitled Manga';

      // Covers may live inside the card anchor or immediately before it.
      const imageSegment = html.slice(Math.max(0, match.index - 2200), match.index) + match[2];
      const imgs = imageSegment.match(/<img\b[^>]*>/gi) || [];
      let coverUrl: string | undefined;
      for (let i = imgs.length - 1; i >= 0; i -= 1) {
        const candidate = getAttr(imgs[i], 'data-src') || getAttr(imgs[i], 'src');
        coverUrl = this.rememberImageUrl(candidate);
        if (coverUrl) break;
      }

      const after = html.slice(match.index + match[0].length, match.index + match[0].length + 900);
      const statusMatch = stripTags(after).match(/\b(Ongoing|Publishing|Finished|Completed|On Hiatus|Hiatus|Discontinued)\b/i);
      items.push(toMangaShape({ id, title, coverUrl, status: statusMatch ? statusMatch[1] : undefined }));
    }
    return items;
  }

  async search(params: URLSearchParams): Promise<ProviderSearchResponse> {
    const title = (params.get('title') || '').trim();
    const limit = Math.max(1, Math.min(24, Number(params.get('limit') || 20) || 20));
    const offset = Math.max(0, Number(params.get('offset') || 0) || 0);
    const page = Math.floor(offset / limit) + 1;
    const query = new URLSearchParams();
    // `/search` with no filters only renders MangaPill's search form. To browse
    // the catalogue (Home/Random), MangaPill requires an actual filter. The
    // empty q + type=manga combination returns the paginated manga catalogue.
    query.set('q', title);
    if (!title) query.set('type', 'manga');
    query.set('page', String(page));
    const html = await this.fetchHtml(`search?${query.toString()}`);
    const data = this.parseSearch(html, limit);
    const hasNext = /<a\b[^>]*class\s*=\s*(["'])[^"']*\bbtn\b[^"']*\1[^>]*>[\s\S]*?\bnext\b[\s\S]*?<\/a>/i.test(html);
    const hasPrevious = /<a\b[^>]*class\s*=\s*(["'])[^"']*\bbtn\b[^"']*\1[^>]*>[\s\S]*?\bprevious\b[\s\S]*?<\/a>/i.test(html);
    const total = hasNext || hasPrevious ? Math.max(offset + data.length + (hasNext ? limit : 0), 10000) : offset + data.length;
    return { data, total, offset, limit };
  }

  async getManga(idRaw: string): Promise<any> {
    const id = normalizePath(idRaw);
    if (!/^manga\//i.test(id)) throw new Error('Invalid MangaPill manga id');
    const html = await this.fetchHtml(id);
    const title = extractH1(html) || extractMeta(html, 'og:title') || id.split('/').pop() || 'Untitled Manga';
    const description = extractFirstParagraphAfterH1(html) || extractMeta(html, 'description');
    const coverUrl = this.rememberImageUrl(extractDetailCover(html));
    return toMangaShape({
      id,
      title: title.replace(/\s*[|\-]\s*MangaPill\s*$/i, '').trim(),
      description,
      coverUrl,
      status: extractStatus(html),
      tags: extractGenres(html),
    });
  }

  async getChapters(mangaIdRaw: string, params: URLSearchParams): Promise<ProviderListResponse> {
    const mangaId = normalizePath(mangaIdRaw);
    const html = await this.fetchHtml(mangaId);
    const chapters: any[] = [];
    const seen = new Set<string>();
    const regex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html))) {
      const openTag = `<a${match[1]}>`;
      const href = getAttr(openTag, 'href') || '';
      const className = getAttr(openTag, 'class') || '';
      if (!/(^|\s)border(\s|$)/.test(className) || !/^\/chapters\//i.test(href)) continue;
      const id = normalizePath(href);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const label = stripTags(match[2]);
      const numberMatch = label.match(/(?:Chapter\s*)?([0-9]+(?:\.[0-9]+)?)/i);
      if (!numberMatch) continue;
      chapters.push(toChapterShape(id, mangaId, numberMatch[1]));
    }
    const order = String(params.get('order[chapter]') || 'desc').toLowerCase();
    if (order === 'asc') chapters.reverse();
    const total = chapters.length;
    const limit = Math.max(1, Math.min(100, Number(params.get('limit') || 40) || 40));
    const offset = Math.max(0, Number(params.get('offset') || 0) || 0);
    return { data: chapters.slice(offset, offset + limit), total };
  }

  async getChapter(chapterIdRaw: string): Promise<any> {
    const chapterId = normalizePath(chapterIdRaw);
    if (!/^chapters\//i.test(chapterId)) throw new Error('Invalid MangaPill chapter id');
    const html = await this.fetchHtml(chapterId);
    const title = extractH1(html) || '';
    const numberMatch = title.match(/\bChapter\s+([0-9]+(?:\.[0-9]+)?)/i) || title.match(/\b([0-9]+(?:\.[0-9]+)?)\b/);
    return toChapterShape(chapterId, undefined, numberMatch ? numberMatch[1] : '0');
  }

  async getChapterPages(chapterIdRaw: string): Promise<ProviderChapterPagesResponse> {
    const chapterId = normalizePath(chapterIdRaw);
    const html = await this.fetchHtml(chapterId);
    const pages: string[] = [];
    const regex = /<img\b[^>]*class\s*=\s*(["'])[^"']*\bjs-page\b[^"']*\1[^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html))) {
      const url = this.rememberImageUrl(getAttr(match[0], 'data-src') || getAttr(match[0], 'src'));
      if (url) pages.push(url);
    }
    if (!pages.length) throw new Error('MangaPill chapter has no readable page images');
    return { result: 'ok', pages, dataSaverPages: pages.slice() };
  }

  isAllowedImageUrl(url: URL): boolean {
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return this.seenImageHosts.has(host) || host === 'cdn.readdetectiveconan.com' || host.endsWith('.readdetectiveconan.com');
  }

  getImageRequestHeaders(_url: URL): Record<string, string> {
    return {
      Referer: this.baseUrl,
      'User-Agent': USER_AGENT,
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    };
  }
}
