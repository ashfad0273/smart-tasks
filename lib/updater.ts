import { SITE_URL } from './api';

/**
 * Self-updater for the downloaded (unpacked) extension.
 *
 * Chrome only auto-updates store installs. For "Load unpacked" installs we
 * keep the extension's own folder up to date instead: the user picks that
 * folder once (File System Access), we remember the handle, and from then on
 * a new release is downloaded from the download site, verified (SHA-256 and
 * manifest), written over the old files and the extension reloads itself.
 */

export interface UpdateInfo {
  version: string;
  date: string;
  zip: string;
  size: number;
  sha256: string;
  notes: string[];
}

/** a > b for dotted versions like "1.10.2". */
export function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export const currentVersion = () => chrome.runtime.getManifest().version;

/** Only unpacked installs update themselves; store installs are updated by the browser. */
export async function isUnpacked(): Promise<boolean> {
  try {
    return (await chrome.management.getSelf()).installType === 'development';
  } catch {
    return false;
  }
}

export async function fetchLatest(): Promise<UpdateInfo> {
  const res = await fetch(`${SITE_URL}/version.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Update check failed (${res.status})`);
  const info = (await res.json()) as UpdateInfo;
  if (typeof info.version !== 'string' || typeof info.zip !== 'string') throw new Error('Bad update info');
  return info;
}

/* ── remembered folder (IndexedDB holds the directory handle) ─────────────── */

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('st-updater', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kv<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction('kv', mode).objectStore('kv'));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export const saveFolder = (h: FileSystemDirectoryHandle) => kv<void>('readwrite', s => s.put(h, 'folder'));
export const loadFolder = () => kv<FileSystemDirectoryHandle | undefined>('readonly', s => s.get('folder'));
export const forgetFolder = () => kv<void>('readwrite', s => s.delete('folder'));

type PermHandle = FileSystemDirectoryHandle & {
  queryPermission(d: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(d: { mode: 'readwrite' }): Promise<PermissionState>;
};

/** Write access without asking (granted earlier and still valid). */
export async function hasAccess(h: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    return (await (h as PermHandle).queryPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/** Ask for write access; needs a user click (window pages only). */
export async function askAccess(h: FileSystemDirectoryHandle): Promise<boolean> {
  return (await (h as PermHandle).requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Is this folder the one this extension was loaded from? Compares the manifest. */
export async function isOurFolder(dir: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const file = await (await dir.getFileHandle('manifest.json')).getFile();
    const m = JSON.parse(await file.text()) as { key?: string; name?: string; version?: string };
    const me = chrome.runtime.getManifest() as chrome.runtime.Manifest & { key?: string };
    if (me.key) return m.key === me.key;
    return m.name === me.name && m.version === me.version;
  } catch {
    return false;
  }
}

/* ── zip ──────────────────────────────────────────────────────────────────── */

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Minimal reader for the zips we publish (stored or deflated entries). */
export async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Broken zip directory');
    const method = v.getUint16(p + 10, true);
    const compSize = v.getUint32(p + 20, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (v.getUint32(local, true) !== 0x04034b50) throw new Error('Broken zip entry');
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + compSize);
    const data = method === 0 ? raw.slice() : method === 8 ? await inflate(raw) : null;
    if (!data) throw new Error(`Unsupported zip compression (${method})`);
    if (data.length !== size) throw new Error(`Zip entry ${name} is damaged`);
    out.set(name, data);
  }
  return out;
}

async function sha256(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Download + verify a release. Returns its files keyed by path inside the extension folder. */
export async function download(info: UpdateInfo): Promise<Map<string, Uint8Array>> {
  const res = await fetch(new URL(info.zip, SITE_URL), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buf = await res.arrayBuffer();
  if ((await sha256(buf)) !== info.sha256) throw new Error('The download was damaged. Try again.');
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of await unzip(buf)) {
    const path = name.replace(/^smart-tasks\//, '');
    if (!path || path.startsWith('/') || path.split('/').some(s => s === '..' || s === '.' || s === '')) {
      throw new Error(`Unsafe path in update: ${name}`);
    }
    files.set(path, data);
  }
  const manifest = files.get('manifest.json');
  if (!manifest) throw new Error('Update has no manifest');
  const m = JSON.parse(new TextDecoder().decode(manifest)) as { version?: string; name?: string };
  if (m.version !== info.version) throw new Error('Update version does not match');
  return files;
}

/** Overwrite the extension folder with the new files (manifest last), then reload. */
export async function install(dir: FileSystemDirectoryHandle, files: Map<string, Uint8Array>): Promise<void> {
  const write = async (path: string, data: Uint8Array) => {
    const parts = path.split('/');
    let d = dir;
    for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg, { create: true });
    const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await fh.createWritable();
    await w.write(data as BlobPart);
    await w.close();
  };
  for (const [path, data] of files) if (path !== 'manifest.json') await write(path, data);
  await write('manifest.json', files.get('manifest.json')!);
}
