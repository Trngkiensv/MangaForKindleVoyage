import { MangaDexProvider } from './mangadex-provider';
import { MangaPillProvider } from './mangapill-provider';
import { WeebCentralProvider } from './weebcentral-provider';
import type { MangaProvider } from './types';

const providers = new Map<string, MangaProvider>();
const mangaDex = new MangaDexProvider();
providers.set(mangaDex.key, mangaDex);
const weebCentral = new WeebCentralProvider();
providers.set(weebCentral.key, weebCentral);
const mangaPill = new MangaPillProvider();
providers.set(mangaPill.key, mangaPill);

export function normalizeProviderKey(key?: string): string {
  const requested = String(key || '').toLowerCase();
  return providers.has(requested) ? requested : 'weebcentral';
}

export function getProvider(key?: string): MangaProvider {
  const configured = key || process.env.MANGA_PROVIDER || 'weebcentral';
  const normalized = normalizeProviderKey(configured);
  return providers.get(normalized) || weebCentral;
}

export function getFallbackProvider(provider: MangaProvider): MangaProvider | null {
  if (provider.key === 'weebcentral') return mangaPill;
  return null;
}

export function listProviders(): Array<{ key: string; displayName: string }> {
  return Array.from(providers.values()).map((provider) => ({
    key: provider.key,
    displayName: provider.displayName,
  }));
}
