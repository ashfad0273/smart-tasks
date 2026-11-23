# Smart Tasks — Chrome Extension Design Analysis & Build Plan

> **✅ STATUS (update): the extension is now BUILT** — see the `smart-tasks/` folder.
> Phases 0–7 of the roadmap below are complete (UI, email auth, realtime
> Firestore sync, offline-first cache, multi-account switching, demo mode,
> background sync via offscreen document + alarms, due-time reminders,
> right-click capture from any page). All verified by automated tests,
> including a real-browser E2E that loads the extension and fires a live
> reminder notification. Remaining: phase 8 (optional Chrome Web Store
> publishing, $5 — everything works free via "Load unpacked").
> Build + setup instructions: `smart-tasks/README.md` and
> `smart-tasks/SETUP.md`.

*Prepared from your 6 design screens: Login, Sign Up, Dashboard, Edit Task, Categories, Account Switcher.*

---

## 1. What you have (design inventory & assessment)

| Screen | Verdict |
|---|---|
| **Login** ("Welcome back" + "Sign in to sync your tasks across devices") | ✅ Complete. Google OAuth + email, forgot-password link |
| **Sign Up** ("Create Your Account") | ✅ Complete. Strength meter + validation checklist is a nice touch |
| **Dashboard** (greeting, task counter, Synced badge, filter pills, quick-add, status tabs, task cards) | ✅ Strong. This is your core loop |
| **Edit Task modal** (title, category, priority, schedule pills, subtasks with drag reorder, save/delete) | ✅ Complete. Bottom-sheet with drag handle is the right pattern for a popup |
| **Categories** (color-coded list, task counts, add CTA) | ✅ Good, but the add/edit flow itself isn't designed |
| **Account Switcher** (multiple accounts, active badge, add account) | ⚠️ Good design, hardest feature to engineer — see §6 |

**Overall:** the happy path is fully covered and consistent (dark theme, green accent, color-coded priorities/categories). This is buildable as designed. Below are the gaps to close and the fastest sane path to shipping it.

---

## 2. Design gaps to close (states & screens not yet designed)

These will come up during the build — design them early so you're not inventing UI mid-implementation:

