import { DurableObject } from 'cloudflare:workers';
import { sendPush, type PushSub } from './webpush';
import { BadRequest, bitsToPerms, categoryDefaults, CLAIM_STALE_MS, DEFAULT_AGENT_PERMS, isOpen, LIMITS, mergeTask, permsToBits, taskDefaults, type AgentPerms, type Approval, type Change, type Req, type SyncOp } from './model';

/**
 * One instance per user. Holds the user's tasks + categories in its private
 * SQLite database and pushes a "rev" notification to every connected device
 * (hibernatable WebSockets, so idle connections cost nothing).
 *
 * Every write bumps a per-user monotonic revision. Clients pull
 * `changes since <rev>` — simple, gap-free, and offline-friendly.
 */
const NOTICE_HOURLY_LIMIT = 30;
/** When a phone gets notifications: every time, only with no desktop app open, only when the computer is idle, or never. */
export type PushMode = 'always' | 'closed' | 'away' | 'off';
export const PUSH_MODES: PushMode[] = ['always', 'closed', 'away', 'off'];
/** A desktop app that has not reported its idle time for this long counts as idle. */
const PRESENCE_STALE_MS = 3 * 60_000;
type Presence = { at: number; input: number };
type PushRow = { endpoint: string; p256dh: string; auth: string; session_id: string | null; mode: PushMode; away_min: number };
/** A sent request nobody has claimed after this long gets a desktop notification. */
export const UNCLAIMED_MS = 5 * 60_000;

type Sub = { id: string; title: string; done: boolean; approval?: Approval | null; aiRequest?: Req | null };
type TaskRec = Record<string, unknown> & { id: string; title?: string; subtasks?: Sub[]; aiRequest?: Req | null; completedAt?: number | null };
/** One request: on the task itself, or on one of its subtasks. */
export interface ReqRef {
  task: TaskRec;
  sub: Sub | null;
  req: Req | null | undefined;
}
/** Every request a task carries (the task's own first, then its subtasks'). */
export const requestsOf = (t: TaskRec): ReqRef[] => [
  { task: t, sub: null, req: t.aiRequest },
  ...(t.subtasks ?? []).map(s => ({ task: t, sub: s, req: s.aiRequest })),
];

export type Actor = 'me' | 'agent';
export type ActivityType = 'added' | 'completed' | 'reopened' | 'deleted' | 'archived' | 'restored' | 'notice';
export interface ActivityEvent {
  id: number;
  at: number;
  type: ActivityType;
  taskId: string | null;
  title: string;
  /** Notification body for "notice" events; "category" for category events. */
  detail: string | null;
  by: Actor;
  /** Name of the agent key that made the change (agent events only). */
  agent: string | null;
}

