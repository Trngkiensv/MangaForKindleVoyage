import type {
  MangaProvider,
  ProviderChapterPagesResponse,
  ProviderListResponse,
  ProviderSearchResponse,
} from './types';

/**
 * Template for a server-rendered HTML source, modeled after manga-tui's
 * HTML-backed providers. Subclasses define URL builders and parsing only;
 * Express/frontends remain provider-neutral.
 */
export abstract class HtmlProviderTemplate implements MangaProvider {
  abstract readonly key: string;
  abstract readonly displayName: string;
  protected abstract readonly allowedImageHosts: string[];

  protected async fetchText(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'KindleVoyageMangaReader/3.1 (authorized provider adapter)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`${this.displayName} returned HTTP ${response.status}`);
    return response.text();
  }

  abstract search(params: URLSearchParams): Promise<ProviderSearchResponse>;
  abstract getManga(id: string): Promise<any>;
  abstract getChapters(mangaId: string, params: URLSearchParams): Promise<ProviderListResponse>;
  abstract getChapter(chapterId: string): Promise<any>;
  abstract getChapterPages(chapterId: string): Promise<ProviderChapterPagesResponse>;

  isAllowedImageUrl(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      this.allowedImageHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
    );
  }
}
