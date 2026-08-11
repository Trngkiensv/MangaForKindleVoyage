import crypto from 'crypto';
import { Pool } from 'pg';

export type AuthUser = {
  id: number;
  username: string;
  email: string;
};

type SessionResult = {
  user: AuthUser;
  token: string;
  expiresAt: Date;
};

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const SESSION_DAYS = Math.max(1, Math.min(365, parseInt(String(process.env.AUTH_SESSION_DAYS || '90'), 10) || 90));
const RESET_CODE_TTL_MINUTES = Math.max(5, Math.min(30, parseInt(String(process.env.AUTH_RESET_CODE_TTL_MINUTES || '10'), 10) || 10));
const AUTH_SECRET = String(process.env.AUTH_SECRET || '').trim();
const BREVO_API_KEY = String(process.env.BREVO_API_KEY || '').trim();
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || '').trim();
const MAIL_FROM_EMAIL = String(process.env.MAIL_FROM_EMAIL || '').trim();
const MAIL_FROM_NAME = String(process.env.MAIL_FROM_NAME || 'Manga Kindle').trim();
const RESEND_FROM_EMAIL = String(process.env.RESEND_FROM_EMAIL || '').trim();
const APP_NAME = String(process.env.APP_NAME || 'Manga for Kindle Voyage').trim();

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  : null;

let initialized = false;
let initPromise: Promise<void> | null = null;

export function authDatabaseConfigured() {
  return !!pool;
}

export function mailConfigured() {
  return !!(AUTH_SECRET && ((BREVO_API_KEY && MAIL_FROM_EMAIL) || (RESEND_API_KEY && (RESEND_FROM_EMAIL || MAIL_FROM_EMAIL))));
}

function ensurePool() {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  return pool;
}

