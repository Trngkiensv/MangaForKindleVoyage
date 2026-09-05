import type {
  MangaProvider,
  ProviderChapterPagesResponse,
  ProviderListResponse,
  ProviderSearchResponse,
} from './types';
import { safeRemoteHost, stripTags, toChapterShape, toMangaShape, type SimpleChapter } from './simple-provider-shapes';

const DEFAULT_BASE_URL = 'https://mangafire.to/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0 Safari/537.36';

// MangaFire's current JSON API expects a `vrf` query value. This is a small
// request-signing transform used by the public web client/provider ecosystem;
// keeping it server-side means the Kindle never has to run the site JS.
// The current stage parameters mirror the 2026 MangaFire API transform.
const VRF_STAGES = [
  {
    tableB64:
      'yINlmUNho8VYJT+ibTIP+9ESiULpVEtMOoD6U6lRE0R/xwXo/Xp9NrUgC4cw/' +
      'Lmo33vUyjUE40kUoEWIr/fxfNNcq2s79ShQ5NhNrFnJ4hXPwOu/SuXzIbuTQKG' +
      'Fvfm08E9jvCfqAtoDqvQq3dVWPQFmJjgvkISBeXY3BgANR+yVnjGbcxZ47d6k' +
      'LNfZPIayTq3/YGySb1KuVZodWp/WGNAO5pfMcpaK53Hhs0allBszaMaxuouOwd' +
      'xbwgxIw6YunSsXjI05Yi0j9j4eHKfSXR8Ifo/Od+8iamRfCXTyvm7NGRGYdcQ' +
      '0ywcK/u6RXhrbcCm4t2eCtrDgQVecJGkQ+A==',
    keyB64: '0Ec58JOY3uBzJK9m3zqIOpdlF7UFiax9DmA=',
    iv: 0x5a,
  },
  {
    tableB64:
      'IUFltCxD3Oc2cwCgkJffthaOg9cgPUb0LgW6H/VtfcF0kc5F25t+aWj6JH9V' +
      'OhOaY0rAFdUxlDnl5BLNvwEJvQtP5qcw7vdb/K+chnbwnspSHT8mz5lqwz41T' +
      'ezG0hkO06FTjJZhsyNuFLDpD2ZZxQj/QIRcF90zpmQ7Byu483WsQqUE0C342H' +
      'L+JXngRB6fRzxRyVTaKu83h7UYTJ0QMt6ixFh6S3F8gqkKwrGTL3jHNBsD45U' +
      'nifK8+RGtishQV2K3rujLKEkiZxpr2dYcudFW4oFsDKhad3CLBvuyTqsCo4B7m' +
      'L5IKQ1vXo/MOOvq1I1d8ar9X6Ttu5KF4fZgiA==',
    keyB64: 'AAdjb1iPY8CiDmq9H34tKTBF8a3oDQ==',
    iv: 0x35,
  },
  {
    tableB64:
      'NQHlu1/wVO5EmkwQymF810qqY2xG1k2obcas4Z9mCsPEIFl9pRIjFxbJ7ybM' +
      'HbBckT5Ton85E0FOeHezbh/mjlEYpmpnlXOS8dgrqeq2KfxImTh1YK9y0PeMN' +
      'hzA1OQzSY9brYOJq/l2QnE/hwOeZIhPixVSKIUlDb5vLcH6RWKxkIEMuP0bDw' +
      'IqQ71AJJaEaMJL7A6YtyIwoRT+L5v4aZzodN/0+3nOGsfblFjgxSfPzVDjNFe' +
      'Nl5P26+kEC/8AHgdrpAbt3hHz3HrRN1Y6e+JHgF7ncFWnoF0y3THL1S71WgWG' +
      'Ca6KtSzTCCG58n68nTyj2T3Sshk7utqCtMi/ZQ==',
    keyB64: 'DELOJgPsVaCcblDtTGMdHzM=',
    iv: 0xba,
  },
].map((stage) => ({
  table: Buffer.from(stage.tableB64, 'base64'),
  key: Buffer.from(stage.keyB64, 'base64'),
  iv: stage.iv,
}));

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function mangaFireVrf(url: URL): string {
  const normalized = new URL(url.toString());
  normalized.searchParams.sort();
  let data = Buffer.from(`${url.pathname.replace(/^\/api\//, '/')}${normalized.search}`, 'utf8');
  for (const stage of VRF_STAGES) {
    const output = Buffer.allocUnsafe(data.length);
    let previous = stage.iv;
    for (let index = 0; index < data.length; index += 1) {
      previous = stage.table[data[index] ^ stage.key[index % stage.key.length] ^ previous];
      output[index] = previous;
    }
    data = output;
  }
  return base64Url(data);
}

function asString(value: any): string {
  if (value === null || typeof value === 'undefined') return '';
  return String(value);
}

