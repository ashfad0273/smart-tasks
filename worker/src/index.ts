import { hashPassword, randomToken, sha256, verifyGoogleIdToken, verifyPassword } from './crypto';
import { BadRequest, parseOps, parsePerms } from './model';
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
 *   GET    /v1/stats                  → {since, total, agent, byAgent: {name: n}}  (last 30 days)
 *   GET    /v1/agent-keys             → {keys: [{id, name, hint, createdAt, lastUsed}]}
 *   POST   /v1/agent-keys             {name, timeZone} → {key, token: "stk_…"}  (token shown once)
 *   PATCH  /v1/agent-keys/:id         {name} → {key}
 *   DELETE /v1/agent-keys/:id         revoke one key
 *   GET|POST|DELETE /v1/agent-token   old single-token API (1.6.x clients): acts on the newest key
 *   GET    /v1/agent-permissions      → {permissions: {add, edit, complete, archive, delete, categories, notify}}
 *   PATCH  /v1/agent-permissions      {permissions: {…partial}} → {permissions}
 *   GET    /v1/sessions               → {sessions: [{id, device, location, createdAt, lastSeen, current, online}], agent}
 *   DELETE /v1/sessions/:id           sign that device out
 *   DELETE /v1/sessions?others=1      sign out every other device
 *   GET    /v1/activity?cursor=<next>&limit=<n> → {events: [{id, at, type, taskId, title, by}], next}
 *   GET    /v1/notices?after=<id>     → {latest, notices: [{id, title, message, url, createdAt}]}  (agent notifications)
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

/** "Chrome on macOS" from a User-Agent string. */
function deviceName(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /CrOS/.test(ua)
      ? 'ChromeOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'macOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : '';
  return os ? `${browser} on ${os}` : browser;
}

function locationOf(req: Request): string | null {
  const cf = (req as Request & { cf?: { city?: string; country?: string } }).cf;
  if (!cf) return null;
  return [cf.city, cf.country].filter(Boolean).join(', ') || null;
}

const newSessionId = () => randomToken(9);

async function createSession(env: Env, userId: string, req?: Request): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen, id, device, location) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      await sha256(token),
      userId,
      now,
      now + SESSION_TTL,
      now,
      newSessionId(),
      req ? deviceName(req.headers.get('User-Agent')) : null,
      req ? locationOf(req) : null,
    )
    .run();
  return token;
}

type Authed = UserRow & { session_id: string };

