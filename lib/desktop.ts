/**
 * Coordination with the Smart Tasks desktop app for Windows and macOS (desktop/).
 *
 * When the app runs on the same computer, it shows the notifications and the
 * extension stays quiet, so nothing pops up twice. The app answers on a fixed
 * loopback port; the extension asks it before each notification whether it is
 * covering that account. No answer (not installed, not running, port taken)
 * means the extension notifies as usual.
 */

export const DESKTOP_PORT = 47813;

export type NotifyKind = 'reminders' | 'agent';

/** True inside the desktop app itself (set by desktop/web/shim.ts). */
export const isDesktopApp = (): boolean => !!(globalThis as { __ST_DESKTOP__?: boolean }).__ST_DESKTOP__;

/** Is the Windows app on this computer showing `kind` notifications for `uid` right now? */
export async function desktopHandles(uid: string, kind: NotifyKind): Promise<boolean> {
  if (isDesktopApp()) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${DESKTOP_PORT}/v1/handles?kind=${kind}&uid=${encodeURIComponent(uid)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return false;
    return ((await res.json()) as { handles?: unknown }).handles === true;
  } catch {
    return false;
  }
}

/** Running on a Mac (the desktop app's shortcut and wording follow it). */
export const isMac = (): boolean => typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);

/** The desktop app's show/hide shortcut, as shown to people. */
export const desktopShortcut = (): string => (isMac() ? '⌘ + ⌥ + K' : 'Ctrl + Alt + K');

/** Desktop-only controls exposed by desktop/web/host.ts (missing in the extension). */
export interface DesktopHost {
  getAutostart(): Promise<boolean>;
  setAutostart(on: boolean): Promise<boolean>;
}
export const desktopHost = (): DesktopHost | null => (globalThis as { __ST_HOST__?: DesktopHost }).__ST_HOST__ ?? null;
