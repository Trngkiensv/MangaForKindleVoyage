import type {
  MangaProvider,
  ProviderChapterPagesResponse,
  ProviderListResponse,
  ProviderSearchResponse,
} from './types';

const API_BASE = 'https://api.mangadex.org';
const USER_AGENT = 'KindleVoyageMangaReader/3.1 (provider adapter)';

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
      data: json.data || [],
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
    return json.data;
  }

  async getChapters(mangaId: string, params: URLSearchParams): Promise<ProviderListResponse> {
    const query = new URLSearchParams(params);
    if (!query.has('limit')) query.set('limit', '100');
    if (!query.has('offset')) query.set('offset', '0');
    if (!query.has('order[chapter]')) query.set('order[chapter]', 'asc');
    if (!query.has('contentRating[]')) {
      query.append('contentRating[]', 'safe');
      query.append('contentRating[]', 'suggestive');
      query.append('contentRating[]', 'erotica');
    }

    const json = await this.requestJson(`/manga/${encodeURIComponent(mangaId)}/feed`, query);
    return {
      data: json.data || [],
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
}
