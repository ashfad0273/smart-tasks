/**
 * Desktop-only duties on top of the shared extension code:
 *  - badge → taskbar overlay icon + tray icon/tooltip
 *  - tell the Rust side which accounts this app notifies for, so the Chrome
 *    extension on the same computer stays quiet (lib/desktop.ts)
 *  - tray menu actions (Sync now, Reminders on/off)
 *  - auto-update: check the download site, install quietly while the window
 *    is hidden, otherwise offer it in the UI and a notification
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import trayIconUrl from '../../public/icon/32.png';
import { storageGet, storageSet, onStorageChange } from '../../lib/ext';
import { AGENT_NOTIFY_KEY, REGISTRY_KEY, REMINDERS_ENABLED_KEY, UPDATE_KEY, UPDATE_STATUS_KEY, UPDATED_KEY, type UpdateStatus } from '../../lib/keys';
import { loadRegistry, sync, activeAccount } from '../../lib/store';
import { currentVersion, newer, type UpdateInfo } from '../../lib/updater';
import { badge, inTauri } from './shim';
import { startClipSync } from './clip';

/** What the desktop app offers the shared UI (see lib/desktop.ts). */
interface DesktopHost {
  getAutostart(): Promise<boolean>;
  setAutostart(on: boolean): Promise<boolean>;
}

/* ── badge ──────────────────────────────────────────────────────────────── */

const SIZE = 32;
let baseIcon: HTMLImageElement | null = null;
const iconReady = new Promise<void>(resolve => {
  const img = new Image();
  img.onload = () => {
    baseIcon = img;
    resolve();
  };
  img.onerror = () => resolve();
  img.src = trayIconUrl;
});

function rgba(draw: (c: CanvasRenderingContext2D) => void): number[] {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const c = canvas.getContext('2d')!;
  draw(c);
  return Array.from(c.getImageData(0, 0, SIZE, SIZE).data);
}

function pill(c: CanvasRenderingContext2D, text: string, color: string, x: number, y: number, h: number) {
  c.font = `700 ${Math.round(h * 0.68)}px "Segoe UI", sans-serif`;
  const w = Math.max(h, c.measureText(text).width + h * 0.5);
  const left = Math.min(x, SIZE - w);
  c.fillStyle = color;
  c.beginPath();
  c.roundRect(left, y, w, h, h / 2);
  c.fill();
  c.fillStyle = '#fff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, left + w / 2, y + h / 2 + 1);
}

