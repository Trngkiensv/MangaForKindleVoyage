export interface SimpleManga {
  id: string;
  title: string;
  coverUrl?: string;
  description?: string;
  status?: string;
  tags?: string[];
  year?: number | null;
  authors?: string[];
}

export interface SimpleChapter {
  id: string;
  number: string;
  title?: string | null;
  publishedAt?: string;
  mangaId?: string;
}

export function decodeHtml(value: string): string {
  return String(value || '')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

export function stripTags(value: string): string {
  return decodeHtml(String(value || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function getAttr(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const quoted = new RegExp(`\\b${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(tag);
  if (quoted) return decodeHtml(quoted[2].trim());
  const bare = new RegExp(`\\b${escaped}\\s*=\\s*([^\\s>]+)`, 'i').exec(tag);
  return bare ? decodeHtml(bare[1].trim()) : undefined;
}

export function firstMeta(html: string, key: string): string | undefined {
  const regex = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    const tag = match[0];
    const name = (getAttr(tag, 'property') || getAttr(tag, 'name') || '').toLowerCase();
    if (name === key.toLowerCase()) return getAttr(tag, 'content');
  }
  return undefined;
}

export function normalizeStatus(status?: string): string {
  const value = String(status || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (value === 'ongoing' || value === 'releasing' || value === 'publishing') return 'ongoing';
  if (value === 'complete' || value === 'completed' || value === 'finished') return 'completed';
  if (value === 'hiatus' || value === 'on_hiatus') return 'hiatus';
  if (value === 'cancelled' || value === 'canceled' || value === 'discontinued') return 'cancelled';
  return value || 'ongoing';
}

function makeTag(provider: string, name: string, index: number): any {
  return {
    id: `${provider}-tag-${index}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    type: 'tag',
    attributes: { name: { en: name }, description: {}, group: 'genre', version: 1 },
  };
}

export function toMangaShape(provider: string, manga: SimpleManga): any {
  const now = new Date().toISOString();
  const relationships: any[] = [];
  if (manga.coverUrl) {
    relationships.push({
      id: `${provider}-cover-${manga.id}`,
      type: 'cover_art',
      attributes: { url: manga.coverUrl, coverUrl: manga.coverUrl },
    });
  }
  (manga.authors || []).forEach((name, index) => {
    relationships.push({ id: `${provider}-author-${manga.id}-${index}`, type: 'author', attributes: { name } });
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
      tags: (manga.tags || []).map((name, index) => makeTag(provider, name, index)),
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

export function toChapterShape(chapter: SimpleChapter): any {
  const publishedAt = chapter.publishedAt || new Date(0).toISOString();
  return {
    id: chapter.id,
    type: 'chapter',
    attributes: {
      volume: null,
      chapter: chapter.number || null,
      title: chapter.title || null,
      translatedLanguage: 'en',
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

export function safeRemoteHost(hostname: string): boolean {
  const host = String(hostname || '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (host === '::1' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  return true;
}
