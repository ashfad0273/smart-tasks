import { DurableObject } from 'cloudflare:workers';
import { BadRequest, bitsToPerms, categoryDefaults, DEFAULT_AGENT_PERMS, LIMITS, permsToBits, taskDefaults, type AgentPerms, type Change, type SyncOp } from './model';

/**
 * One instance per user. Holds the user's tasks + categories in its private
 * SQLite database and pushes a "rev" notification to every connected device
 * (hibernatable WebSockets, so idle connections cost nothing).
 *
 * Every write bumps a per-user monotonic revision. Clients pull
 * `changes since <rev>` — simple, gap-free, and offline-friendly.
 */
const NOTICE_HOURLY_LIMIT = 30;

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
        const next = { ...base, ...op.data };
        write(op.kind, op.id, next);
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
    return { rev };
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
  notify(n: { title: string; message: string; url: string | null }, who: string | null = null): { id: number } | { error: string } {
    const now = Date.now();
    const recent = this.sql
      .exec<{ n: number }>(`SELECT COUNT(*) AS n FROM notices WHERE created_at > ?`, now - 3600_000)
      .one().n;
    if (recent >= NOTICE_HOURLY_LIMIT) return { error: `Limit of ${NOTICE_HOURLY_LIMIT} notifications per hour reached. Try again later.` };
    const id = this.sql
      .exec<{ id: number }>(
        `INSERT INTO notices (title, message, url, created_at, sender) VALUES (?, ?, ?, ?, ?) RETURNING id`,
        n.title,
        n.message,
        n.url,
        now,
        who,
      )
      .one().id;
    this.sql.exec(`DELETE FROM notices WHERE created_at < ?`, now - 7 * 86_400_000);
    this.who = who;
    this.log(now, 'notice', null, n.title, 'agent', n.message);
    const msg = JSON.stringify({ type: 'notice' });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        /* socket closing */
      }
    }
    return { id };
  }

  /** Notifications newer than `after` (a notice id) from the last day. */
  notices(after: number): {
    latest: number;
    notices: Array<{ id: number; title: string; message: string; url: string | null; createdAt: number; from: string | null }>;
  } {
    const latest = this.sql.exec<{ v: number | null }>(`SELECT MAX(id) AS v FROM notices`).one().v ?? 0;
    const notices = this.sql
      .exec<{ id: number; title: string; message: string; url: string | null; created_at: number; sender: string | null }>(
        `SELECT id, title, message, url, created_at, sender FROM notices WHERE id > ? AND created_at > ? ORDER BY id LIMIT 20`,
        after,
        Date.now() - 86_400_000,
      )
      .toArray()
      .map(r => ({ id: r.id, title: r.title, message: r.message, url: r.url, createdAt: r.created_at, from: r.sender }));
    return { latest, notices };
  }

  /** Session ids with an open live connection right now. */
  online(): string[] {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) for (const t of this.ctx.getTags(ws)) ids.add(t);
    return [...ids];
  }

  /** Disconnect the given sessions (they were just signed out). */
  kick(sessionIds: string[]): void {
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

  /* ── WebSocket fan-out ───────────────────────────────────────────── */

  private broadcast(rev: number): void {
    const msg = JSON.stringify({ type: 'rev', rev });
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
    this.ctx.acceptWebSocket(server, sid ? [sid] : []);
    server.send(JSON.stringify({ type: 'rev', rev: this.rev() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(): Promise<void> {
    // Clients only listen; pings are answered by the auto-response.
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch {
      /* already closed */
    }
  }
}
