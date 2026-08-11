# Neon account + reading sync setup (ES5 v20)

The Kindle no longer stores growing reading data in `localStorage`.

Server-side data in Neon:
- user accounts
- login sessions
- password reset codes
- reading history
- chapter/page progress
- Saved Manga

Kindle-side persistent data:
- one small HttpOnly session cookie (default 90 days)
- fixed-size reader settings only (fit mode, quality, zoom)

Short-lived RAM only:
- current image/preload window
- 5-page translation hot cache

## Render environment variables

Required for accounts:

```env
DATABASE_URL=YOUR_NEON_CONNECTION_STRING
AUTH_SECRET=GENERATE_A_LONG_RANDOM_SECRET
AUTH_SESSION_DAYS=90
AUTH_RESET_CODE_TTL_MINUTES=10
```

Generate `AUTH_SECRET` locally:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Password reset email

Choose one provider.

### Option A - Brevo

```env
BREVO_API_KEY=YOUR_BREVO_API_KEY
MAIL_FROM_EMAIL=YOUR_VERIFIED_SENDER_EMAIL
MAIL_FROM_NAME=Manga Kindle
```

### Option B - Resend

```env
RESEND_API_KEY=YOUR_RESEND_API_KEY
RESEND_FROM_EMAIL=Manga Kindle <noreply@YOUR_DOMAIN>
```

The server creates the database tables automatically on startup. You do not need
to paste SQL into Neon manually.

## Render deploy

Keep the existing commands:

```text
Build Command: npm install && npm run build
Start Command: npm start
```

After adding `DATABASE_URL`, deploy/redeploy the service. The server log should show:

```text
Account database: Neon/Postgres connected
```

Open:

```text
https://YOUR-APP.onrender.com/kindle?t=20
```

Use the **Login** button in the top bar to register or sign in.

## Notes

- History API pages contain at most 40 entries.
- Reading is still allowed while logged out, but progress/history/saved manga are not stored.
- A normal Kindle/browser restart should preserve the session cookie. If the Kindle
  wipes all browser data, log in again; the reading data remains in Neon.
- Never commit `DATABASE_URL`, email API keys, or `AUTH_SECRET` to GitHub.
