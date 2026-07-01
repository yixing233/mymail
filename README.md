# MyMail

Personal unified inbox for 163, QQ, Outlook, and Gmail.

## Stack

- Next.js 16
- TypeScript
- React 19
- SQLite (`better-sqlite3`)
- Tailwind CSS 4

## Current scope

- Single-user desktop-first inbox
- Receive only
- Unified list with source filters
- Provider-specific integration model
- Metadata-first storage, lazy detail fetch
- Sync health and auth state UI

## Provider strategy

- Gmail: Google OAuth flow, Gmail API or IMAP fallback wired behind `GmailSyncProvider`
- Outlook: Microsoft OAuth flow, Graph or IMAP bridge wired behind `OutlookSyncProvider`
- QQ Mail: IMAP + authorization code via `QQImapSyncProvider`
- 163 Mail: IMAP + client authorization code via `Mail163ImapSyncProvider`

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:12121](http://localhost:12121).

## Desktop

The desktop build wraps the existing Next.js app with Electron, so API routes, SQLite storage, and provider sync continue to run locally.

### Development

```bash
npm run desktop:dev
```

This starts the Next.js dev server on `http://127.0.0.1:12121` and opens the Electron window.

### Production desktop package

```bash
npm run desktop:pack
```

The unpacked executable is generated at `dist-desktop/win-unpacked/MyMail.exe`.

Use `npm run desktop:build` to create installer artifacts under `dist-desktop/`.

Desktop data defaults to Electron's user data directory. Override it with `MYMAIL_DATA_DIR` when needed.

## Docker

### Development

```bash
docker compose up --build app-dev
```

Open [http://localhost:12121](http://localhost:12121).

If port `12121` is already in use on the host, override it:

```bash
MYMAIL_DEV_PORT=12122 docker compose up --build app-dev
```

### Production-style runtime

```bash
docker compose up --build app-prod
```

If port `12121` is already in use on the host, override it:

```bash
MYMAIL_PROD_PORT=12123 docker compose up --build app-prod
```

### Notes

- Compose reads environment variables from `.env`.
- Docker sets `MYMAIL_DATA_DIR=/app/data`.
- SQLite data is stored in the `mymail-data` Docker volume.
- Optional host port overrides: `MYMAIL_DEV_PORT`, `MYMAIL_PROD_PORT`.

## API routes

- `GET /api/inbox`
- `GET /api/providers`
- `POST /api/sync`
- `POST /api/providers/:providerId`

## Notes

- Provider config now persists in local SQLite and supports live OAuth / IMAP setup flows.
- `lib/security.ts` encrypts stored secrets with `MYMAIL_SECRET`.
- `lib/db.ts` creates local SQLite schema for provider credentials and message metadata.

## OAuth env

- Set `MYMAIL_SECRET` before using OAuth in non-dev environments.
- Google callback: `http://localhost:12121/api/oauth/gmail/callback`
- Microsoft callback: `http://localhost:12121/api/oauth/outlook/callback`
