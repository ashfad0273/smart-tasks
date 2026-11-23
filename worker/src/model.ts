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
          return { id: o.id, title: str(o.title, LIMITS.subtaskTitle, 'subtask title'), done: o.done === true };
        });
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
    subtasks: [],
    order: now,
    createdAt: now,
    updatedAt: now,
  };
}

export function categoryDefaults(now: number): Record<string, unknown> {
  return { name: 'Untitled', color: '#22c55e', order: now, createdAt: now };
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
