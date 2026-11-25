export const PRIVACY_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Smart Tasks — Privacy Policy</title>
<style>body{font:16px/1.65 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#1f2937}h1{font-size:28px}h2{font-size:19px;margin-top:28px}code{background:#f3f4f6;padding:1px 5px;border-radius:4px}</style>
</head><body>
<h1>Smart Tasks — Privacy Policy</h1>
<p><em>Last updated: November 23, 2026</em></p>
<p>Smart Tasks is a to-do list browser extension. This policy explains what data it handles and why. In short: we store only what's needed to sync your tasks, we never sell it, and you can delete it at any time.</p>

<h2>What we collect</h2>
<ul>
<li><strong>Account details</strong> — your email address, display name and a salted, hashed password (we never see or store your actual password). If you sign in with Google, we receive your Google account ID, email, name and profile photo URL.</li>
<li><strong>Your content</strong> — tasks, subtasks, notes, categories, due dates, and the page URL/title when you choose to save a page with the right-click menu.</li>
<li><strong>Clipboard sync (desktop app, off unless you turn it on)</strong>: what you copy is encrypted on your computer with a key only your computers hold, then relayed to your other computers. Our server sees only encrypted data it cannot read, keeps it for at most 10 minutes so a computer can fetch it, then deletes it. Clearing your clipboard on one computer is never sent.</li>
<li><strong>Session data</strong> — a random sign-in token (stored hashed on our server) and its creation/last-used dates.</li>
</ul>
<p>If you use Smart Tasks <strong>without an account</strong> ("local only"), nothing is sent to our servers — everything stays in your browser.</p>
<p>We do <strong>not</strong> collect browsing history, analytics, advertising identifiers, or the contents of pages you visit. The extension only reads a page's title and URL when you explicitly click "Save this page as a task".</p>

<h2>How we use it</h2>
<p>Solely to provide the service: signing you in, storing your tasks and syncing them across your devices, and sending password-reset codes you request. We do not use your data for advertising, profiling, or training AI models, and we do not sell or share it with third parties.</p>

<h2>Where it's stored</h2>
<p>Data is stored on Cloudflare's infrastructure (Cloudflare Workers, D1 and Durable Objects), encrypted in transit (HTTPS/WSS) and at rest. Each account's tasks are kept in an isolated storage unit that only that account's sign-in token can access. A copy of your tasks is cached in your browser's extension storage so the app works offline.</p>

<h2>Your choices</h2>
<ul>
<li><strong>Export</strong> — Settings → Your data → Export JSON downloads everything.</li>
<li><strong>Delete</strong> — Settings → Your data → Delete account permanently erases your account and all tasks from our servers immediately.</li>
<li><strong>Sign out</strong> removes your data from the current browser.</li>
</ul>

<h2>Permissions the extension requests</h2>
<ul>
<li><code>storage</code> — offline cache of your tasks and settings.</li>
<li><code>alarms</code> &amp; <code>notifications</code> — background sync and due-time reminders.</li>
<li><code>contextMenus</code> — the right-click "Add task" menu.</li>
<li><code>identity</code> — optional "Continue with Google" sign-in.</li>
</ul>

<h2>Limited Use</h2>
<p>Smart Tasks' use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.</p>

<h2>Contact</h2>
<p>Questions or requests: open an issue at <a href="https://github.com/ashfad0273/smart-tasks/issues">github.com/ashfad0273/smart-tasks</a>.</p>
</body></html>`;