function normalizeUsername(value: unknown) {
  return String(value || '').trim();
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizeIdentifier(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function validateUsername(username: string) {
  return /^[A-Za-z0-9_.-]{3,32}$/.test(username);
}

function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function validatePassword(password: string) {
  return password.length >= 8 && password.length <= 128;
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function codeHash(code: string) {
  if (AUTH_SECRET) return crypto.createHmac('sha256', AUTH_SECRET).update(code).digest('hex');
  return sha256(code);
}

async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 32, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = parts[1];
  const expected = Buffer.from(parts[2], 'hex');
  if (!expected.length) return false;
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, expected.length, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

function publicUser(row: any): AuthUser {
  return {
    id: Number(row.id),
    username: String(row.username),
    email: String(row.email),
  };
}

export async function initAuthDatabase() {
  if (initialized || !pool) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const db = ensurePool();
    await db.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        id BIGSERIAL PRIMARY KEY,
        username VARCHAR(32) NOT NULL,
        username_lower VARCHAR(32) NOT NULL UNIQUE,
        email VARCHAR(254) NOT NULL,
        email_lower VARCHAR(254) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS app_sessions (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS app_sessions_user_idx ON app_sessions(user_id);
      CREATE INDEX IF NOT EXISTS app_sessions_expiry_idx ON app_sessions(expires_at);

      CREATE TABLE IF NOT EXISTS password_reset_codes (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        code_hash CHAR(64) NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS password_reset_user_idx ON password_reset_codes(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS reading_progress (
        user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        provider VARCHAR(40) NOT NULL,
        manga_id TEXT NOT NULL,
        manga_title TEXT NOT NULL DEFAULT '',
        chapter_id TEXT NOT NULL,
        chapter_number TEXT NOT NULL DEFAULT '',
        is_volume BOOLEAN NOT NULL DEFAULT FALSE,
        page_index INTEGER NOT NULL DEFAULT 0,
        page_count INTEGER NOT NULL DEFAULT 0,
        client_millis BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, provider, chapter_id)
      );
      ALTER TABLE reading_progress ADD COLUMN IF NOT EXISTS client_millis BIGINT NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS reading_progress_history_idx ON reading_progress(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS saved_manga (
        user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        provider VARCHAR(40) NOT NULL,
        manga_id TEXT NOT NULL,
        manga_title TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, provider, manga_id)
      );
      CREATE INDEX IF NOT EXISTS saved_manga_user_idx ON saved_manga(user_id, created_at DESC);
    `);
    initialized = true;
  })();
  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

async function ensureReady() {
  if (!initialized) await initAuthDatabase();
  return ensurePool();
}

export async function registerUser(usernameRaw: unknown, emailRaw: unknown, passwordRaw: unknown): Promise<SessionResult> {
  const db = await ensureReady();
  const username = normalizeUsername(usernameRaw);
  const usernameLower = username.toLowerCase();
  const email = normalizeEmail(emailRaw);
  const password = String(passwordRaw || '');

  if (!validateUsername(username)) throw new Error('Username must be 3-32 characters: letters, numbers, dot, dash or underscore');
  if (!validateEmail(email)) throw new Error('Please enter a valid email address');
  if (!validatePassword(password)) throw new Error('Password must be 8-128 characters');

  const passwordHash = await hashPassword(password);
  let row;
  try {
    const result = await db.query(
      `INSERT INTO app_users (username, username_lower, email, email_lower, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email`,
      [username, usernameLower, email, email, passwordHash],
    );
    row = result.rows[0];
  } catch (error: any) {
    if (error && error.code === '23505') throw new Error('Username or email is already registered');
    throw error;
  }
  return createSession(publicUser(row));
}

export async function loginUser(identifierRaw: unknown, passwordRaw: unknown): Promise<SessionResult> {
  const db = await ensureReady();
  const identifier = normalizeIdentifier(identifierRaw);
  const password = String(passwordRaw || '');
  if (!identifier || !password) throw new Error('Username/email and password are required');

  const result = await db.query(
    `SELECT id, username, email, password_hash
       FROM app_users
      WHERE username_lower = $1 OR email_lower = $1
      LIMIT 1`,
    [identifier],
  );
  const row = result.rows[0];
  if (!row || !(await verifyPassword(password, String(row.password_hash)))) {
    throw new Error('Invalid username/email or password');
  }
  return createSession(publicUser(row));
}

async function createSession(user: AuthUser): Promise<SessionResult> {
  const db = await ensureReady();
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.query(
    `INSERT INTO app_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, tokenHash, expiresAt],
  );
  await db.query(
    `DELETE FROM app_sessions
      WHERE user_id = $1
        AND id NOT IN (
          SELECT id FROM app_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10
        )`,
    [user.id],
  );
  return { user, token, expiresAt };
}

export async function getUserBySessionToken(token: string): Promise<AuthUser | null> {
  if (!token || !pool) return null;
  const db = await ensureReady();
  const result = await db.query(
    `SELECT u.id, u.username, u.email, s.id AS session_id
       FROM app_sessions s
       JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW()
      LIMIT 1`,
    [sha256(token)],
  );
  const row = result.rows[0];
  if (!row) return null;
  void db.query(`UPDATE app_sessions SET last_seen_at = NOW() WHERE id = $1`, [row.session_id]).catch(() => {});
  return publicUser(row);
}

export async function logoutSession(token: string) {
  if (!token || !pool) return;
  const db = await ensureReady();
  await db.query(`DELETE FROM app_sessions WHERE token_hash = $1`, [sha256(token)]);
}

export async function requestPasswordReset(identifierRaw: unknown) {
  const db = await ensureReady();
  const identifier = normalizeIdentifier(identifierRaw);
  if (!identifier) return;
  const result = await db.query(
    `SELECT id, username, email
       FROM app_users
      WHERE username_lower = $1 OR email_lower = $1
      LIMIT 1`,
    [identifier],
  );
  const row = result.rows[0];
  if (!row) return;

  const recent = await db.query(
    `SELECT created_at FROM password_reset_codes
      WHERE user_id = $1 AND created_at > NOW() - INTERVAL '60 seconds'
      ORDER BY created_at DESC LIMIT 1`,
    [row.id],
  );
  if (recent.rows.length) return;

  const code = String(crypto.randomInt(100000, 1000000));
  await db.query(`UPDATE password_reset_codes SET consumed_at = NOW() WHERE user_id = $1 AND consumed_at IS NULL`, [row.id]);
  await db.query(
    `INSERT INTO password_reset_codes (user_id, code_hash, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval)`,
    [row.id, codeHash(code), String(RESET_CODE_TTL_MINUTES)],
  );
  await sendResetCode(String(row.email), String(row.username), code);
}

async function sendResetCode(email: string, username: string, code: string) {
  if (!AUTH_SECRET) throw new Error('AUTH_SECRET is required for password reset');
  const subject = `${APP_NAME} password reset code`;
  const text = `Hello ${username},\n\nYour ${APP_NAME} password reset code is: ${code}\n\nThis code expires in ${RESET_CODE_TTL_MINUTES} minutes. If you did not request this, you can ignore this email.`;

  if (BREVO_API_KEY && MAIL_FROM_EMAIL) {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: MAIL_FROM_NAME, email: MAIL_FROM_EMAIL },
        to: [{ email }],
        subject,
        textContent: text,
      }),
    });
    if (!response.ok) {
      let message = `Brevo HTTP ${response.status}`;
      try {
        const payload: any = await response.json();
        if (payload && payload.message) message = String(payload.message);
      } catch (_error) {}
      throw new Error(message);
    }
    return;
  }

  const resendFrom = RESEND_FROM_EMAIL || (MAIL_FROM_EMAIL ? `${MAIL_FROM_NAME} <${MAIL_FROM_EMAIL}>` : '');
  if (RESEND_API_KEY && resendFrom) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: resendFrom, to: [email], subject, text }),
    });
    if (!response.ok) {
      let message = `Resend HTTP ${response.status}`;
      try {
        const payload: any = await response.json();
        if (payload && payload.message) message = String(payload.message);
      } catch (_error) {}
      throw new Error(message);
    }
    return;
  }

  throw new Error('Password reset email is not configured on the server');
}

