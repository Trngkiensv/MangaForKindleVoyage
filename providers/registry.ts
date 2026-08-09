import { MangaDexProvider } from './mangadex-provider';
import { WeebCentralProvider } from './weebcentral-provider';
import type { MangaProvider } from './types';

const providers = new Map<string, MangaProvider>();
const mangaDex = new MangaDexProvider();
providers.set(mangaDex.key, mangaDex);
const weebCentral = new WeebCentralProvider();
providers.set(weebCentral.key, weebCentral);

export function getProvider(key?: string): MangaProvider {
  const requested = (key || process.env.MANGA_PROVIDER || 'mangadex').toLowerCase();
  return providers.get(requested) || mangaDex;
}

export function listProviders(): Array<{ key: string; displayName: string }> {
  return Array.from(providers.values()).map((provider) => ({
    key: provider.key,
    displayName: provider.displayName,
  }));
}
