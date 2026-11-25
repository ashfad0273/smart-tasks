/**
 * Clipboard sync between your computers (Mac and Windows apps).
 *
 * Copy on one computer and it's on the clipboard of the others a moment later:
 * text and images, everything the same. Clearing the clipboard is not synced.
 *
 * Everything is end-to-end encrypted with one AES-256 key per account. The server
 * relays encrypted bytes and never has the key: each computer has its own key pair,
 * and a computer that already has the key hands a copy to a new one, wrapped for
 * that computer's public key (ECDH P-256). This happens by itself, as long as one of
 * your computers with sync on is running when you turn it on on another.
 *
 * Speed: the copying computer notices within 250 ms (src-tauri/src/clip.rs), posts
 * the encrypted copy, and the server pushes it to the others over their open
 * connection. Text and small images ride inside that message; bigger images are
 * fetched right after.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { API_URL } from '../../lib/api';
import { onStorageChange, storageGet, storageSet } from '../../lib/ext';
import { CLIP_DEVICE_KEY, CLIP_RESET_KEY, CLIP_STATUS_KEY, CLIP_SYNC_KEY, clipKeyKey, REGISTRY_KEY, type ClipStatus } from '../../lib/keys';
import { activeAccount } from '../../lib/store';
import { inTauri } from './shim';

interface Device {
  id: string;
  pub: JsonWebKey;
  priv: JsonWebKey;
}
interface StoredKey {
  keyId: string;
  raw: string;
}
type Local = { kind: 'text'; text: string } | { kind: 'image'; bytes: number };
interface ClipMsg {
  type: 'clip';
  id: string;
  from: string;
  kind: 'text' | 'image';
  keyId: string;
  size: number;
  at: number;
  data?: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/* ── keys ──────────────────────────────────────────────────────────────── */

async function device(): Promise<Device> {
  const have = await storageGet<Device | null>(CLIP_DEVICE_KEY, null);
  if (have) return have;
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const d: Device = {
    id: crypto.randomUUID(),
    pub: await crypto.subtle.exportKey('jwk', kp.publicKey),
    priv: await crypto.subtle.exportKey('jwk', kp.privateKey),
  };
  await storageSet(CLIP_DEVICE_KEY, d);
  return d;
}

/** Key shared by exactly two computers: mine (private) and theirs (public). */
async function pairKey(priv: JsonWebKey, theirPub: JsonWebKey): Promise<CryptoKey> {
  const p = await crypto.subtle.importKey('jwk', priv, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
  const q = await crypto.subtle.importKey('jwk', theirPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return crypto.subtle.deriveKey({ name: 'ECDH', public: q }, p, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function keyIdOf(raw: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', raw as BufferSource));
  return Array.from(h.slice(0, 8), x => x.toString(16).padStart(2, '0')).join('');
}

const aes = (raw: string) => crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);

async function seal(key: CryptoKey, plain: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain as BufferSource));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

async function open(key: CryptoKey, box: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.slice(0, 12) }, key, box.slice(12)));
}

/* ── state ─────────────────────────────────────────────────────────────── */

let session = 0; // bumps on every restart, so old callbacks stop
let ws: WebSocket | null = null;
let ping: ReturnType<typeof setInterval> | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let status: ClipStatus = { state: 'off', last: null };

async function setStatus(s: Partial<ClipStatus>) {
  status = { ...status, ...s };
  await storageSet(CLIP_STATUS_KEY, status);
}

function stop() {
  session++;
  if (ping) clearInterval(ping);
  if (retry) clearTimeout(retry);
  ping = retry = null;
  try {
    ws?.close(1000, 'off');
  } catch {
    /* already closed */
  }
  ws = null;
  void invoke('clip_watch', { on: false }).catch(() => {});
}

