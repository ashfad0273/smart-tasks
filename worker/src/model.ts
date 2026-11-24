/** Wire format shared with the extension (mirrored in ../../lib/sync-types.ts). */

export type Kind = 'task' | 'category';

export interface SyncOp {
  kind: Kind;
  id: string;
  /** upsert = merge `data` onto the record (creating it if missing). */
  op: 'upsert' | 'delete';
  data?: Record<string, unknown>;
}

export interface Change {
  kind: Kind;
  id: string;
  deleted: boolean;
  data: Record<string, unknown> | null;
}

export const LIMITS = {
  opsPerPush: 500,
  itemsPerKind: 20_000,
  title: 500,
  notes: 5_000,
  url: 2_048,
  subtasks: 100,
  subtaskTitle: 300,
  categoryName: 40,
};

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export class BadRequest extends Error {}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max: number, field: string): string => {
  if (typeof v !== 'string') throw new BadRequest(`${field} must be a string`);
  return v.slice(0, max);
};
const numOrNull = (v: unknown, field: string): number | null => {
  if (v === null) return null;
  if (!isNum(v)) throw new BadRequest(`${field} must be a number or null`);
  return v;
};

export type ReqStatus = 'approved' | 'claimed' | 'done' | 'returned' | 'cancelled';
export interface Req {
  id?: string;
  status: ReqStatus;
  at: number;
  by: string | null;
  session: string | null;
  note: string | null;
  reply?: string | null;
}
export interface Approval {
  action: string;
  choices?: string[];
  confirm?: boolean;
}
const REQ_STATUS: ReqStatus[] = ['approved', 'claimed', 'done', 'returned', 'cancelled'];
/** A claim with no finish after this long is treated as abandoned. */
export const CLAIM_STALE_MS = 2 * 60 * 60_000;

export function cleanApproval(v: unknown): Approval | null {
  if (v === null) return null;
  const o = v as Record<string, unknown>;
  if (!o || typeof o !== 'object') throw new BadRequest('approval must be an object or null');
  const action = str(o.action, 300, 'approval.action').trim();
  if (!action) throw new BadRequest('approval.action cannot be empty');
  const out: Approval = { action };
  if (o.choices != null) {
    if (!Array.isArray(o.choices)) throw new BadRequest('approval.choices must be an array of strings');
    const choices = o.choices
      .map((c, i) => str(c, 80, `approval.choices[${i}]`).trim())
      .filter(Boolean)
      .slice(0, 6);
    if (choices.length) out.choices = choices;
  }
  if (o.confirm === true) out.confirm = true;
  return out;
}

export function cleanRequest(v: unknown): Req | null {
  if (v === null) return null;
  const o = v as Record<string, unknown>;
  if (!o || !REQ_STATUS.includes(o.status as ReqStatus)) throw new BadRequest('bad aiRequest.status');
  const out: Req = {
    status: o.status as ReqStatus,
    at: isNum(o.at) ? o.at : Date.now(),
    by: o.by == null ? null : str(o.by, 60, 'aiRequest.by'),
    session: o.session == null ? null : str(o.session, 120, 'aiRequest.session'),
    note: o.note == null ? null : str(o.note, LIMITS.notes, 'aiRequest.note'),
    // The user's own answer/instructions sent with the OK.
    reply: o.reply == null || o.reply === '' ? null : str(o.reply, LIMITS.notes, 'aiRequest.reply'),
  };
  if (o.id != null) {
    if (typeof o.id !== 'string' || !ID_RE.test(o.id)) throw new BadRequest('bad aiRequest.id');
    return { id: o.id, ...out };
  }
  return out;
}

export const isOpen = (r: Req | null | undefined): r is Req => !!r && (r.status === 'approved' || r.status === 'claimed');

/**
 * One open request per item, and states only move forward: a stale copy from another
 * device (or a double click) can't undo a claim, revive a cancelled send or start a
 * second request while one is open. Old requests without an id keep the old rules.
 */
