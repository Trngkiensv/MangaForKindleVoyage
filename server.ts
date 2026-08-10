import express from 'express';
import os from 'os';
import path from 'path';
import { getProvider, listProviders } from './providers/registry';
import type { MangaProvider, ProviderChapterPagesResponse } from './providers/types';
import { EnglishVietnameseTranslationService } from './translation/ocrspace-cloudflare-en-vi';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isDevelopment = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
const translationService = new EnglishVietnameseTranslationService();

const chapterPagesCache = new Map<string, { expiresAt: number; data: ProviderChapterPagesResponse }>();
const CHAPTER_PAGES_CACHE_MS = 60 * 60 * 1000;

app.use(express.json());

function queryParamsFromExpress(query: express.Request['query']): URLSearchParams {
  const params = new URLSearchParams();
  Object.keys(query).forEach((key) => {
    const value = query[key];
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (typeof item === 'string') params.append(key, item);
      });
    } else if (typeof value === 'string') {
      params.append(key, value);
    }
  });
  return params;
}

function providerForRequest(req: express.Request) {
  const requested = typeof req.query.provider === 'string' ? req.query.provider : undefined;
  return getProvider(requested);
}


async function getCachedChapterPages(
  provider: MangaProvider,
  chapterId: string,
): Promise<ProviderChapterPagesResponse> {
  const key = `${provider.key}:${chapterId}`;
  const cached = chapterPagesCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const data = await provider.getChapterPages(chapterId);
  chapterPagesCache.set(key, { expiresAt: Date.now() + CHAPTER_PAGES_CACHE_MS, data });
  if (chapterPagesCache.size > 80) {
    const firstKey = chapterPagesCache.keys().next().value;
    if (firstKey) chapterPagesCache.delete(firstKey);
  }
  return data;
}

app.get('/api/health', (_req, res) => {
  const provider = getProvider();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    mode: isDevelopment ? 'development' : 'production',
    provider: provider.key,
    providers: listProviders(),
  });
});

// Provider-neutral API inspired by manga-tui's MangaProvider architecture:
// search -> manga -> chapters -> chapter pages.
app.get('/api/provider/search', async (req, res) => {
  try {
    const provider = providerForRequest(req);
    const params = queryParamsFromExpress(req.query);
    params.delete('provider');
    const data = await provider.search(params);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(data);
  } catch (error: any) {
    console.error('Provider search error:', error);
    res.status(502).json({ error: error?.message || String(error) });
  }
});

app.get('/api/provider/manga/:id', async (req, res) => {
  try {
    const provider = providerForRequest(req);
    const data = await provider.getManga(req.params.id);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(data);
  } catch (error: any) {
    console.error('Provider manga error:', error);
    res.status(502).json({ error: error?.message || String(error) });
  }
});

app.get('/api/provider/manga/:id/chapters', async (req, res) => {
  try {
    const provider = providerForRequest(req);
    const params = queryParamsFromExpress(req.query);
    params.delete('provider');
    const data = await provider.getChapters(req.params.id, params);
    res.setHeader('Cache-Control', 'public, max-age=180');
    res.json(data);
  } catch (error: any) {
    console.error('Provider chapters error:', error);
    res.status(502).json({ error: error?.message || String(error) });
  }
});

app.get('/api/provider/chapter/:id', async (req, res) => {
  try {
    const provider = providerForRequest(req);
    const data = await provider.getChapter(req.params.id);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(data);
  } catch (error: any) {
    console.error('Provider chapter error:', error);
    res.status(502).json({ error: error?.message || String(error) });
  }
});

app.get('/api/provider/chapter/:id/pages', async (req, res) => {
  try {
    const provider = providerForRequest(req);
    const data = await getCachedChapterPages(provider, req.params.id);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(data);
  } catch (error: any) {
    console.error('Provider pages error:', error);
    res.status(502).json({ error: error?.message || String(error) });
  }
});


// English -> Vietnamese manga translation. OCR.Space + Cloudflare Workers AI run only on
// the PC/Node server; the old Kindle receives lightweight JSON overlay boxes.
app.get('/api/translation/status', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await translationService.getStatus());
});

app.get('/api/translation/chapter/:id/page/:page', async (req, res) => {
  try {
    const provider = providerForRequest(req);
    const pageNumber = parseInt(req.params.page, 10);
    if (!isFinite(pageNumber) || pageNumber < 1) {
      return res.status(400).json({ error: 'Page number must be 1 or greater' });
    }
    const pages = await getCachedChapterPages(provider, req.params.id);
    const context = translationService.makeContext(provider, req.params.id, pageNumber - 1, pages);
    const data = await translationService.translatePage(context);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.json({ ...data, page: pageNumber });
  } catch (error: any) {
    console.error('Translation page error:', error);
    return res.status(502).json({ error: error?.message || String(error) });
  }
});

app.get('/api/translation/chapter/:id/cancel-prefetch', async (req, res) => {
  try {
    const result = translationService.cancelPrefetch(req.params.id);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, ...result });
  } catch (error: any) {
    console.error('Translation prefetch cancel error:', error);
    return res.status(500).json({ error: error?.message || String(error) });
  }
});

