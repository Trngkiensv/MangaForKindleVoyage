import type {
  MangaProvider,
  ProviderChapterPagesResponse,
  ProviderListResponse,
  ProviderSearchResponse,
} from './types';

const DEFAULT_BASE_URL = 'https://weebcentral.com/';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';

interface ParsedManga {
  id: string;
  title: string;
  coverUrl?: string;
  description?: string;
  status?: string;
  tags?: string[];
  year?: number | null;
  authors?: string[];
}

interface ParsedChapter {
  id: string;
  number: string;
  kind?: 'chapter' | 'episode' | 'volume' | 'page';
  publishedAt?: string;
  mangaId?: string;
}

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

function hasClass(tag: string, className: string): boolean {
  const classes = getAttr(tag, 'class');
  return !!classes && classes.split(/\s+/).includes(className);
}

function firstTag(html: string, tagName: string, predicate?: (tag: string) => boolean): string | undefined {
  const regex = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    if (!predicate || predicate(match[0])) return match[0];
  }
  return undefined;
}

function firstElementTextByClass(html: string, className: string): string | undefined {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `<([a-z0-9:-]+)\\b([^>]*class\\s*=\\s*(["'])[^"']*\\b${escaped}\\b[^"']*\\3[^>]*)>([\\s\\S]*?)<\\/\\1>`,
    'i',
  );
  const match = regex.exec(html);
  const text = match ? stripTags(match[4]) : '';
  return text || undefined;
}

function firstElementText(html: string, tagName: string): string | undefined {
  const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(html);
  const text = match ? stripTags(match[1]) : '';
  return text || undefined;
}

