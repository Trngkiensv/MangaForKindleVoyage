import express from 'express';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { getProvider, listProviders } from './providers/registry';
import type { MangaProvider, ProviderChapterPagesResponse } from './providers/types';
import { EnglishVietnameseTranslationService } from './translation/ocrspace-cloudflare-en-vi';
import { getDriveBookAsset, getDriveBookPage, getParsedDriveBook, googleBooksConfigured } from './books-drive';
import {
  authDatabaseConfigured,
  cleanupExpiredAuthData,
  getHistory,
  getBookProgress,
  getBookProgressMany,
  getProgress,
  getReadChapterIds,
  getSavedManga,
  getSavedMangaIds,
  getUserBySessionToken,
  initAuthDatabase,
  isMangaSaved,
  loginUser,
  logoutSession,
  mailConfigured,
  registerUser,
  removeSavedManga,
  requestPasswordReset,
  resetPassword,
  saveManga,
  saveProgress,
  saveBookProgress,
  type AuthUser,
} from './auth-db';

const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT || 3000);
const isDevelopment = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
const translationService = new EnglishVietnameseTranslationService();

const chapterPagesCache = new Map<string, { expiresAt: number; data: ProviderChapterPagesResponse }>();
const CHAPTER_PAGES_CACHE_MS = 60 * 60 * 1000;

app.use(express.json({ limit: '100kb' }));

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

const SESSION_COOKIE = 'manga_session';
const SESSION_DAYS = Math.max(1, Math.min(365, parseInt(String(process.env.AUTH_SESSION_DAYS || '90'), 10) || 90));
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: express.Request) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.ip || req.socket.remoteAddress || 'unknown';
}

function allowRate(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

function readCookie(req: express.Request, name: string) {
  const raw = String(req.headers.cookie || '');
  const parts = raw.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch (_error) {
        return part.slice(idx + 1).trim();
      }
    }
  }
  return '';
}