app.get('/api/translation/chapter/:id/prefetch', async (req, res) => {
  try {
    const provider = providerForRequest(req);
    const status = await translationService.getStatus();
    if (!status.enabled) {
      return res.status(503).json({ error: status.reason || 'Translation is not configured' });
    }
    const fromPage = Math.max(1, parseInt(String(req.query.from || '1'), 10) || 1);
    const requestedAhead = parseInt(String(req.query.ahead || status.prefetchAhead), 10);
    const ahead = Math.max(0, Math.min(status.prefetchAhead, isFinite(requestedAhead) ? requestedAhead : status.prefetchAhead));
    const pages = await getCachedChapterPages(provider, req.params.id);
    const pageList = pages.pages && pages.pages.length ? pages.pages : pages.dataSaverPages || [];
    const replaceQueued = String(req.query.replace || '') === '1';
    const cancelled = replaceQueued ? translationService.cancelPrefetch(req.params.id).cancelled : 0;
    let queued = 0;
    for (let pageNumber = fromPage; pageNumber <= Math.min(pageList.length, fromPage + ahead); pageNumber += 1) {
      try {
        const context = translationService.makeContext(provider, req.params.id, pageNumber - 1, pages);
        translationService.queuePrefetch(context);
        queued += 1;
      } catch (_error) {}
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, queued, cancelled, fromPage, ahead });
  } catch (error: any) {
    console.error('Translation prefetch error:', error);
    return res.status(502).json({ error: error?.message || String(error) });
  }
});

// Backward-compatible raw MangaDex proxy retained so old bookmarks/builds do not break.
app.get('/api/mangadex/*', async (req, res) => {
  try {
    const targetPath = req.params[0];
    const rawQueryIndex = req.originalUrl.indexOf('?');
    const queryString = rawQueryIndex !== -1 ? req.originalUrl.substring(rawQueryIndex) : '';
    const mangaDexUrl = `https://api.mangadex.org/${targetPath}${queryString}`;

    const response = await fetch(mangaDexUrl, {
      headers: {
        'User-Agent': 'KindleVoyageMangaReader/3.1 (compat proxy)',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).send(errorText);
    }

    const data = await response.json();
    res.setHeader('Cache-Control', targetPath.startsWith('at-home/server') ? 'public, max-age=3600' : 'public, max-age=300');
    return res.json(data);
  } catch (error: any) {
    console.error('MangaDex compatibility proxy error:', error);
    return res.status(500).json({
      error: 'Failed to proxy request to MangaDex',
      details: error && error.message ? error.message : String(error),
    });
  }
});

// Image proxy: the Kindle talks HTTP to this PC; the PC downloads HTTPS images.
// Host validation is delegated to the active provider so a future authorized scraper
// can opt in only the exact CDN domains it is permitted to fetch.
app.get('/api/image-proxy', async (req, res) => {
  const imageUrl = typeof req.query.url === 'string' ? req.query.url : '';
  const provider = providerForRequest(req);

  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch (_error) {
    return res.status(400).send('Invalid image URL');
  }

  if (!provider.isAllowedImageUrl(parsed)) {
    return res.status(400).send('Image host is not allowed by the active provider');
  }

  try {
    const providerHeaders = provider.getImageRequestHeaders
      ? provider.getImageRequestHeaders(parsed)
      : {};
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'KindleVoyageMangaReader/3.1 (image proxy)',
        Accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8,*/*;q=0.5',
        ...providerHeaders,
      },
    });

    if (!response.ok) {
      return res.status(response.status).send('Image fetch failed');
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const arrayBuffer = await response.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (error: any) {
    console.error('Image Proxy Error:', error);
    return res.status(500).send('Error proxying image');
  }
});

function printLanUrls() {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];

  Object.keys(interfaces).forEach((name) => {
    const entries = interfaces[name] || [];
    entries.forEach((entry) => {
      if (entry.family === 'IPv4' && !entry.internal) {
        addresses.push(`http://${entry.address}:${PORT}`);
      }
    });
  });

  console.log(`Server running on http://localhost:${PORT}`);
  addresses.forEach((url) => console.log(`Kindle/LAN: ${url}`));
}

async function startServer() {
  if (isDevelopment) {
    const publicPath = path.join(process.cwd(), 'public');

    app.get(['/', '/kindle', '/kindle/'], (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(publicPath, 'kindle-voyage.html'));
    });
    app.use(express.static(publicPath));

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');

    app.get(['/', '/kindle', '/kindle/'], (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'kindle-voyage.html'));
    });

    app.get(['/modern', '/modern/'], (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });

    app.use(
      express.static(distPath, {
        setHeaders(res, filePath) {
          if (
            filePath.endsWith('.html') ||
            filePath.endsWith('kindle-voyage.js') ||
            filePath.endsWith('kindle-voyage.css')
          ) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          }
        },
      }),
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', printLanUrls);
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
