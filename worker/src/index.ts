import { hashPassword, randomToken, sha256, verifyGoogleIdToken, verifyPassword } from './crypto';
import { BadRequest, parseOps } from './model';
import { handleMcp } from './mcp';
import { PRIVACY_HTML } from './privacy';

export { UserHub } from './hub';

/**
 * Smart Tasks API.
 *
 *   GET    /v1/config                 public feature flags
 *   POST   /v1/auth/signup            {name, email, password}  → {token, user}
 *   POST   /v1/auth/login             {email, password}        → {token, user}
 *   POST   /v1/auth/google            {idToken}                → {token, user}
 *   POST   /v1/auth/reset/request     {email}
 *   POST   /v1/auth/reset/confirm     {email, code, password}  → {token, user}
 *   POST   /v1/auth/logout
 *   GET    /v1/me                     → {user}
 *   PATCH  /v1/me                     {name}
 *   DELETE /v1/me                     delete account + all data
 *   GET    /v1/sync?since=REV         → {rev, changes, more}
 *   POST   /v1/sync                   {ops}  → {rev}
 *   GET    /v1/ws?token=…             WebSocket: {"type":"rev","rev":N} on every change
 *   GET    /v1/agent-token            → {token: {hint, createdAt, lastUsed} | null}
 *   POST   /v1/agent-token            {timeZone} → {token: "stk_…"}  (replaces any old one)
 *   DELETE /v1/agent-token            revoke
 *   POST   /mcp                       MCP endpoint for AI agents (Bearer stk_… token)
 */

const SESSION_TTL = 180 * 86_400_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  google_sub: string | null;
  photo_url: string | null;
}

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
  });
}

async function readJson<T>(req: Request): Promise<T> {
  if (Number(req.headers.get('Content-Length') ?? 0) > 2_000_000) throw new HttpError(413, 'too-large', 'Request too large');
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'bad-json', 'Invalid JSON body');
  }
}

const publicUser = (u: UserRow) => ({ uid: u.id, email: u.email, name: u.name, photoURL: u.photo_url });

async function rateLimit(env: Env, req: Request, route: string): Promise<void> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  const { success } = await env.AUTH_LIMITER.limit({ key: `${route}:${ip}` });
  if (!success) throw new HttpError(429, 'too-many-requests', 'Too many attempts — wait a minute and try again.');
}

async function createSession(env: Env, userId: string): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), userId, now, now + SESSION_TTL, now)
    .run();
  return token;
}

async function authenticate(env: Env, token: string | null): Promise<UserRow> {
  if (!token) throw new HttpError(401, 'unauthenticated', 'Sign in required');
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT u.*, s.expires_at, s.last_seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  )
    .bind(hash)
    .first<UserRow & { expires_at: number; last_seen: number }>();
  const now = Date.now();
  if (!row || row.expires_at < now) throw new HttpError(401, 'session-expired', 'Your session expired — please sign in again.');
  if (now - row.last_seen > 86_400_000) {
    // Sliding expiry, written at most once a day.
    await env.DB.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?')
      .bind(now, now + SESSION_TTL, hash)
      .run();
  }
  return row;
}

const bearer = (req: Request) => req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || null;
const hub = (env: Env, userId: string) => env.USER_HUB.get(env.USER_HUB.idFromName(userId));

function validatePassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'weak-password', 'Password must be at least 8 characters.');
  if (pw.length > 200) throw new HttpError(400, 'weak-password', 'Password is too long.');
  return pw;
}

function validateEmail(email: unknown): string {
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(e) || e.length > 254) throw new HttpError(400, 'invalid-email', "That email address doesn't look right.");
  return e;
}

const AGENT_PREFIX = 'stk_';

function validZone(tz: unknown): string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