async function authenticate(env: Env, token: string | null, req?: Request): Promise<Authed> {
  if (!token) throw new HttpError(401, 'unauthenticated', 'Sign in required');
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT u.*, s.expires_at, s.last_seen, s.id AS session_id, s.device FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  )
    .bind(hash)
    .first<Authed & { expires_at: number; last_seen: number; device: string | null }>();
  const now = Date.now();
  if (!row || row.expires_at < now) throw new HttpError(401, 'session-expired', 'Your session expired — please sign in again.');
  if (now - row.last_seen > 5 * 60_000 || !row.device || !row.session_id) {
    // "Last active" + sliding expiry, written at most every few minutes.
    // Sessions from before the device list get their name/id filled in here.
    const id = row.session_id || newSessionId();
    await env.DB.prepare(
      'UPDATE sessions SET last_seen = ?, expires_at = ?, id = ?, device = COALESCE(device, ?), location = COALESCE(location, ?) WHERE token_hash = ?',
    )
      .bind(now, now + SESSION_TTL, id, req ? deviceName(req.headers.get('User-Agent')) : null, req ? locationOf(req) : null, hash)
      .run();
    row.session_id = id;
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

async function agentAuth(env: Env, token: string | null): Promise<{ user: UserRow; tz: string; agent: string }> {
  if (!token?.startsWith(AGENT_PREFIX)) {
    throw new HttpError(401, 'unauthenticated', 'Send your Smart Tasks agent token as "Authorization: Bearer stk_…". Create one in Smart Tasks → Settings → AI agent.');
  }
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT u.*, a.time_zone, a.last_used, a.name AS agent_name FROM agent_keys a JOIN users u ON u.id = a.user_id WHERE a.token_hash = ?`,
  )
    .bind(hash)
    .first<UserRow & { time_zone: string; last_used: number | null; agent_name: string }>();
  if (!row) throw new HttpError(401, 'token-revoked', 'This agent token is no longer valid. Create a new one in Smart Tasks → Settings → AI agent.');
  const now = Date.now();
  if (!row.last_used || now - row.last_used > 10 * 60_000) {
    await env.DB.prepare('UPDATE agent_keys SET last_used = ? WHERE token_hash = ?').bind(now, hash).run();
  }
  return { user: row, tz: row.time_zone || 'UTC', agent: row.agent_name };
}

const MAX_AGENT_KEYS = 20;
type AgentKeyRow = { id: string; name: string; hint: string; created_at: number; last_used: number | null };
const publicKey = (r: AgentKeyRow) => ({ id: r.id, name: r.name, hint: r.hint, createdAt: r.created_at, lastUsed: r.last_used });

function keyName(v: unknown): string {
  const name = (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '').slice(0, 40);
  if (!name) throw new HttpError(400, 'bad-name', 'Give the key a name, like "Claude Code" or "Cursor".');
  return name;
}

async function agentKeys(env: Env, userId: string): Promise<AgentKeyRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, name, hint, created_at, last_used FROM agent_keys WHERE user_id = ? ORDER BY created_at DESC',
  )
    .bind(userId)
    .all<AgentKeyRow>();
  return results;
}

async function createAgentKey(env: Env, userId: string, name: string, timeZone: unknown): Promise<{ key: ReturnType<typeof publicKey>; token: string }> {
  const keys = await agentKeys(env, userId);
  if (keys.length >= MAX_AGENT_KEYS) throw new HttpError(400, 'too-many-keys', `You can have up to ${MAX_AGENT_KEYS} agent keys. Revoke one first.`);
  if (keys.some(k => k.name.toLowerCase() === name.toLowerCase())) {
    throw new HttpError(409, 'name-taken', `You already have a key called "${name}". Pick another name so History can tell them apart.`);
  }
  const token = AGENT_PREFIX + randomToken();
  const row: AgentKeyRow = { id: randomToken(9), name, hint: token.slice(-4), created_at: Date.now(), last_used: null };
  await env.DB.prepare(
    'INSERT INTO agent_keys (id, user_id, name, token_hash, hint, time_zone, created_at, last_used) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
  )
    .bind(row.id, userId, name, await sha256(token), row.hint, validZone(timeZone), row.created_at)
    .run();
  return { key: publicKey(row), token };
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
  return json({ token: await createSession(env, user.id, req), user: publicUser(user), created: true });
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
  return json({ token: await createSession(env, user.id, req), user: publicUser(user) });
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
  return json({ token: await createSession(env, user.id, req), user: publicUser(user), created });
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
  return json({ token: await createSession(env, user.id, req), user: publicUser(user) });
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
    const { user, tz, agent } = await agentAuth(env, bearer(req));
    const h = hub(env, user.id);
    return handleMcp(req, { hub: h, name: user.name, agent, tz, perms: await h.agentPerms() }, { 'Cache-Control': 'no-store', ...CORS });
  }

  // WebSocket: browsers can't set headers on WS, so the token rides in the query.
  if (p === '/v1/ws') {
    if (req.headers.get('Upgrade') !== 'websocket') throw new HttpError(426, 'upgrade-required', 'Expected WebSocket');
    const user = await authenticate(env, url.searchParams.get('token'), req);
    const headers = new Headers(req.headers);
    headers.set('X-Session-Id', user.session_id);
    return hub(env, user.id).fetch(new Request('https://hub/ws', { headers }));
  }

  const token = bearer(req);
  const user = await authenticate(env, token, req);

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
        env.DB.prepare('DELETE FROM agent_keys WHERE user_id = ?').bind(user.id),
        env.DB.prepare('DELETE FROM agent_tokens WHERE user_id = ?').bind(user.id),
        env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
      ]);
      return json({ ok: true });
    }
  }
  if (p === '/v1/activity' && m === 'GET') {
    const cursor = (url.searchParams.get('cursor') ?? '').slice(0, 40);
    const limit = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get('limit')) || 50)));
    const task = (url.searchParams.get('task') ?? '').slice(0, 80) || null;
    return json(await hub(env, user.id).activity(cursor, limit, task));
  }
  if (p === '/v1/stats' && m === 'GET') {
    return json(await hub(env, user.id).stats());
  }
  if (p === '/v1/notices' && m === 'GET') {
    const after = Math.max(0, Math.floor(Number(url.searchParams.get('after')) || 0));
    return json(await hub(env, user.id).notices(after));
  }
  if (p === '/v1/sessions' && m === 'GET') {
    const [{ results }, agents, online] = await Promise.all([
      env.DB.prepare('SELECT id, device, location, created_at, last_seen FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen DESC')
        .bind(user.id, Date.now())
        .all<{ id: string; device: string | null; location: string | null; created_at: number; last_seen: number }>(),
      agentKeys(env, user.id),
      hub(env, user.id).online(),
    ]);
    const live = new Set(online);
    const agent = agents[0];
    return json({
      sessions: results.map(r => ({
        id: r.id,
        device: r.device ?? 'Unknown device',
        location: r.location,
        createdAt: r.created_at,
        lastSeen: r.last_seen,
        current: r.id === user.session_id,
        online: live.has(r.id),
      })),
      agent: agent ? { hint: agent.hint, createdAt: agent.created_at, lastUsed: agent.last_used } : null,
      agents: agents.map(publicKey),
    });
  }
  if (p === '/v1/sessions' && m === 'DELETE' && url.searchParams.get('others') === '1') {
    const { results } = await env.DB.prepare('SELECT id FROM sessions WHERE user_id = ? AND id != ?')
      .bind(user.id, user.session_id)
      .all<{ id: string }>();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(user.id, user.session_id).run();
    await hub(env, user.id).kick(results.map(r => r.id));
    return json({ ok: true, signedOut: results.length });
  }
  const sm = p.match(/^\/v1\/sessions\/([A-Za-z0-9_-]{6,40})$/);
  if (sm && m === 'DELETE') {
    if (sm[1] === user.session_id) throw new HttpError(400, 'current-session', 'Use Sign out for this device.');
    const r = await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id = ?').bind(user.id, sm[1]).run();
    if (!r.meta.changes) throw new HttpError(404, 'not-found', 'That device is already signed out.');
    await hub(env, user.id).kick([sm[1]]);
    return json({ ok: true });
  }
  if (p === '/v1/agent-permissions') {
    const h = hub(env, user.id);
    if (m === 'GET') return json({ permissions: await h.agentPerms() });
    if (m === 'PATCH') {
      const next = parsePerms(await readJson<unknown>(req), await h.agentPerms());
      return json({ permissions: await h.setAgentPerms(next) });
    }
  }
  if (p === '/v1/agent-keys') {
    if (m === 'GET') return json({ keys: (await agentKeys(env, user.id)).map(publicKey) });
    if (m === 'POST') {
      const b = await readJson<{ name?: unknown; timeZone?: unknown }>(req);
      return json(await createAgentKey(env, user.id, keyName(b.name), b.timeZone));
    }
  }
  const km = p.match(/^\/v1\/agent-keys\/([A-Za-z0-9_-]{6,40})$/);
  if (km) {
    if (m === 'PATCH') {
      const name = keyName((await readJson<{ name?: unknown }>(req)).name);
      const clash = await env.DB.prepare('SELECT id FROM agent_keys WHERE user_id = ? AND lower(name) = lower(?) AND id != ?')
        .bind(user.id, name, km[1])
        .first();
      if (clash) throw new HttpError(409, 'name-taken', `You already have a key called "${name}".`);
      const old = await env.DB.prepare('SELECT name FROM agent_keys WHERE user_id = ? AND id = ?').bind(user.id, km[1]).first<{ name: string }>();
      if (!old) throw new HttpError(404, 'not-found', 'That key no longer exists.');
      const row = await env.DB.prepare('UPDATE agent_keys SET name = ? WHERE user_id = ? AND id = ? RETURNING id, name, hint, created_at, last_used')
        .bind(name, user.id, km[1])
        .first<AgentKeyRow>();
      if (!row) throw new HttpError(404, 'not-found', 'That key no longer exists.');
      if (old.name !== name) await hub(env, user.id).renameAgent(old.name, name);
      return json({ key: publicKey(row) });
    }
    if (m === 'DELETE') {
      const r = await env.DB.prepare('DELETE FROM agent_keys WHERE user_id = ? AND id = ?').bind(user.id, km[1]).run();
      if (!r.meta.changes) throw new HttpError(404, 'not-found', 'That key is already revoked.');
      return json({ ok: true });
    }
  }
  // Old single-token API, still used by 1.6.x apps until they update.
  if (p === '/v1/agent-token') {
    const newest = (await agentKeys(env, user.id))[0];
    if (m === 'GET') {
      return json({ token: newest ? { hint: newest.hint, createdAt: newest.created_at, lastUsed: newest.last_used } : null });
    }
    if (m === 'POST') {
      const b = await readJson<{ timeZone?: unknown }>(req).catch(() => ({}) as { timeZone?: unknown });
      if (newest) await env.DB.prepare('DELETE FROM agent_keys WHERE user_id = ? AND id = ?').bind(user.id, newest.id).run();
      const { token } = await createAgentKey(env, user.id, newest?.name ?? 'AI agent', b.timeZone);
      return json({ token });
    }
    if (m === 'DELETE') {
      if (newest) await env.DB.prepare('DELETE FROM agent_keys WHERE user_id = ? AND id = ?').bind(user.id, newest.id).run();
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