export async function resetPassword(identifierRaw: unknown, codeRaw: unknown, newPasswordRaw: unknown): Promise<SessionResult> {
  const db = await ensureReady();
  const identifier = normalizeIdentifier(identifierRaw);
  const code = String(codeRaw || '').trim();
  const newPassword = String(newPasswordRaw || '');
  if (!/^\d{6}$/.test(code)) throw new Error('Reset code must contain 6 digits');
  if (!validatePassword(newPassword)) throw new Error('Password must be 8-128 characters');

  const userResult = await db.query(
    `SELECT id, username, email FROM app_users
      WHERE username_lower = $1 OR email_lower = $1
      LIMIT 1`,
    [identifier],
  );
  const userRow = userResult.rows[0];
  if (!userRow) throw new Error('Invalid or expired reset code');

  const codeResult = await db.query(
    `SELECT id, code_hash, attempts
       FROM password_reset_codes
      WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1`,
    [userRow.id],
  );
  const resetRow = codeResult.rows[0];
  if (!resetRow) throw new Error('Invalid or expired reset code');
  if (Number(resetRow.attempts) >= 5) throw new Error('Too many incorrect attempts; request a new code');
  if (!crypto.timingSafeEqual(Buffer.from(String(resetRow.code_hash)), Buffer.from(codeHash(code)))) {
    await db.query(`UPDATE password_reset_codes SET attempts = attempts + 1 WHERE id = $1`, [resetRow.id]);
    throw new Error('Invalid or expired reset code');
  }

  const passwordHash = await hashPassword(newPassword);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE app_users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [passwordHash, userRow.id]);
    await client.query(`UPDATE password_reset_codes SET consumed_at = NOW() WHERE id = $1`, [resetRow.id]);
    await client.query(`DELETE FROM app_sessions WHERE user_id = $1`, [userRow.id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return createSession(publicUser(userRow));
}

export async function getProgress(userId: number, provider: string, chapterId: string) {
  const db = await ensureReady();
  const result = await db.query(
    `SELECT manga_id, manga_title, chapter_id, chapter_number, is_volume, page_index, page_count, updated_at
       FROM reading_progress
      WHERE user_id = $1 AND provider = $2 AND chapter_id = $3
      LIMIT 1`,
    [userId, provider, chapterId],
  );
  return result.rows[0] || null;
}

export async function saveProgress(userId: number, provider: string, input: any) {
  const db = await ensureReady();
  const mangaId = String(input.mangaId || '').slice(0, 1000);
  const mangaTitle = String(input.mangaTitle || '').slice(0, 1000);
  const chapterId = String(input.chapterId || '').slice(0, 1000);
  const chapterNumber = String(input.chapterNumber || '').slice(0, 100);
  const isVolume = !!input.isVolume;
  let pageIndex = parseInt(String(input.pageIndex || '0'), 10);
  let pageCount = parseInt(String(input.pageCount || '0'), 10);
  let clientMillis = parseInt(String(input.clientMillis || Date.now()), 10);
  if (!mangaId || !chapterId) throw new Error('mangaId and chapterId are required');
  if (!isFinite(pageIndex) || pageIndex < 0) pageIndex = 0;
  if (!isFinite(pageCount) || pageCount < 0) pageCount = 0;
  if (!isFinite(clientMillis) || clientMillis < 0) clientMillis = Date.now();
  if (pageCount && pageIndex >= pageCount) pageIndex = pageCount - 1;

  await db.query(
    `INSERT INTO reading_progress
       (user_id, provider, manga_id, manga_title, chapter_id, chapter_number, is_volume, page_index, page_count, client_millis, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
     ON CONFLICT (user_id, provider, chapter_id)
     DO UPDATE SET
       manga_id = EXCLUDED.manga_id,
       manga_title = EXCLUDED.manga_title,
       chapter_number = EXCLUDED.chapter_number,
       is_volume = EXCLUDED.is_volume,
       page_index = EXCLUDED.page_index,
       page_count = EXCLUDED.page_count,
       client_millis = EXCLUDED.client_millis,
       updated_at = NOW()
     WHERE EXCLUDED.client_millis >= reading_progress.client_millis`,
    [userId, provider, mangaId, mangaTitle, chapterId, chapterNumber, isVolume, pageIndex, pageCount, clientMillis],
  );
}

export async function getReadChapterIds(userId: number, provider: string, mangaIdRaw: unknown, chapterIdsRaw: unknown) {
  const db = await ensureReady();
  const mangaId = String(mangaIdRaw || '').slice(0, 1000);
  const raw = Array.isArray(chapterIdsRaw) ? chapterIdsRaw : [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of raw) {
    const id = String(value || '').slice(0, 1000);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= 100) break;
  }
  if (!mangaId || !ids.length) return [];
  const result = await db.query(
    `SELECT chapter_id
       FROM reading_progress
      WHERE user_id = $1 AND provider = $2 AND manga_id = $3
        AND chapter_id = ANY($4::text[])`,
    [userId, provider, mangaId, ids],
  );
  return result.rows.map((row: any) => String(row.chapter_id));
}

