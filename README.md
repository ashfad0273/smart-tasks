# Smart Tasks — Synced To-Do List

A playful Chrome extension to-do list that syncs across devices in real time. Its backend is a Cloudflare Worker.

- **Quick add with natural language:** `Pay rent next week 9am !high #personal`.
- **Tasks:** categories, subtasks, notes, links, priorities, and due dates with desktop reminders that you can mark done or snooze from the notification.
- **Right-click capture:** save selected text, a page or a link as a task.
- **Sync:**
  - Offline-first: everything works without a network and syncs when you're back online.
  - Live updates over WebSockets, so changes from another device appear instantly.
  - Multiple accounts, plus a no-account local mode.
- **Toolbar badge:** shows how many tasks are due today or overdue.
- **Interface:** confetti, progress ring and keyboard shortcuts (`N` new task, `/` search, `Ctrl/⌘+Shift+K` open).

## How it works

```
┌────────────────────────── Chrome extension (WXT + React) ──────────────────────────┐
│  popup UI  ──►  lib/store.ts  ──►  chrome.storage.local                             │
│                  (base + outbox)     st-base:<uid>  server state + rev              │
│                       │              st-outbox:<uid> local edits not yet pushed     │
│  background SW: alarms (sync every 1 min, reminders), badge, context menus          │
└───────────────────────┼─────────────────────────────────────────────────────────────┘
                        │ HTTPS (Bearer token)          ▲ WebSocket {"type":"rev"}
                        ▼                               │
┌──────────────── Cloudflare Worker  smart-tasks-api ──────────────────────────────────┐
│  /v1/auth/*  ──►  D1 "smart-tasks"  (users, sessions, reset codes)                   │
│  /v1/sync    ──►  Durable Object UserHub (one per user, own SQLite, monotonic rev)   │
│  /v1/ws      ──►  same UserHub, hibernatable WebSockets → push "rev changed"         │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **Writes** are stored as ops (`upsert` / `delete`) in a local outbox. The UI shows `base + outbox` immediately, then `sync()` pushes the outbox and pulls changes since the last `rev`.
- **Conflicts:** field-level merge, last write wins. Deletes are tombstoned on the server and never resurrected. Deleting a category un-files its tasks.
- **Auth:** email and password (PBKDF2-SHA256, 100k iterations) or Google sign-in (optional). Sessions are random tokens stored as SHA-256 hashes with a 180-day sliding expiry. Auth endpoints are rate-limited.
- **Local mode:** data stays only in `chrome.storage.local`. Creating an account later imports it.

## Project layout

```
entrypoints/
  background.ts         sync alarm, reminders, badge, context menus
  popup/                React UI (screens/, components/, state/AppContext.tsx)
lib/
  api.ts                typed API client (VITE_API_URL)
  store.ts              offline-first sync engine
  reminders.ts, utils.ts (quick-add parser), types.ts, keys.ts, ext.ts
worker/                 Cloudflare Worker (wrangler.jsonc, src/, migrations/)
scripts/smoke.cjs       end-to-end API smoke test
```

## Develop

```bash
npm install
npm --prefix worker install

# optional: run the API locally instead of production
cp .env.example .env              # VITE_API_URL=http://localhost:8787
npm --prefix worker run db:migrate:local
npm run worker:dev

npm run dev                       # opens Chrome with the extension loaded
```

To load it manually, run `npm run build`, then open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select `dist/chrome-mv3`.

Checks:

```bash
npm run compile                   # type-check extension
npm --prefix worker run typecheck # type-check worker
npm run smoke                     # API smoke test (API_URL=… to target another server)
```

See [SETUP.md](SETUP.md) for deploying the backend, Google sign-in, password-reset email, and publishing to the Chrome Web Store.