export function mergeRequest(ex: Req | null | undefined, inc: Req | null | undefined, now = Date.now()): Req | null {
  if (inc === undefined) return ex ?? null;
  if (!ex || !ex.id) return inc;
  if (inc === null) return isOpen(ex) ? ex : null;
  if (inc.id !== ex.id) return isOpen(ex) ? ex : inc;
  if (inc.status === ex.status) return { ...ex, ...inc };
  const stale = ex.status === 'claimed' && now - ex.at > CLAIM_STALE_MS;
  const ok: Record<ReqStatus, ReqStatus[]> = {
    approved: ['claimed', 'done', 'returned', 'cancelled'],
    claimed: stale ? ['claimed', 'done', 'returned', 'cancelled', 'approved'] : ['done', 'returned'],
    done: [],
    returned: [],
    cancelled: [],
  };
  return ok[ex.status].includes(inc.status) ? inc : ex;
}

type SubRec = { id: string; title: string; done: boolean; approval?: Approval | null; aiRequest?: Req | null };
const subShape = (s: SubRec): SubRec => ({
  id: s.id,
  title: s.title,
  done: s.done,
  ...(s.approval ? { approval: s.approval } : {}),
  ...(s.aiRequest ? { aiRequest: s.aiRequest } : {}),
});

/**
 * Applies an incoming task upsert onto the stored task, keeping request state safe:
 * subtasks sent without approval/aiRequest (older apps) keep theirs, and a new
 * unfinished subtask on a finished task reopens it.
 */
export function mergeTask(base: Record<string, unknown>, data: Record<string, unknown>, now = Date.now()): Record<string, unknown> {
  const next = { ...base, ...data };
  if ('aiRequest' in data) next.aiRequest = mergeRequest(base.aiRequest as Req | null, data.aiRequest as Req | null, now);
  if (Array.isArray(data.subtasks)) {
    const old = new Map(((base.subtasks as SubRec[]) ?? []).map(s => [s.id, s]));
    next.subtasks = (data.subtasks as SubRec[]).map(s => {
      const ex = old.get(s.id);
      return subShape({
        ...s,
        approval: 'approval' in s ? s.approval : (ex?.approval ?? null),
        aiRequest: mergeRequest(ex?.aiRequest, 'aiRequest' in s ? s.aiRequest : undefined, now),
      });
    });
    const added = (next.subtasks as SubRec[]).some(s => !old.has(s.id) && !s.done);
    if (added && base.completedAt != null && !('completedAt' in data)) next.completedAt = null;
  }
  return next;
}

function cleanTask(d: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    switch (k) {
      case 'title':
        out.title = str(v, LIMITS.title, k).trim();
        break;
      case 'notes':
        out.notes = v === null ? null : str(v, LIMITS.notes, k);
        break;
      case 'url':
        if (v === null) out.url = null;
        else {
          const u = str(v, LIMITS.url, k);
          out.url = /^https?:\/\//i.test(u) ? u : null;
        }
        break;
      case 'categoryId':
        if (v !== null && (typeof v !== 'string' || !ID_RE.test(v))) throw new BadRequest('bad categoryId');
        out.categoryId = v;
        break;
      case 'priority':
        if (v !== null && v !== 'low' && v !== 'med' && v !== 'high') throw new BadRequest('bad priority');
        out.priority = v;
        break;
      case 'dueAt':
      case 'completedAt':
      case 'archivedAt':
        out[k] = numOrNull(v, k);
        break;
      case 'order':
      case 'createdAt':
      case 'updatedAt':
        if (!isNum(v)) throw new BadRequest(`${k} must be a number`);
        out[k] = v;
        break;
      case 'subtasks':
        if (!Array.isArray(v)) throw new BadRequest('subtasks must be an array');
        out.subtasks = v.slice(0, LIMITS.subtasks).map(s => {
          const o = s as Record<string, unknown>;
          if (typeof o?.id !== 'string' || !ID_RE.test(o.id)) throw new BadRequest('bad subtask id');
          const sub: Record<string, unknown> = { id: o.id, title: str(o.title, LIMITS.subtaskTitle, 'subtask title'), done: o.done === true };
          // Only when sent: older apps leave them out, and the stored ones are kept.
          if ('approval' in o) sub.approval = o.approval === undefined ? null : cleanApproval(o.approval);
          if ('aiRequest' in o) sub.aiRequest = o.aiRequest === undefined ? null : cleanRequest(o.aiRequest);
          return sub;
        });
        break;
      case 'source':
        // Which agent (and session) created the task; set by the MCP server.
        if (v === null) out.source = null;
        else {
          const o = v as Record<string, unknown>;
          out.source = {
            agent: str(o?.agent, 60, 'source.agent'),
            session: o?.session == null ? null : str(o.session, 120, 'source.session'),
            ...(o?.scope == null ? {} : { scope: str(o.scope, 200, 'source.scope') }),
          };
        }
        break;
      case 'aiRequest':
        // "OK, send to AI": approved by the user, then claimed and finished by an agent.
        out.aiRequest = cleanRequest(v);
        break;
      case 'approval':
        out.approval = cleanApproval(v);
        break;
      default:
      // unknown fields are dropped
    }
  }
  return out;
}

