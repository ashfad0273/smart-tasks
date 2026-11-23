/* API smoke test — no dependencies (Node 22+).
 *
 *   npm run smoke                         # against production
 *   API_URL=http://localhost:8787 npm run smoke   # against `wrangler dev`
 *
 * Creates a throwaway account, pushes/pulls a task, checks the realtime
 * WebSocket, then deletes the account again.
 */
const API = (process.env.API_URL || 'https://smart-tasks-api.ashfadhossain0.workers.dev').replace(/\/+$/, '');

let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

(async () => {
  console.log(`Smoke testing ${API}\n`);

  const health = await call('/v1/health');
  check('health', health.status === 200 && health.data?.ok);

  const config = await call('/v1/config');
  check('config', config.status === 200 && 'passwordReset' in (config.data || {}));

  const privacy = await fetch(API + '/privacy');
  check('privacy page', privacy.status === 200);

  const email = `smoke-${Date.now()}@example.com`;
  const signup = await call('/v1/auth/signup', { method: 'POST', body: { name: 'Smoke', email, password: 'correct horse battery 9' } });
  check('signup', signup.status === 200 && !!signup.data?.token, String(signup.status));
  const token = signup.data?.token;
  if (!token) return finish();

  const badLogin = await call('/v1/auth/login', { method: 'POST', body: { email, password: 'wrong password!!' } });
  check('wrong password rejected', badLogin.status === 401);

  const unauth = await call('/v1/sync?since=0');
  check('unauthenticated sync rejected', unauth.status === 401);

  // Realtime: open a socket and expect a rev push after the write below.
  let gotRev = false;
  let ws;
  if (typeof WebSocket !== 'undefined') {
    ws = new WebSocket(`${API.replace(/^http/, 'ws')}/v1/ws?token=${encodeURIComponent(token)}`);
    ws.onmessage = e => {
      try {
        if (JSON.parse(e.data).type === 'rev') gotRev = true;
      } catch {}
    };
    await new Promise(r => {
      ws.onopen = r;
      ws.onerror = r;
      setTimeout(r, 3000);
    });
  }

  const id = 't_smoke_' + Date.now();
  const push = await call('/v1/sync', {
    method: 'POST',
    token,
    body: { ops: [{ kind: 'task', id, op: 'upsert', data: { title: 'Smoke task', createdAt: Date.now() } }] },
  });
  check('push', push.status === 200 && push.data?.rev > 0, String(push.status));

  const pull = await call('/v1/sync?since=0', { token });
  check('pull', pull.status === 200 && pull.data?.changes?.some(c => c.id === id && c.data?.title === 'Smoke task'));

  if (ws) {
    await new Promise(r => setTimeout(r, 1500));
    check('websocket rev push', gotRev);
    ws.close();
  }

  const del = await call('/v1/me', { method: 'DELETE', token });
  check('delete account', del.status === 200);

  const after = await call('/v1/me', { token });
  check('session invalid after delete', after.status === 401);

  finish();
})().catch(e => {
  console.error(e);
  process.exit(1);
});

function finish() {
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
}
