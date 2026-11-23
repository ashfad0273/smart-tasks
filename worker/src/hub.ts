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
    this.ctx.acceptWebSocket(server);
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
