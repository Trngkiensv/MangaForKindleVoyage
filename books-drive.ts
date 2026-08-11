import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

export type DriveBookItem = {
  id: string;
  name: string;
  title: string;
  format: 'epub' | 'azw3';
  size: number;
  modifiedTime: string;
};

export type ParsedBookSection = {
  index: number;
  title: string;
  html: string;
};

export type ParsedBook = {
  id: string;
  name: string;
  title: string;
  author: string;
  format: 'epub' | 'azw3';
  modifiedTime: string;
  size: number;
  sections: ParsedBookSection[];
};

type DriveToken = { token: string; expiresAt: number };
type BookCacheEntry = { book: ParsedBook; touchedAt: number };

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_FOLDER_ID = String(process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();
const BOOK_LIBRARY_CACHE_MS = Math.max(10_000, parseInt(String(process.env.BOOK_LIBRARY_CACHE_SECONDS || '60'), 10) * 1000 || 60_000);
const BOOK_PARSE_CACHE_LIMIT = Math.max(1, Math.min(8, parseInt(String(process.env.BOOK_PARSE_CACHE_LIMIT || '3'), 10) || 3));
const BOOK_MAX_FILE_MB = Math.max(5, Math.min(250, parseInt(String(process.env.BOOK_MAX_FILE_MB || '80'), 10) || 80));

let tokenCache: DriveToken | null = null;
let libraryCache: { expiresAt: number; items: DriveBookItem[] } | null = null;
const parsedBookCache = new Map<string, BookCacheEntry>();

let epubParserModulePromise: Promise<any> | null = null;
let mobiParserModulePromise: Promise<any> | null = null;

async function getEpubParserModule() {
  if (!epubParserModulePromise) {
    epubParserModulePromise = import('@lingo-reader/epub-parser');
  }
  return epubParserModulePromise;
}

async function getMobiParserModule() {
  if (!mobiParserModulePromise) {
    mobiParserModulePromise = import('@lingo-reader/mobi-parser');
  }
  return mobiParserModulePromise;
}

function serviceAccountCredentials() {
  const raw = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (raw) {
    let parsed: any = null;
    try {
      parsed = JSON.parse(raw);
    } catch (_plainError) {
      try {
        parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
      } catch (_base64Error) {}
    }
    if (parsed && parsed.client_email && parsed.private_key) {
      return {
        email: String(parsed.client_email).trim(),
        privateKey: String(parsed.private_key).replace(/\\n/g, '\n'),
      };
    }
  }
  const email = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const privateKey = String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  return { email, privateKey };
}

export function googleBooksConfigured() {
  const credentials = serviceAccountCredentials();
  return !!(GOOGLE_DRIVE_FOLDER_ID && credentials.email && credentials.privateKey);
}

function base64Url(input: Buffer | string) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function driveAccessToken() {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.token;
  const credentials = serviceAccountCredentials();
  if (!GOOGLE_DRIVE_FOLDER_ID) throw new Error('GOOGLE_DRIVE_FOLDER_ID is not configured');
  if (!credentials.email || !credentials.privateKey) throw new Error('Google service account is not configured');

  const iat = Math.floor(now / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: credentials.email,
    scope: DRIVE_SCOPE,
    aud: DRIVE_TOKEN_URL,
    iat,
    exp: iat + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), credentials.privateKey);
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const response = await fetch(DRIVE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json: any = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    throw new Error(`Google OAuth failed (${response.status}): ${json.error_description || json.error || 'no access token'}`);
  }
  tokenCache = {
    token: String(json.access_token),
    expiresAt: now + Math.max(60, Number(json.expires_in || 3600)) * 1000,
  };
  return tokenCache.token;
}

function bookFormatFromName(name: string): 'epub' | 'azw3' | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.epub')) return 'epub';
  if (lower.endsWith('.azw3')) return 'azw3';
  return null;
}

function titleFromName(name: string) {
  return name.replace(/\.(epub|azw3)$/i, '').replace(/[_]+/g, ' ').trim() || name;
}