async function agentAuth(env: Env, token: string | null): Promise<{ user: UserRow; tz: string }> {
  if (!token?.startsWith(AGENT_PREFIX)) {
    throw new HttpError(401, 'unauthenticated', 'Send your Smart Tasks agent token as "Authorization: Bearer stk_…". Create one in Smart Tasks → Settings → AI agent.');
  }
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT u.*, a.time_zone, a.last_used FROM agent_tokens a JOIN users u ON u.id = a.user_id WHERE a.token_hash = ?`,
  )
    .bind(hash)
    .first<UserRow & { time_zone: string; last_used: number | null }>();
  if (!row) throw new HttpError(401, 'token-revoked', 'This agent token is no longer valid. Create a new one in Smart Tasks → Settings → AI agent.');
  const now = Date.now();
  if (!row.last_used || now - row.last_used > 10 * 60_000) {
    await env.DB.prepare('UPDATE agent_tokens SET last_used = ? WHERE token_hash = ?').bind(now, hash).run();
  }
  return { user: row, tz: row.time_zone || 'UTC' };
}

/* ── handlers ──────────────────────────────────────────────────────────── */

async function signup(req: Request, env: Env): Promise<Response> {
  await rateLimit(env, req, 'signup');
  const b = await readJson<{ name?: string; email?: string; password?: string }>(req);
  const email = validateEmail(b.email);
  const password = validatePassword(b.password);
  const name = (typeof b.name === 'string' ? b.name.trim() : '').slice(0, 80) || email.split('@')[0];

  const exists = await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
  if (exists) throw new HttpError(409, 'email-already-in-use', 'An account with this email already exists — try signing in.');

  const user: UserRow = { id: crypto.randomUUID(), email, name, password_hash: await hashPassword(password), google_sub: null, photo_url: null };
  await env.DB.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(user.id, user.email, user.name, user.password_hash, Date.now())
    .run();
  return json({ token: await createSession(env, user.id), user: publicUser(user), created: true });
}

async function login(req: Request, env: Env): Promise<Response> {
  await rateLimit(env, req, 'login');
  const b = await readJson<{ email?: string; password?: string }>(req);
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  const ok = await verifyPassword(typeof b.password === 'string' ? b.password : '', user?.password_hash ?? null);
  if (!user || !ok) {
    if (user && !user.password_hash) {
      throw new HttpError(401, 'use-google', 'This account uses Google sign-in — tap “Continue with Google”.');
    }
    throw new HttpError(401, 'invalid-credential', 'Incorrect email or password.');
  }
  return json({ token: await createSession(env, user.id), user: publicUser(user) });
}

async function google(req: Request, env: Env): Promise<Response> {
  await rateLimit(env, req, 'google');
  if (!env.GOOGLE_CLIENT_ID) throw new HttpError(501, 'google-disabled', 'Google sign-in is not enabled.');
  const b = await readJson<{ idToken?: string; nonce?: string }>(req);
  let claims;
  try {
    claims = await verifyGoogleIdToken(String(b.idToken ?? ''), env.GOOGLE_CLIENT_ID, String(b.nonce ?? ''));
  } catch (e) {
    throw new HttpError(401, 'google-failed', `Google sign-in failed: ${(e as Error).message}`);
  }
  const email = claims.email.toLowerCase();
  let user =
    (await env.DB.prepare('SELECT * FROM users WHERE google_sub = ?').bind(claims.sub).first<UserRow>()) ??
    (await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>());
  let created = false;
  if (!user) {
    user = { id: crypto.randomUUID(), email, name: claims.name || email.split('@')[0], password_hash: null, google_sub: claims.sub, photo_url: claims.picture ?? null };
    await env.DB.prepare('INSERT INTO users (id, email, name, google_sub, photo_url, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(user.id, user.email, user.name, user.google_sub, user.photo_url, Date.now())
      .run();
    created = true;
  } else if (user.google_sub !== claims.sub || (claims.picture && user.photo_url !== claims.picture)) {
    // Link Google to an existing (verified-email) account.
    await env.DB.prepare('UPDATE users SET google_sub = ?, photo_url = COALESCE(?, photo_url) WHERE id = ?')
      .bind(claims.sub, claims.picture ?? null, user.id)
      .run();
    user = { ...user, google_sub: claims.sub, photo_url: claims.picture ?? user.photo_url };
  }
  return json({ token: await createSession(env, user.id), user: publicUser(user), created });
}

async function resetRequest(req: Request, env: Env): Promise<Response> {
  await rateLimit(env, req, 'reset');
  if (!env.EMAIL || !env.EMAIL_FROM) throw new HttpError(501, 'reset-disabled', 'Password reset is not available yet.');
  const b = await readJson<{ email?: string }>(req);
  const email = validateEmail(b.email);
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  // Same response whether or not the account exists (no account enumeration).
  if (user) {
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
    await env.DB.prepare(
      `INSERT INTO reset_codes (user_id, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)
       ON CONFLICT (user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0`,
    )
      .bind(user.id, await sha256(`${user.id}:${code}`), Date.now() + 15 * 60_000)
      .run();
    await env.EMAIL.send({
      from: { email: env.EMAIL_FROM, name: 'Smart Tasks' },
      to: user.email,
      subject: `${code} is your Smart Tasks reset code`,
      text: `Your Smart Tasks password reset code is ${code}.\n\nIt expires in 15 minutes. If you didn't ask for this, you can ignore this email.`,
      html: `<p>Your Smart Tasks password reset code is</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>It expires in 15 minutes. If you didn't ask for this, you can ignore this email.</p>`,
    });
  }
  return json({ ok: true });
}

