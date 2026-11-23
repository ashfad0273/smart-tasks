/** Password hashing, session tokens and Google ID-token verification — all on
 *  WebCrypto, no dependencies. */

const enc = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(s: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

/* ── passwords (PBKDF2-SHA256; 100k is the Workers runtime maximum) ───── */

const ITER = 100_000;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITER);
  return `pbkdf2$${ITER}$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Always do the work so response time doesn't reveal whether the account exists.
  const parts = (stored ?? '').split('$');
  const valid = parts.length === 4 && parts[0] === 'pbkdf2';
  const iter = valid ? Number(parts[1]) : ITER;
  const salt = valid ? fromB64url(parts[2]) : new Uint8Array(16);
  const expected = valid ? fromB64url(parts[3]) : new Uint8Array(32);
  const actual = await pbkdf2(password, salt, iter);
  return safeEqual(actual, expected) && valid;
}

/* ── Google ID token (RS256) ───────────────────────────────────────────── */

interface Jwk extends JsonWebKey {
  kid: string;
}
let jwksCache: { keys: Jwk[]; exp: number } | null = null;

async function googleKeys(): Promise<Jwk[]> {
  if (jwksCache && jwksCache.exp > Date.now()) return jwksCache.keys;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) throw new Error('Could not fetch Google keys');
  const body = (await res.json()) as { keys: Jwk[] };
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  jwksCache = { keys: body.keys, exp: Date.now() + maxAge * 1000 };
  return body.keys;
}

export interface GoogleClaims {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  nonce?: string;
}

export async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<GoogleClaims> {
  const [h, p, s] = idToken.split('.');
  if (!h || !p || !s) throw new Error('Malformed token');
  const header = JSON.parse(new TextDecoder().decode(fromB64url(h))) as { kid: string; alg: string };
  if (header.alg !== 'RS256') throw new Error('Unexpected algorithm');
  const jwk = (await googleKeys()).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Unknown signing key');
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(s), enc.encode(`${h}.${p}`));
  if (!ok) throw new Error('Bad signature');
  const c = JSON.parse(new TextDecoder().decode(fromB64url(p))) as GoogleClaims & {
    iss: string;
    aud: string;
    exp: number;
  };
  if (c.iss !== 'https://accounts.google.com' && c.iss !== 'accounts.google.com') throw new Error('Bad issuer');
  if (c.aud !== clientId) throw new Error('Bad audience');
  if (c.exp * 1000 < Date.now()) throw new Error('Token expired');
  if (!c.email || !c.email_verified) throw new Error('Google email not verified');
  return c;
}