function extractSeriesId(value: string): string | undefined {
  const match = value.match(/\/series\/([^\/?#]+)/i);
  return match ? match[1] : undefined;
}

function extractChapterId(value: string): string | undefined {
  const match = value.match(/\/chapters\/([^\/?#]+)/i);
  return match ? match[1] : undefined;
}

function extractFirstSeriesHref(html: string): string | undefined {
  const regex = /<a\b[^>]*\bhref\s*=\s*(["'])([^"']*\/series\/[^"']+)\1[^>]*>/gi;
  const match = regex.exec(html);
  return match ? decodeHtml(match[2]) : undefined;
}


/**
 * Search results contain nested <article> tags for responsive cover variants.
 * A regex such as `<article ...>.*?</article>` therefore stops at the inner
 * cover article and drops the title/metadata. Split only on the outer result
 * marker instead and let each chunk run until the next outer result.
 */
function splitSearchArticles(html: string): string[] {
  const starts: number[] = [];
  const regex = /<article\b[^>]*class\s*=\s*(["'])[^"']*\bbg-base-300\b[^"']*\1[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) starts.push(match.index);

  const chunks: string[] = [];
  for (let i = 0; i < starts.length; i += 1) {
    const end = i + 1 < starts.length ? starts[i + 1] : html.length;
    chunks.push(html.slice(starts[i], end));
  }
  return chunks;
}

function extractTooltipTitle(html: string): string | undefined {
  const tag = firstTag(html, 'span', (candidate) => {
    return hasClass(candidate, 'tooltip') && !!getAttr(candidate, 'data-tip');
  });
  const title = tag ? getAttr(tag, 'data-tip') : undefined;
  return title ? stripTags(title) : undefined;
}

function extractSeriesAnchorTitle(html: string): string | undefined {
  const regex = /<a\b([^>]*\bhref\s*=\s*(["'])[^"']*\/series\/[^"']+\2[^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  let fallback: string | undefined;
  while ((match = regex.exec(html))) {
    const text = stripTags(match[3]);
    if (!text) continue;
    if (getAttr(`<a ${match[1]}>`, 'class')?.split(/\s+/).includes('line-clamp-1')) return text;
    fallback = fallback || text;
  }
  return fallback;
}

function extractMetaContent(html: string, property: string): string | undefined {
  const tag = firstTag(html, 'meta', (candidate) => {
    const key = (getAttr(candidate, 'property') || getAttr(candidate, 'name') || '').toLowerCase();
    return key === property.toLowerCase() && !!getAttr(candidate, 'content');
  });
  return tag ? getAttr(tag, 'content') : undefined;
}

function extractDocumentTitle(html: string): string | undefined {
  const title = firstElementText(html, 'title');
  if (!title) return undefined;
  return title.replace(/\s*[|\-]\s*Weeb\s*Central\s*$/i, '').trim() || undefined;
}

function extractFirstSourceUrl(html: string): string | undefined {
  const source = firstTag(html, 'source', (tag) => !!getAttr(tag, 'srcset'));
  if (source) {
    const srcset = getAttr(source, 'srcset');
    if (srcset) return srcset.split(',')[0].trim().split(/\s+/)[0];
  }

  const img = firstTag(html, 'img', (tag) => !!getAttr(tag, 'src'));
  return img ? getAttr(img, 'src') : undefined;
}

function extractCanonicalUrl(html: string): string | undefined {
  const tag = firstTag(html, 'link', (candidate) => {
    return (getAttr(candidate, 'rel') || '').toLowerCase() === 'canonical' && !!getAttr(candidate, 'href');
  });
  return tag ? getAttr(tag, 'href') : undefined;
}

function extractLabeledListItem(html: string, labelPattern: RegExp): string | undefined {
  const regex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    const text = stripTags(match[1]);
    if (labelPattern.test(text)) return match[1];
  }
  return undefined;
}

function extractAnchorTexts(html: string): string[] {
  const values: string[] = [];
  const regex = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    const text = stripTags(match[1]);
    if (text) values.push(text);
  }
  return values;
}

function normalizeStatus(status?: string): string {
  const value = (status || '').trim().toLowerCase();
  if (value === 'ongoing') return 'ongoing';
  if (value === 'complete' || value === 'completed') return 'completed';
  if (value === 'hiatus') return 'hiatus';
  if (value === 'cancelled' || value === 'canceled') return 'cancelled';
  return value || 'ongoing';
}

function makeTag(name: string, index: number): any {
  return {
    id: `weebcentral-tag-${index}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    type: 'tag',
    attributes: {
      name: { en: name },
      description: {},
      group: 'genre',
      version: 1,
    },
  };
}

function toMangaShape(manga: ParsedManga): any {
  const now = new Date().toISOString();
  const relationships: any[] = [];

  if (manga.coverUrl) {
    relationships.push({
      id: `weebcentral-cover-${manga.id}`,
      type: 'cover_art',
      attributes: { url: manga.coverUrl, coverUrl: manga.coverUrl },
    });
  }

  (manga.authors || []).forEach((name, index) => {
    relationships.push({
      id: `weebcentral-author-${manga.id}-${index}`,
      type: 'author',
      attributes: { name },
    });
  });

  return {
    id: manga.id,
    type: 'manga',
    attributes: {
      title: { en: manga.title || 'Untitled Manga' },
      altTitles: [],
      description: manga.description ? { en: manga.description } : {},
      isLocked: false,
      links: {},
      originalLanguage: 'en',
      lastVolume: null,
      lastChapter: null,
      publicationDemographic: null,
      status: normalizeStatus(manga.status),
      year: manga.year ?? null,
      contentRating: 'safe',
      tags: (manga.tags || []).map(makeTag),
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

function toChapterShape(chapter: ParsedChapter): any {
  const publishedAt = chapter.publishedAt || new Date(0).toISOString();
  const isVolume = chapter.kind === 'volume';
  return {
    id: chapter.id,
    type: 'chapter',
    attributes: {
      volume: isVolume ? chapter.number || null : null,
      chapter: isVolume ? null : chapter.number || null,
      title: null,
      language: 'en',
      externalUrl: null,
      publishAt: publishedAt,
      readableAt: publishedAt,
      createdAt: publishedAt,
      updatedAt: publishedAt,
      pages: 0,
      version: 1,
    },
    relationships: chapter.mangaId ? [{ id: chapter.mangaId, type: 'manga' }] : [],
  };
}

function chapterSortValue(value: string): number {
  const numeric = parseFloat(value);
  return Number.isFinite(numeric) ? numeric : Number.NEGATIVE_INFINITY;
}

export class WeebCentralProvider implements MangaProvider {
  readonly key = 'weebcentral';
  readonly displayName = 'WeebCentral';

  private readonly baseUrl: string;
  private readonly seenImageHosts = new Set<string>(['temp.compsci88.com', 'scans.lastation.us']);
  private readonly cookies = new Map<string, string>();
  private readonly chapterListCache = new Map<string, { expiresAt: number; chapters: ParsedChapter[] }>();
  private readonly chapterListCacheTtlMs = 10 * 60 * 1000;
  private readonly chapterListCacheMaxEntries = 12;

  constructor(baseUrl = process.env.WEEBCENTRAL_BASE_URL || DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  private rememberImageUrl(value?: string): string | undefined {
    if (!value) return value;
    try {
      const parsed = new URL(value, this.baseUrl);
      if (parsed.protocol === 'https:' && this.isSafeRemoteHost(parsed.hostname)) {
        this.seenImageHosts.add(parsed.hostname.toLowerCase());
        return parsed.toString();
      }
    } catch (_error) {
      // Ignore malformed image URLs from upstream HTML.
    }
    return undefined;
  }

  private isSafeRemoteHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost')) return false;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
    if (host === '::1' || host.endsWith('.local')) return false;
    return true;
  }

  private cookieHeader(): string | undefined {
    if (!this.cookies.size) return undefined;
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  private rememberCookies(headers: Headers): void {
    const headerApi = headers as Headers & { getSetCookie?: () => string[] };
    const setCookies = typeof headerApi.getSetCookie === 'function'
      ? headerApi.getSetCookie()
      : [headers.get('set-cookie') || ''].filter(Boolean);

    setCookies.forEach((cookie) => {
      const first = cookie.split(';', 1)[0];
      const separator = first.indexOf('=');
      if (separator > 0) {
        this.cookies.set(first.slice(0, separator).trim(), first.slice(separator + 1).trim());
      }
    });
  }

  private async fetchHtml(pathOrUrl: string, headers: Record<string, string> = {}): Promise<string> {
    const url = new URL(pathOrUrl, this.baseUrl);
    const cookie = this.cookieHeader();
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8,application/json',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'max-age=604800',
        Referer: 'https://google.com/',
        DNT: '1',
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
    });

    this.rememberCookies(response.headers);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`WeebCentral returned HTTP ${response.status}: ${body.slice(0, 240)}`);
    }

    return response.text();
  }

  private parseSearchItem(articleHtml: string): ParsedManga | undefined {
    const href = extractFirstSeriesHref(articleHtml);
    const id = href ? extractSeriesId(href) : undefined;
    if (!id) return undefined;

    const coverUrl = this.rememberImageUrl(extractFirstSourceUrl(articleHtml));
    const title =
      firstElementTextByClass(articleHtml, 'line-clamp-1') ||
      extractTooltipTitle(articleHtml) ||
      extractSeriesAnchorTitle(articleHtml) ||
      `WeebCentral ${id}`;
    const statusMatch = stripTags(articleHtml).match(/\b(Ongoing|Complete|Completed|Hiatus|Cancelled|Canceled)\b/i);

    return {
      id,
      title,
      coverUrl,
      status: statusMatch ? statusMatch[1] : undefined,
    };
  }

  async search(params: URLSearchParams): Promise<ProviderSearchResponse> {
    const title = (params.get('title') || '').trim();
    const requestedLimit = Math.max(1, Math.min(24, Number(params.get('limit') || 20) || 20));
    const offset = Math.max(0, Number(params.get('offset') || 0) || 0);
    const search = new URLSearchParams({
      ...(title ? { text: title } : {}),
      limit: String(requestedLimit),
      offset: String(offset),
      sort: 'Best Match',
      order: 'Descending',
      official: 'Any',
      anime: 'Any',
      adult: 'Any',
      display_mode: 'Full Display',
    });

    const html = await this.fetchHtml(`search/data?${search.toString()}`);
    const articles = splitSearchArticles(html);
    const data = articles
      .map((article) => this.parseSearchItem(article))
      .filter((item): item is ParsedManga => !!item)
      .slice(0, requestedLimit)
      .map(toMangaShape);

    const hasMore = /<button\b[^>]*class\s*=\s*(["'])[^"']*\bcol-span-2\b[^"']*\1/i.test(html);
    const total = hasMore ? offset + data.length + requestedLimit : offset + data.length;

    return { data, total, offset, limit: requestedLimit };
  }

  async getManga(id: string): Promise<any> {
    const html = await this.fetchHtml(`series/${encodeURIComponent(id)}`);
    const canonical = extractCanonicalUrl(html);
    const resolvedId = (canonical && extractSeriesId(canonical)) || id;
    const coverUrl = this.rememberImageUrl(extractFirstSourceUrl(html));
    const title =
      firstElementText(html, 'h1') ||
      extractMetaContent(html, 'og:title') ||
      extractDocumentTitle(html) ||
      `WeebCentral ${resolvedId}`;
    const description = firstElementTextByClass(html, 'whitespace-pre-wrap');

    const authorItem = extractLabeledListItem(html, /^Author\(s\):/i);
    const tagItem = extractLabeledListItem(html, /^Tags?\(s\):/i);
    const statusItem = extractLabeledListItem(html, /^Status:/i);
    const releasedItem = extractLabeledListItem(html, /^Released:/i);

    const authors = authorItem ? extractAnchorTexts(authorItem) : [];
    const tags = tagItem ? extractAnchorTexts(tagItem) : [];
    const statusTexts = statusItem ? extractAnchorTexts(statusItem) : [];
    const releasedText = releasedItem ? stripTags(releasedItem) : '';
    const yearMatch = releasedText.match(/\b(19|20)\d{2}\b/);

    return toMangaShape({
      id: resolvedId,
      title,
      coverUrl,
      description,
      authors,
      tags,
      status: statusTexts[0],
      year: yearMatch ? Number(yearMatch[0]) : null,
    });
  }

  private parseChapters(html: string, mangaId?: string): ParsedChapter[] {
    const chapters: ParsedChapter[] = [];
    const regex = /<a\b([^>]*\bhref\s*=\s*(["'])([^"']*\/chapters\/[^"']+)\2[^>]*)>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    const seen = new Set<string>();

    while ((match = regex.exec(html))) {
      const href = decodeHtml(match[3]);
      const id = extractChapterId(href);
      if (!id || seen.has(id)) continue;

      const content = match[4];
      const text = stripTags(content);
      // WeebCentral is not consistent about the release label across series.
      // Depending on the title it may render "Chapter 214", "Volume 6",
      // "Page 115", or only "# 214". The old parser required the words
      // Chapter/Episode/Volume, which made valid series appear to have 0 chapters.
      // Prefer a named release label when WeebCentral provides one. Some
      // series use nonstandard names such as "Scene 155" (Claymore), while
      // others use Chapter, Episode, Volume, Page, Act, Story, Issue, etc.
      // Normalize every non-volume label to a normal chapter for the frontend.
      const explicitMatch = text.match(
        /\b(Chapter|Episode|Volume|Page|Scene|Act|Story|Issue|Case|Part|Lesson)\s*(?:#|No\.?)?\s*([0-9]+(?:\.[0-9]+)?(?:-[0-9]+(?:\.[0-9]+)?)?)/i,
      );
      const hashMatch = !explicitMatch
        ? text.match(/(?:^|\s)#\s*([0-9]+(?:\.[0-9]+)?(?:-[0-9]+(?:\.[0-9]+)?)?)/)
        : null;
      const leadingNumberMatch = !explicitMatch && !hashMatch
        ? text.match(/^\s*([0-9]+(?:\.[0-9]+)?(?:-[0-9]+(?:\.[0-9]+)?)?)(?:\s|$)/)
        : null;
      // Last-resort fallback: chapter anchors normally put the release number
      // before their timestamp. This keeps a new label from turning a valid
      // series into a fake 0-chapter result while still requiring a numeric
      // release token inside an actual /chapters/ link.
      const firstNumberMatch = !explicitMatch && !hashMatch && !leadingNumberMatch
        ? text.match(/(?:^|\s)([0-9]+(?:\.[0-9]+)?(?:-[0-9]+(?:\.[0-9]+)?)?)(?=\s|$)/)
        : null;
      if (!explicitMatch && !hashMatch && !leadingNumberMatch && !firstNumberMatch) continue;

      const label = explicitMatch ? explicitMatch[1].toLowerCase() : 'chapter';
      const kind: 'chapter' | 'episode' | 'volume' | 'page' =
        label === 'volume' ? 'volume' : label === 'episode' ? 'episode' : label === 'page' ? 'page' : 'chapter';
      const number = explicitMatch
        ? explicitMatch[2]
        : hashMatch
          ? hashMatch[1]
          : leadingNumberMatch
            ? leadingNumberMatch[1]
            : firstNumberMatch![1];
      const timeTag = firstTag(content, 'time', (tag) => !!getAttr(tag, 'datetime'));
      const publishedAt = timeTag ? getAttr(timeTag, 'datetime') : undefined;
      seen.add(id);
      chapters.push({ id, number, kind, publishedAt, mangaId });
    }

    return chapters;
  }

  private rememberChapterList(mangaId: string, chapters: ParsedChapter[]): void {
    if (!this.chapterListCache.has(mangaId) && this.chapterListCache.size >= this.chapterListCacheMaxEntries) {
      const oldestKey = this.chapterListCache.keys().next().value as string | undefined;
      if (oldestKey) this.chapterListCache.delete(oldestKey);
    }
    this.chapterListCache.delete(mangaId);
    this.chapterListCache.set(mangaId, {
      expiresAt: Date.now() + this.chapterListCacheTtlMs,
      chapters,
    });
  }

  private async loadChapterList(mangaId: string): Promise<ParsedChapter[]> {
    const cached = this.chapterListCache.get(mangaId);
    if (cached && cached.expiresAt > Date.now()) {
      // Refresh insertion order so frequently browsed series stay cached.
      this.chapterListCache.delete(mangaId);
      this.chapterListCache.set(mangaId, cached);
      return cached.chapters;
    }
    if (cached) this.chapterListCache.delete(mangaId);

    const html = await this.fetchHtml(`series/${encodeURIComponent(mangaId)}/full-chapter-list`);
    const chapters = this.parseChapters(html, mangaId);

    // Do not silently cache a parser failure as a genuine empty series. If the
    // upstream response contains reader links but none can be normalized, make
    // the mismatch visible so a changed WeebCentral label can be fixed quickly.
    if (!chapters.length && /\/chapters\//i.test(html)) {
      throw new Error(`WeebCentral chapter parser found reader links but could not parse release labels for ${mangaId}`);
    }

    this.rememberChapterList(mangaId, chapters);
    return chapters;
  }

  async getChapters(mangaId: string, params: URLSearchParams): Promise<ProviderListResponse> {
    // WeebCentral exposes a full chapter-list document. Parse it once on the
    // server, cache the compact metadata, and send only the requested slice
    // to the client. This is especially important for 500-1000+ chapter series.
    const all = (await this.loadChapterList(mangaId)).slice();
    const direction = (params.get('order[chapter]') || 'desc').toLowerCase();

    all.sort((a, b) => {
      const delta = chapterSortValue(a.number) - chapterSortValue(b.number);
      if (delta !== 0) return direction === 'asc' ? delta : -delta;
      return direction === 'asc' ? a.number.localeCompare(b.number) : b.number.localeCompare(a.number);
    });

    const offset = Math.max(0, Number(params.get('offset') || 0) || 0);
    const limit = Math.max(1, Math.min(100, Number(params.get('limit') || 40) || 40));
    return {
      data: all.slice(offset, offset + limit).map(toChapterShape),
      total: all.length,
    };
  }

  async getChapter(chapterId: string): Promise<any> {
    const html = await this.fetchHtml(`chapters/${encodeURIComponent(chapterId)}`);
    const text = stripTags(html);
    const explicitMatch = text.match(
      /\b(Chapter|Episode|Volume|Page|Scene|Act|Story|Issue|Case|Part|Lesson)\s*(?:#|No\.?)?\s*([0-9]+(?:\.[0-9]+)?)/i,
    );
    const hashMatch = !explicitMatch ? text.match(/(?:^|\s)#\s*([0-9]+(?:\.[0-9]+)?)/) : null;
    const firstNumberMatch = !explicitMatch && !hashMatch
      ? text.match(/(?:^|\s)([0-9]+(?:\.[0-9]+)?)(?=\s|$)/)
      : null;
    const seriesHref = extractFirstSeriesHref(html);
    const mangaId = seriesHref ? extractSeriesId(seriesHref) : undefined;
    const label = explicitMatch ? explicitMatch[1].toLowerCase() : 'chapter';
    const kind: 'chapter' | 'episode' | 'volume' | 'page' =
      label === 'volume' ? 'volume' : label === 'episode' ? 'episode' : label === 'page' ? 'page' : 'chapter';

    return toChapterShape({
      id: chapterId,
      number: explicitMatch ? explicitMatch[2] : hashMatch ? hashMatch[1] : firstNumberMatch ? firstNumberMatch[1] : '',
      kind,
      mangaId,
    });
  }

  async getChapterPages(chapterId: string): Promise<ProviderChapterPagesResponse> {
    const path = `chapters/${encodeURIComponent(chapterId)}/images?is_prev=False&current_page=1&reading_style=long_strip`;
    const html = await this.fetchHtml(path, { Referer: this.baseUrl });
    const pages: string[] = [];
    const seen = new Set<string>();
    const regex = /<img\b[^>]*>/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(html))) {
      const src = getAttr(match[0], 'src');
      const normalized = this.rememberImageUrl(src);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        pages.push(normalized);
      }
    }

    if (!pages.length) {
      throw new Error(`WeebCentral returned no chapter images for ${chapterId}`);
    }

    return { result: 'ok', pages, dataSaverPages: [] };
  }

  isAllowedImageUrl(url: URL): boolean {
    return (
      url.protocol === 'https:' &&
      this.isSafeRemoteHost(url.hostname) &&
      this.seenImageHosts.has(url.hostname.toLowerCase())
    );
  }

  getImageRequestHeaders(_url: URL): Record<string, string> {
    const cookie = this.cookieHeader();
    return {
      Referer: this.baseUrl,
      'Cache-Control': 'max-age=604800',
      ...(cookie ? { Cookie: cookie } : {}),
    };
  }
}