async function fetchAllDriveBooks(force = false) {
  if (!googleBooksConfigured()) return [];
  const now = Date.now();
  if (!force && libraryCache && libraryCache.expiresAt > now) return libraryCache.items;
  const token = await driveAccessToken();
  const items: DriveBookItem[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams();
    params.set('q', `'${GOOGLE_DRIVE_FOLDER_ID.replace(/'/g, "\\'")}' in parents and trashed = false`);
    params.set('pageSize', '1000');
    params.set('fields', 'nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,capabilities(canDownload))');
    params.set('orderBy', 'name_natural');
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Google Drive list failed (${response.status}): ${json.error?.message || 'unknown error'}`);
    const files = Array.isArray(json.files) ? json.files : [];
    for (const file of files) {
      const name = String(file.name || '');
      const format = bookFormatFromName(name);
      if (!format || file.capabilities?.canDownload === false) continue;
      items.push({
        id: String(file.id || ''),
        name,
        title: titleFromName(name),
        format,
        size: Number(file.size || 0),
        modifiedTime: String(file.modifiedTime || ''),
      });
    }
    pageToken = String(json.nextPageToken || '');
  } while (pageToken);
  items.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  libraryCache = { expiresAt: now + BOOK_LIBRARY_CACHE_MS, items };
  return items;
}

export async function getDriveBookPage(pageRaw: unknown, limitRaw: unknown, searchRaw?: unknown, force = false) {
  let page = parseInt(String(pageRaw || '1'), 10);
  let limit = parseInt(String(limitRaw || '40'), 10);
  if (!isFinite(page) || page < 1) page = 1;
  if (!isFinite(limit) || limit < 1) limit = 40;
  limit = Math.min(40, limit);
  const search = String(searchRaw || '').trim().toLowerCase();
  const all = await fetchAllDriveBooks(force);
  const filtered = search ? all.filter((item) => item.title.toLowerCase().indexOf(search) !== -1 || item.name.toLowerCase().indexOf(search) !== -1) : all;
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  if (page > pages) page = pages;
  const offset = (page - 1) * limit;
  return { items: filtered.slice(offset, offset + limit), total, page, pages, limit };
}

async function findDriveBook(fileId: string) {
  let items = await fetchAllDriveBooks(false);
  let item = items.find((candidate) => candidate.id === fileId);
  if (!item) {
    items = await fetchAllDriveBooks(true);
    item = items.find((candidate) => candidate.id === fileId);
  }
  if (!item) throw new Error('Book is not inside the configured Google Drive folder');
  return item;
}

async function downloadDriveBook(item: DriveBookItem) {
  const maxBytes = BOOK_MAX_FILE_MB * 1024 * 1024;
  if (item.size && item.size > maxBytes) throw new Error(`Book is larger than the ${BOOK_MAX_FILE_MB} MB server limit`);
  const token = await driveAccessToken();
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Google Drive download failed (${response.status}): ${text.slice(0, 300)}`);
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength && contentLength > maxBytes) throw new Error(`Book is larger than the ${BOOK_MAX_FILE_MB} MB server limit`);
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) throw new Error(`Book is larger than the ${BOOK_MAX_FILE_MB} MB server limit`);
  return new Uint8Array(arrayBuffer);
}

function metadataText(value: any): string {
  if (value === null || typeof value === 'undefined') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.map(metadataText).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    for (const key of ['text', 'value', 'name', 'title', 'fullName']) {
      if (value[key]) {
        const text = metadataText(value[key]);
        if (text) return text;
      }
    }
  }
  return '';
}

