/**
 * chrome.* stand-in for the installable web app (phones), backed by plain
 * browser APIs. Same shape as desktop/web/shim.ts, without Tauri:
 *   storage.local      → localStorage
 *   runtime messages   → in-page dispatch
 *   alarms             → timers (only while the app is open)
 *   notifications      → the service worker's showNotification
 *   identity           → Google sign-in in a popup that returns to /app/google.html
 *
 * Agent notifications come by Web Push (sw.js) once phone notifications are on,
 * so the page doesn't show them a second time.
 */
declare const __APP_VERSION__: string;

export const PUSH_ON_KEY = 'st-push-on';
const BASE = new URL('./', location.href).href; // …/app/
/** Must be listed under the Google OAuth client's Authorized redirect URIs. */
export const GOOGLE_REDIRECT = new URL('google.html', BASE).href;

type Listener<A extends unknown[]> = (...args: A) => unknown;
function event<A extends unknown[]>() {
  const set = new Set<Listener<A>>();
  return {
    addListener: (l: Listener<A>) => void set.add(l),
    removeListener: (l: Listener<A>) => void set.delete(l),
    hasListener: (l: Listener<A>) => set.has(l),
    emit: (...args: A) => [...set].map(l => l(...args)),
  };
}

/* ── storage.local ──────────────────────────────────────────────────────── */

const PREFIX = 'st:';
const onChanged = event<[Record<string, { newValue?: unknown; oldValue?: unknown }>, string]>();
function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}
function allKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
  }
  return out;
}
const local = {
  async get(keys?: string | string[] | Record<string, unknown> | null) {
    const out: Record<string, unknown> = {};
    if (keys == null) for (const k of allKeys()) out[k] = read(k);
    else if (typeof keys === 'string') {
      const v = read(keys);
      if (v !== undefined) out[keys] = v;
    } else if (Array.isArray(keys)) {
      for (const k of keys) {
        const v = read(k);
        if (v !== undefined) out[k] = v;
      }
    } else for (const [k, d] of Object.entries(keys)) out[k] = read(k) ?? d;
    return out;
  },
  async set(values: Record<string, unknown>) {
    const changes: Record<string, { newValue?: unknown; oldValue?: unknown }> = {};
    for (const [k, v] of Object.entries(values)) {
      changes[k] = { oldValue: read(k), newValue: v };
      if (v === undefined) localStorage.removeItem(PREFIX + k);
      else localStorage.setItem(PREFIX + k, JSON.stringify(v));
    }
    queueMicrotask(() => onChanged.emit(changes, 'local'));
  },
  async remove(keys: string | string[]) {
    const changes: Record<string, { oldValue?: unknown }> = {};
    for (const k of typeof keys === 'string' ? [keys] : keys) {
      changes[k] = { oldValue: read(k) };
      localStorage.removeItem(PREFIX + k);
    }
    queueMicrotask(() => onChanged.emit(changes, 'local'));
  },
};

/* ── runtime ────────────────────────────────────────────────────────────── */