function numericDate(value: any): string | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const millis = n < 10_000_000_000 ? n * 1000 : n;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function mangaIdFromItem(item: any): string {
  if (item && item.hid !== null && typeof item.hid !== 'undefined') return asString(item.hid);
  if (item && item.id !== null && typeof item.id !== 'undefined') return asString(item.id);
  const value = asString(item?.url || item?.link);
  const match = value.match(/\/title\/([^\/?#-]+)(?:-|$)/i);
  return match ? match[1] : '';
}

function posterUrl(item: any): string {
  const poster = item?.poster || {};
  return asString(poster.large || poster.medium || poster.small || item?.imageUrl || item?.coverUrl);
}

function metaTotal(meta: any, offset: number, count: number, limit: number): number {
  const candidates = [meta?.total, meta?.totalItems, meta?.total_items, meta?.count];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return offset + count + (meta?.hasNext || meta?.has_next ? limit : 0);
}

export class MangaFireProvider implements MangaProvider {
  readonly key = 'mangafire';
  readonly displayName = 'MangaFire';

  private readonly baseUrl: string;
  private readonly seenImageHosts = new Set<string>();
  private readonly chapterCache = new Map<string, { expiresAt: number; chapters: SimpleChapter[] }>();
  private readonly chapterCacheTtlMs = 10 * 60 * 1000;

  constructor(baseUrl = process.env.MANGAFIRE_BASE_URL || DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    try {
      this.seenImageHosts.add(new URL(this.baseUrl).hostname.toLowerCase());
    } catch (_error) {}
  }

  private rememberImage(value: any): string | undefined {
    const raw = asString(value).trim();
    if (!raw) return undefined;
    try {
      const url = new URL(raw, this.baseUrl);
      if (url.protocol !== 'https:' || !safeRemoteHost(url.hostname)) return undefined;
      this.seenImageHosts.add(url.hostname.toLowerCase());
      return url.toString();
    } catch (_error) {
      return undefined;
    }
  }

  private async fetchJson(pathOrUrl: string, params?: URLSearchParams): Promise<any> {
    const url = new URL(pathOrUrl, this.baseUrl);
    if (params) params.forEach((value, key) => url.searchParams.append(key, value));
    // Sign after all ordinary parameters have been appended. `vrf` itself is
    // not part of the signed input.
    url.searchParams.set('vrf', mangaFireVrf(url));
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json,text/plain,*/*',
        'Accept-Language': 'en-US,en;q=0.8',
        Referer: this.baseUrl,
      },
    });
    const body = await response.text();
    if (!response.ok) {
      if (response.status === 403 && /(?:invalid|missing)\s+token|captcha_required/i.test(body)) {
        const error: any = new Error(
          'MangaFire rejected the current API token. MangaFire v3 now uses session-bound request tokens, so the old static VRF signer is no longer accepted by the upstream API.',
        );
        error.statusCode = 503;
        throw error;
      }
      throw new Error(`MangaFire returned HTTP ${response.status}: ${body.slice(0, 240)}`);
    }
    try {
      return JSON.parse(body);
    } catch (_error) {
      throw new Error(`MangaFire returned invalid JSON: ${body.slice(0, 180)}`);
    }
  }

  async search(params: URLSearchParams): Promise<ProviderSearchResponse> {
    const title = asString(params.get('title')).trim();
    const requestedLimit = Math.max(1, Math.min(30, Number(params.get('limit') || 20) || 20));
    const offset = Math.max(0, Number(params.get('offset') || 0) || 0);
    const page = Math.floor(offset / requestedLimit) + 1;
    const query = new URLSearchParams();
    if (title) query.set('keyword', title);
    query.set('language', 'en');
    query.set('limit', String(requestedLimit));
    query.set('page', String(page));
    if (title) query.set('order[relevance]', 'desc');
    else query.set('order[views_7d]', 'desc');

    const json = await this.fetchJson('api/titles', query);
    const items = Array.isArray(json?.items) ? json.items : Array.isArray(json?.data?.items) ? json.data.items : [];
    const data = items.map((item: any) => {
      const id = mangaIdFromItem(item);
      if (!id) return null;
      return toMangaShape(this.key, {
        id,
        title: asString(item.title || item.name) || `MangaFire ${id}`,
        coverUrl: this.rememberImage(posterUrl(item)),
        status: asString(item.status),
      });
    }).filter(Boolean).slice(0, requestedLimit);
    const meta = json?.meta || json?.data?.meta || {};
    return { data, total: metaTotal(meta, offset, data.length, requestedLimit), offset, limit: requestedLimit };
  }

  async getManga(id: string): Promise<any> {
    const json = await this.fetchJson(`api/titles/${encodeURIComponent(id)}`);
    const item = json?.data || json;
    const synopsisHtml = asString(item?.synopsisHtml || item?.synopsis || item?.description);
    const authors = Array.isArray(item?.authors) ? item.authors.map((x: any) => asString(x?.title || x?.name)).filter(Boolean) : [];
    const artists = Array.isArray(item?.artists) ? item.artists.map((x: any) => asString(x?.title || x?.name)).filter(Boolean) : [];
    const tags = Array.isArray(item?.genres) ? item.genres.map((x: any) => asString(x?.title || x?.name || x)).filter(Boolean) : [];
    const mergedAuthors = authors.slice();
    artists.forEach((name: string) => { if (mergedAuthors.indexOf(name) === -1) mergedAuthors.push(name); });
    const yearValue = Number(item?.year || item?.publishedYear || item?.releaseYear);
    return toMangaShape(this.key, {
      id: asString(item?.hid || item?.id) || id,
      title: asString(item?.title || item?.name) || `MangaFire ${id}`,
      coverUrl: this.rememberImage(posterUrl(item)),
      description: stripTags(synopsisHtml),
      status: asString(item?.status),
      tags,
      authors: mergedAuthors,
      year: Number.isFinite(yearValue) && yearValue > 0 ? yearValue : null,
    });
  }

  private async loadAllChapters(mangaId: string): Promise<SimpleChapter[]> {
    const cached = this.chapterCache.get(mangaId);
    if (cached && cached.expiresAt > Date.now()) return cached.chapters;
    if (cached) this.chapterCache.delete(mangaId);

    const chapters: SimpleChapter[] = [];
    const seen = new Set<string>();
    const limit = 200;
    let page = 1;
    let hasNext = true;
    while (hasNext && page <= 50) {
      const query = new URLSearchParams({
        language: 'en',
        sort: 'number',
        order: 'desc',
        limit: String(limit),
        page: String(page),
      });
      const json = await this.fetchJson(`api/titles/${encodeURIComponent(mangaId)}/chapters`, query);
      const items = Array.isArray(json?.items) ? json.items : Array.isArray(json?.data?.items) ? json.data.items : [];
      for (const item of items) {
        const id = asString(item?.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        chapters.push({
          id,
          number: asString(item?.number || item?.chapter || item?.chapterNumber),
          title: asString(item?.name || item?.title) || null,
          publishedAt: numericDate(item?.createdAt || item?.created_at || item?.publishedAt),
          mangaId,
        });
      }
      const meta = json?.meta || json?.data?.meta || {};
      hasNext = !!(meta.hasNext || meta.has_next);
      if (!items.length) hasNext = false;
      page += 1;
    }
    chapters.sort((a, b) => {
      const an = parseFloat(a.number);
      const bn = parseFloat(b.number);
      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return bn - an;
      return b.number.localeCompare(a.number);
    });
    this.chapterCache.set(mangaId, { expiresAt: Date.now() + this.chapterCacheTtlMs, chapters });
    return chapters;
  }

  async getChapters(mangaId: string, params: URLSearchParams): Promise<ProviderListResponse> {
    const all = (await this.loadAllChapters(mangaId)).slice();
    const direction = (params.get('order[chapter]') || 'desc').toLowerCase();
    if (direction === 'asc') all.reverse();
    const offset = Math.max(0, Number(params.get('offset') || 0) || 0);
    const limit = Math.max(1, Math.min(100, Number(params.get('limit') || 40) || 40));
    return { data: all.slice(offset, offset + limit).map(toChapterShape), total: all.length };
  }

  async getChapter(chapterId: string): Promise<any> {
    const json = await this.fetchJson(`api/chapters/${encodeURIComponent(chapterId)}`);
    const item = json?.data || json;
    return toChapterShape({
      id: chapterId,
      number: asString(item?.number || item?.chapter || item?.chapterNumber),
      title: asString(item?.name || item?.title) || null,
      mangaId: asString(item?.titleId || item?.mangaId || item?.manga?.id) || undefined,
      publishedAt: numericDate(item?.createdAt || item?.created_at || item?.publishedAt),
    });
  }

  async getChapterPages(chapterId: string): Promise<ProviderChapterPagesResponse> {
    const json = await this.fetchJson(`api/chapters/${encodeURIComponent(chapterId)}`);
    const item = json?.data || json;
    const rawPages = Array.isArray(item?.pages) ? item.pages : [];
    const pages: string[] = [];
    for (const page of rawPages) {
      const url = this.rememberImage(typeof page === 'string' ? page : page?.url || page?.imageUrl || page?.src);
      if (url) pages.push(url);
    }
    if (!pages.length) throw new Error(`MangaFire returned no chapter images for ${chapterId}`);
    return { result: 'ok', pages, dataSaverPages: [] };
  }

  isAllowedImageUrl(url: URL): boolean {
    return url.protocol === 'https:' && safeRemoteHost(url.hostname) && this.seenImageHosts.has(url.hostname.toLowerCase());
  }

  getImageRequestHeaders(_url: URL): Record<string, string> {
    return { Referer: this.baseUrl, 'Accept-Language': 'en-US,en;q=0.8' };
  }
}
