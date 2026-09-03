import * as cheerio from 'cheerio';
import type {
  MangaProvider,
  ProviderChapterPagesResponse,
  ProviderListResponse,
  ProviderSearchResponse,
} from './types';

// Adapter inspired by minhduc1212/Crawl_Comic. That project is a downloader/userscript,
// not a REST API, so this provider ports its HTML extraction strategy into the app's
// provider-neutral contract. TruyenQQ is used as the default Crawl_Comic source.
const DEFAULT_BASE_URL = 'https://truyenqq.com.vn';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = { expiresAt: number; html: string };

function makeTag(name: string, index: number): any {
  return {
    id: `crawlcomic-tag-${index}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    type: 'tag',
    attributes: { name: { en: name }, description: {}, group: 'genre', version: 1 },
  };
}

function mangaShape(input: {
  id: string;
  title: string;
  coverUrl?: string;
  description?: string;
  author?: string;
  status?: string;
  tags?: string[];
}): any {
  const now = new Date().toISOString();
  const relationships: any[] = [];
  if (input.coverUrl) {
    relationships.push({
      id: `crawlcomic-cover-${input.id}`,
      type: 'cover_art',
      attributes: { url: input.coverUrl, coverUrl: input.coverUrl },
    });
  }
  if (input.author) {
    relationships.push({
      id: `crawlcomic-author-${input.author.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      type: 'author',
      attributes: { name: input.author },
    });
  }
  const statusText = String(input.status || '').toLowerCase();
  const status = /hoan|complete|finished/.test(statusText) ? 'completed' : 'ongoing';
  return {
    id: input.id,
    type: 'manga',
    attributes: {
      title: { vi: input.title || 'Untitled Manga', en: input.title || 'Untitled Manga' },
      altTitles: [],
      description: input.description ? { vi: input.description, en: input.description } : {},
      isLocked: false,
      links: {},
      originalLanguage: 'vi',
      lastVolume: null,
      lastChapter: null,
      publicationDemographic: null,
      status,
      year: null,
      contentRating: 'safe',
      tags: (input.tags || []).map(makeTag),
      state: 'published',
      chapterNumbersResetOnNewVolume: false,
      createdAt: now,
      updatedAt: now,
      version: 1,
      availableTranslatedLanguages: ['vi'],
      latestUploadedChapter: null,
    },
    relationships,
  };
}

function chapterShape(id: string, mangaId: string | undefined, chapter: string, title?: string): any {
  const now = new Date().toISOString();
  return {
    id,
    type: 'chapter',
    attributes: {
      title: title || null,
      volume: null,
      chapter: chapter || '0',
      pages: 0,
      translatedLanguage: 'vi',
      uploader: null,
      externalUrl: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      publishAt: now,
      readableAt: now,
    },
    relationships: mangaId ? [{ id: mangaId, type: 'manga' }] : [],
  };
}

function encodeChapterPath(pathname: string): string {
  return `cc_${Buffer.from(pathname.replace(/^\/+/, ''), 'utf8').toString('base64url')}`;
}

function decodeChapterPath(value: string): string {
  const raw = String(value || '');
  if (raw.startsWith('cc_')) {
    try {
      return `/${Buffer.from(raw.slice(3), 'base64url').toString('utf8').replace(/^\/+/, '')}`;
    } catch (_error) {}
  }
  if (/\/chapter-/i.test(raw)) return `/${raw.replace(/^\/+/, '')}`;
  throw new Error('Invalid CrawlComic chapter id');
}

function chapterNumberFromPath(pathname: string, text = ''): string {
  return (
    pathname.match(/chapter[-_/]?(\d+(?:[.-]\d+)?)/i)?.[1]?.replace('-', '.') ||
    text.match(/(?:chapter|chap|chuong|chương)\s*(\d+(?:\.\d+)?)/i)?.[1] ||
    '0'
  );
}

export class CrawlComicProvider implements MangaProvider {
  readonly key = 'crawlcomic';
  readonly displayName = 'CrawlComic / TruyenQQ';

