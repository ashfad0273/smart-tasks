# Setup, deployment and publishing

## 1. Deploy the backend (Cloudflare)

You need a Cloudflare account (the free plan is fine) and `npx wrangler login`.

```bash
cd worker
npm install
npx wrangler d1 create smart-tasks
```

Put the printed `database_id` into `wrangler.jsonc` under `d1_databases`, then:

```bash
npm run db:migrate:remote
npm run deploy
```

Wrangler prints the Worker URL, e.g. `https://smart-tasks-api.<you>.workers.dev`. If it differs from the default in `lib/api.ts`, set it at build time:

```bash
echo "VITE_API_URL=https://smart-tasks-api.<you>.workers.dev" > ../.env
```

Verify it:

```bash
API_URL=https://smart-tasks-api.<you>.workers.dev npm --prefix .. run smoke
```

The privacy policy is served by the Worker at `<API_URL>/privacy`. Use that URL in the Web Store listing.

## 2. Optional: Google sign-in

1. In Google Cloud Console, go to **APIs & Services → Credentials → Create OAuth client ID → Web application**.
2. Add this **Authorized redirect URI**: `https://<EXTENSION_ID>.chromiumapp.org/`
   - Dev builds use a pinned key, so the ID is always `ogaknheecofagmolhcbpbdjhfbobgmbc`.
   - Add the Web Store ID too once you have it (it is shown in the developer dashboard after the first upload).
3. Configure the OAuth consent screen with scopes `openid email profile`.
4. Put the client ID into `worker/wrangler.jsonc` → `vars.GOOGLE_CLIENT_ID` and run `npm run deploy`.

The extension reads the client ID from `GET /v1/config`, so you don't need to rebuild it. The "Continue with Google" button appears automatically.

## 3. Optional: password-reset emails

Password reset sends a 6-digit code using Cloudflare Email Sending. It is off until a sending domain is set up. Until then, "Forgot password?" on the sign-in screen shows a note pointing Gmail users to "Continue with Google".

```bash
npx wrangler email sending enable yourdomain.com   # then add the DNS records it prints
```

In `worker/wrangler.jsonc`:

- set `vars.EMAIL_FROM` to e.g. `no-reply@yourdomain.com`
- uncomment `"send_email": [{ "name": "EMAIL" }]`

Then run `npm run deploy`. `/v1/config` will report `passwordReset: true`.

## 4. Publish to the Chrome Web Store

1. Register a developer account at <https://chrome.google.com/webstore/devconsole> (one-time US$5 fee).
2. Build the store package. This leaves out the dev-only manifest `key`, which the store rejects:
   ```bash
   npm run zip        # → dist/smart-tasks-1.0.0-chrome.zip
   ```
3. Upload the zip and fill in the listing:
   - **Category:** Productivity.
   - **Icon:** 128×128 from `public/icon/128.png`. A 512 px source is in `design/icon-512.png`.
   - **Screenshots:** at least one at 1280×800 or 640×400. Take them from the popup.
   - **Privacy policy URL:** `<API_URL>/privacy`.
   - **Single purpose:** "Manage a personal to-do list that syncs across the user's devices."
4. Permission justifications:

   | Permission | Why |
   | --- | --- |
   | `storage` | Store tasks offline and remember signed-in accounts. |
   | `alarms` | Periodic background sync and scheduling due-date reminders. |
   | `notifications` | Show reminders when a task is due, with Done / Snooze buttons. |
   | `contextMenus` | "Add to Smart Tasks" on selected text, pages and links. |
   | `identity` | Optional Google sign-in via `chrome.identity.launchWebAuthFlow`. |
   | Host access | None. The extension only calls its own API with `fetch`, which needs no host permission because the API allows CORS. |

5. **Data use disclosures:** check "Personally identifiable information" (email, name) and "User activity / website content" (task text, saved links). Say the data is not sold or used for unrelated purposes, and is only used to provide sync.
6. Submit for review.

## Release checklist

- [ ] Bump `version` in `wxt.config.ts` and `package.json`.
- [ ] `npm run compile && npm --prefix worker run typecheck`
- [ ] `npm --prefix worker run deploy` if the API changed (deploy the backend **before** the extension).
- [ ] `npm run smoke`
- [ ] `npm run zip` and upload.
