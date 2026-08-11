# Google Drive EPUB / AZW3 Books Setup

The Kindle text-book reader reads `.epub` and `.azw3` files from **one Google Drive folder**. Google Drive credentials stay on the Node/Render server; the Kindle never receives them and never downloads the whole ebook into localStorage.

## 1. Create a Google Cloud service account

1. Open Google Cloud Console and select/create a project.
2. Enable **Google Drive API** for the project.
3. Open **IAM & Admin → Service Accounts**.
4. Create a service account, then create a **JSON key** for it.
5. Keep the JSON file private. Do not commit it to GitHub.

## 2. Share the book folder

Create or choose one Drive folder containing your ebook files.

Supported files:

```text
.epub
.azw3
```

Open the service-account JSON and copy its `client_email`, then share the book folder with that email as **Viewer**.

Copy the folder ID from the Drive URL:

```text
https://drive.google.com/drive/folders/FOLDER_ID_HERE
```

## 3. Environment variables

Set:

```env
GOOGLE_DRIVE_FOLDER_ID=FOLDER_ID_HERE
GOOGLE_SERVICE_ACCOUNT_JSON=SERVICE_ACCOUNT_JSON_OR_BASE64
```

For Render, Base64 is often easier than pasting a multiline private key.

PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("service-account.json"))
```

Copy the resulting one-line value into Render as `GOOGLE_SERVICE_ACCOUNT_JSON`.

Optional limits:

```env
BOOK_LIBRARY_CACHE_SECONDS=60
BOOK_PARSE_CACHE_LIMIT=3
BOOK_MAX_FILE_MB=80
```

## 4. Install dependencies

```bash
npm install
```

The project uses server-side parsers for EPUB and Kindle KF8/AZW3. Ebook HTML is sanitized on the server and only the current text section is sent to the Kindle.

## 5. Open Books

Restart/deploy the app and open:

```text
/kindle?t=231
```

Tap **Books** in the top navigation.

The folder is paged at 40 files per page. Reading position is synced to Neon when logged in.

## Kindle storage behavior

Kindle localStorage keeps only small fixed reader preferences:

- font size
- typeface
- text margins
- line spacing
- existing manga fit/zoom preferences

Growing data stays off the Kindle:

- ebook files: Google Drive
- book parsing/cache: server memory
- book reading position: Neon
- manga history/progress/saved manga: Neon

The service-account credentials and Google Drive access token are server-only.

## Render / Node ESM note (v23.1)

The ebook parser packages publish separate Node ESM and CommonJS entry points. The server is built as ESM (`dist/server.mjs`) so Node selects the working `import` entry point. The parser modules are also lazy-loaded only when an EPUB/AZW3 is opened, so a parser problem cannot crash the whole manga server during startup.

If upgrading from v23, make sure Render uses the project scripts as-is:

```text
Build Command: npm install && npm run build
Start Command: npm start
```

Do not override the Start Command with `node dist/server.cjs`; v23.1 starts `dist/server.mjs`.
