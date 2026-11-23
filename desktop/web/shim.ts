/**
 * A small stand-in for the chrome.* extension APIs, backed by the Tauri host.
 *
 * The Windows app runs the extension's own code unchanged: the popup UI
 * (entrypoints/popup), the service worker logic (entrypoints/background.ts:
 * sync, reminders, agent notifications, badge) and the chime player
 * (entrypoints/offscreen). They all talk to `chrome.*`, so this file provides
 * the parts they use, in one page:
 *   storage.local      → localStorage (WebView2 keeps it in the app's profile)
 *   runtime messages   → in-page dispatch
 *   alarms             → timers
 *   notifications      → Windows toasts (Rust: notify)
 *   action badge/title → taskbar overlay + tray icon (host.ts)
 *   tabs.create        → default browser, or the app window for its own pages
 *   identity           → Google sign-in in the default browser (Rust: google_auth)
 *
 * Must be imported before anything that touches lib/ext.ts, which checks for
 * chrome.runtime.id once at load.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { DESKTOP_PORT } from '../../lib/desktop';

declare const __APP_VERSION__: string;

/** Must be listed under the Google OAuth client's Authorized redirect URIs. */
const GOOGLE_REDIRECT = `http://127.0.0.1:${DESKTOP_PORT}/google`;

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
    } else {
      for (const [k, d] of Object.entries(keys)) out[k] = read(k) ?? d;
    }
    return out;
  },
  async set(values: Record<string, unknown>) {
    const changes: Record<string, { newValue?: unknown; oldValue?: unknown }> = {};
    for (const [k, v] of Object.entries(values)) {
      changes[k] = { oldValue: read(k), newValue: v };
      if (v === undefined) localStorage.removeItem(PREFIX + k);
      else localStorage.setItem(PREFIX + k, JSON.stringify(v));
    }
    // chrome fires onChanged asynchronously, after the write resolves.
    queueMicrotask(() => onChanged.emit(changes, 'local'));
  },
  async remove(keys: string | string[]) {
    const list = typeof keys === 'string' ? [keys] : keys;
    const changes: Record<string, { oldValue?: unknown }> = {};
    for (const k of list) {
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
    // Defer like a real message hop, so callers never re-enter synchronously.
    setTimeout(() => {
      for (const keep of onMessage.emit(msg, { id: 'desktop' }, respond)) if (keep === true) async = true;
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
  const timer = setTimeout(() => {
    if (wait > MAX_DELAY - 1000 && Date.now() < when) return arm(name, when, period); // > 24 days: re-arm
    if (period) arm(name, Date.now() + period * 60_000, period);
    else alarms.delete(name);
    onAlarm.emit({ name, scheduledTime: when, periodInMinutes: period });
  }, Math.min(wait, MAX_DELAY));
  alarms.set(name, { timer, when, period });
}

/* ── notifications ──────────────────────────────────────────────────────── */

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

/** False when the desktop UI is opened in a plain browser (layout checks via the Vite dev server). */
export const inTauri = '__TAURI_INTERNALS__' in globalThis;

if (inTauri) {
  void listen<{ id: string; button: number | null }>('toast', e => {
    if (e.payload.button == null) onClicked.emit(e.payload.id);
    else onButtonClicked.emit(e.payload.id, e.payload.button);
  });
}

/* ── action (toolbar badge → taskbar overlay + tray) ────────────────────── */

export const badge = { text: '', color: '#22c55e', title: 'Smart Tasks', onChange: () => {} };

/* ── tabs.create: our own pages open the app window ─────────────────────── */

async function openUrl(url: string) {
  const own = url.startsWith(location.origin) || !/^https?:\/\//i.test(url);
  if (!own) return invoke('open_url', { url });
  await invoke('show_window');
  // The extension's update page → the app's own updater (host.ts).
  if (url.includes('update.html')) window.dispatchEvent(new CustomEvent('st-desktop-update', { detail: url.includes('go=1') }));
}

/* ── install ────────────────────────────────────────────────────────────── */

const g = globalThis as Record<string, unknown>;
g.__ST_DESKTOP__ = true;
g.chrome = {
  storage: { local, onChanged },
  runtime: {
    id: 'desktop',
    getURL: (p: string) => new URL(p.replace(/^\//, ''), location.origin + '/').href,
    getManifest: () => ({ version: __APP_VERSION__, name: 'Smart Tasks' }),
    sendMessage,
    onMessage,
    onInstalled: event<[unknown]>(),
    onStartup,
    reload: () => location.reload(),
    // The chime player (offscreen/main.ts) is always loaded; there is no popup.
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
      void invoke('notify', {
        id,
        title: o.title ?? 'Smart Tasks',
        message: o.message ?? '',
        context: o.contextMessage ?? null,
        buttons: (o.buttons ?? []).map(b => b.title),
        sticky: !!o.requireInteraction,
        silent: !!o.silent,
      }).catch(() => {});
      return id;
    },
    clear: async () => true,
    onClicked,
    onButtonClicked,
  },
  contextMenus: {
    removeAll: (cb?: () => void) => cb?.(),
    create: () => {},
    onClicked: event<[unknown, unknown]>(),
  },
  action: {
    setBadgeText: async ({ text }: { text: string }) => {
      badge.text = text;
      badge.onChange();
    },
    setBadgeBackgroundColor: async ({ color }: { color: string }) => {
      badge.color = color;
      badge.onChange();
    },
    setBadgeTextColor: async () => {},
    setTitle: async ({ title }: { title: string }) => {
      badge.title = title;
      badge.onChange();
    },
    openPopup: () => invoke('show_window'),
  },
  tabs: { create: ({ url }: { url: string }) => openUrl(url) },
  offscreen: {
    createDocument: () => sendMessage({ type: 'st-offscreen-chime' }),
    Reason: { AUDIO_PLAYBACK: 'AUDIO_PLAYBACK' },
  },
  // Google sign-in happens in the default browser, which comes back to the
  // app's loopback port (Rust: google_auth + presence.rs).
  identity: {
    getRedirectURL: () => GOOGLE_REDIRECT,
    launchWebAuthFlow: ({ url }: { url: string }) =>
      invoke<string>('google_auth', { url, redirect: GOOGLE_REDIRECT }).catch((e: unknown) => {
        throw new Error(String(e));
      }),
  },
  // Not an unpacked extension: the extension self-updater stays off (host.ts runs the app's).
  management: { getSelf: async () => ({ installType: 'normal' }) },
};
