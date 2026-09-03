import { MangaDexProvider } from './mangadex-provider';
import { MangaPillProvider } from './mangapill-provider';
import { CrawlComicProvider } from './crawlcomic-provider';
import { WeebCentralProvider } from './weebcentral-provider';
import type { MangaProvider } from './types';

const providers = new Map<string, MangaProvider>();
const mangaDex = new MangaDexProvider();
providers.set(mangaDex.key, mangaDex);
const weebCentral = new WeebCentralProvider();
providers.set(weebCentral.key, weebCentral);
const mangaPill = new MangaPillProvider();
providers.set(mangaPill.key, mangaPill);
const crawlComic = new CrawlComicProvider();
providers.set(crawlComic.key, crawlComic);

export function normalizeProviderKey(key?: string): string {
  const requested = String(key || '').toLowerCase();
  return providers.has(requested) ? requested : 'mangapill';
}

export function getProvider(key?: string): MangaProvider {
  const configured = key || process.env.MANGA_PROVIDER || 'mangapill';
  const normalized = normalizeProviderKey(configured);
  return providers.get(normalized) || mangaPill;
}

export function getFallbackProvider(provider: MangaProvider): MangaProvider | null {
  if (provider.key === 'weebcentral') return mangaPill;
  if (provider.key === 'mangapill') return crawlComic;
  if (provider.key === 'crawlcomic') return mangaPill;
  return null;
}

export function listProviders(): Array<{ key: string; displayName: string }> {
  return Array.from(providers.values()).map((provider) => ({
    key: provider.key,
    displayName: provider.displayName,
  }));
}
