/**
 * Thin wrappers around extension APIs with graceful fallbacks so the UI can
 * also run as a plain web page (e.g. serving .output/chrome-mv3 over HTTP)
 * for quick previews and the headless smoke test.
 */

const hasChrome: boolean = typeof chrome !== 'undefined' && !!chrome?.runtime?.id;

export const isExtension = (): boolean => hasChrome;

export async function storageGet<T>(key: string, fallback: T): Promise<T> {
  if (hasChrome) {
    try {
      const obj = (await chrome.storage.local.get(key)) as Record<string, unknown>;
      return (obj?.[key] as T) ?? fallback;
    } catch {
      return fallback;
    }
  }
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function storageSetMany(values: Record<string, unknown>): Promise<void> {
  if (hasChrome) {
    await chrome.storage.local.set(values);
    return;
  }
  for (const [k, v] of Object.entries(values)) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* sandboxed preview */
    }
  }
  // localStorage 'storage' events don't fire in the writing tab — emulate.
  localListeners.forEach(l => l(Object.keys(values)));
}

export const storageSet = (key: string, value: unknown) => storageSetMany({ [key]: value });

export async function storageRemove(keys: string[]): Promise<void> {
  if (hasChrome) {
    await chrome.storage.local.remove(keys);
    return;
  }
  keys.forEach(k => localStorage.removeItem(k));
  localListeners.forEach(l => l(keys));
}

const localListeners = new Set<(keys: string[]) => void>();

/** Called with the changed keys whenever storage changes (any context). */
export function onStorageChange(cb: (keys: string[]) => void): () => void {
  if (hasChrome) {
    const listener = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local') cb(Object.keys(changes));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
  const onStorage = (e: StorageEvent) => e.key && cb([e.key]);
  window.addEventListener('storage', onStorage);
  localListeners.add(cb);
  return () => {
    window.removeEventListener('storage', onStorage);
    localListeners.delete(cb);
  };
}

/** Run `fn` exclusively across every extension context (popup + worker). */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(name, fn) as Promise<T>;
  }
  return fn();
}

export function manifestVersion(): string {
  try {
    return hasChrome ? chrome.runtime.getManifest().version : 'dev';
  } catch {
    return 'dev';
  }
}