type MessageListener = (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | void;
const onMessage = event<Parameters<MessageListener>>();
export const onStartup = event<[]>();
function sendMessage(msg: unknown): Promise<unknown> {
  return new Promise(resolve => {
    let async = false;
    let done = false;
    const respond = (r: unknown) => {
      if (!done) {
        done = true;
        resolve(r);
      }
    };
    setTimeout(() => {
      for (const keep of onMessage.emit(msg, { id: 'web' }, respond)) if (keep === true) async = true;
      if (!async) respond(undefined);
    });
  });
}

/* ── alarms ─────────────────────────────────────────────────────────────── */

const onAlarm = event<[{ name: string; scheduledTime: number; periodInMinutes?: number }]>();
const alarms = new Map<string, { timer: ReturnType<typeof setTimeout>; when: number; period?: number }>();
const MAX_DELAY = 2 ** 31 - 1;
function arm(name: string, when: number, period?: number) {
  clearTimeout(alarms.get(name)?.timer);
  const wait = Math.max(0, when - Date.now());
  const timer = setTimeout(
    () => {
      if (wait > MAX_DELAY - 1000 && Date.now() < when) return arm(name, when, period);
      if (period) arm(name, Date.now() + period * 60_000, period);
      else alarms.delete(name);
      onAlarm.emit({ name, scheduledTime: when, periodInMinutes: period });
    },
    Math.min(wait, MAX_DELAY),
  );
  alarms.set(name, { timer, when, period });
}

/* ── notifications (service worker) ─────────────────────────────────────── */

const onClicked = event<[string]>();
const onButtonClicked = event<[string, number]>();
interface NotificationOptions {
  title?: string;
  message?: string;
  contextMessage?: string;
  buttons?: { title: string }[];
  requireInteraction?: boolean;
  silent?: boolean;
}
async function notify(id: string, o: NotificationOptions) {
  // Agent notifications arrive by push once phone notifications are on.
  if (id.startsWith('st-agent:') && localStorage.getItem(PUSH_ON_KEY) === '1') return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker?.ready;
  await reg?.showNotification(o.title ?? 'Smart Tasks', {
    body: [o.message, o.contextMessage].filter(Boolean).join('\n'),
    tag: id,
    icon: new URL('icon-512.png', BASE).href,
    badge: new URL('badge-96.png', BASE).href,
    requireInteraction: !!o.requireInteraction,
    data: { id, local: true },
  });
}
// The service worker tells the page which notification was tapped.
navigator.serviceWorker?.addEventListener('message', e => {
  const m = e.data as { type?: string; id?: string; action?: string } | null;
  if (m?.type !== 'st-notification-click' || !m.id) return;
  if (m.action?.startsWith('b')) onButtonClicked.emit(m.id, Number(m.action.slice(1)));
  else onClicked.emit(m.id);
});

export const badge = { text: '', color: '#22c55e', title: 'Smart Tasks' };

/* ── tabs.create ────────────────────────────────────────────────────────── */

function openUrl(url: string) {
  // Our own pages (the extension's update page) mean nothing here; the site updates itself.
  if (url.startsWith(location.origin) && !url.includes(location.pathname.replace(/[^/]*$/, ''))) return;
  if (!/^https?:\/\//i.test(url)) return;
  window.open(url, '_blank', 'noopener');
}

/* ── Google sign-in: a popup that comes back to google.html ─────────────── */

function googleAuth(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ch = new BroadcastChannel('st-google');
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      ch.close();
      clearInterval(poll);
      fn();
    };
    ch.onmessage = e => finish(() => resolve(String(e.data)));
    const win = window.open(url, 'st-google', 'popup,width=480,height=640');
    if (!win) return finish(() => reject(new Error('Allow pop-ups to sign in with Google.')));
    const started = Date.now();
    const poll = setInterval(() => {
      // Closed without an answer (cancelled), or gave up after 5 minutes.
      if ((win.closed && Date.now() - started > 1500) || Date.now() - started > 5 * 60_000)
        setTimeout(() => finish(() => reject(new Error('Sign-in was cancelled.'))), 800);
    }, 500);
  });
}

/* ── install ────────────────────────────────────────────────────────────── */

const g = globalThis as Record<string, unknown>;
g.__ST_WEB__ = true;
g.chrome = {
  storage: { local, onChanged },
  runtime: {
    id: 'web',
    getURL: (p: string) => new URL(p.replace(/^\//, ''), BASE).href,
    getManifest: () => ({ version: __APP_VERSION__, name: 'Smart Tasks' }),
    sendMessage,
    onMessage,
    onInstalled: event<[unknown]>(),
    onStartup,
    reload: () => location.reload(),
    getContexts: async ({ contextTypes }: { contextTypes: string[] }) =>
      contextTypes.includes('OFFSCREEN_DOCUMENT') ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : [],
    ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT', POPUP: 'POPUP' },
  },
  alarms: {
    create: async (name: string, o: { when?: number; delayInMinutes?: number; periodInMinutes?: number }) =>
      arm(name, o.when ?? Date.now() + (o.delayInMinutes ?? o.periodInMinutes ?? 0) * 60_000, o.periodInMinutes),
    clear: async (name: string) => {
      const a = alarms.get(name);
      if (a) clearTimeout(a.timer);
      return alarms.delete(name);
    },
    onAlarm,
  },
  notifications: {
    create: (id: string, o: NotificationOptions) => {
      void notify(id, o).catch(() => {});
      return id;
    },
    clear: async (id: string) => {
      const reg = await navigator.serviceWorker?.getRegistration();
      for (const n of (await reg?.getNotifications({ tag: id })) ?? []) n.close();
      return true;
    },
    onClicked,
    onButtonClicked,
  },
  contextMenus: { removeAll: (cb?: () => void) => cb?.(), create: () => {}, onClicked: event<[unknown, unknown]>() },
  action: {
    setBadgeText: async ({ text }: { text: string }) => {
      badge.text = text;
      // Home-screen icon badge where supported (installed app).
      const n = Number(text);
      const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
      if (n > 0) void nav.setAppBadge?.(n).catch(() => {});
      else void nav.clearAppBadge?.().catch(() => {});
    },
    setBadgeBackgroundColor: async () => {},
    setBadgeTextColor: async () => {},
    setTitle: async ({ title }: { title: string }) => void (badge.title = title),
    openPopup: async () => {},
  },
  tabs: { create: ({ url }: { url: string }) => openUrl(url) },
  offscreen: {
    createDocument: () => sendMessage({ type: 'st-offscreen-chime' }),
    Reason: { AUDIO_PLAYBACK: 'AUDIO_PLAYBACK', CLIPBOARD: 'CLIPBOARD' },
  },
  identity: { getRedirectURL: () => GOOGLE_REDIRECT, launchWebAuthFlow: ({ url }: { url: string }) => googleAuth(url) },
  // The site serves the newest version on every load: no self-updater.
  management: { getSelf: async () => ({ installType: 'normal' }) },
};