function cleanCategory(d: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    switch (k) {
      case 'name':
        out.name = str(v, LIMITS.categoryName, k).trim();
        break;
      case 'color':
        if (typeof v !== 'string' || !COLOR_RE.test(v)) throw new BadRequest('bad color');
        out.color = v;
        break;
      case 'archivedAt':
        out.archivedAt = numOrNull(v, k);
        break;
      case 'order':
      case 'createdAt':
        if (!isNum(v)) throw new BadRequest(`${k} must be a number`);
        out[k] = v;
        break;
      default:
    }
  }
  return out;
}

export function taskDefaults(now: number): Record<string, unknown> {
  return {
    title: 'Untitled task',
    notes: null,
    url: null,
    categoryId: null,
    priority: null,
    dueAt: null,
    completedAt: null,
    archivedAt: null,
    subtasks: [],
    source: null,
    approval: null,
    aiRequest: null,
    order: now,
    createdAt: now,
    updatedAt: now,
  };
}

export function categoryDefaults(now: number): Record<string, unknown> {
  return { name: 'Untitled', color: '#22c55e', order: now, createdAt: now, archivedAt: null };
}

export function parseOps(body: unknown): SyncOp[] {
  const ops = (body as { ops?: unknown })?.ops;
  if (!Array.isArray(ops)) throw new BadRequest('ops must be an array');
  if (ops.length > LIMITS.opsPerPush) throw new BadRequest(`at most ${LIMITS.opsPerPush} ops per request`);
  return ops.map(raw => {
    const o = raw as Record<string, unknown>;
    if (o.kind !== 'task' && o.kind !== 'category') throw new BadRequest('bad kind');
    if (typeof o.id !== 'string' || !ID_RE.test(o.id)) throw new BadRequest('bad id');
    if (o.op === 'delete') return { kind: o.kind, id: o.id, op: 'delete' };
    if (o.op !== 'upsert' || typeof o.data !== 'object' || o.data === null) throw new BadRequest('bad op');
    const data = o.kind === 'task' ? cleanTask(o.data as Record<string, unknown>) : cleanCategory(o.data as Record<string, unknown>);
    return { kind: o.kind, id: o.id, op: 'upsert', data };
  });
}

/* ── what AI agents may do (set by the user in Settings → AI agent) ─────── */

export const AGENT_PERMS = ['add', 'edit', 'complete', 'archive', 'delete', 'categories', 'notify'] as const;
export type AgentPerm = (typeof AGENT_PERMS)[number];
export type AgentPerms = Record<AgentPerm, boolean>;

/** Everything allowed until the user turns something off. */
export const DEFAULT_AGENT_PERMS: AgentPerms = Object.fromEntries(AGENT_PERMS.map(p => [p, true])) as AgentPerms;

export const permsToBits = (p: AgentPerms) => AGENT_PERMS.reduce((n, k, i) => (p[k] ? n | (1 << i) : n), 0);
export const bitsToPerms = (n: number) => Object.fromEntries(AGENT_PERMS.map((k, i) => [k, (n & (1 << i)) !== 0])) as AgentPerms;

export function parsePerms(body: unknown, current: AgentPerms): AgentPerms {
  const src = (body as { permissions?: unknown })?.permissions;
  if (!src || typeof src !== 'object') throw new BadRequest('permissions must be an object');
  const out = { ...current };
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    if (!(AGENT_PERMS as readonly string[]).includes(k)) continue;
    if (typeof v !== 'boolean') throw new BadRequest(`${k} must be true or false`);
    out[k as AgentPerm] = v;
  }
  return out;
}
