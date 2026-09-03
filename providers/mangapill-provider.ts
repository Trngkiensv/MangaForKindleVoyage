import * as cheerio from 'cheerio';
import type {
  MangaProvider,
  ProviderChapterPagesResponse,
  ProviderListResponse,
  ProviderSearchResponse,
} from './types';

const DEFAULT_BASE_URL = 'https://mangapill.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

type MangaCard = {
  id: string;
  title: string;
  imageUrl?: string;
  status?: string;
  year?: string;
};

type ChapterInfo = {
  chapterNumber: string;
  chapterTitle?: string;
  chapterUrl: string;
  releaseDate?: string;
};

type CacheEntry = { expiresAt: number; html: string };

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
  year?: string;
  tags?: string[];
  altTitles?: string[];
}): any {
  const now = new Date().toISOString();
  const relationships: any[] = [];
  if (input.coverUrl) {
    relationships.push({
      id: `mangapill-cover-${input.id}`,
      type: 'cover_art',
      attributes: { url: input.coverUrl, coverUrl: input.coverUrl },
    });
  }

  return {
    id: input.id,
    type: 'manga',
    attributes: {
      title: { en: input.title || 'Untitled Manga' },
      altTitles: (input.altTitles || []).map((title) => ({ en: title })),
      description: input.description ? { en: input.description } : {},
      isLocked: false,
      links: {},
      originalLanguage: 'en',
      lastVolume: null,
      lastChapter: null,
      publicationDemographic: null,
      status: normalizeStatus(input.status),
      year: input.year ? Number(input.year) || null : null,
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

function toChapterShape(id: string, mangaId: string | undefined, number: string, title?: string): any {
  const now = new Date().toISOString();
  const relationships: any[] = mangaId ? [{ id: mangaId, type: 'manga' }] : [];
  return {
    id,
    type: 'chapter',
    attributes: {
      title: title || null,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractChapterId(rawUrl: string): string | undefined {
  const match = rawUrl.match(/\/chapters\/([^/?#]+)/i);
  return match?.[1];
}

export class MangaPillProvider implements MangaProvider {
  readonly key = 'mangapill';
  readonly displayName = 'MangaPill (manga-scraper)';

  private readonly baseUrl: string;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly seenImageHosts = new Set<string>();

  constructor(baseUrl = process.env.MANGAPILL_BASE_URL || DEFAULT_BASE_URL) {
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

  private async fetchPage(path: string, useCache = true): Promise<cheerio.CheerioAPI> {
    const url = new URL(path, `${this.baseUrl}/`).toString();
    if (useCache) {
      const cached = this.cache.get(url);
      if (cached && cached.expiresAt > Date.now()) return cheerio.load(cached.html);
      if (cached) this.cache.delete(url);
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await fetch(url, {
          redirect: 'follow',
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            DNT: '1',
            'Cache-Control': 'max-age=0',
          },
        });
        if (!response.ok) {
          const body = await response.text();
          const error = new Error(`MangaPill returned HTTP ${response.status}: ${body.slice(0, 240)}`);
          if (response.status >= 400 && response.status < 500) throw error;
          lastError = error;
        } else {
          const html = await response.text();
          if (useCache) this.cache.set(url, { expiresAt: Date.now() + CACHE_TTL_MS, html });
          return cheerio.load(html);
        }
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (/HTTP 4\d\d/.test(message)) throw error;
      }
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
    }
    throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
  }

  private extractMangaCards($: cheerio.CheerioAPI): MangaCard[] {
    const cards: MangaCard[] = [];
    const seen = new Set<string>();

    $('a[href*="/manga/"]').each((_index, element) => {
      const anchor = $(element);
      const href = anchor.attr('href') || '';
      const id = href.match(/\/manga\/(\d+)(?:\/|$)/)?.[1];
      if (!id || seen.has(id)) return;

      const title = (anchor.attr('title') || anchor.find('div').first().text() || anchor.text()).trim();
      if (!title) return;

      const img = anchor.find('img').first();
      const imageUrl = this.rememberImageUrl(img.attr('src') || img.attr('data-src'));
      const infoText = anchor.find('div, span').last().text();
      const year = infoText.match(/\b\d{4}\b/)?.[0];
      const status = infoText.match(/publishing|ongoing|finished|completed|hiatus/i)?.[0];

      seen.add(id);
      cards.push({ id, title, imageUrl, year, status });
    });

    return cards;
  }

  private extractMetadata($: cheerio.CheerioAPI, label: string): string | undefined {
    let value: string | undefined;
    $('div, span, p, td, th').each((_index, element) => {
      const text = $(element).text();
      const match = text.match(new RegExp(`${label}\\s*:?\\s*([^\\n]+)`, 'i'));
      if (match) {
        value = match[1].trim();
        return false;
      }
      return undefined;
    });
    return value;
  }

  private extractChapters($: cheerio.CheerioAPI): ChapterInfo[] {
    const chapters: ChapterInfo[] = [];
    const seen = new Set<string>();

    $('a[href*="/chapters/"]').each((_index, element) => {
      const anchor = $(element);
      const href = anchor.attr('href') || '';
      const chapterId = extractChapterId(href);
      if (!chapterId || seen.has(chapterId)) return;

      const text = anchor.text().trim();
      const chapterNumber =
        href.match(/chapter-(\d+(?:\.\d+)?)/i)?.[1] ||
        text.match(/chapter\s*(\d+(?:\.\d+)?)/i)?.[1] ||
        chapterId.match(/-(\d+)(?:$|-)/)?.[1] ||
        '0';
      const dateText = anchor.find('time, .date').text().trim() || anchor.next('time, .date').text().trim();

      seen.add(chapterId);
      chapters.push({
        chapterNumber,
        chapterTitle: text || undefined,
        chapterUrl: this.absoluteUrl(href) || href,
        releaseDate: dateText || undefined,
      });
    });

    return chapters;
  }

  async search(params: URLSearchParams): Promise<ProviderSearchResponse> {
    const title = (params.get('title') || '').trim();
    const limit = Math.max(1, Math.min(24, Number(params.get('limit') || 20) || 20));
    const offset = Math.max(0, Number(params.get('offset') || 0) || 0);
    const page = Math.floor(offset / limit) + 1;
    const path = title
      ? `/search?q=${encodeURIComponent(title)}&page=${page}`
      : `/mangas/new?page=${page}`;
    const $ = await this.fetchPage(path);
    const all = this.extractMangaCards($);
    const data = all.slice(0, limit).map((manga) =>
      toMangaShape({
        id: manga.id,
        title: manga.title,
        coverUrl: manga.imageUrl,
        status: manga.status,
        year: manga.year,
      }),
    );

    const totalText = $('.total-results, .result-count').text();
    const explicitTotal = Number(totalText.match(/\d+/)?.[0] || 0);
    const lastPage = Number($('.pagination a').last().text().trim() || 0);
    const total = explicitTotal || (lastPage ? lastPage * limit : offset + data.length);
    return { data, total, offset, limit };
  }

  async getManga(idRaw: string): Promise<any> {
    const id = String(idRaw).match(/\d+/)?.[0];
    if (!id) throw new Error('Invalid MangaPill manga id');
    const $ = await this.fetchPage(`/manga/${id}`);
    const title = $('h1').first().text().trim();
    if (!title) throw new Error(`MangaPill manga ${id} was not found`);

    const altTitles: string[] = [];
    $('div, p, span').each((_index, element) => {
      const match = $(element).text().match(/Alternative.*?:(.+?)(?:\n|$)/i);
      if (match) altTitles.push(...match[1].split(',').map((item) => item.trim()).filter(Boolean));
    });

    let description = '';
    const descriptionSelectors = ['p.description', '.description', 'div.summary', '.synopsis', 'p[itemprop="description"]'];
    for (const selector of descriptionSelectors) {
      const candidate = $(selector).first().text().trim();
      if (candidate.length > 50) {
        description = candidate;
        break;
      }
    }
    if (!description) {
      $('p').each((_index, element) => {
        const candidate = $(element).text().trim();
        if (candidate.length > description.length && candidate.length > 100) description = candidate;
      });
    }

    let coverUrl: string | undefined;
    const safeTitle = title.replace(/["\\]/g, '');
    const coverSelectors = [`img[alt*="${safeTitle}"]`, '.manga-cover img', '.cover img', 'img[src*="cover"]', 'img'];
    for (const selector of coverSelectors) {
      const img = $(selector).first();
      const candidate = img.attr('src') || img.attr('data-src');
      if (candidate && !candidate.includes('logo') && !candidate.includes('icon')) {
        coverUrl = this.rememberImageUrl(candidate);
        if (coverUrl) break;
      }
    }

    const genres: string[] = [];
    $('a[href*="/search?genre="], .genre, .tag, a[href*="/genre/"]').each((_index, element) => {
      const genre = $(element).text().trim();
      if (genre && !genres.includes(genre)) genres.push(genre);
    });

    return toMangaShape({
      id,
      title,
      coverUrl,
      description: description || undefined,
      status: this.extractMetadata($, 'Status'),
      year: this.extractMetadata($, 'Year'),
      tags: genres,
      altTitles,
    });
  }

  async getChapters(mangaIdRaw: string, params: URLSearchParams): Promise<ProviderListResponse> {
    const mangaId = String(mangaIdRaw).match(/\d+/)?.[0];
    if (!mangaId) throw new Error('Invalid MangaPill manga id');
    const $ = await this.fetchPage(`/manga/${mangaId}`);
    const chapters = this.extractChapters($).map((chapter) => {
      const chapterId = extractChapterId(chapter.chapterUrl);
      return toChapterShape(chapterId || chapter.chapterUrl, mangaId, chapter.chapterNumber, chapter.chapterTitle);
    });

    const order = String(params.get('order[chapter]') || 'desc').toLowerCase();
    if (order === 'asc') chapters.reverse();
    const total = chapters.length;
    const limit = Math.max(1, Math.min(100, Number(params.get('limit') || 40) || 40));
    const offset = Math.max(0, Number(params.get('offset') || 0) || 0);
    return { data: chapters.slice(offset, offset + limit), total };
  }

  async getChapter(chapterIdRaw: string): Promise<any> {
    const chapterId = extractChapterId(chapterIdRaw) || String(chapterIdRaw).replace(/^\/+|\/+$/g, '');
    if (!chapterId) throw new Error('Invalid MangaPill chapter id');
    const $ = await this.fetchPage(`/chapters/${chapterId}`);
    const title = $('h1, .chapter-title, .reader-title, title').first().text().trim();
    const number = title.match(/chapter\s*(\d+(?:\.\d+)?)/i)?.[1] || chapterId.split('-').pop() || '0';
    return toChapterShape(chapterId, undefined, number, title || undefined);
  }

  async getChapterPages(chapterIdRaw: string): Promise<ProviderChapterPagesResponse> {
    const chapterId = extractChapterId(chapterIdRaw) || String(chapterIdRaw).replace(/^\/+|\/+$/g, '');
    if (!chapterId) throw new Error('Invalid MangaPill chapter id');
    const $ = await this.fetchPage(`/chapters/${chapterId}`);
    const pages: string[] = [];
    const seen = new Set<string>();

    const addPage = (raw?: string) => {
      const imageUrl = this.rememberImageUrl(raw);
      if (!imageUrl || seen.has(imageUrl)) return;
      if (/logo|icon|avatar/i.test(imageUrl)) return;
      seen.add(imageUrl);
      pages.push(imageUrl);
    };

    // These selectors mirror manga-scraper's ChapterExtractor.extractPages.
    $('img[src*="cdn"], .reader img, #chapter-container img, picture img, .page-img, img.js-page').each(
      (_index, element) => {
        const image = $(element);
        addPage(image.attr('src') || image.attr('data-src'));
      },
    );

    // Keep the upstream scraper's JavaScript-array fallback for reader markup changes.
    if (!pages.length) {
      const patterns = [
        /images\s*=\s*(\[[\s\S]+?\])/,
        /pages\s*=\s*(\[[\s\S]+?\])/,
        /chapter_images\s*=\s*(\[[\s\S]+?\])/,
      ];
      const scripts = $('script').toArray();
      outer: for (const script of scripts) {
        const scriptContent = $(script).html() || '';
        for (const pattern of patterns) {
          const match = scriptContent.match(pattern);
          if (!match) continue;
          try {
            const values = JSON.parse(match[1]);
            if (Array.isArray(values)) values.forEach((value) => typeof value === 'string' && addPage(value));
          } catch (_error) {}
          if (pages.length) break outer;
        }
      }
    }

    if (!pages.length) throw new Error(`MangaPill chapter ${chapterId} has no readable page images`);
    return { result: 'ok', pages, dataSaverPages: pages.slice() };
  }

  isAllowedImageUrl(url: URL): boolean {
    if (!/^https?:$/.test(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    return this.seenImageHosts.has(host) || host.endsWith('.mangapill.com') || host === 'mangapill.com';
  }

  getImageRequestHeaders(_url: URL): Record<string, string> {
    return {
      Referer: `${this.baseUrl}/`,
      'User-Agent': USER_AGENT,
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      DNT: '1',
    };
  }
}
