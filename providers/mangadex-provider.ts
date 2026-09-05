import type {
  MangaProvider,
  ProviderChapterPagesResponse,
  ProviderListResponse,
  ProviderSearchResponse,
} from './types';

const API_BASE = 'https://api.mangadex.org';
const USER_AGENT = 'KindleVoyageMangaReader/3.1 (provider adapter)';

function normalizeMangaDexManga(manga: any): any {
  if (!manga || !manga.id || !Array.isArray(manga.relationships)) return manga;
  const cover = manga.relationships.find((rel: any) => rel && rel.type === 'cover_art');
  const fileName = cover && cover.attributes ? cover.attributes.fileName : '';
  if (fileName) {
    const originalUrl = `https://uploads.mangadex.org/covers/${manga.id}/${fileName}`;
    // MangaDex provides JPEG thumbnails by appending .256.jpg / .512.jpg to
    // the original cover filename. Prefer those for Kindle/browser cards so
    // the client never has to decode the source cover format.
    cover.attributes = {
      ...cover.attributes,
      originalUrl,
      url: `${originalUrl}.512.jpg`,
      coverUrl: `${originalUrl}.512.jpg`,
      thumbnail256: `${originalUrl}.256.jpg`,
      thumbnail512: `${originalUrl}.512.jpg`,
    };
  }
  return manga;
}

export class MangaDexProvider implements MangaProvider {
  readonly key = 'mangadex';
  readonly displayName = 'MangaDex';

  private async requestJson(pathname: string, params?: URLSearchParams): Promise<any> {
    const query = params && params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(`${API_BASE}${pathname}${query}`, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`MangaDex request failed (${response.status}): ${body.slice(0, 300)}`);
    }

    return response.json();
  }

  async search(params: URLSearchParams): Promise<ProviderSearchResponse> {
    const query = new URLSearchParams(params);
    if (!query.has('includes[]')) {
      query.append('includes[]', 'cover_art');
      query.append('includes[]', 'author');
      query.append('includes[]', 'artist');
    }
    if (!query.has('contentRating[]')) {
      query.append('contentRating[]', 'safe');
      query.append('contentRating[]', 'suggestive');
    }

    const json = await this.requestJson('/manga', query);
    return {
      data: (json.data || []).map(normalizeMangaDexManga),
      total: json.total || 0,
      offset: json.offset || 0,
      limit: json.limit || Number(query.get('limit') || 20),
    };
  }

  async getManga(id: string): Promise<any> {
    const query = new URLSearchParams();
    query.append('includes[]', 'cover_art');
    query.append('includes[]', 'author');
    query.append('includes[]', 'artist');
    const json = await this.requestJson(`/manga/${encodeURIComponent(id)}`, query);
    return normalizeMangaDexManga(json.data);
  }

  async getChapters(mangaId: string, params: URLSearchParams): Promise<ProviderListResponse> {
    const query = new URLSearchParams(params);

    // Accept both the correct bracket form and the form produced by some
    // Express query parsers, then always send MangaDex an actual array.
    const translatedLanguages = Array.from(new Set([
      ...query.getAll('translatedLanguage[]'),
      ...query.getAll('translatedLanguage'),
    ].map((value) => value.trim()).filter(Boolean)));
    query.delete('translatedLanguage[]');
    query.delete('translatedLanguage');
    translatedLanguages.forEach((language) => query.append('translatedLanguage[]', language));

    if (!query.has('limit')) query.set('limit', '100');
    if (!query.has('offset')) query.set('offset', '0');

    // Keep chapter feeds consistent with MangaKatana/WeebCentral: newest/highest
    // chapter first. Force this even if an older client still sends asc.
    query.set('order[chapter]', 'desc');

    if (!query.has('contentRating[]')) {
      query.append('contentRating[]', 'safe');
      query.append('contentRating[]', 'suggestive');
      query.append('contentRating[]', 'erotica');
    }

    const json = await this.requestJson(`/manga/${encodeURIComponent(mangaId)}/feed`, query);
    const data = Array.isArray(json.data) ? [...json.data] : [];

    // Defensive local ordering in case the upstream feed returns tied/unsorted
    // releases. Numeric chapters sort high -> low; same-number releases sort by
    // readable/publish date newest first.
    data.sort((left: any, right: any) => {
      const leftRaw = left?.attributes?.chapter;
      const rightRaw = right?.attributes?.chapter;
      const leftNumber = leftRaw == null || leftRaw === '' ? Number.NEGATIVE_INFINITY : Number.parseFloat(String(leftRaw));
      const rightNumber = rightRaw == null || rightRaw === '' ? Number.NEGATIVE_INFINITY : Number.parseFloat(String(rightRaw));
      const leftFinite = Number.isFinite(leftNumber);
      const rightFinite = Number.isFinite(rightNumber);
      if (leftFinite && rightFinite && leftNumber !== rightNumber) return rightNumber - leftNumber;
      if (leftFinite !== rightFinite) return leftFinite ? -1 : 1;
      const leftDate = Date.parse(left?.attributes?.readableAt || left?.attributes?.publishAt || left?.attributes?.createdAt || '') || 0;
      const rightDate = Date.parse(right?.attributes?.readableAt || right?.attributes?.publishAt || right?.attributes?.createdAt || '') || 0;
      return rightDate - leftDate;
    });

    return {
      data,
      total: json.total || 0,
    };
  }

  async getChapter(chapterId: string): Promise<any> {
    const query = new URLSearchParams();
    query.append('includes[]', 'manga');
    const json = await this.requestJson(`/chapter/${encodeURIComponent(chapterId)}`, query);
    return json.data;
  }

  async getChapterPages(chapterId: string): Promise<ProviderChapterPagesResponse> {
    const json = await this.requestJson(`/at-home/server/${encodeURIComponent(chapterId)}`);
    const baseUrl = json.baseUrl || '';
    const chapter = json.chapter || {};
    const hash = chapter.hash || '';
    const originalFiles: string[] = chapter.data || [];
    const saverFiles: string[] = chapter.dataSaver || [];

    return {
      result: 'ok',
      pages: originalFiles.map((file) => `${baseUrl}/data/${hash}/${file}`),
      dataSaverPages: saverFiles.map((file) => `${baseUrl}/data-saver/${hash}/${file}`),
    };
  }

  isAllowedImageUrl(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      (host === 'uploads.mangadex.org' || host.endsWith('.mangadex.org') || host.endsWith('.mangadex.network'))
    );
  }

  getImageRequestHeaders(_url: URL): Record<string, string> {
    return {
      'User-Agent': 'Mozilla/5.0 (Linux; Kindle) AppleWebKit/537.36 Safari/537.36',
      Referer: 'https://mangadex.org/',
      'Accept-Language': 'en-US,en;q=0.8',
    };
  }
}
