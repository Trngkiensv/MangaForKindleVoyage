export interface ProviderSearchResponse {
  data: any[];
  total: number;
  offset: number;
  limit: number;
}

export interface ProviderListResponse<T = any> {
  data: T[];
  total: number;
}

export interface ProviderChapterPagesResponse {
  result: 'ok' | 'error';
  pages: string[];
  dataSaverPages: string[];
}

export interface MangaProvider {
  readonly key: string;
  readonly displayName: string;
  search(params: URLSearchParams): Promise<ProviderSearchResponse>;
  getManga(id: string): Promise<any>;
  getChapters(mangaId: string, params: URLSearchParams): Promise<ProviderListResponse>;
  getChapter(chapterId: string): Promise<any>;
  getChapterPages(chapterId: string): Promise<ProviderChapterPagesResponse>;
  isAllowedImageUrl(url: URL): boolean;
  getImageRequestHeaders?(url: URL): Record<string, string>;
}