function plainTextLength(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&[a-z0-9#]+;/gi, 'x').replace(/\s+/g, ' ').trim().length;
}

function sanitizeBookHtml(raw: string) {
  let html = String(raw || '');
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<\s*(script|style|iframe|object|embed|svg|canvas|form|textarea|select|button|input|video|audio|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  html = html.replace(/<\s*(script|style|iframe|object|embed|svg|canvas|form|textarea|select|button|input|video|audio|link|meta)[^>]*\/?>/gi, '');
  html = html.replace(/<img\b[^>]*>/gi, '');
  html = html.replace(/<a\b[^>]*>/gi, '<span>').replace(/<\/a>/gi, '</span>');
  const allowed: Record<string, boolean> = {
    p: true, div: true, span: true, br: true, hr: true,
    h1: true, h2: true, h3: true, h4: true, h5: true, h6: true,
    em: true, i: true, strong: true, b: true, u: true, s: true,
    blockquote: true, ul: true, ol: true, li: true, pre: true, code: true,
    sup: true, sub: true, center: true,
  };
  html = html.replace(/<\s*(\/?)\s*([a-z0-9]+)(?:\s[^>]*)?>/gi, (_match, closing, tagRaw) => {
    const tag = String(tagRaw || '').toLowerCase();
    if (!allowed[tag]) return '';
    if (tag === 'br' || tag === 'hr') return `<${tag}>`;
    return closing ? `</${tag}>` : `<${tag}>`;
  });
  html = html.replace(/\s{3,}/g, ' ');
  return html.trim();
}

function firstHeading(html: string) {
  const match = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
  if (!match) return '';
  return match[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function flattenEpubToc(epub: any) {
  const labels: Record<string, string> = {};
  const visit = (nodes: any[]) => {
    for (const node of nodes || []) {
      try {
        const resolved = node && node.href ? epub.resolveHref(node.href) : null;
        if (resolved && resolved.id && node.label && !labels[resolved.id]) labels[resolved.id] = String(node.label).trim();
      } catch (_error) {}
      if (node && Array.isArray(node.children)) visit(node.children);
    }
  };
  try { visit(epub.getToc() || []); } catch (_error) {}
  return labels;
}

function flattenKf8Toc(kf8: any) {
  const labels: Record<string, string> = {};
  const visit = (nodes: any[]) => {
    for (const node of nodes || []) {
      try {
        const resolved = node && node.href ? kf8.resolveHref(node.href) : null;
        if (resolved && resolved.id && node.label && !labels[resolved.id]) labels[resolved.id] = String(node.label).trim();
      } catch (_error) {}
      if (node && Array.isArray(node.children)) visit(node.children);
    }
  };
  try { visit(kf8.getToc() || []); } catch (_error) {}
  return labels;
}

async function parseEpub(item: DriveBookItem, bytes: Uint8Array): Promise<ParsedBook> {
  const parserModule = await getEpubParserModule();
  const initEpubFile = parserModule.initEpubFile;
  if (typeof initEpubFile !== 'function') throw new Error('EPUB parser failed to load');
  const resourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kindle-epub-'));
  let epub: any = null;
  try {
    epub = await initEpubFile(bytes as any, resourceDir);
    const metadata: any = epub.getMetadata ? epub.getMetadata() : {};
    const spine: any[] = epub.getSpine ? epub.getSpine() || [] : [];
    const labels = flattenEpubToc(epub);
    const sections: ParsedBookSection[] = [];
    for (let i = 0; i < spine.length; i += 1) {
      if (spine[i] && String(spine[i].linear || '').toLowerCase() === 'no') continue;
      const id = String(spine[i]?.id || '');
      if (!id) continue;
      const chapter: any = await epub.loadChapter(id);
      if (!chapter || !chapter.html) continue;
      const html = sanitizeBookHtml(String(chapter.html));
      if (plainTextLength(html) < 2) continue;
      sections.push({
        index: sections.length,
        title: labels[id] || firstHeading(html) || `Section ${sections.length + 1}`,
        html,
      });
    }
    if (!sections.length) throw new Error('No readable EPUB text sections were found');
    return {
      id: item.id,
      name: item.name,
      title: metadataText(metadata?.title) || item.title,
      author: metadataText(metadata?.creator || metadata?.author),
      format: 'epub',
      modifiedTime: item.modifiedTime,
      size: item.size,
      sections,
    };
  } finally {
    try { if (epub && epub.destroy) epub.destroy(); } catch (_error) {}
    await fs.rm(resourceDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function parseAzw3(item: DriveBookItem, bytes: Uint8Array): Promise<ParsedBook> {
  const parserModule = await getMobiParserModule();
  const initKf8File = parserModule.initKf8File;
  if (typeof initKf8File !== 'function') throw new Error('AZW3 parser failed to load');
  const resourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kindle-azw3-'));
  let kf8: any = null;
  try {
    kf8 = await initKf8File(bytes as any, resourceDir);
    const metadata: any = kf8.getMetadata ? kf8.getMetadata() : {};
    const spine: any[] = kf8.getSpine ? kf8.getSpine() || [] : [];
    const labels = flattenKf8Toc(kf8);
    const sections: ParsedBookSection[] = [];
    for (let i = 0; i < spine.length; i += 1) {
      const id = String(spine[i]?.id || '');
      if (!id) continue;
      const chapter: any = await Promise.resolve(kf8.loadChapter(id));
      if (!chapter || !chapter.html) continue;
      const html = sanitizeBookHtml(String(chapter.html));
      if (plainTextLength(html) < 2) continue;
      sections.push({
        index: sections.length,
        title: labels[id] || firstHeading(html) || `Section ${sections.length + 1}`,
        html,
      });
    }
    if (!sections.length) throw new Error('No readable AZW3 text sections were found');
    return {
      id: item.id,
      name: item.name,
      title: metadataText(metadata?.title) || item.title,
      author: metadataText(metadata?.creator || metadata?.author),
      format: 'azw3',
      modifiedTime: item.modifiedTime,
      size: item.size,
      sections,
    };
  } finally {
    try { if (kf8 && kf8.destroy) kf8.destroy(); } catch (_error) {}
    await fs.rm(resourceDir, { recursive: true, force: true }).catch(() => {});
  }
}

function touchBookCache(key: string, book: ParsedBook) {
  parsedBookCache.delete(key);
  parsedBookCache.set(key, { book, touchedAt: Date.now() });
  while (parsedBookCache.size > BOOK_PARSE_CACHE_LIMIT) {
    const oldestKey = parsedBookCache.keys().next().value;
    if (!oldestKey) break;
    parsedBookCache.delete(oldestKey);
  }
}

export async function getParsedDriveBook(fileIdRaw: unknown) {
  const fileId = String(fileIdRaw || '').trim();
  if (!fileId) throw new Error('Book file id is required');
  const item = await findDriveBook(fileId);
  const cacheKey = `${item.id}:${item.modifiedTime}:${item.size}`;
  const cached = parsedBookCache.get(cacheKey);
  if (cached) {
    touchBookCache(cacheKey, cached.book);
    return cached.book;
  }
  const bytes = await downloadDriveBook(item);
  const book = item.format === 'epub' ? await parseEpub(item, bytes) : await parseAzw3(item, bytes);
  touchBookCache(cacheKey, book);
  return book;
}

export function clearDriveBookLibraryCache() {
  libraryCache = null;
}
