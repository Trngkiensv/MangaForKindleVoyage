import { Chapter, ChapterPagesResponse, Manga, SearchMangaParams } from '../types';

const API_BASE = '/api/provider';

export type MangaProviderKey = 'mangakatana' | 'mangafire' | 'weebcentral' | 'mangadex';

export const MANGA_PROVIDERS: Array<{ key: MangaProviderKey; label: string }> = [
  { key: 'mangakatana', label: 'MangaKatana' },
  { key: 'mangafire', label: 'MangaFire' },
  { key: 'weebcentral', label: 'WeebCentral' },
  { key: 'mangadex', label: 'MangaDex' },
];

const PROVIDER_STORAGE_KEY = 'kindle_manga_provider_v34';
let activeProvider: MangaProviderKey = 'mangakatana';

function isProviderKey(value: unknown): value is MangaProviderKey {
  return MANGA_PROVIDERS.some((item) => item.key === value);
}

try {
  const stored = typeof window !== 'undefined' ? window.localStorage.getItem(PROVIDER_STORAGE_KEY) : null;
  if (isProviderKey(stored)) activeProvider = stored;
} catch (_error) {}

export function getActiveProvider(): MangaProviderKey {
  return activeProvider;
}

export function setActiveProvider(provider: MangaProviderKey): void {
  if (!isProviderKey(provider)) throw new Error(`Unknown manga provider: ${provider}`);
  activeProvider = provider;
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(PROVIDER_STORAGE_KEY, provider);
  } catch (_error) {}
}

function providerUrl(url: string, provider: MangaProviderKey = activeProvider): string {
  const separator = url.indexOf('?') === -1 ? '?' : '&';
  return `${url}${separator}provider=${encodeURIComponent(provider)}`;
}

type QueryPair = [string, string];

function buildQuery(pairs: QueryPair[]): string {
  return pairs
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function addPair(pairs: QueryPair[], key: string, value: string | number): void {
  pairs.push([key, String(value)]);
}

export function proxyImageUrl(url: string, provider: MangaProviderKey = activeProvider): string {
  if (!url) return url;
  if (url.indexOf('/api/image-proxy?') === 0) {
    if (/[?&]provider=/.test(url)) return url;
    return providerUrl(url, provider);
  }
  return providerUrl(`/api/image-proxy?url=${encodeURIComponent(url)}`, provider);
}

/**
 * Accepts normal keywords and still recognizes MangaDex UUID/URLs for
 * backwards compatibility. Other providers can add their URL formats here
 * without changing the UI.
 */
export function parseProviderInput(input: string, provider: MangaProviderKey = activeProvider): { type: 'manga' | 'chapter' | 'search'; id?: string } {
  const trimmed = input.trim();
  if (!trimmed) return { type: 'search' };

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (provider === 'mangadex' && uuidRegex.test(trimmed)) {
    return { type: 'manga', id: trimmed };
  }

  const mangaDexManga = trimmed.match(/mangadex\.org\/(?:title|manga)\/([0-9a-f-]{36})/i);
  if (provider === 'mangadex' && mangaDexManga && mangaDexManga[1]) {
    return { type: 'manga', id: mangaDexManga[1] };
  }

  const mangaDexChapter = trimmed.match(/mangadex\.org\/chapter\/([0-9a-f-]{36})/i);
  if (provider === 'mangadex' && mangaDexChapter && mangaDexChapter[1]) {
    return { type: 'chapter', id: mangaDexChapter[1] };
  }

  const weebCentralManga = trimmed.match(/weebcentral\.com\/series\/([^\/?#]+)/i);
  if (provider === 'weebcentral' && weebCentralManga && weebCentralManga[1]) {
    return { type: 'manga', id: weebCentralManga[1] };
  }

  const weebCentralChapter = trimmed.match(/weebcentral\.com\/chapters\/([^\/?#]+)/i);
  if (provider === 'weebcentral' && weebCentralChapter && weebCentralChapter[1]) {
    return { type: 'chapter', id: weebCentralChapter[1] };
  }

  if (provider === 'mangakatana') {
    const mangaKatanaManga = trimmed.match(/mangakatana\.com\/manga\/([^\/?#]+)/i);
    if (mangaKatanaManga && mangaKatanaManga[1]) return { type: 'manga', id: mangaKatanaManga[1] };
  }

  if (provider === 'mangafire') {
    const mangaFireManga = trimmed.match(/mangafire\.to\/manga\/([^\/?#]+)/i) || trimmed.match(/mangafire\.to\/title\/([^\/?#]+)/i);
    if (mangaFireManga && mangaFireManga[1]) return { type: 'manga', id: mangaFireManga[1].split('-')[0] };
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

  const res = await fetch(providerUrl(`${API_BASE}/search?${buildQuery(query)}`));
  if (!res.ok) throw new Error(`Provider search failed: ${res.status}`);
  return await res.json();
}

export async function getMangaById(id: string): Promise<Manga> {
  const res = await fetch(providerUrl(`${API_BASE}/manga/${encodeURIComponent(id)}`));
  if (!res.ok) throw new Error(`Failed to fetch manga details (${res.status})`);
  return await res.json();
}

export async function getMangaFeed(
  mangaId: string,
  languages: string[] = [],
  limit: number = 100,
  offset: number = 0,
): Promise<{ data: Chapter[]; total: number }> {
  const query: QueryPair[] = [];
  addPair(query, 'limit', limit);
  addPair(query, 'offset', offset);
  addPair(query, 'order[chapter]', 'desc');
  addPair(query, 'contentRating[]', 'safe');
  addPair(query, 'contentRating[]', 'suggestive');
  addPair(query, 'contentRating[]', 'erotica');
  if (activeProvider === 'mangadex') {
    languages.filter(Boolean).forEach((language) => addPair(query, 'translatedLanguage[]', language));
  }

  const res = await fetch(
    providerUrl(`${API_BASE}/manga/${encodeURIComponent(mangaId)}/chapters?${buildQuery(query)}`),
  );
  if (!res.ok) throw new Error(`Failed to fetch chapters (${res.status})`);
  return await res.json();
}

export async function getChapterById(chapterId: string): Promise<Chapter> {
  const res = await fetch(providerUrl(`${API_BASE}/chapter/${encodeURIComponent(chapterId)}`));
  if (!res.ok) throw new Error(`Failed to fetch chapter details (${res.status})`);
  return await res.json();
}

export async function getChapterPages(chapterId: string): Promise<ChapterPagesResponse> {
  const res = await fetch(providerUrl(`${API_BASE}/chapter/${encodeURIComponent(chapterId)}/pages`));
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

  const fileName = coverRel.attributes.fileName;

  // For MangaDex, prefer its generated JPEG thumbnail instead of the original
  // cover file. This is smaller and much safer for old Kindle WebKit.
  if (activeProvider === 'mangadex' && fileName) {
    const mangaDexUrl = `https://uploads.mangadex.org/covers/${manga.id}/${fileName}.${size}.jpg`;
    return proxyImageUrl(mangaDexUrl);
  }

  const direct = coverRel.attributes.url || coverRel.attributes.coverUrl;
  if (typeof direct === 'string' && direct) return proxyImageUrl(direct);
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
