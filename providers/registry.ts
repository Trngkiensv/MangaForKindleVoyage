import { MangaDexProvider } from './mangadex-provider';
import { MangaFireProvider } from './mangafire-provider';
import { MangaKatanaProvider } from './mangakatana-provider';
import { WeebCentralProvider } from './weebcentral-provider';
import type { MangaProvider } from './types';

const providers = new Map<string, MangaProvider>();

const mangaDex = new MangaDexProvider();
providers.set(mangaDex.key, mangaDex);

const weebCentral = new WeebCentralProvider();
providers.set(weebCentral.key, weebCentral);

const mangaFire = new MangaFireProvider();
providers.set(mangaFire.key, mangaFire);

const mangaKatana = new MangaKatanaProvider();
providers.set(mangaKatana.key, mangaKatana);

const aliases: Record<string, string> = {
  'manga-fire': 'mangafire',
  manga_fire: 'mangafire',
  'manga-katana': 'mangakatana',
  manga_katana: 'mangakatana',
  'weeb-central': 'weebcentral',
};

export function getProvider(key?: string): MangaProvider {
  const raw = (key || process.env.MANGA_PROVIDER || 'weebcentral').toLowerCase();
  const requested = aliases[raw] || raw;
  return providers.get(requested) || weebCentral;
}

export function listProviders(): Array<{ key: string; displayName: string }> {
  return Array.from(providers.values()).map((provider) => ({
    key: provider.key,
    displayName: provider.displayName,
  }));
}