**Missing screens/flows**
1. **Settings screen** — the ⚙ icon exists but has no target. Needs: sign out, sync controls, theme, reminder prefs, "remove account".
2. **Add/Edit Category modal** — name + color picker (the `+ Add Category` button exists, the flow doesn't).
3. **Forgot password flow** — link exists; needs a request-reset screen (and you'll need a sender for the reset email).
4. **Category `⋮` menu** — rename, delete-with-confirmation, and what happens to its tasks (reassign to a default? block deletion if non-empty?).
5. **Remove account from the switcher** — you designed "add", not "remove".
6. **Custom date picker** — Today/Tomorrow/Next Week + time only covers 3 days. Tasks need an arbitrary date eventually.
7. **First-run experience** — seed new accounts with default categories (Work/Personal/etc.) so the dashboard is never empty-broken.

**Missing states (the biggest gap)**
8. **Empty states** — zero tasks, zero categories, all-filters-empty. Empty states are cheap to design and make the app feel finished.
9. **Loading states** — initial auth check + first sync (skeletons for task cards).
10. **Sync badge state machine** — "Synced" is one of four states: `Synced` → `Syncing…` → `Offline` (queued writes) → `Sync error / retry`. This badge is your trust signal; wire all four.
11. **Delete confirmations** — trash icon on task cards and "Delete Task" in the modal should confirm (or support undo via a small toast).
12. **Google OAuth in-popup flow** — a loading state while the OAuth window round-trips.

**Minor notes**
- **⚠️ Popup height:** Chrome caps extension popups at **800 × 600 px**. Your auth screens are 628–648 px tall — they'll be clipped or scroll. Either compress the layouts to fit ≤600 px, or embrace in-popup scrolling deliberately (dashboard at 628 is fine if the header is sticky).
- Define what "5 tasks remaining" counts (all pending? pending + due today?).
- Main task list has no visible reorder affordance (drag handles only appear on subtasks) — decide sort order: manual, priority, or due date.
- Firestore uses silent last-write-wins per document, so simultaneous edits on two devices won't prompt the user — fine for this app, just know it.

---

## 3. Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **WXT** (wxt.dev) | The consensus best extension framework in 2025/26: Vite-based, first-class React support, HMR, auto-generated manifest, cross-browser (Chrome/Edge/Firefox) if you ever expand. Beats hand-rolling a Vite config or Plasmo/CRXJS for a new project. |
| UI | **React + TypeScript + Tailwind** | Your design is 6+ distinct screens with shared components (pills, badges, cards, modal) — component architecture pays off. Tailwind makes the dark theme + green accent system trivial to tokenize. |
| Icons/misc | `lucide-react` icons; optional `framer-motion` for the bottom-sheet/drag animations (watch popup bundle size) | |
| Backend | **Firebase** (Auth + Firestore) | See §4 — the offline-first requirement decides it. |
| Local data | **Firestore's built-in persistent cache** (IndexedDB) | No separate local DB to build or reconcile. The cache *is* your offline store. |

---

## 4. Backend decision: Firebase vs Supabase vs custom

Your requirement is *account-based cross-device sync inside a browser popup* — which means **offline-first is not optional**: the popup opens/closes constantly and must render instantly with stale-then-fresh data, and writes made offline must queue and flush.

| | **Firebase (Auth + Firestore)** | Supabase | Custom (Node + Postgres) |
|---|---|---|---|
| Offline-first sync | ✅ Built-in (persistent local cache, queued writes, automatic flush, conflict handling) | ❌ No native offline layer — still an open feature request; you'd bolt on RxDB / PowerSync / Legend-State | ❌ You build it all |
| Realtime cross-device | ✅ `onSnapshot` subscriptions | ✅ Realtime channels | WebSocket server you build |
| Email + Google auth | ✅ (Google needs `chrome.identity` setup, §7) | ✅ | You build hashing, reset emails, OAuth |
| Multi-account sessions | ✅ via secondary app instances (§6) | ⚠️ manual token juggling, refresh-token rotation makes it fiddly | ✅ trivial (multi-JWT) but you built everything else |
| Free tier for a task app | ✅ Spark is plenty | ✅ | ❌ hosting costs |
| Lock-in | Google | Postgres (portable) | none |

**Verdict: Firebase.** For a personal-scale task manager, Firestore gives you local-first reads/writes, queued offline writes, and live cross-device sync with **zero sync code written by you** — the popup opens against the IndexedDB cache and updates stream in. Supabase is the better *database*, but you'd have to solve offline yourself (its official client still has no offline sync layer — a long-standing open request: [2](https://github.com/orgs/supabase/discussions/40664)). Custom is strictly more work with no payoff at this scale.

**The one big Firebase constraint:** the Firebase Auth SDK **cannot run in a Manifest V3 service worker** — it's unsupported in that environment ([2](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/xQmZLc8cu6Q)). This shapes the architecture: all Firebase code lives in the **popup** (and later an offscreen document), never in the background service worker. The SW only orchestrates (alarms, identity flows, notifications).

---

## 5. Architecture

```
┌─────────────────────────────────────────────────────────┐
│ POPUP (React — all 6 screens)                           │
│  • Firebase Auth + Firestore, persistentLocalCache ON   │
│  • Reads render instantly from IndexedDB cache          │
│  • Writes go to cache → auto-flush to cloud             │
│  • onSnapshot → live updates from your other devices    │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│ SERVICE WORKER (background.ts — NO Firebase code)       │
│  • chrome.alarms  → periodic sync nudges (phase 6)      │
│  • chrome.identity → Google OAuth redirect handling     │
│  • chrome.notifications → due-time reminders (phase 7)  │
│  • spawns OFFSCREEN DOCUMENT when popup is closed       │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│ OFFSCREEN DOCUMENT (phase 6 — "sync engine")            │
│  • Hosts Firebase SDK so queued writes flush and        │
│    snapshots stream even while the popup is closed     │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│ chrome.storage.local — ACCOUNT REGISTRY                 │
│  [{uid, email, name, avatar, appName}, activeUid]       │
└─────────────────────────────────────────────────────────┘
```

**Key insight that de-risks the MVP:** you don't need the offscreen document to launch. Firestore's cache flushes queued writes and pulls remote changes *whenever the popup opens an SDK connection*. For v1, "sync happens when you use the extension" is perfectly fine (and invisible to the user). The offscreen sync engine is a later enhancement for background flush + reminders.

### Firestore data model

```
users/{uid}
  ├─ profile:    { displayName, email, avatarSeed, createdAt }
  ├─ categories/{catId}:   { name, color, order, createdAt }
  └─ tasks/{taskId}:       { title, categoryId, priority: 'low'|'med'|'high',
                             dueAt?, completedAt?, time?,
                             subtasks: [{ id, title, done }],
                             order, createdAt, updatedAt }
```

Subtasks as an embedded array is correct at this scale (a task never has thousands of subtasks; drag-reorder = one array write).

### Security rules (owner-only — the whole app in 5 lines)

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

### Project structure (WXT)

```
smart-tasks/
├── wxt.config.ts
├── entrypoints/
│   ├── popup/                # the entire UI
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx           # screen router (auth state → dashboard ↔ login)
│   │   ├── screens/          # Login, Signup, Dashboard, Categories,
│   │   │                     # EditTaskSheet, SwitchAccount, Settings
│   │   └── components/       # TaskCard, CategoryPill, PriorityToggle,
│   │                         # SchedulePills, SubtaskRow, SyncBadge, StrengthMeter
│   ├── background.ts         # alarms, identity, offscreen mgmt, context menu
│   └── offscreen/            # sync engine (phase 6)
├── lib/
│   ├── firebase.ts           # app/auth/db factory (per-account instances)
│   ├── accounts.ts           # account registry: add/switch/remove
│   ├── tasks.ts / categories.ts   # typed CRUD + onSnapshot hooks
│   └── useSyncStatus.ts      # the 4-state badge
└── assets/                   # icons exported from your designs
```

---

## 6. The hard part: multi-account switching (done right)

Neither Firebase nor Supabase gives you concurrent sessions out of the box, but Firebase has a clean documented pattern — **one initialized app instance per account**:

```ts
// lib/firebase.ts
import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

function appFor(uid: string) {                    // one app per signed-in account
  const name = `acct-${uid}`;
  const app = getApps().find(a => a.name === name) ?? initializeApp(cfg, name);
  return { auth: getAuth(app), db: getFirestore(app) };
}
```

- Each app instance keeps **its own independent auth session** (persisted separately in IndexedDB) and its own Firestore connection.
- The **account registry** (`chrome.storage.local`) stores `{uid, email, name, avatarSeed}` per account + which `uid` is active. The account switcher is just a registry view.
- **Switch** = update `activeUid` → popup re-mounts data hooks against that account's `appFor(uid)`.
- **Add account** = create a fresh unnamed app, run sign-in on it, save to registry.
- **Remove account** = `signOut(auth)` + `deleteApp(app)` + registry entry removal.
- Nice property: switching accounts keeps both sessions alive — no re-login, matching your design where 3 accounts sit side by side.

---

## 7. Google OAuth in an MV3 extension (the fiddly bit)

Standard, documented, but console-heavy — budget an hour:

1. GCP Console → create OAuth client → add redirect URI `https://<your-extension-id>.chromiumapp.org/`
2. Manifest (WXT config): `permissions: ["identity", "storage", "alarms"]`, plus a stable `key` so the extension ID doesn't change during development.
3. Flow: `chrome.identity.launchWebAuthFlow` (Google's endpoint, `prompt=select_account` so users can pick *which* account — important for your multi-account feature) → exchange code → `signInWithCredential` on the right app instance.
4. Needs a stable extension **key** in the manifest during dev so the redirect URI stays valid.

**Recommendation: ship email/password first (phase 3), add Google in phase 5.** Don't let OAuth console setup block your core loop.

---

## 8. Build roadmap

Realistic for one developer working evenings/weekends:

| Phase | Deliverable | Est. |
|---|---|---|
| **0. Scaffold** | WXT + React + TS + Tailwind, dark theme tokens from your designs, popup shell | ½ day |
| **1. UI with mock data** | All 6 screens pixel-matched, in-popup routing, transitions, the modal/sheet component. *No backend — this is where you nail the ≤600px layout issue* | 2–4 days |
| **2. Firebase project** | Console setup, email/password auth, Firestore, security rules, seed default categories on signup | 1 day |
| **3. Wire the dashboard** | Tasks + categories CRUD against Firestore, offline persistence ON, quick-add, filters, tabs, **4-state sync badge** | 2–3 days |
| **4. Multi-account** | Registry, secondary app instances, switcher UI, add/remove account | 1–2 days |
| **5. Google OAuth** | `chrome.identity.launchWebAuthFlow` + `signInWithCredential` | ½–1 day |
| **6. Background sync** | Offscreen document + `chrome.alarms` so queued writes flush while popup is closed | 1–2 days |
| **7. Polish & power features** | Empty/loading states, delete confirmations/undo, reminders via `chrome.notifications` for timed tasks, right-click "add task from selection/page", keyboard shortcut | 2–3 days |
| **8. Ship** | Privacy policy (required — you collect emails), store listing, icons/screenshots, submit | 1 day |

**Total: ~2–3 weeks part-time.** Phases 1–3 give you a shippable v1.

---

## 9. Gotchas checklist (things that bite people)

- ❌ **Never import Firebase in the service worker** — Auth is unsupported there ([2](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/xQmZLc8cu6Q)). SW = orchestration only.
- 📏 **Popup max 800×600** — your 628–648px auth screens need to compress or scroll.
- 🔑 **Stable extension `key`** in the manifest from day 1, or your OAuth redirect URI breaks mid-development.
- 🔒 **Ship with the owner-only rules in §5 before you share it with anyone.** Test rules with the emulator.
- 🧪 **Test the popup lifecycle** — open/close rapidly, offline mode (DevTools → Network → Offline), write offline then close popup then reopen with network.
- 🎨 **CSP:** MV3 forbids remote code — WXT bundles everything, just don't load scripts from CDNs at runtime.
- 📦 **Popup perf:** lazy-mount the Edit Task sheet, keep bundle lean; the popup should open in <200ms.
- 📋 **Chrome Web Store review** will check: privacy policy, permission justification (each permission in your manifest needs a reason in the listing), and a functional demo account if login is required — prepare a review account.

---

## 10. TL;DR

1. **Stack:** WXT + React + TypeScript + Tailwind — build once, sanity intact.
2. **Backend:** Firebase (Auth + Firestore). Offline-first sync is the requirement, and Firestore is the only option where you write *zero* sync code. Keep all Firebase code out of the service worker.
3. **Multi-account:** one Firebase app instance per account + a registry in `chrome.storage.local`.
4. **Sequence:** UI with mocks → email auth + Firestore → wire CRUD → multi-account → Google OAuth → offscreen background sync → reminders/polish → ship.
5. **Before coding:** fix the 600px height issue on the auth screens and design the 12 gap items in §2 (especially the 4-state sync badge and empty states).