  private readonly baseUrl: string;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly seenImageHosts = new Set<string>();

  constructor(baseUrl = process.env.CRAWL_COMIC_BASE_URL || DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private absoluteUrl(value?: string): string | undefined {
    if (!value) return undefined;
    try {
      return new URL(value, `${this.baseUrl}/`).toString();
    } catch (_error) {
      return undefined;
    }
  }

  private rememberImageUrl(value?: string): string | undefined {
    const absolute = this.absoluteUrl(value);
    if (!absolute) return undefined;
    try {
      const parsed = new URL(absolute);
      if (!/^https?:$/.test(parsed.protocol)) return undefined;
      this.seenImageHosts.add(parsed.hostname.toLowerCase());
      return parsed.toString();
    } catch (_error) {
      return undefined;
    }
  }

  private async fetchPage(pathOrUrl: string, useCache = true): Promise<cheerio.CheerioAPI> {
    const url = new URL(pathOrUrl, `${this.baseUrl}/`).toString();
    const cached = this.cache.get(url);
    if (useCache && cached && cached.expiresAt > Date.now()) return cheerio.load(cached.html);
    if (cached) this.cache.delete(url);

    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.6,en;q=0.5',
        Referer: `${this.baseUrl}/`,
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`CrawlComic source returned HTTP ${response.status}: ${body.slice(0, 220)}`);
    }
    const html = await response.text();
    if (useCache) this.cache.set(url, { expiresAt: Date.now() + CACHE_TTL_MS, html });
    return cheerio.load(html);
  }

  private isMangaPath(pathname: string): boolean {
    const path = pathname.replace(/^\/+|\/+$/g, '');
    if (!path || path.includes('/')) return false;
    return !/^(the-loai|tim-kiem|search|dang-nhap|dang-ky|lien-he|tos|group|fanpage|lich-su|theo-doi|xep-hang|api|assets?|images?|uploads?)$/i.test(path);
  }

  private extractCards($: cheerio.CheerioAPI): Array<{ id: string; title: string; coverUrl?: string }> {
    const results: Array<{ id: string; title: string; coverUrl?: string }> = [];
    const seen = new Set<string>();
    $('a[href]').each((_index, element) => {
      const anchor = $(element);
      const href = anchor.attr('href') || '';
      let parsed: URL;
      try {
        parsed = new URL(href, `${this.baseUrl}/`);
      } catch (_error) {
        return;
      }
      if (!this.isMangaPath(parsed.pathname)) return;
      const id = parsed.pathname.replace(/^\/+|\/+$/g, '');
      if (!id || seen.has(id)) return;

      const img = anchor.find('img').first();
      const title = (
        anchor.attr('title') ||
        img.attr('alt') ||
        anchor.find('h1,h2,h3,h4,.title,.name').first().text() ||
        anchor.text()
      )
        .replace(/\s+/g, ' ')
        .trim();
      if (!title || title.length < 2 || title.length > 220) return;
      // A real manga card normally has an image or a title heading. This avoids nav/footer links.
      if (!img.length && !anchor.find('h1,h2,h3,h4,.title,.name').length) return;

      const coverUrl = this.rememberImageUrl(
        img.attr('data-src') || img.attr('data-original') || img.attr('data-lazy-src') || img.attr('src'),
      );
      seen.add(id);
      results.push({ id, title, coverUrl });
    });
    return results;
  }

  async search(params: URLSearchParams): Promise<ProviderSearchResponse> {
    const title = (params.get('title') || '').trim();
    const limit = Math.max(1, Math.min(24, Number(params.get('limit') || 20) || 20));
    const offset = Math.max(0, Number(params.get('offset') || 0) || 0);
    const page = Math.floor(offset / limit) + 1;

    const candidates = title
      ? [
          `/tim-kiem?keyword=${encodeURIComponent(title)}&page=${page}`,
          `/tim-kiem?q=${encodeURIComponent(title)}&page=${page}`,
          `/search?keyword=${encodeURIComponent(title)}&page=${page}`,
          `/search?q=${encodeURIComponent(title)}&page=${page}`,
          `/?s=${encodeURIComponent(title)}&page=${page}`,
        ]
      : [`/?page=${page}`];

    let cards: Array<{ id: string; title: string; coverUrl?: string }> = [];
    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        const $ = await this.fetchPage(candidate, true);
        const extracted = this.extractCards($);
        if (title) {
          const needle = title.toLocaleLowerCase('vi');
          cards = extracted.filter((item) => item.title.toLocaleLowerCase('vi').includes(needle));
          if (!cards.length) cards = extracted;
        } else {
          cards = extracted;
        }
        if (cards.length) break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!cards.length && lastError) throw lastError;

    const data = cards.slice(0, limit).map((item) => mangaShape(item));
    return { data, total: offset + data.length + (data.length === limit ? limit : 0), offset, limit };
  }

  async getManga(idRaw: string): Promise<any> {
    const id = String(idRaw || '').replace(/^\/+|\/+$/g, '');
    if (!this.isMangaPath(`/${id}`)) throw new Error('Invalid CrawlComic manga id');
    const $ = await this.fetchPage(`/${id}`);
    const title = $('h1').first().text().replace(/\s+/g, ' ').trim() || $('title').text().split('|')[0].trim();
    if (!title) throw new Error(`CrawlComic manga ${id} was not found`);

    let coverUrl: string | undefined;
    const coverSelectors = [
      '.book_avatar img', '.book-info img', '.story-detail img', '.detail-info img', '.manga-info img',
      'img[itemprop="image"]', 'meta[property="og:image"]', 'img',
    ];
    for (const selector of coverSelectors) {
      const node = $(selector).first();
      const raw = node.is('meta')
        ? node.attr('content')
        : node.attr('data-src') || node.attr('data-original') || node.attr('src');
      if (raw && !/logo|icon|avatar/i.test(raw)) {
        coverUrl = this.rememberImageUrl(raw);
        if (coverUrl) break;
      }
    }

    const bodyText = $('body').text().replace(/\s+/g, ' ');
    const author = bodyText.match(/T[aá]c gi[aả]\s*:?\s*([^\n|]{2,80}?)(?=Tr[aạ]ng th[aá]i|Th[eể] lo[aạ]i|Lượt view|Cập nhật|$)/i)?.[1]?.trim();
    const status = bodyText.match(/Tr[aạ]ng th[aá]i\s*:?\s*([^\n|]{2,40}?)(?=Lượt view|Th[eể] lo[aạ]i|Cập nhật|$)/i)?.[1]?.trim();

    let description = '';
    const descSelectors = ['.story-detail-info', '.detail-content', '.story-detail-content', '.summary', '.description', '[itemprop="description"]'];
    for (const selector of descSelectors) {
      const candidate = $(selector).first().text().replace(/\s+/g, ' ').trim();
      if (candidate.length > 40) { description = candidate; break; }
    }
    if (!description) {
      $('p').each((_i, el) => {
        const candidate = $(el).text().replace(/\s+/g, ' ').trim();
        if (candidate.length > description.length && candidate.length > 80) description = candidate;
      });
    }

    const tags: string[] = [];
    $('a[href*="/the-loai/"]').each((_i, el) => {
      const value = $(el).text().trim();
      if (value && !tags.includes(value)) tags.push(value);
    });

    return mangaShape({ id, title, coverUrl, description: description || undefined, author, status, tags });
  }

  async getChapters(mangaIdRaw: string, params: URLSearchParams): Promise<ProviderListResponse> {
    const mangaId = String(mangaIdRaw || '').replace(/^\/+|\/+$/g, '');
    if (!this.isMangaPath(`/${mangaId}`)) throw new Error('Invalid CrawlComic manga id');
    const $ = await this.fetchPage(`/${mangaId}`);
    const chapters: any[] = [];
    const seen = new Set<string>();

    // Crawl_Comic uses `.works-chapter-list a` on TruyenQQ. Keep that selector,
    // plus newer/current layouts seen on Vietnamese reader mirrors.
    const selectors = [
      '.works-chapter-list a[href]', '.list-chapter a[href]', '.list_chapter a[href]', '#list-chapter a[href]',
      '#chapterList a[href]', '.chapter-list a[href]', 'a[href*="/chapter-"]',
    ];
    $(selectors.join(',')).each((_index, element) => {
      const anchor = $(element);
      const href = anchor.attr('href') || '';
      let parsed: URL;
      try { parsed = new URL(href, `${this.baseUrl}/`); } catch (_error) { return; }
      if (!parsed.pathname.startsWith(`/${mangaId}/`) || !/\/chapter-/i.test(parsed.pathname)) return;
      const id = encodeChapterPath(parsed.pathname);
      if (seen.has(id)) return;
      seen.add(id);
      const text = anchor.text().replace(/\s+/g, ' ').trim();
      const number = chapterNumberFromPath(parsed.pathname, text);
      chapters.push(chapterShape(id, mangaId, number, text || `Chapter ${number}`));
    });

    const order = String(params.get('order[chapter]') || 'desc').toLowerCase();
    // Most TruyenQQ lists are newest first. Reverse only when caller requests ascending.
    if (order === 'asc') chapters.reverse();
    const total = chapters.length;
    const limit = Math.max(1, Math.min(100, Number(params.get('limit') || 40) || 40));
    const offset = Math.max(0, Number(params.get('offset') || 0) || 0);
    return { data: chapters.slice(offset, offset + limit), total };
  }

  async getChapter(chapterIdRaw: string): Promise<any> {
    const pathname = decodeChapterPath(chapterIdRaw);
    const $ = await this.fetchPage(pathname);
    const parts = pathname.replace(/^\/+/, '').split('/');
    const mangaId = parts[0] || undefined;
    const title = $('h1').first().text().replace(/\s+/g, ' ').trim() || $('title').text().split('|')[0].trim();
    return chapterShape(encodeChapterPath(pathname), mangaId, chapterNumberFromPath(pathname, title), title || undefined);
  }

  async getChapterPages(chapterIdRaw: string): Promise<ProviderChapterPagesResponse> {
    const pathname = decodeChapterPath(chapterIdRaw);
    const $ = await this.fetchPage(pathname, false);
    const pages: string[] = [];
    const seen = new Set<string>();
    const add = (raw?: string) => {
      const url = this.rememberImageUrl(raw);
      if (!url || seen.has(url) || /logo|icon|avatar|banner|ads?\b/i.test(url)) return;
      seen.add(url);
      pages.push(url);
    };

    // Ported from Crawl_Comic: TruyenQQ used `.chapter_content`; the userscript then
    // reads data-src/data-original/src. Extra selectors make it work with newer mirrors.
    const containers = [
      '.chapter_content', '.chapter-content', '#chapter_content', '.reading-detail', '.reading-content',
      '.box-chapter-content', '.list-images', '#content_chap', '.read_content', '.chapter-reading',
    ];
    const root = $(containers.join(','));
    const images = root.length ? root.find('img') : $('img');
    images.each((_index, element) => {
      const img = $(element);
      add(
        img.attr('data-src') ||
        img.attr('data-original') ||
        img.attr('data-lazy-src') ||
        img.attr('data-url') ||
        img.attr('src'),
      );
    });

    if (!pages.length) throw new Error(`CrawlComic chapter ${chapterIdRaw} has no readable page images`);
    return { result: 'ok', pages, dataSaverPages: pages.slice() };
  }

  isAllowedImageUrl(url: URL): boolean {
    if (!/^https?:$/.test(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    const baseHost = new URL(this.baseUrl).hostname.toLowerCase();
    return this.seenImageHosts.has(host) || host === baseHost || host.endsWith(`.${baseHost}`);
  }

  getImageRequestHeaders(_url: URL): Record<string, string> {
    return {
      Referer: `${this.baseUrl}/`,
      Origin: this.baseUrl,
      'User-Agent': USER_AGENT,
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.6,en;q=0.5',
    };
  }
}
