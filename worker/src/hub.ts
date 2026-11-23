import { DurableObject } from 'cloudflare:workers';
import { BadRequest, categoryDefaults, LIMITS, taskDefaults, type Change, type SyncOp } from './model';

/**
 * One instance per user. Holds the user's tasks + categories in its private
 * SQLite database and pushes a "rev" notification to every connected device
 * (hibernatable WebSockets, so idle connections cost nothing).
 *
 * Every write bumps a per-user monotonic revision. Clients pull
 * `changes since <rev>` — simple, gap-free, and offline-friendly.
 */
const NOTICE_HOURLY_LIMIT = 30;

export class UserHub extends DurableObject<Env> {
  private sql: SqlStorage;

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
    `);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
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

  push(ops: SyncOp[]): { rev: number } {
    if (ops.length === 0) return { rev: this.rev() };
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
          if (op.kind === 'category') {
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
        write(op.kind, op.id, { ...base, ...op.data });
      }

      this.sql.exec(`INSERT INTO meta (k, v) VALUES ('rev', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v`, rev);
    });

    this.broadcast(rev);
    return { rev };
  }

  /* ── agent notifications ─────────────────────────────────────────── */

  /** Queue a desktop notification from an AI agent. Devices fetch it on their next check. */
  notify(n: { title: string; message: string; url: string | null }): { id: number } | { error: string } {
    const now = Date.now();
    const recent = this.sql
      .exec<{ n: number }>(`SELECT COUNT(*) AS n FROM notices WHERE created_at > ?`, now - 3600_000)
      .one().n;
    if (recent >= NOTICE_HOURLY_LIMIT) return { error: `Limit of ${NOTICE_HOURLY_LIMIT} notifications per hour reached. Try again later.` };
    const id = this.sql
      .exec<{ id: number }>(
        `INSERT INTO notices (title, message, url, created_at) VALUES (?, ?, ?, ?) RETURNING id`,
        n.title,
        n.message,
        n.url,
        now,
      )
      .one().id;
    this.sql.exec(`DELETE FROM notices WHERE created_at < ?`, now - 7 * 86_400_000);
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
  notices(after: number): { latest: number; notices: Array<{ id: number; title: string; message: string; url: string | null; createdAt: number }> } {
    const latest = this.sql.exec<{ v: number | null }>(`SELECT MAX(id) AS v FROM notices`).one().v ?? 0;
    const notices = this.sql
      .exec<{ id: number; title: string; message: string; url: string | null; created_at: number }>(
        `SELECT id, title, message, url, created_at FROM notices WHERE id > ? AND created_at > ? ORDER BY id LIMIT 20`,
        after,
        Date.now() - 86_400_000,
      )
      .toArray()
      .map(r => ({ id: r.id, title: r.title, message: r.message, url: r.url, createdAt: r.created_at }));
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