export async function getHistory(userId: number, pageRaw: unknown, limitRaw: unknown) {
  const db = await ensureReady();
  let page = parseInt(String(pageRaw || '1'), 10);
  let limit = parseInt(String(limitRaw || '40'), 10);
  if (!isFinite(page) || page < 1) page = 1;
  if (!isFinite(limit) || limit < 1) limit = 40;
  limit = Math.min(40, limit);
  const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM reading_progress WHERE user_id = $1`, [userId]);
  const total = Number(countResult.rows[0]?.total || 0);
  const pages = Math.max(1, Math.ceil(total / limit));
  if (page > pages) page = pages;
  const offset = (page - 1) * limit;
  const result = await db.query(
    `SELECT provider, manga_id, manga_title, chapter_id, chapter_number, is_volume, page_index, page_count, updated_at
       FROM reading_progress
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  return { items: result.rows, total, page, pages, limit };
}

export async function getSavedManga(userId: number, pageRaw: unknown, limitRaw: unknown) {
  const db = await ensureReady();
  let page = parseInt(String(pageRaw || '1'), 10);
  let limit = parseInt(String(limitRaw || '40'), 10);
  if (!isFinite(page) || page < 1) page = 1;
  if (!isFinite(limit) || limit < 1) limit = 40;
  limit = Math.min(40, limit);
  const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM saved_manga WHERE user_id = $1`, [userId]);
  const total = Number(countResult.rows[0]?.total || 0);
  const pages = Math.max(1, Math.ceil(total / limit));
  if (page > pages) page = pages;
  const offset = (page - 1) * limit;
  const result = await db.query(
    `SELECT provider, manga_id, manga_title, created_at
       FROM saved_manga
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  return { items: result.rows, total, page, pages, limit };
}

export async function getSavedMangaIds(userId: number, provider: string, mangaIdsRaw: unknown) {
  const db = await ensureReady();
  const raw = Array.isArray(mangaIdsRaw) ? mangaIdsRaw : [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of raw) {
    const id = String(value || '').slice(0, 1000);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= 40) break;
  }
  if (!ids.length) return [];
  const result = await db.query(
    `SELECT manga_id
       FROM saved_manga
      WHERE user_id = $1 AND provider = $2
        AND manga_id = ANY($3::text[])`,
    [userId, provider, ids],
  );
  return result.rows.map((row: any) => String(row.manga_id));
}

export async function isMangaSaved(userId: number, provider: string, mangaId: string) {
  const db = await ensureReady();
  const result = await db.query(
    `SELECT 1 FROM saved_manga WHERE user_id = $1 AND provider = $2 AND manga_id = $3 LIMIT 1`,
    [userId, provider, mangaId],
  );
  return !!result.rows.length;
}

export async function saveManga(userId: number, provider: string, mangaId: string, mangaTitle: string) {
  const db = await ensureReady();
  await db.query(
    `INSERT INTO saved_manga (user_id, provider, manga_id, manga_title)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, provider, manga_id)
     DO UPDATE SET manga_title = EXCLUDED.manga_title`,
    [userId, provider, mangaId.slice(0, 1000), mangaTitle.slice(0, 1000)],
  );
}

export async function removeSavedManga(userId: number, provider: string, mangaId: string) {
  const db = await ensureReady();
  await db.query(`DELETE FROM saved_manga WHERE user_id = $1 AND provider = $2 AND manga_id = $3`, [userId, provider, mangaId]);
}

export async function cleanupExpiredAuthData() {
  if (!pool) return;
  const db = await ensureReady();
  await db.query(`DELETE FROM app_sessions WHERE expires_at <= NOW()`);
  await db.query(`DELETE FROM password_reset_codes WHERE expires_at < NOW() - INTERVAL '1 day' OR consumed_at < NOW() - INTERVAL '1 day'`);
}
