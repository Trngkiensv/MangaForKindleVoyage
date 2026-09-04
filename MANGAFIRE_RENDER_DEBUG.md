# MangaFire Render Debug

This build includes two fixed-target debug endpoints for Render Free, where shell access is unavailable.

## 1. Test MangaFire homepage from Render

Open:

```text
https://YOUR-APP.onrender.com/api/debug/mangafire
```

Healthy example:

```json
{
  "ok": true,
  "test": "homepage",
  "status": 200
}
```

Cloudflare-blocked example:

```json
{
  "ok": false,
  "test": "homepage",
  "status": 403,
  "server": "cloudflare",
  "preview": "<!DOCTYPE html>...<title>Just a moment...</title>..."
}
```

## 2. Test the exact MangaFire provider search path

Open:

```text
https://YOUR-APP.onrender.com/api/debug/mangafire/search?q=naruto
```

This goes through the same `MangaFireProvider.search()` implementation used by the normal app, including its VRF signature.

If homepage is 403, the Render outbound network is being challenged before the provider can work.
If homepage is 200 but provider search is 403, MangaFire/Cloudflare is specifically challenging the API request/path.
If both are 200, MangaFire connectivity from Render is currently healthy.

The routes are rate-limited and cannot proxy arbitrary URLs.