/** One running sync for the active account. */
async function start(reset = false) {
  stop();
  const my = session;
  const on = await storageGet<boolean>(CLIP_SYNC_KEY, false);
  if (!on) return setStatus({ state: 'off', error: null });
  const acct = await activeAccount();
  if (!acct || acct.local || !acct.token) return setStatus({ state: 'signed-out', error: null });
  const token = acct.token;
  const uid = acct.uid;
  const me = await device();
  await setStatus({ state: 'connecting', error: null });

  const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const r = await fetch(API_URL + path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
    if (!r.ok) {
      const e = new Error(`HTTP ${r.status}`) as Error & { status?: number; code?: string };
      e.status = r.status;
      e.code = ((await r.json().catch(() => null)) as { error?: { code?: string } } | null)?.error?.code;
      throw e;
    }
    return (r.headers.get('Content-Type') ?? '').includes('json') ? ((await r.json()) as T) : ((await r.arrayBuffer()) as T);
  };

  let key: CryptoKey | null = null;
  let keyId: string | null = null;

  /** Make sure this computer has the account's key: create it, receive it, or wait. */
  const ensureKey = async (startOver = false): Promise<void> => {
    if (my !== session) return;
    const stored = await storageGet<StoredKey | null>(clipKeyKey(uid), null);
    const info = await call<{ keyId: string | null; devices: Array<{ id: string; pub: string; wrapped: string | null }> }>('/v1/clip/keys');
    const pub = JSON.stringify(me.pub);
    if (!info.keyId || startOver) {
      // First computer (or starting over): make a new key.
      const raw = crypto.getRandomValues(new Uint8Array(32));
      const id = await keyIdOf(raw);
      await call('/v1/clip/device', { method: 'POST', body: JSON.stringify({ deviceId: me.id, pub, keyId: id, reset: startOver }) });
      await storageSet(clipKeyKey(uid), { keyId: id, raw: b64(raw) });
      return ensureKey();
    }
    if (stored && stored.keyId === info.keyId) {
      key = await aes(stored.raw);
      keyId = stored.keyId;
      if (!info.devices.some(d => d.id === me.id && d.pub === pub)) {
        await call('/v1/clip/device', { method: 'POST', body: JSON.stringify({ deviceId: me.id, pub, keyId }) });
      }
      await setStatus({ state: 'on', error: null });
      return shareKey(info.devices);
    }
    // We don't have the key in use: register, and use a copy if one was left for us.
    key = keyId = null;
    const mine = info.devices.find(d => d.id === me.id && d.pub === pub);
    if (!mine) await call('/v1/clip/device', { method: 'POST', body: JSON.stringify({ deviceId: me.id, pub }) });
    if (mine?.wrapped) {
      try {
        const w = JSON.parse(mine.wrapped) as { from: string; keyId: string; box: string };
        const giver = info.devices.find(d => d.id === w.from);
        if (giver && w.keyId === info.keyId) {
          const raw = await open(await pairKey(me.priv, JSON.parse(giver.pub) as JsonWebKey), unb64(w.box));
          if ((await keyIdOf(raw)) === info.keyId) {
            await storageSet(clipKeyKey(uid), { keyId: info.keyId, raw: b64(raw) });
            return ensureKey();
          }
        }
      } catch {
        /* a bad copy: wait for a fresh one */
      }
    }
    await setStatus({ state: 'waiting', error: null });
  };

  /** Hand the key to every other computer that doesn't have it yet. */
  const shareKey = async (devices: Array<{ id: string; pub: string; wrapped: string | null }>) => {
    const stored = await storageGet<StoredKey | null>(clipKeyKey(uid), null);
    if (!stored || stored.keyId !== keyId) return;
    for (const d of devices) {
      if (d.id === me.id) continue;
      const has = (() => {
        try {
          return d.wrapped ? (JSON.parse(d.wrapped) as { keyId: string }).keyId === keyId : false;
        } catch {
          return false;
        }
      })();
      if (has) continue;
      try {
        const box = await seal(await pairKey(me.priv, JSON.parse(d.pub) as JsonWebKey), unb64(stored.raw));
        await call('/v1/clip/wrap', { method: 'POST', body: JSON.stringify({ deviceId: d.id, keyId, wrapped: JSON.stringify({ from: me.id, keyId, box: b64(box) }) }) });
      } catch {
        /* that computer will get it from the next one */
      }
    }
  };

  /** Another computer copied something: put it on this clipboard. */
  const receive = async (m: ClipMsg) => {
    if (m.from === me.id || !key || m.keyId !== keyId) return;
    const box = m.data ? unb64(m.data) : new Uint8Array(await call<ArrayBuffer>(`/v1/clip/${m.id}`));
    const plain = await open(key, box);
    if (m.kind === 'text') await invoke('clip_write_text', { text: dec.decode(plain) });
    else await invoke('clip_write_image', plain);
    await setStatus({ last: { kind: m.kind, dir: 'in', at: Date.now() } });
  };

  /** This computer copied something: send it to the others. */
  const send = async (l: Local) => {
    if (!key || !keyId) return;
    const plain = l.kind === 'text' ? enc.encode(l.text) : new Uint8Array(await invoke<ArrayBuffer>('clip_take_image'));
    if (!plain.length) return;
    const box = await seal(key, plain);
    await call(`/v1/clip?from=${me.id}&kind=${l.kind}&key=${keyId}`, { method: 'POST', body: box as BodyInit, headers: { 'Content-Type': 'application/octet-stream' } });
    await setStatus({ last: { kind: l.kind, dir: 'out', at: Date.now() } });
  };

  const unlisten = await listen<Local>('clip-local', e => {
    if (my !== session) return;
    void send(e.payload).catch(err => {
      if (err?.code === 'key-mismatch') return void ensureKey().catch(() => {});
      void setStatus({ error: String(err?.message ?? err) });
    });
  });

  const connect = () => {
    if (my !== session) return;
    const sock = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/v1/ws?clip=1&token=${encodeURIComponent(token)}`);
    ws = sock;
    sock.onopen = () => {
      ping = setInterval(() => sock.readyState === WebSocket.OPEN && sock.send('ping'), 25_000);
      // Catch up on key changes made while we were away.
      void ensureKey(reset).catch(err => void setStatus({ state: 'error', error: String(err?.message ?? err) }));
      reset = false;
    };
    sock.onmessage = e => {
      if (my !== session || typeof e.data !== 'string' || e.data === 'pong') return;
      let m: { type?: string };
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.type === 'clip') void receive(m as ClipMsg).catch(err => void setStatus({ error: String(err?.message ?? err) }));
      else if (m.type === 'clip-device' && key) void call<{ devices: Array<{ id: string; pub: string; wrapped: string | null }> }>('/v1/clip/keys').then(i => shareKey(i.devices)).catch(() => {});
      else if (m.type === 'clip-key') void ensureKey().catch(() => {});
    };
    sock.onclose = () => {
      if (ping) clearInterval(ping);
      ping = null;
      if (my !== session) return void unlisten();
      void setStatus({ state: 'connecting' });
      retry = setTimeout(connect, 3000);
    };
  };

  await invoke('clip_watch', { on: true });
  connect();
}

/** Called once by host.ts: follows the switch in Settings and account changes. */
export function startClipSync() {
  if (!inTauri) return;
  // Restart only when the signed-in account (or its token) really changes.
  const who = async () => {
    const a = await activeAccount();
    return a && !a.local ? `${a.uid}:${a.token ?? ''}` : '';
  };
  let current = '';
  void who().then(w => {
    current = w;
    void start();
  });
  onStorageChange(keys => {
    if (keys.includes(CLIP_RESET_KEY)) void start(true);
    else if (keys.includes(CLIP_SYNC_KEY)) void start();
    else if (keys.includes(REGISTRY_KEY))
      void who().then(w => {
        if (w === current) return;
        current = w;
        void start();
      });
  });
}