function setSessionCookie(res: express.Response, token: string) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAge}`,
    'SameSite=Lax',
  ];
  if (!isDevelopment && process.env.AUTH_COOKIE_SECURE !== 'false') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res: express.Response) {
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    'SameSite=Lax',
  ];
  if (!isDevelopment && process.env.AUTH_COOKIE_SECURE !== 'false') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function sessionUser(req: express.Request): Promise<AuthUser | null> {
  if (!authDatabaseConfigured()) return null;
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  return getUserBySessionToken(token);
}

async function requireUser(req: express.Request, res: express.Response): Promise<AuthUser | null> {
  if (!authDatabaseConfigured()) {
    res.status(503).json({ error: 'Account database is not configured' });
    return null;
  }
  const user = await sessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Please log in' });
    return null;
  }
  return user;
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

app.get('/api/auth/me', async (req, res) => {
  try {
    const user = await sessionUser(req);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      authenticated: !!user,
      user,
      databaseConfigured: authDatabaseConfigured(),
      mailConfigured: mailConfigured(),
      sessionDays: SESSION_DAYS,
    });
  } catch (error: any) {
    console.error('Auth me error:', error);
    res.status(500).json({ error: 'Could not read account session' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    if (!authDatabaseConfigured()) return res.status(503).json({ error: 'Account database is not configured' });
    if (!allowRate(`register:${clientIp(req)}`, 8, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many registration attempts. Try again later.' });
    }
    const session = await registerUser(req.body?.username, req.body?.email, req.body?.password);
    setSessionCookie(res, session.token);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(201).json({ ok: true, user: session.user });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || String(error) });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    if (!authDatabaseConfigured()) return res.status(503).json({ error: 'Account database is not configured' });
    if (!allowRate(`login:${clientIp(req)}`, 30, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    }
    const session = await loginUser(req.body?.identifier, req.body?.password);
    setSessionCookie(res, session.token);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, user: session.user });
  } catch (error: any) {
    return res.status(401).json({ error: error?.message || 'Login failed' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) await logoutSession(token);
    clearSessionCookie(res);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true });
  } catch (error: any) {
    console.error('Logout error:', error);
    clearSessionCookie(res);
    return res.json({ ok: true });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    if (!authDatabaseConfigured()) return res.status(503).json({ error: 'Account database is not configured' });
    if (!mailConfigured()) return res.status(503).json({ error: 'Password reset email is not configured on the server' });
    if (!allowRate(`forgot:${clientIp(req)}`, 8, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many reset requests. Try again later.' });
    }
    try {
      await requestPasswordReset(req.body?.identifier);
    } catch (error) {
      console.error('Password reset email error:', error);
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, message: 'If the account exists, a 6-digit reset code was sent by email.' });
  } catch (error: any) {
    return res.status(500).json({ error: 'Could not process password reset request' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    if (!authDatabaseConfigured()) return res.status(503).json({ error: 'Account database is not configured' });
    if (!allowRate(`reset:${clientIp(req)}`, 20, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many reset attempts. Try again later.' });
    }
    const session = await resetPassword(req.body?.identifier, req.body?.code, req.body?.newPassword);
    setSessionCookie(res, session.token);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, user: session.user });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'Password reset failed' });
  }
});

app.get('/api/reading/progress/:chapterId', async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const provider = providerForRequest(req);
    const item = await getProgress(user.id, provider.key, req.params.chapterId);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ item });
  } catch (error: any) {
    console.error('Reading progress load error:', error);
    return res.status(500).json({ error: 'Could not load reading progress' });
  }
});

app.post('/api/reading/progress', async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const provider = providerForRequest(req);
    await saveProgress(user.id, provider.key, req.body || {});
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true });
  } catch (error: any) {
    console.error('Reading progress save error:', error);
    return res.status(400).json({ error: error?.message || 'Could not save reading progress' });
  }
});

app.post('/api/reading/read-chapters', async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const provider = providerForRequest(req);
    const chapterIds = await getReadChapterIds(user.id, provider.key, req.body?.mangaId, req.body?.chapterIds);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ chapterIds });
  } catch (error: any) {
    console.error('Read chapter marker error:', error);
    return res.status(500).json({ error: 'Could not load read chapter markers' });
  }
});

app.get('/api/reading/history', async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const data = await getHistory(user.id, req.query.page, req.query.limit || 40);
    res.setHeader('Cache-Control', 'no-store');
    return res.json(data);
  } catch (error: any) {
    console.error('Reading history error:', error);
    return res.status(500).json({ error: 'Could not load reading history' });
  }
});

app.get('/api/reading/saved', async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const data = await getSavedManga(user.id, req.query.page, req.query.limit || 40);
    res.setHeader('Cache-Control', 'no-store');
    return res.json(data);
  } catch (error: any) {
    console.error('Saved manga load error:', error);
    return res.status(500).json({ error: 'Could not load saved manga' });
  }
});

app.post('/api/reading/saved/check-many', async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const provider = providerForRequest(req);
    const savedIds = await getSavedMangaIds(user.id, provider.key, req.body?.mangaIds);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ savedIds });
  } catch (error: any) {
    console.error('Saved manga batch check error:', error);
    return res.status(500).json({ error: 'Could not check saved manga' });
  }
});

app.get('/api/reading/saved/check/:mangaId', async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const provider = providerForRequest(req);
    const saved = await isMangaSaved(user.id, provider.key, req.params.mangaId);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ saved });
  } catch (error: any) {
    return res.status(500).json({ error: 'Could not check saved manga' });
  }
});

app.post('/api/reading/saved', async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const provider = providerForRequest(req);
    const mangaId = String(req.body?.mangaId || '');
    const mangaTitle = String(req.body?.mangaTitle || '');
    if (!mangaId) return res.status(400).json({ error: 'mangaId is required' });
    await saveManga(user.id, provider.key, mangaId, mangaTitle);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, saved: true });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'Could not save manga' });
  }
});

app.delete('/api/reading/saved/:mangaId', async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const provider = providerForRequest(req);
    await removeSavedManga(user.id, provider.key, req.params.mangaId);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, saved: false });
  } catch (error: any) {
    return res.status(500).json({ error: 'Could not remove saved manga' });
  }
});

app.get('/api/books/status', async (_req, res) => {
  res.json({ configured: googleBooksConfigured(), formats: ['epub', 'azw3'], pageSize: 40 });
});

app.get('/api/books', async (req, res) => {
  try {
    if (!googleBooksConfigured()) return res.status(503).json({ error: 'Google Drive books are not configured' });
    const result: any = await getDriveBookPage(req.query.page, req.query.limit, req.query.q, req.query.refresh === '1');
    const user = await sessionUser(req);
    if (user && result.items.length) {
      const progressRows: any[] = await getBookProgressMany(user.id, result.items.map((item: any) => item.id));
      const progressById: Record<string, any> = {};
      for (const row of progressRows) progressById[String(row.drive_file_id)] = row;
      result.items = result.items.map((item: any) => ({ ...item, progress: progressById[item.id] || null }));
    }
    res.json(result);
  } catch (error: any) {
    res.status(502).json({ error: error?.message || 'Could not load Google Drive books' });
  }
});

app.get('/api/books/:id/meta', async (req, res) => {
  try {
    if (!googleBooksConfigured()) return res.status(503).json({ error: 'Google Drive books are not configured' });
    const book = await getParsedDriveBook(req.params.id);
    res.json({
      id: book.id,
      name: book.name,
      title: book.title,
      author: book.author,
      format: book.format,
      modifiedTime: book.modifiedTime,
      size: book.size,
      sectionCount: book.sections.length,
      sections: book.sections.map((section) => ({ index: section.index, title: section.title })),
    });
  } catch (error: any) {
    res.status(502).json({ error: error?.message || 'Could not parse book' });
  }
});

app.get('/api/books/:id/section/:index', async (req, res) => {
  try {
    if (!googleBooksConfigured()) return res.status(503).json({ error: 'Google Drive books are not configured' });
    const book = await getParsedDriveBook(req.params.id);
    let index = parseInt(String(req.params.index || '0'), 10);
    if (!isFinite(index) || index < 0 || index >= book.sections.length) return res.status(404).json({ error: 'Book section not found' });
    const section = book.sections[index];
    res.json({
      book: { id: book.id, title: book.title, author: book.author, format: book.format, sectionCount: book.sections.length },
      section: { index: section.index, title: section.title, html: section.html },
    });
  } catch (error: any) {
    res.status(502).json({ error: error?.message || 'Could not load book section' });
  }
});


app.get('/api/books/:id/asset/:assetKey', async (req, res) => {
  try {
    if (!googleBooksConfigured()) return res.status(503).end();
    const asset = await getDriveBookAsset(req.params.id, req.params.assetKey);
    const jpeg = await sharp(asset.bytes, { failOn: 'none', animated: false })
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: 1100, height: 1500, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, progressive: false, chromaSubsampling: '4:2:0' })
      .toBuffer();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Content-Length', String(jpeg.length));
    return res.send(jpeg);
  } catch (_error) {
    return res.status(404).end();
  }
});

app.get('/api/books/:id/progress', async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const progress = await getBookProgress(user.id, req.params.id);
    res.json({ progress });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Could not load book progress' });
  }
});

app.post('/api/books/progress', async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    await saveBookProgress(user.id, req.body || {});
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'Could not save book progress' });
  }
});

app.get('/api/health', (_req, res) => {
  const provider = getProvider();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    mode: isDevelopment ? 'development' : 'production',
    provider: provider.key,
    providers: listProviders(),
    accountDatabase: authDatabaseConfigured(),
    resetEmail: mailConfigured(),
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

app.get('/api/provider/random', async (req, res) => {
  try {
    const provider = providerForRequest(req);
    const requested = Math.max(1, Math.min(10, parseInt(String(req.query.limit || '10'), 10) || 10));
    const pageSize = 24;
    let data: any[] = [];
    // Sample from a different provider search page on every press, then
    // shuffle locally. Retry a shallower page if the sampled offset is empty.
    for (let attempt = 0; attempt < 3 && data.length < requested; attempt += 1) {
      const page = attempt === 2 ? 0 : Math.floor(Math.random() * 16);
      const params = new URLSearchParams();
      params.set('limit', String(pageSize));
      params.set('offset', String(page * pageSize));
      params.append('contentRating[]', 'safe');
      params.append('contentRating[]', 'suggestive');
      params.append('includes[]', 'cover_art');
      const result = await provider.search(params);
      data = result.data || [];
    }
    for (let i = data.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = data[i];
      data[i] = data[j];
      data[j] = tmp;
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ data: data.slice(0, requested), total: data.length, limit: requested });
  } catch (error: any) {
    console.error('Random manga error:', error);
    return res.status(502).json({ error: 'Could not load random manga' });
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

app.post('/api/translation/text', async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    if (!allowRate(`book-text-translate:${user.id}`, 30, 10 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many translation requests. Please wait a few minutes.' });
    }
    const selected = String(req.body?.text || '').trim();
    if (!selected) return res.status(400).json({ error: 'Select some text first' });
    if (selected.length > 3000) return res.status(400).json({ error: 'Selected text is too long (max 3000 characters)' });
    const result = await translationService.translateSelectedText(selected);
    res.setHeader('Cache-Control', 'no-store');
    return res.json(result);
  } catch (error: any) {
    console.error('Selected text translation error:', error);
    return res.status(502).json({ error: error?.message || String(error) });
  }
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
    // `ahead` is the number of pages to queue starting at `fromPage`.
    for (let pageNumber = fromPage; pageNumber < Math.min(pageList.length + 1, fromPage + ahead); pageNumber += 1) {
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
    const arrayBuffer = await response.arrayBuffer();
    const sourceBuffer = Buffer.from(arrayBuffer);
    const kindleCover = String(req.query.kindle || '').toLowerCase() === 'cover';

    if (kindleCover) {
      try {
        // Voyage WebKit does not reliably decode modern cover formats such as
        // WebP/AVIF. Normalize only cover thumbnails to a small baseline JPEG.
        // Chapter pages stay byte-for-byte unchanged through the proxy.
        const jpegCover = await sharp(sourceBuffer, { failOn: 'none' })
          .rotate()
          .resize({ width: 320, withoutEnlargement: true })
          .jpeg({ quality: 78, progressive: false, chromaSubsampling: '4:2:0' })
          .toBuffer();
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=86400');
        return res.send(jpegCover);
      } catch (coverError) {
        console.error('Kindle cover conversion error:', coverError);
        // Fall through to the original bytes instead of breaking the card.
      }
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.send(sourceBuffer);
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
  if (authDatabaseConfigured()) {
    try {
      await initAuthDatabase();
      await cleanupExpiredAuthData();
      console.log('Account database: Neon/Postgres connected');
    } catch (error) {
      console.error('Account database initial connection failed; manga reading will still start and auth routes will retry:', error);
    }
  } else {
    console.log('Account database: disabled (DATABASE_URL not set)');
  }

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
