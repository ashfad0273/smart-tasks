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
import { AGENT_NOTIFY_KEY, REGISTRY_KEY, REMINDERS_ENABLED_KEY, UPDATE_KEY, UPDATED_KEY } from '../../lib/keys';
import { loadRegistry, sync, activeAccount } from '../../lib/store';
import { currentVersion, newer, type UpdateInfo } from '../../lib/updater';
import { badge, inTauri } from './shim';

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

const UPDATE_EVERY_MS = 6 * 3600_000;
let installing = false;

async function installUpdate(version: string) {
  if (installing) return;
  installing = true;
  try {
    // background.ts announces "Updated to X" on the next start.
    await storageSet(UPDATED_KEY, { from: currentVersion(), to: version });
    await invoke('install_update'); // downloads, verifies the signature, runs the installer, restarts
  } catch (e) {
    installing = false;
    await storageSet(UPDATED_KEY, null);
    chrome.notifications.create(`st-update-failed:${Date.now()}`, {
      type: 'basic',
      iconUrl: '',
      title: 'Update failed',
      message: String(e).slice(0, 200),
    });
  }
}

async function checkUpdate(): Promise<void> {
  let u: DesktopUpdate | null;
  try {
    u = await invoke<DesktopUpdate | null>('check_update');
  } catch {
    return; // offline or the site is down: try again later
  }
  if (!u || !newer(u.version, currentVersion())) {
    await storageSet(UPDATE_KEY, null);
    return;
  }
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
  document.documentElement.classList.add('desktop');

  badge.onChange = () => void renderBadge();
  void renderBadge();

  void reportPresence();
  onStorageChange(keys => {
    if (keys.some(k => k === REGISTRY_KEY || k === REMINDERS_ENABLED_KEY || k === AGENT_NOTIFY_KEY)) void reportPresence();
  });

  if (!inTauri) return; // plain browser (layout checks): no tray, no updater

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
    else void checkUpdate();
  });
  setTimeout(() => void checkUpdate(), 20_000);
  setInterval(() => void checkUpdate(), UPDATE_EVERY_MS);
}
