import { Chapter, ChapterPagesResponse, Manga, SearchMangaParams } from '../types';

const API_BASE = '/api/provider';

type QueryPair = [string, string];

function buildQuery(pairs: QueryPair[]): string {
  return pairs
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function addPair(pairs: QueryPair[], key: string, value: string | number): void {
  pairs.push([key, String(value)]);
}

export function proxyImageUrl(url: string): string {
  if (!url) return url;
  if (url.indexOf('/api/image-proxy?url=') === 0) return url;
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

/**
 * Accepts normal keywords and still recognizes MangaDex UUID/URLs for
 * backwards compatibility. Other providers can add their URL formats here
 * without changing the UI.
 */
export function parseProviderInput(input: string): { type: 'manga' | 'chapter' | 'search'; id?: string } {
  const trimmed = input.trim();
  if (!trimmed) return { type: 'search' };

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(trimmed)) {
    return { type: 'manga', id: trimmed };
  }

  const mangaDexManga = trimmed.match(/mangadex\.org\/(?:title|manga)\/([0-9a-f-]{36})/i);
  if (mangaDexManga && mangaDexManga[1]) {
    return { type: 'manga', id: mangaDexManga[1] };
  }

  const mangaDexChapter = trimmed.match(/mangadex\.org\/chapter\/([0-9a-f-]{36})/i);
  if (mangaDexChapter && mangaDexChapter[1]) {
    return { type: 'chapter', id: mangaDexChapter[1] };
  }

  const mangaPillManga = trimmed.match(/mangapill\.com\/manga\/(\d+)(?:\/|$)/i);
  if (mangaPillManga && mangaPillManga[1]) {
    return { type: 'manga', id: mangaPillManga[1] };
  }

  const mangaPillChapter = trimmed.match(/mangapill\.com\/chapters\/([^\/?#]+)/i);
  if (mangaPillChapter && mangaPillChapter[1]) {
    return { type: 'chapter', id: mangaPillChapter[1] };
  }

  const weebCentralManga = trimmed.match(/weebcentral\.com\/series\/([^\/?#]+)/i);
  if (weebCentralManga && weebCentralManga[1]) {
    return { type: 'manga', id: weebCentralManga[1] };
  }

  const weebCentralChapter = trimmed.match(/weebcentral\.com\/chapters\/([^\/?#]+)/i);
  if (weebCentralChapter && weebCentralChapter[1]) {
    return { type: 'chapter', id: weebCentralChapter[1] };
  }

  return { type: 'search' };
}

export async function searchManga(
  params: SearchMangaParams = {},
): Promise<{ data: Manga[]; total: number; offset: number; limit: number }> {
  const query: QueryPair[] = [];

  if (params.title) addPair(query, 'title', params.title);

  const limit = params.limit || 20;
  const offset = params.offset || 0;
  addPair(query, 'limit', limit);
  addPair(query, 'offset', offset);

  const contentRatings = params.contentRating || ['safe', 'suggestive'];
  contentRatings.forEach((rating) => addPair(query, 'contentRating[]', rating));

  addPair(query, 'includes[]', 'cover_art');
  addPair(query, 'includes[]', 'author');
  addPair(query, 'includes[]', 'artist');

  if (params.order) {
    Object.keys(params.order).forEach((key) => {
      const value = params.order && params.order[key];
      if (value) addPair(query, `order[${key}]`, value);
    });
  } else {
    addPair(query, 'order[followedCount]', 'desc');
  }

  const res = await fetch(`${API_BASE}/search?${buildQuery(query)}`);
  if (!res.ok) throw new Error(`Provider search failed: ${res.status}`);
  return await res.json();
}

export async function getMangaById(id: string): Promise<Manga> {
  const res = await fetch(`${API_BASE}/manga/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to fetch manga details (${res.status})`);
  return await res.json();
}

export async function getMangaFeed(
  mangaId: string,
  _languages: string[] = [],
  limit: number = 100,
  offset: number = 0,
): Promise<{ data: Chapter[]; total: number }> {
  const query: QueryPair[] = [];
  addPair(query, 'limit', limit);
  addPair(query, 'offset', offset);
  addPair(query, 'order[chapter]', 'asc');
  addPair(query, 'contentRating[]', 'safe');
  addPair(query, 'contentRating[]', 'suggestive');
  addPair(query, 'contentRating[]', 'erotica');

  const res = await fetch(
    `${API_BASE}/manga/${encodeURIComponent(mangaId)}/chapters?${buildQuery(query)}`,
  );
  if (!res.ok) throw new Error(`Failed to fetch chapters (${res.status})`);
  return await res.json();
}

export async function getChapterById(chapterId: string): Promise<Chapter> {
  const res = await fetch(`${API_BASE}/chapter/${encodeURIComponent(chapterId)}`);
  if (!res.ok) throw new Error(`Failed to fetch chapter details (${res.status})`);
  return await res.json();
}

export async function getChapterPages(chapterId: string): Promise<ChapterPagesResponse> {
  const res = await fetch(`${API_BASE}/chapter/${encodeURIComponent(chapterId)}/pages`);
  if (!res.ok) throw new Error(`Failed to fetch chapter pages (${res.status})`);
  return await res.json();
}

/**
 * Prefer a normalized direct cover URL supplied by a custom provider. Fall
 * back to MangaDex's cover-art convention for the built-in provider.
 */
export function getCoverUrl(manga: Manga, size: '256' | '512' = '256'): string | null {
  const coverRel = manga.relationships && manga.relationships.find((r) => r.type === 'cover_art');
  if (!coverRel || !coverRel.attributes) return null;

  const direct = coverRel.attributes.url || coverRel.attributes.coverUrl;
  if (typeof direct === 'string' && direct) return proxyImageUrl(direct);

  const fileName = coverRel.attributes.fileName;
  if (!fileName) return null;

  const mangaDexUrl = `https://uploads.mangadex.org/covers/${manga.id}/${fileName}.${size}.jpg`;
  return proxyImageUrl(mangaDexUrl);
}

export function getMangaTitle(manga: Manga, preferredLang: string = 'en'): string {
  if (!manga || !manga.attributes || !manga.attributes.title) return 'Untitled Manga';

  const titles = manga.attributes.title;
  if (titles[preferredLang]) return titles[preferredLang];
  if (titles.en) return titles.en;
  if (titles['ja-ro']) return titles['ja-ro'];
  if (titles.ja) return titles.ja;
  if (titles.vi) return titles.vi;

  const firstKey = Object.keys(titles)[0];
  if (firstKey) return titles[firstKey];

  if (manga.attributes.altTitles && manga.attributes.altTitles.length > 0) {
    for (let i = 0; i < manga.attributes.altTitles.length; i += 1) {
      const altObj = manga.attributes.altTitles[i];
      if (altObj[preferredLang]) return altObj[preferredLang];
      if (altObj.en) return altObj.en;
    }
  }

  return 'Unknown Title';
}

export function getMangaDescription(manga: Manga, preferredLang: string = 'en'): string {
  if (!manga || !manga.attributes || !manga.attributes.description) return '';
  const desc = manga.attributes.description;
  if (desc[preferredLang]) return desc[preferredLang];
  if (desc.en) return desc.en;
  if (desc.vi) return desc.vi;
  const firstKey = Object.keys(desc)[0];
  return firstKey ? desc[firstKey] : '';
}

export function formatChapterName(chapter: Chapter): string {
  const attr = chapter.attributes;
  if (attr.chapter) {
    return `Ch. ${attr.chapter}${attr.title ? `: ${attr.title}` : ''}`;
  }
  if (attr.volume) {
    return `Vol. ${attr.volume}${attr.title ? `: ${attr.title}` : ''}`;
  }
  return attr.title || 'Oneshot';
}
