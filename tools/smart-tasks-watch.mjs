#!/usr/bin/env node
// Smart Tasks watcher for Claude Code sessions, in any project.
//
// Waits until the user OKs something in the Smart Tasks app for this session, prints
// one line per request and exits. Run it with Bash `run_in_background`: Claude Code
// wakes the session when a background command exits, so answers arrive within about
// a minute without spending tokens while waiting. Plain HTTP, no Claude involved.
//
//   node ~/.claude/tools/smart-tasks-watch.mjs                 (session = $CLAUDE_CODE_SESSION_ID)
//   node ~/.claude/tools/smart-tasks-watch.mjs --session <id> --scope <scope> --every 60 --max-hours 8
//   node tools/smart-tasks-watch.mjs --install                 (copy this file to ~/.claude/tools/)
//
// Reads the MCP URL and Authorization header from the "smart-tasks" entry in
// ~/.claude.json (never printed). SMART_TASKS_URL overrides the URL (for tests).
// Exit codes: 0 = requests (or "timed out", or "already watching"), 1 = server unreachable, 2 = bad usage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = name => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

if (args.includes('--install')) {
  const dir = path.join(os.homedir(), '.claude', 'tools');
  fs.mkdirSync(dir, { recursive: true });
  const to = path.join(dir, 'smart-tasks-watch.mjs');
  fs.copyFileSync(fileURLToPath(import.meta.url), to);
  console.log(`installed ${to}`);
  process.exit(0);
}

const session = opt('session') || process.env.CLAUDE_CODE_SESSION_ID;
const scope = opt('scope');
const every = Math.max(5, Number(opt('every') ?? 60)) * 1000;
const maxHours = Number(opt('max-hours') ?? 8);
if (!session || !Number.isFinite(every) || !(maxHours > 0)) {
  console.log('usage: smart-tasks-watch.mjs [--session <id>] [--scope <scope>] [--every <seconds>] [--max-hours <n>]');
  process.exit(2);
}

// ── One watcher per session: a lock file in the OS temp folder ──
const key = crypto.createHash('sha1').update(session).digest('hex').slice(0, 16);
const lock = path.join(os.tmpdir(), `smart-tasks-watch-${key}.lock`);
const seenFile = path.join(os.tmpdir(), `smart-tasks-watch-${key}.seen.json`);
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
try {
  fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
} catch {
  const pid = Number(fs.readFileSync(lock, 'utf8'));
  if (pid && pid !== process.pid && alive(pid)) {
    console.log(`already watching (pid ${pid})`);
    process.exit(0);
  }
  fs.writeFileSync(lock, String(process.pid)); // stale lock from a killed watcher
}
const unlock = () => {
  try {
    if (fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.unlinkSync(lock);
  } catch {}
};
process.on('exit', unlock);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));

// Requests already reported to the session. Only new ones wake it again, so a request
// the session skipped (or could not claim) never wakes it in a loop.
let seen = {};
try {
  seen = JSON.parse(fs.readFileSync(seenFile, 'utf8'));
} catch {}

// ── Smart Tasks MCP over plain HTTP ──
// User-wide entry first (`claude mcp add --scope user`), else this project's, else .mcp.json here.
const claudeJson = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
  } catch {
    return {};
  }
})();
const here = path.resolve(process.cwd());
const projectEntry = Object.entries(claudeJson.projects || {}).find(([p]) => path.resolve(p).toLowerCase() === here.toLowerCase())?.[1];
const dotMcp = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(here, '.mcp.json'), 'utf8'));
  } catch {
    return {};
  }
})();
const cfg =
  claudeJson.mcpServers?.['smart-tasks'] || projectEntry?.mcpServers?.['smart-tasks'] || dotMcp.mcpServers?.['smart-tasks'];
if (!cfg?.url) {
  console.log('no "smart-tasks" MCP server found (~/.claude.json or .mcp.json); connect it from the AI agents page in Smart Tasks');
  process.exit(1);
}
const url = process.env.SMART_TASKS_URL || cfg.url;
const base = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(cfg.headers || {}) };
let sid;
async function rpc(method, params, id) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...base, ...(sid ? { 'mcp-session-id': sid } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(id != null ? { id } : {}) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  sid = res.headers.get('mcp-session-id') || sid;
  const text = await res.text();
  if (!text) return null;
  const m = text.match(/^data: (.*)$/m);
  const msg = JSON.parse(m ? m[1] : text);
  if (msg?.error) throw new Error(msg.error.message || 'MCP error');
  return msg;
}
async function listRequests() {
  if (!sid) {
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smart-tasks-watch', version: '1' } }, 1);
    await rpc('notifications/initialized', {});
  }
  const r = await rpc('tools/call', { name: 'list_requests', arguments: { session, ...(scope ? { scope } : {}) } }, 2);
  const res = r?.result;
  if (res?.isError) throw new Error(res.content?.[0]?.text || 'list_requests failed');
  return res?.structuredContent ?? JSON.parse(res?.content?.[0]?.text ?? '{}');
}

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const deadline = Date.now() + maxHours * 3600_000;
let fails = 0;
for (;;) {
  try {
    const { requests = [] } = await listRequests();
    fails = 0;
    const fresh = requests.filter(r => seen[r.request] !== r.approved);
    if (fresh.length) {
      for (const r of fresh) seen[r.request] = r.approved;
      try {
        fs.writeFileSync(seenFile, JSON.stringify(seen));
      } catch {}
      console.log(`Smart Tasks: ${fresh.length} approved request(s). claim_request, do it, finish_request, then restart this watcher.`);
      for (const r of fresh) {
        const title = r.task?.title ?? r.title;
        console.log(
          `- request ${r.request} | task: ${clip(title, 80)}${r.subtask ? ` | subtask: ${clip(r.subtask, 100)}` : ''} | userAnswer: ${clip(r.userAnswer, 300)}`,
        );
      }
      process.exit(0);
    }
  } catch (e) {
    sid = undefined; // start a fresh MCP session on the next try
    if (++fails >= 5) {
      console.log(`Smart Tasks watcher stopped: server unreachable 5 times in a row (${clip(e.message || e, 120)}).`);
      process.exit(1);
    }
  }
  if (Date.now() + every > deadline) {
    console.log(`Smart Tasks watcher timed out after ${maxHours} h with nothing approved; start it again to keep watching.`);
    process.exit(0);
  }
  await sleep(fails ? Math.min(every, 15_000) : every);
}