async function resetConfirm(req: Request, env: Env): Promise<Response> {
  await rateLimit(env, req, 'reset-confirm');
  const b = await readJson<{ email?: string; code?: string; password?: string }>(req);
  const email = validateEmail(b.email);
  const password = validatePassword(b.password);
  const fail = new HttpError(400, 'invalid-code', 'That code is wrong or has expired.');
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  if (!user) throw fail;
  const rc = await env.DB.prepare('SELECT * FROM reset_codes WHERE user_id = ?')
    .bind(user.id)
    .first<{ code_hash: string; expires_at: number; attempts: number }>();
  if (!rc || rc.expires_at < Date.now() || rc.attempts >= 5) throw fail;
  if ((await sha256(`${user.id}:${String(b.code ?? '').trim()}`)) !== rc.code_hash) {
    await env.DB.prepare('UPDATE reset_codes SET attempts = attempts + 1 WHERE user_id = ?').bind(user.id).run();
    throw fail;
  }
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), user.id),
    env.DB.prepare('DELETE FROM reset_codes WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id), // sign out everywhere
  ]);
  return json({ token: await createSession(env, user.id), user: publicUser(user) });
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, '');
  const m = req.method;

  if (m === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  if (p === '' || p === '/v1/health') return json({ ok: true, service: 'smart-tasks-api' });
  if (p === '/privacy' && m === 'GET') {
    return new Response(PRIVACY_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
  }
  if (p === '/v1/config' && m === 'GET') {
    return json({ googleClientId: env.GOOGLE_CLIENT_ID || null, passwordReset: !!(env.EMAIL && env.EMAIL_FROM) });
  }
  if (m === 'POST') {
    if (p === '/v1/auth/signup') return signup(req, env);
    if (p === '/v1/auth/login') return login(req, env);
    if (p === '/v1/auth/google') return google(req, env);
    if (p === '/v1/auth/reset/request') return resetRequest(req, env);
    if (p === '/v1/auth/reset/confirm') return resetConfirm(req, env);
  }

  if (p === '/mcp') {
    const { user, tz } = await agentAuth(env, bearer(req));
    return handleMcp(req, { hub: hub(env, user.id), name: user.name, tz }, { 'Cache-Control': 'no-store', ...CORS });
  }

  // WebSocket: browsers can't set headers on WS, so the token rides in the query.
  if (p === '/v1/ws') {
    if (req.headers.get('Upgrade') !== 'websocket') throw new HttpError(426, 'upgrade-required', 'Expected WebSocket');
    const user = await authenticate(env, url.searchParams.get('token'));
    return hub(env, user.id).fetch(new Request('https://hub/ws', { headers: req.headers }));
  }

  const token = bearer(req);
  const user = await authenticate(env, token);

  if (p === '/v1/auth/logout' && m === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token!)).run();
    return json({ ok: true });
  }
  if (p === '/v1/me') {
    if (m === 'GET') return json({ user: publicUser(user) });
    if (m === 'PATCH') {
      const b = await readJson<{ name?: string }>(req);
      const name = (typeof b.name === 'string' ? b.name.trim() : '').slice(0, 80);
      if (!name) throw new HttpError(400, 'bad-name', 'Name cannot be empty.');
      await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run();
      return json({ user: publicUser({ ...user, name }) });
    }
    if (m === 'DELETE') {
      await hub(env, user.id).wipe();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
        env.DB.prepare('DELETE FROM reset_codes WHERE user_id = ?').bind(user.id),
        env.DB.prepare('DELETE FROM agent_tokens WHERE user_id = ?').bind(user.id),
        env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
      ]);
      return json({ ok: true });
    }
  }
  if (p === '/v1/agent-token') {
    if (m === 'GET') {
      const row = await env.DB.prepare('SELECT hint, created_at, last_used FROM agent_tokens WHERE user_id = ?')
        .bind(user.id)
        .first<{ hint: string; created_at: number; last_used: number | null }>();
      return json({ token: row ? { hint: row.hint, createdAt: row.created_at, lastUsed: row.last_used } : null });
    }
    if (m === 'POST') {
      const b = await readJson<{ timeZone?: string }>(req).catch(() => ({}) as { timeZone?: string });
      const token = AGENT_PREFIX + randomToken();
      await env.DB.prepare(
        `INSERT INTO agent_tokens (user_id, token_hash, hint, time_zone, created_at, last_used) VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT (user_id) DO UPDATE SET token_hash = excluded.token_hash, hint = excluded.hint,
           time_zone = excluded.time_zone, created_at = excluded.created_at, last_used = NULL`,
      )
        .bind(user.id, await sha256(token), token.slice(-4), validZone(b.timeZone), Date.now())
        .run();
      return json({ token });
    }
    if (m === 'DELETE') {
      await env.DB.prepare('DELETE FROM agent_tokens WHERE user_id = ?').bind(user.id).run();
      return json({ ok: true });
    }
  }
  if (p === '/v1/sync') {
    if (m === 'GET') {
      const since = Math.max(0, Number(url.searchParams.get('since') ?? 0) || 0);
      return json(await hub(env, user.id).pull(since));
    }
    if (m === 'POST') {
      const ops = parseOps(await readJson(req));
      return json(await hub(env, user.id).push(ops));
    }
  }
  throw new HttpError(404, 'not-found', 'Not found');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await route(req, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: { code: e.code, message: e.message } }, e.status);
      // DO RPC errors arrive as plain Errors carrying the original message.
      if (e instanceof BadRequest || (e as Error)?.message?.startsWith('Limit of')) {
        return json({ error: { code: 'bad-request', message: (e as Error).message } }, 400);
      }
      console.error('unhandled', e);
      return json({ error: { code: 'internal', message: 'Something went wrong on our side.' } }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