export class UserHub extends DurableObject<Env> {
  private sql: SqlStorage;
  /** Agent key name for the write in progress (set by push/notify, read by log). */
  private who: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS items (
        kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT, rev INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (kind, id)
      );
      CREATE INDEX IF NOT EXISTS items_rev ON items(rev);
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS notices (
        id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, message TEXT NOT NULL,
        url TEXT, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, type TEXT NOT NULL,
        task_id TEXT, title TEXT NOT NULL, detail TEXT, by TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS activity_at ON activity(at);
    `);
    // Columns added later: which named agent key did it / sent it.
    const cols = (t: string) => new Set(this.sql.exec<{ name: string }>(`PRAGMA table_info(${t})`).toArray().map(r => r.name));
    if (!cols('activity').has('who')) this.sql.exec(`ALTER TABLE activity ADD COLUMN who TEXT`);
    if (!cols('notices').has('sender')) this.sql.exec(`ALTER TABLE notices ADD COLUMN sender TEXT`);
    // Text the notification's "Copy prompt" button copies.
    if (!cols('notices').has('copy')) this.sql.exec(`ALTER TABLE notices ADD COLUMN copy TEXT`);
    // The task a notification is about: clicking it opens that task.
    if (!cols('notices').has('task_id')) this.sql.exec(`ALTER TABLE notices ADD COLUMN task_id TEXT`);
    // Requests already reported as unclaimed (by request id), so each is reported once.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS nudged (rid TEXT PRIMARY KEY, at INTEGER NOT NULL)`);
    // Phones (the installed web app) that get push notifications, and when.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS push_subs (
      endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, session_id TEXT,
      mode TEXT NOT NULL DEFAULT 'away', away_min INTEGER NOT NULL DEFAULT 5, created_at INTEGER NOT NULL
    )`);
    // Clipboard sync (desktop apps). Everything here is end-to-end encrypted by the
    // computers: the key itself never reaches the server, only copies of it wrapped
    // for each computer's own public key.
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS clip_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS clip_devices (id TEXT PRIMARY KEY, pub TEXT NOT NULL, wrapped TEXT, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS clip_blobs (id TEXT NOT NULL, part INTEGER NOT NULL, data BLOB NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (id, part));
    `);
    this.backfillActivity();
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /** First run after the activity log shipped: seed it from existing tasks' timestamps. */
  private backfillActivity(): void {
    const done = this.sql.exec<{ v: number }>(`SELECT v FROM meta WHERE k = 'activity_v'`).toArray()[0];
    if (done) return;
    this.ctx.storage.transactionSync(() => {
      const tasks = this.sql
        .exec<{ id: string; data: string }>(`SELECT id, data FROM items WHERE kind = 'task' AND deleted = 0`)
        .toArray();
      for (const t of tasks) {
        const d = JSON.parse(t.data) as Record<string, unknown>;
        const title = String(d.title ?? '');
        if (typeof d.createdAt === 'number') this.log(d.createdAt, 'added', t.id, title, 'me');
        if (typeof d.completedAt === 'number') this.log(d.completedAt, 'completed', t.id, title, 'me');
      }
      this.sql.exec(`INSERT INTO meta (k, v) VALUES ('activity_v', 1) ON CONFLICT (k) DO UPDATE SET v = 1`);
    });
  }

  private log(at: number, type: ActivityType, taskId: string | null, title: string, by: Actor, detail: string | null = null): void {
    this.sql.exec(
      `INSERT INTO activity (at, type, task_id, title, detail, by, who) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      Math.min(at, Date.now()),
      type,
      taskId,
      title.slice(0, 200),
      detail,
      by,
      by === 'agent' ? this.who : null,
    );
  }

  private rev(): number {
    const row = this.sql.exec<{ v: number }>(`SELECT v FROM meta WHERE k = 'rev'`).toArray()[0];
    return row?.v ?? 0;
  }

  /* ── RPC ──────────────────────────────────────────────────────────── */

  pull(since: number): { rev: number; changes: Change[]; more: boolean } {
    const PAGE = 2000;
    const rows = this.sql
      .exec<{ kind: string; id: string; data: string | null; deleted: number; rev: number }>(
        `SELECT kind, id, data, deleted, rev FROM items WHERE rev > ? ORDER BY rev LIMIT ?`,
        since,
        PAGE + 1,
      )
      .toArray();
    const more = rows.length > PAGE;
    const page = more ? rows.slice(0, PAGE) : rows;
    const changes: Change[] = page.map(r => ({
      kind: r.kind as Change['kind'],
      id: r.id,
      deleted: r.deleted === 1,
      data: r.deleted ? null : (JSON.parse(r.data ?? 'null') as Record<string, unknown>),
    }));
    return { rev: more ? page[page.length - 1].rev : this.rev(), changes, more };
  }

  /** Every live (not deleted) record of one kind, for the agent API. */
  list(kind: 'task' | 'category'): Array<Record<string, unknown> & { id: string }> {
    return this.sql
      .exec<{ id: string; data: string }>(`SELECT id, data FROM items WHERE kind = ? AND deleted = 0`, kind)
      .toArray()
      .map(r => ({ ...(JSON.parse(r.data) as Record<string, unknown>), id: r.id }));
  }

  /** Newest-first history page: tasks added, completed, reopened, deleted and agent notifications.
   *  `cursor` is the `next` value of the previous page ("<at>_<id>"), or empty for the newest. */
  activity(cursor: string, limit: number, taskId: string | null = null): { events: ActivityEvent[]; next: string | null } {
    const m = /^(\d+)_(\d+)$/.exec(cursor);
    const at = m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
    const id = m ? Number(m[2]) : Number.MAX_SAFE_INTEGER;
    type Row = { id: number; at: number; type: string; task_id: string | null; title: string; detail: string | null; by: string; who: string | null };
    const cols = `SELECT id, at, type, task_id, title, detail, by, who FROM activity`;
    const rows = (
      taskId
        ? this.sql.exec<Row>(
            `${cols} WHERE task_id = ? AND (at < ? OR (at = ? AND id < ?)) ORDER BY at DESC, id DESC LIMIT ?`,
            taskId,
            at,
            at,
            id,
            limit + 1,
          )
        : this.sql.exec<Row>(`${cols} WHERE at < ? OR (at = ? AND id < ?) ORDER BY at DESC, id DESC LIMIT ?`, at, at, id, limit + 1)
    ).toArray();
    const page = rows.slice(0, limit);
    const events = page.map(r => ({
      id: r.id,
      at: r.at,
      type: r.type as ActivityType,
      taskId: r.task_id,
      title: r.title,
      detail: r.detail,
      by: r.by as Actor,
      agent: r.who,
    }));
    const last = page[page.length - 1];
    return { events, next: rows.length > limit && last ? `${last.at}_${last.id}` : null };
  }

  push(ops: SyncOp[], by: Actor = 'me', who: string | null = null): { rev: number } {
    if (ops.length === 0) return { rev: this.rev() };
    this.who = who;
    let rev = this.rev();
    const now = Date.now();
    let nudgeAt = Infinity;

    this.ctx.storage.transactionSync(() => {
      const write = (kind: string, id: string, data: Record<string, unknown> | null) => {
        rev++;
        this.sql.exec(
          `INSERT INTO items (kind, id, data, rev, deleted) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (kind, id) DO UPDATE SET data = excluded.data, rev = excluded.rev, deleted = excluded.deleted`,
          kind,
          id,
          data ? JSON.stringify(data) : null,
          rev,
          data ? 0 : 1,
        );
      };

      for (const op of ops) {
        const existing = this.sql
          .exec<{ data: string | null; deleted: number }>(`SELECT data, deleted FROM items WHERE kind = ? AND id = ?`, op.kind, op.id)
          .toArray()[0];

        if (op.op === 'delete') {
          if (!existing || existing.deleted) continue;
          write(op.kind, op.id, null);
          if (op.kind === 'task') this.log(now, 'deleted', op.id, String(JSON.parse(existing.data ?? '{}').title ?? ''), by);
          if (op.kind === 'category') {
            this.log(now, 'deleted', null, String(JSON.parse(existing.data ?? '{}').name ?? ''), by, 'category');
            // Orphaned tasks become uncategorized.
            const tasks = this.sql
              .exec<{ id: string; data: string }>(
                `SELECT id, data FROM items WHERE kind = 'task' AND deleted = 0 AND json_extract(data, '$.categoryId') = ?`,
                op.id,
              )
              .toArray();
            for (const t of tasks) write('task', t.id, { ...JSON.parse(t.data), categoryId: null, updatedAt: now });
          }
          continue;
        }

        // A deleted record stays deleted (an offline edit doesn't resurrect it).
        if (existing?.deleted) continue;
        let base: Record<string, unknown>;
        if (existing) base = JSON.parse(existing.data ?? '{}');
        else {
          const count = this.sql
            .exec<{ n: number }>(`SELECT COUNT(*) AS n FROM items WHERE kind = ? AND deleted = 0`, op.kind)
            .one().n;
          if (count >= LIMITS.itemsPerKind) throw new BadRequest(`Limit of ${LIMITS.itemsPerKind} ${op.kind}s reached`);
          base = op.kind === 'task' ? taskDefaults(now) : categoryDefaults(now);
        }
        const next = op.kind === 'task' ? mergeTask(base, op.data ?? {}, now) : { ...base, ...op.data };
        write(op.kind, op.id, next);
        if (op.kind === 'task') {
          // Newly sent requests: check back in 5 minutes whether an agent took them.
          const before = new Set(requestsOf(base as TaskRec).map(r => r.req?.id).filter(Boolean));
          for (const r of requestsOf(next as TaskRec)) {
            if (r.req?.status === 'approved' && r.req.id && !before.has(r.req.id)) nudgeAt = Math.min(nudgeAt, r.req.at + UNCLAIMED_MS);
          }
        }
        if (op.kind === 'task') {
          const title = String(next.title ?? '');
          const was = existing ? base.completedAt : null;
          const is = next.completedAt;
          if (!existing) this.log(typeof next.createdAt === 'number' ? next.createdAt : now, 'added', op.id, title, by);
          if (was == null && typeof is === 'number') this.log(is, 'completed', op.id, title, by);
          else if (was != null && is == null) this.log(now, 'reopened', op.id, title, by);
        }
        const wasArch = existing ? base.archivedAt != null : false;
        const isArch = next.archivedAt != null;
        if (wasArch !== isArch) {
          const label = String((op.kind === 'task' ? next.title : next.name) ?? '');
          this.log(now, isArch ? 'archived' : 'restored', op.kind === 'task' ? op.id : null, label, by, op.kind === 'category' ? 'category' : null);
        }
      }
      // Keep about a year of history.
      this.sql.exec(`DELETE FROM activity WHERE at < ?`, now - 365 * 86_400_000);

      this.sql.exec(`INSERT INTO meta (k, v) VALUES ('rev', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v`, rev);
    });

    this.broadcast(rev);
    if (nudgeAt !== Infinity) void this.armNudge(nudgeAt);
    return { rev };
  }

  /* ── AI requests ─────────────────────────────────────────────────── */

  private task(id: string): TaskRec | null {
    const row = this.sql.exec<{ data: string }>(`SELECT data FROM items WHERE kind = 'task' AND id = ? AND deleted = 0`, id).toArray()[0];
    return row ? { ...(JSON.parse(row.data) as Record<string, unknown>), id } : null;
  }

  /** Writes a new request state onto the task or one subtask (plus extra task fields). */
  private setRequest(t: TaskRec, subId: string | null, req: Req | null, who: string, extra: Record<string, unknown> = {}, subPatch: Partial<Sub> = {}): void {
    const now = Date.now();
    const data: Record<string, unknown> = { updatedAt: now, ...extra };
    if (subId) data.subtasks = (t.subtasks ?? []).map(s => (s.id === subId ? { ...s, ...subPatch, aiRequest: req } : s));
    else data.aiRequest = req;
    this.push([{ kind: 'task', id: t.id, op: 'upsert', data }], 'agent', who);
  }

  /**
   * Claim a request. Runs in one go inside this object (no awaits), so two agents
   * claiming at once can't both win: the second is told who has it.
   */
  claim(taskId: string, subId: string | null, who: string, session: string | null): { ok: true; req: Req } | { error: string } {
    const t = this.task(taskId);
    const sub = subId ? (t?.subtasks ?? []).find(s => s.id === subId) : null;
    if (!t || (subId && !sub)) return { error: 'That request no longer exists.' };
    const r: Req | null | undefined = subId ? sub!.aiRequest : t.aiRequest;
    if (!isOpen(r)) return { error: (r as Req | null | undefined)?.status === 'done' ? 'That request is already done.' : 'That item is not waiting for an agent.' };
    const now = Date.now();
    if (r.status === 'claimed' && now - r.at <= CLAIM_STALE_MS) {
      const same = session ? r.session === session : !r.session && r.by === who;
      if (!same) return { error: `already claimed by ${r.session ?? r.by ?? 'another agent'}` };
    }
    const req: Req = { ...(r.id ? { id: r.id } : {}), status: 'claimed', at: now, by: who, session, note: null, reply: r.reply ?? null };
    this.setRequest(t, subId, req, who);
    return { ok: true, req };
  }

  /**
   * Finish a claimed request. done: tick the subtask (and finish the task once every
   * subtask is done). Not done: hand it back to the user with the reason.
   */
  finish(taskId: string, subId: string | null, who: string, result: string, done: boolean): { ok: true; taskDone: boolean } | { error: string } {
    const t = this.task(taskId);
    const sub = subId ? (t?.subtasks ?? []).find(s => s.id === subId) : null;
    if (!t || (subId && !sub)) return { error: 'That request no longer exists.' };
    const r = subId ? sub!.aiRequest : t.aiRequest;
    if (!r || r.status === 'cancelled') return { error: r ? 'The user took that request back.' : 'That item was not sent to AI.' };
    if (r.status === 'done' || r.status === 'returned') return { error: 'That request is already finished.' };
    const now = Date.now();
    const req: Req = { ...(r.id ? { id: r.id } : {}), status: done ? 'done' : 'returned', at: now, by: who, session: r.session, note: result, reply: r.reply ?? null };
    let taskDone = false;
    const extra: Record<string, unknown> = {};
    if (done && !subId) {
      extra.completedAt = now;
      taskDone = true;
    } else if (done && subId) {
      const subs = t.subtasks ?? [];
      taskDone = subs.every(s => s.id === subId || s.done);
      if (taskDone && t.completedAt == null) extra.completedAt = now;
    }
    this.setRequest(t, subId, req, who, extra, done && subId ? { done: true } : {});
    return { ok: true, taskDone };
  }

  /** Wake up at `at` (or earlier, if a check is already due sooner). */
  private async armNudge(at: number): Promise<void> {
    const cur = await this.ctx.storage.getAlarm();
    if (cur == null || at < cur) await this.ctx.storage.setAlarm(at);
  }

  /** Requests nobody claimed within 5 minutes: one desktop notification each. */
  async alarm(): Promise<void> {
    const now = Date.now();
    const done = new Set(this.sql.exec<{ rid: string }>(`SELECT rid FROM nudged`).toArray().map(r => r.rid));
    let next = Infinity;
    let sent = false;
    const fresh: Array<{ id: number; title: string; message: string; copy: string; taskId: string }> = [];
    for (const t of this.list('task') as TaskRec[]) {
      if (t.completedAt != null || t.archivedAt != null) continue;
      for (const { sub, req } of requestsOf(t)) {
        if (req?.status !== 'approved' || !req.id || done.has(req.id) || (sub && sub.done)) continue;
        const due = req.at + UNCLAIMED_MS;
        if (due > now) {
          next = Math.min(next, due);
          continue;
        }
        const name = String(sub ? sub.title : t.title).slice(0, 200);
        const id = sub ? sub.id : t.id;
        const n = {
          title: `No agent picked up ${name}`.slice(0, 60),
          message: `Nothing claimed it in 5 minutes. Copy the prompt and paste it into your agent: "${name.slice(0, 80)}"`.slice(0, 240),
          copy: `Check Smart Tasks: run list_requests, claim and do request ${id}`,
        };
        const nid = this.sql
          .exec<{ id: number }>(
            `INSERT INTO notices (title, message, url, created_at, sender, copy, task_id) VALUES (?, ?, NULL, ?, 'Smart Tasks', ?, ?) RETURNING id`,
            n.title,
            n.message,
            now,
            n.copy,
            t.id,
          )
          .one().id;
        fresh.push({ id: nid, ...n, taskId: t.id });
        this.sql.exec(`INSERT INTO nudged (rid, at) VALUES (?, ?) ON CONFLICT (rid) DO NOTHING`, req.id, now);
        sent = true;
      }
    }
    this.sql.exec(`DELETE FROM nudged WHERE at < ?`, now - 30 * 86_400_000);
    if (sent) this.ping({ type: 'notice' });
    for (const n of fresh) await this.pushOut({ ...n, url: null });
    if (next !== Infinity) await this.ctx.storage.setAlarm(next);
  }

  /** Last 30 days: how many changes there were, and how many each named agent made. */
  stats(): { since: number; total: number; agent: number; byAgent: Record<string, number> } {
    const since = Date.now() - 30 * 86_400_000;
    const total = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM activity WHERE at >= ? AND type != 'notice'`, since).one().n;
    const rows = this.sql
      .exec<{ who: string | null; n: number }>(
        `SELECT who, COUNT(*) AS n FROM activity WHERE at >= ? AND by = 'agent' AND type != 'notice' GROUP BY who`,
        since,
      )
      .toArray();
    const byAgent: Record<string, number> = {};
    let agent = 0;
    for (const r of rows) {
      agent += r.n;
      byAgent[r.who ?? 'AI agent'] = (byAgent[r.who ?? 'AI agent'] ?? 0) + r.n;
    }
    return { since, total, agent, byAgent };
  }

  /** A key was renamed: History follows the new name. */
  renameAgent(from: string, to: string): void {
    this.sql.exec(`UPDATE activity SET who = ? WHERE who = ?`, to, from);
    this.sql.exec(`UPDATE notices SET sender = ? WHERE sender = ?`, to, from);
  }

  /* ── agent permissions ───────────────────────────────────────────── */

  agentPerms(): AgentPerms {
    const row = this.sql.exec<{ v: number }>(`SELECT v FROM meta WHERE k = 'agent_perms'`).toArray()[0];
    return row ? bitsToPerms(row.v) : { ...DEFAULT_AGENT_PERMS };
  }

  setAgentPerms(p: AgentPerms): AgentPerms {
    this.sql.exec(`INSERT INTO meta (k, v) VALUES ('agent_perms', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v`, permsToBits(p));
    return this.agentPerms();
  }

  /* ── agent notifications ─────────────────────────────────────────── */

  /** Queue a desktop notification from an AI agent. Devices fetch it on their next check. */
  notify(n: { title: string; message: string; url: string | null; taskId?: string | null }, who: string | null = null): { id: number } | { error: string } {
    const now = Date.now();
    const recent = this.sql
      .exec<{ n: number }>(`SELECT COUNT(*) AS n FROM notices WHERE created_at > ?`, now - 3600_000)
      .one().n;
    if (recent >= NOTICE_HOURLY_LIMIT) return { error: `Limit of ${NOTICE_HOURLY_LIMIT} notifications per hour reached. Try again later.` };
    const id = this.sql
      .exec<{ id: number }>(
        `INSERT INTO notices (title, message, url, created_at, sender, task_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        n.title,
        n.message,
        n.url,
        now,
        who,
        n.taskId ?? null,
      )
      .one().id;
    this.sql.exec(`DELETE FROM notices WHERE created_at < ?`, now - 7 * 86_400_000);
    this.who = who;
    this.log(now, 'notice', n.taskId ?? null, n.title, 'agent', n.message);
    this.ping({ type: 'notice' });
    this.ctx.waitUntil(this.pushOut({ id, ...n, from: who }));
    return { id };
  }

  /** Notifications newer than `after` (a notice id) from the last day. */
  notices(after: number): {
    latest: number;
    notices: Array<{ id: number; title: string; message: string; url: string | null; createdAt: number; from: string | null; copy?: string; taskId?: string }>;
  } {
    const latest = this.sql.exec<{ v: number | null }>(`SELECT MAX(id) AS v FROM notices`).one().v ?? 0;
    const notices = this.sql
      .exec<{ id: number; title: string; message: string; url: string | null; created_at: number; sender: string | null; copy: string | null; task_id: string | null }>(
        `SELECT id, title, message, url, created_at, sender, copy, task_id FROM notices WHERE id > ? AND created_at > ? ORDER BY id LIMIT 20`,
        after,
        Date.now() - 86_400_000,
      )
      .toArray()
      .map(r => ({ id: r.id, title: r.title, message: r.message, url: r.url, createdAt: r.created_at, from: r.sender, ...(r.copy ? { copy: r.copy } : {}), ...(r.task_id ? { taskId: r.task_id } : {}) }));
    return { latest, notices };
  }

  /* ── clipboard sync ──────────────────────────────────────────────── */

  private clipKeyId(): string | null {
    return this.sql.exec<{ v: string }>(`SELECT v FROM clip_meta WHERE k = 'key_id'`).toArray()[0]?.v ?? null;
  }

  /** Sockets of computers with clipboard sync on (optionally leaving one session out). */
  private clipSockets(exceptSid: string | null = null): WebSocket[] {
    return this.ctx.getWebSockets().filter(ws => {
      const a = ws.deserializeAttachment() as { clip?: boolean } | null;
      return !!a?.clip && !(exceptSid && this.ctx.getTags(ws).includes(exceptSid));
    });
  }

  private clipPing(m: object, exceptSid: string | null = null): void {
    const msg = JSON.stringify(m);
    for (const ws of this.clipSockets(exceptSid)) {
      try {
        ws.send(msg);
      } catch {
        /* socket closing */
      }
    }
  }

  clipKeys(): { keyId: string | null; devices: Array<{ id: string; pub: string; wrapped: string | null }> } {
    const devices = this.sql
      .exec<{ id: string; pub: string; wrapped: string | null }>(`SELECT id, pub, wrapped FROM clip_devices ORDER BY updated DESC LIMIT 50`)
      .toArray();
    return { keyId: this.clipKeyId(), devices };
  }

  /**
   * A computer turning sync on: records its public key. The first one also sets
   * which key everyone uses (`keyId`); `reset` starts over with a new key.
   */
  clipRegister(deviceId: string, pub: string, keyId: string | null, reset: boolean): { keyId: string | null } | { error: string } {
    const cur = this.clipKeyId();
    if (keyId && (reset || !cur)) {
      this.sql.exec(`INSERT INTO clip_meta (k, v) VALUES ('key_id', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v`, keyId);
      if (cur && cur !== keyId) this.sql.exec(`UPDATE clip_devices SET wrapped = NULL`);
    } else if (keyId && cur !== keyId) return { error: 'key-mismatch' };
    const old = this.sql.exec<{ pub: string }>(`SELECT pub FROM clip_devices WHERE id = ?`, deviceId).toArray()[0];
    this.sql.exec(
      `INSERT INTO clip_devices (id, pub, wrapped, updated) VALUES (?, ?, NULL, ?)
       ON CONFLICT (id) DO UPDATE SET pub = excluded.pub, updated = excluded.updated, wrapped = CASE WHEN clip_devices.pub = excluded.pub THEN clip_devices.wrapped ELSE NULL END`,
      deviceId,
      pub,
      Date.now(),
    );
    // Keep the list short: computers not seen for 90 days drop off.
    this.sql.exec(`DELETE FROM clip_devices WHERE updated < ?`, Date.now() - 90 * 86_400_000);
    const now = this.clipKeyId();
    if (now !== cur) this.clipPing({ type: 'clip-key' });
    if (!old || old.pub !== pub || now !== cur) this.clipPing({ type: 'clip-device' });
    return { keyId: now };
  }

  /** A computer that has the key hands a copy to another one, wrapped for that computer only. */
  clipWrap(deviceId: string, wrapped: string, keyId: string): { ok: true } | { error: string } {
    if (keyId !== this.clipKeyId()) return { error: 'key-mismatch' };
    const r = this.sql.exec(`UPDATE clip_devices SET wrapped = ? WHERE id = ?`, wrapped, deviceId);
    if (!r.rowsWritten) return { error: 'unknown-device' };
    this.clipPing({ type: 'clip-key' });
    return { ok: true };
  }

  /**
   * Something was copied: keep it for 10 minutes (so big images can be fetched) and
   * tell the other computers right away. Small items ride along in the message.
   */
  clipPut(sid: string, meta: { from: string; kind: 'text' | 'image'; keyId: string }, data: ArrayBuffer): { id: string } | { error: string } {
    // Sealed with an old key: the others couldn't open it. The sender picks up the new one.
    if (meta.keyId !== this.clipKeyId()) return { error: 'key-mismatch' };
    const now = Date.now();
    const id = crypto.randomUUID();
    const bytes = new Uint8Array(data);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`DELETE FROM clip_blobs WHERE created < ?`, now - 10 * 60_000);
      const PART = 1_000_000; // SQLite rows stay under 2 MB
      for (let i = 0, part = 0; i < bytes.length; i += PART, part++) {
        this.sql.exec(`INSERT INTO clip_blobs (id, part, data, created) VALUES (?, ?, ?, ?)`, id, part, bytes.slice(i, i + PART), now);
      }
    });
    const inline = bytes.length <= 700_000;
    this.clipPing({ type: 'clip', id, ...meta, size: bytes.length, at: now, ...(inline ? { data: toBase64(bytes) } : {}) }, sid);
    return { id };
  }

  clipGet(id: string): ArrayBuffer | null {
    const parts = this.sql.exec<{ data: ArrayBuffer }>(`SELECT data FROM clip_blobs WHERE id = ? ORDER BY part`, id).toArray();
    if (!parts.length) return null;
    const total = parts.reduce((n, p) => n + p.data.byteLength, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      out.set(new Uint8Array(p.data), at);
      at += p.data.byteLength;
    }
    return out.buffer;
  }

  /** Session ids with an open live connection right now. */
  online(): string[] {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) for (const t of this.ctx.getTags(ws)) ids.add(t);
    return [...ids];
  }

  /** Disconnect the given sessions (they were just signed out). */
  kick(sessionIds: string[]): void {
    this.pushForget(sessionIds);
    for (const id of sessionIds) {
      for (const ws of this.ctx.getWebSockets(id)) {
        try {
          ws.close(4003, 'signed out');
        } catch {
          /* already closed */
        }
      }
    }
  }

  /** Account deletion: drop everything and disconnect devices. */
  async wipe(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(4001, 'account deleted');
      } catch {
        /* already closed */
      }
    }
    await this.ctx.storage.deleteAll();
  }

  /* ── phone push notifications ────────────────────────────────────── */

  pushSubscribe(sessionId: string | null, sub: PushSub, mode: PushMode, awayMin: number): { mode: PushMode; awayMin: number } {
    this.sql.exec(
      `INSERT INTO push_subs (endpoint, p256dh, auth, session_id, mode, away_min, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, session_id = excluded.session_id,
         mode = excluded.mode, away_min = excluded.away_min`,
      sub.endpoint,
      sub.p256dh,
      sub.auth,
      sessionId,
      mode,
      awayMin,
      Date.now(),
    );
    return { mode, awayMin };
  }

  pushSettings(endpoint: string): { mode: PushMode; awayMin: number } | null {
    const r = this.sql.exec<PushRow>(`SELECT * FROM push_subs WHERE endpoint = ?`, endpoint).toArray()[0];
    return r ? { mode: r.mode, awayMin: r.away_min } : null;
  }

  pushUnsubscribe(endpoint: string): void {
    this.sql.exec(`DELETE FROM push_subs WHERE endpoint = ?`, endpoint);
  }

  /** Phones of signed-out sessions stop getting notifications. */
  pushForget(sessionIds: string[]): void {
    for (const id of sessionIds) this.sql.exec(`DELETE FROM push_subs WHERE session_id = ?`, id);
  }

  /** Is a desktop app open, and how long since its computer last had keyboard or mouse input? */
  desktopState(): { open: boolean; idleMs: number } {
    const now = Date.now();
    let open = false;
    let idleMs = Infinity;
    for (const ws of this.ctx.getWebSockets('k:desktop')) {
      open = true;
      const p = ws.deserializeAttachment() as Presence | null;
      // Older apps never report: count them as in use while they are open.
      if (!p) idleMs = 0;
      else if (now - p.at < PRESENCE_STALE_MS) idleMs = Math.min(idleMs, Math.max(0, now - p.input));
    }
    return { open, idleMs };
  }

  /** Send a notice to every phone whose setting says it should get it now (all of them for a test). */
  async pushOut(n: { id: number; title: string; message: string; url: string | null; copy?: string; from?: string | null; taskId?: string | null }, test = false): Promise<number> {
    const pub = this.env.VAPID_PUBLIC;
    const priv = this.env.VAPID_PRIVATE;
    if (!pub || !priv) return 0;
    const rows = this.sql.exec<PushRow>(`SELECT * FROM push_subs`).toArray();
    if (!rows.length) return 0;
    const desk = this.desktopState();
    const keys = { pub, priv, contact: 'https://smart-tasks.ashfadhossain0.workers.dev' };
    let sent = 0;
    await Promise.all(
      rows.map(async r => {
        const due =
          test ||
          r.mode === 'always' ||
          (r.mode === 'closed' && !desk.open) ||
          (r.mode === 'away' && (!desk.open || desk.idleMs >= r.away_min * 60_000));
        if (!due) return;
        const res = await sendPush(r, { ...n, tag: `notice-${n.id}` }, keys);
        if (res === 'gone') this.sql.exec(`DELETE FROM push_subs WHERE endpoint = ?`, r.endpoint);
        if (res === 'sent') sent++;
      }),
    );
    return sent;
  }

  /* ── WebSocket fan-out ───────────────────────────────────────────── */

  private broadcast(rev: number): void {
    this.ping({ type: 'rev', rev });
  }

  private ping(m: object): void {
    const msg = JSON.stringify(m);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        /* socket closing */
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    // Tag the socket with its session so the device list can show who's online
    // and a signed-out device can be disconnected immediately.
    const sid = request.headers.get('X-Session-Id');
    // The desktop app's second, clipboard-sync connection gets clipboard messages.
    // It doesn't report presence, so it isn't counted as an open app below.
    const clip = request.headers.get('X-Clip') === '1';
    const tags = sid ? [sid] : [];
    // Desktop apps are tagged so phones know whether one is open (and idle).
    if (request.headers.get('X-Client-Kind') === 'desktop' && !clip) tags.push('k:desktop');
    this.ctx.acceptWebSocket(server, tags);
    if (clip) server.serializeAttachment({ clip: true });
    server.send(JSON.stringify({ type: 'rev', rev: this.rev() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Pings are answered by the auto-response. The desktop app reports its computer's idle time: {"type":"presence","idle":<seconds>}. */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || message.length > 200) return;
    try {
      const m = JSON.parse(message) as { type?: string; idle?: unknown };
      if (m.type !== 'presence' || typeof m.idle !== 'number' || !Number.isFinite(m.idle)) return;
      const now = Date.now();
      ws.serializeAttachment({ at: now, input: now - Math.max(0, Math.min(m.idle, 7 * 86_400)) * 1000 } satisfies Presence);
    } catch {
      /* not JSON */
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch {
      /* already closed */
    }
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
