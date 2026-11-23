# Production readiness checklist

Where Smart Tasks stands (v1.5.1, Nov 2026) and what is left before it is ready for
the public. Tick items off as they are done.

**Who:** 🧑 = needs you (your accounts, money, or your own login) · 🤖 = Claude can do it in code · 🧑🤖 = both

**Current status:** good for you and a few early users (public beta). The items under
"Blockers" are what stand between this and a public launch.

---

## 1. Verify what is already shipped

- [ ] 🧑 **Real Google sign-in in the Windows app.** Open Smart Tasks → I already have one →
      Continue with Google, sign in in the browser, and confirm the app signs you in.
      (Redirect `http://127.0.0.1:47813/google` was added to the OAuth client on 24 Nov 2026.)
- [ ] 🧑 **Google sign-in in the extension** still works (it uses the `chromiumapp.org` redirect).
- [ ] 🧑 **Mac app on a real Mac** (borrow one if needed). Check that it opens, the menu bar icon
      works, ⌘⌥K works, notifications show with buttons, and Open at Login works.
- [ ] 🧑🤖 **Auto-update end to end.** Install an older version, publish a newer one, and confirm
      the app updates itself (Windows and Mac).
- [ ] 🧑 **Extension auto-update** from one version to the next on a clean browser profile.

## 2. Blockers for a public launch

### Google sign-in for everyone
- [ ] 🧑 **Publish the OAuth consent screen.** Go to Google Cloud Console → Google Auth Platform →
      Audience → Publish app. While it is in "Testing", only test users you add (max 100) can sign in.
- [ ] 🧑 **Branding:** rename the project from "My First Project", and set the app name, logo,
      support email, home page and privacy policy link under Branding.
- [ ] 🧑 **Google verification** if Google asks for it. Basic scopes (email, profile, openid)
      usually only need brand verification, which takes a few days.
- [ ] 🤖 **Switch the desktop sign-in to the "authorization code + PKCE" flow** (Google's
      recommended way for desktop apps) instead of the older implicit `id_token` flow. Handle
      port 47813 already being in use.

### Code signing (removes the "unsafe app" warnings)
- [ ] 🧑 **Windows code-signing certificate.** Options: Azure Trusted Signing (~$10/month,
      cheapest), or an OV/EV certificate (~$100–400/year). Without it Windows SmartScreen says
      "Windows protected your PC".
- [ ] 🤖 Wire Windows signing into the build (`tauri.conf.json` signCommand or a CI step).
- [ ] 🧑 **Apple Developer Program** ($99/year). Then create a "Developer ID Application"
      certificate and an app-specific password.
- [ ] 🧑 Add the GitHub secrets: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
      `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.
      The macOS workflow already uses them, and with them the app is signed and notarized.

### Chrome Web Store
- [ ] 🧑 **Developer account** ($5 one-time) at chrome.google.com/webstore/devconsole.
- [ ] 🧑🤖 **Store listing:** icon, 1280×800 screenshots, short and long description,
      category, privacy-practices form, permission justifications. Claude can draft all the
      text and produce the screenshots.
- [ ] 🤖 Store build: `npm run zip` (STORE_BUILD=1) and turn off the self-updater in store builds
      (the store updates the extension itself).
- [ ] 🧑 Submit for review (usually a few days). Then add the store link to the download page.
- [ ] 🧑 Optional: Microsoft Edge Add-ons (free).

## 3. Reliability and support

- [ ] 🤖 **Crash and error reporting** (e.g. Sentry free tier) for the app, the extension and the
      API worker, so you hear about problems. 🧑 Create the Sentry account.
- [ ] 🤖 **Uptime check** on the API and the download site (e.g. a Cloudflare health check or
      UptimeRobot).
- [ ] 🤖 **Backups** of the database behind the API worker (scheduled export).
- [ ] 🤖 **Rate limits and abuse protection** on sign-up, sign-in and password reset endpoints.
- [ ] 🧑 **Support channel:** a support email, listed on the site and in Settings.

## 4. Release process

- [ ] 🤖 **Build Windows in GitHub Actions too** (not just on this PC), so a single tag
      (`git tag v1.6.0 && git push --tags`) builds both apps and publishes them.
- [ ] 🤖 **Automated tests** in CI: type check, `npm run smoke`, a build of the extension,
      and `cargo check` for the desktop app on every push.
- [ ] 🧑🤖 **Work on branches with pull requests** instead of committing straight to `main`.
- [ ] 🧑 **Back up the updater key** (`~/.smart-tasks/updater.key`) in a password manager.
      If it is lost, installed apps can never auto-update again.

## 5. Trust and polish

- [ ] 🧑 **Your own domain** (e.g. smarttasks.app, ~$10–15/year), connected in Cloudflare.
      🤖 Then move the site, API and updater URLs over, keeping the old ones redirecting.
- [ ] 🧑🤖 **Privacy policy and terms** reviewed and up to date (desktop app, Google sign-in,
      AI agent access). Claude can draft them, and you should have them checked.
- [ ] 🤖 **Accessibility pass** (keyboard navigation, screen reader labels, contrast) in the app.
- [ ] 🤖 **Open Graph image and meta** for the download page, so links look good when shared.
- [ ] 🧑 Optional: **analytics** (privacy-friendly, e.g. Cloudflare Web Analytics) on the site.

---

## Suggested order

1. Verify Google sign-in (section 1).
2. Publish the consent screen and fill in branding (free, about 30 minutes).
3. Chrome Web Store ($5).
4. Crash reporting + Windows build in CI.
5. Code signing (Azure Trusted Signing for Windows, Apple Developer for Mac).
6. Own domain.