let lastBadge = '';
async function renderBadge() {
  await iconReady;
  const key = `${badge.text}|${badge.color}|${badge.title}`;
  if (key === lastBadge) return;
  lastBadge = key;
  const text = badge.text;
  // Taskbar overlay: a full-size count bubble (Windows draws it bottom-right).
  const overlay = text ? rgba(c => pill(c, text, badge.color, 0, 4, 24)) : null;
  // Tray: the app icon with a dot (numbers are unreadable at 16 px).
  const tray = rgba(c => {
    if (baseIcon) c.drawImage(baseIcon, 0, 0, SIZE, SIZE);
    if (text) {
      c.fillStyle = '#10191c';
      c.beginPath();
      c.arc(24, 8, 9, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = badge.color;
      c.beginPath();
      c.arc(24, 8, 6.5, 0, Math.PI * 2);
      c.fill();
    }
  });
  // text: the macOS Dock badge (Windows draws the overlay instead).
  await invoke('set_badge', { tooltip: badge.title, tray, overlay, text: text || null }).catch(() => {});
}

/* ── presence for the extension ─────────────────────────────────────────── */

async function reportPresence() {
  const reg = await loadRegistry();
  const active = reg.accounts.find(a => a.uid === reg.activeId && !a.local);
  const remindersOn = await storageGet<boolean>(REMINDERS_ENABLED_KEY, true);
  const agentOn = await storageGet<boolean>(AGENT_NOTIFY_KEY, true);
  await invoke('set_presence', {
    reminders: remindersOn && active ? [active.uid] : [],
    agent: agentOn ? reg.accounts.filter(a => !a.local).map(a => a.uid) : [],
    remindersOn,
  }).catch(() => {});
}

/* ── updates ────────────────────────────────────────────────────────────── */

interface DesktopUpdate {
  version: string;
  notes: string;
  date: string | null;
}

/** Background check while the app stays open. Each check is one ~1 KB request for latest.json. */
const UPDATE_EVERY_MS = 30 * 60_000;
/** Bringing the window to the front checks too, but not more often than this. */
const FOCUS_CHECK_GAP_MS = 10 * 60_000;
let lastCheck = 0;
let installing = false;

type StatusIn = UpdateStatus extends infer S ? (S extends UpdateStatus ? Omit<S, 'at'> : never) : never;
const setStatus = (s: StatusIn | null) =>
  storageSet(UPDATE_STATUS_KEY, s ? { ...s, at: Date.now() } : null);

async function installUpdate(version: string) {
  if (installing) return;
  installing = true;
  await setStatus({ state: 'downloading', pct: 0 });
  // Rust sends whole percents while downloading, then 100 when the installer starts.
  const stop = await listen<number>('update-progress', e =>
    void setStatus(e.payload >= 100 ? { state: 'installing' } : { state: 'downloading', pct: e.payload }),
  );
  try {
    // background.ts announces "Updated to X" on the next start.
    await storageSet(UPDATED_KEY, { from: currentVersion(), to: version });
    await invoke('install_update'); // downloads, verifies the signature, runs the installer, restarts
  } catch (e) {
    installing = false;
    stop();
    await storageSet(UPDATED_KEY, null);
    const message = String(e).replace(/^Error:\s*/, '').slice(0, 200);
    await setStatus({ state: 'failed', message });
    chrome.notifications.create(`st-update-failed:${Date.now()}`, {
      type: 'basic',
      iconUrl: '',
      title: 'Update failed',
      message,
    });
  }
}

/** `manual`: you pressed "Check now", so say what happened (checking, up to date, couldn't reach). */
async function checkUpdate(manual = false): Promise<void> {
  if (installing) return;
  lastCheck = Date.now();
  if (manual) await setStatus({ state: 'checking' });
  let u: DesktopUpdate | null;
  try {
    u = await invoke<DesktopUpdate | null>('check_update');
  } catch {
    // offline or the site is down: try again later
    if (manual) await setStatus({ state: 'failed', message: "Couldn't reach the update server. Check your connection." });
    return;
  }
  if (!u || !newer(u.version, currentVersion())) {
    await storageSet(UPDATE_KEY, null);
    if (manual) await setStatus({ state: 'latest' });
    return;
  }
  if (manual) await setStatus(null);
  // Same shape the extension's update banner reads (Dashboard + Settings).
  const info: UpdateInfo = {
    version: u.version,
    date: u.date ?? '',
    zip: '',
    size: 0,
    sha256: '',
    notes: u.notes.split('\n').map(l => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean),
  };
  await storageSet(UPDATE_KEY, info);
  // Nobody is looking: update now, quietly. Otherwise don't pull the window away.
  if (!(await getCurrentWindow().isVisible())) return installUpdate(u.version);
  if ((await storageGet<string | null>('st-update-notified', null)) !== u.version) {
    await storageSet('st-update-notified', u.version);
    chrome.notifications.create('st-update', {
      type: 'basic',
      iconUrl: '',
      title: `Smart Tasks ${u.version} is ready`,
      message: info.notes[0] ?? 'A new version is available.',
      buttons: [{ title: 'Update now' }],
    });
  }
}

/* ── start ──────────────────────────────────────────────────────────────── */

export function startHost() {
  startClipSync();
  // "Copy prompt" on a notification: the system clipboard, even while the window is hidden.
  chrome.runtime.onMessage.addListener((msg: { type?: string; text?: unknown }) => {
    if (msg?.type === 'st-offscreen-copy' && typeof msg.text === 'string' && inTauri) void invoke('copy_text', { text: msg.text }).catch(() => {});
    return false;
  });

  document.documentElement.classList.add('desktop');

  badge.onChange = () => void renderBadge();
  void renderBadge();

  void reportPresence();
  onStorageChange(keys => {
    if (keys.some(k => k === REGISTRY_KEY || k === REMINDERS_ENABLED_KEY || k === AGENT_NOTIFY_KEY)) void reportPresence();
  });

  if (!inTauri) return; // plain browser (layout checks): no tray, no updater
  // Read by the realtime connection (AppContext), which reports it to the server for phones.
  (globalThis as { __stIdleSeconds?: () => Promise<number> }).__stIdleSeconds = () => invoke<number>('idle_seconds');

  // Settings → "Open at login" talks to the app through this.
  (globalThis as { __ST_HOST__?: DesktopHost }).__ST_HOST__ = {
    getAutostart: () => invoke<boolean>('get_autostart'),
    setAutostart: (on: boolean) => invoke<boolean>('set_autostart', { on }),
  };

  void listen('tray-sync', async () => {
    const acc = await activeAccount();
    if (acc && !acc.local) await sync(acc);
  });
  void listen<boolean>('tray-reminders', e => void storageSet(REMINDERS_ENABLED_KEY, e.payload));

  // Update buttons in the UI and the "ready" notification (via the shim's tabs.create).
  window.addEventListener('st-desktop-update', async e => {
    const info = await storageGet<UpdateInfo | null>(UPDATE_KEY, null);
    if ((e as CustomEvent<boolean>).detail && info) void installUpdate(info.version);
    else void checkUpdate(true);
  });
  // A status left over from before a restart (or a failed install) shouldn't stick around.
  void setStatus(null);
  setTimeout(() => void checkUpdate(), 20_000);
  setInterval(() => void checkUpdate(), UPDATE_EVERY_MS);
  // Opening the window (tray click, shortcut, Cmd+Tab) looks for a new version right away.
  const onFront = () => {
    if (!document.hidden && Date.now() - lastCheck > FOCUS_CHECK_GAP_MS) void checkUpdate();
  };
  window.addEventListener('focus', onFront);
  document.addEventListener('visibilitychange', onFront);
}
