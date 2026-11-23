import { parseOps, type SyncOp } from './model';
import type { UserHub } from './hub';

/**
 * MCP (Model Context Protocol) endpoint so AI agents can read and change a
 * user's tasks. Stateless Streamable HTTP: every POST carries one JSON-RPC
 * message (or a batch) and gets a plain JSON reply. Writes go through the
 * same UserHub.push() the extension uses, so open popups update live.
 */

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const CATEGORY_COLORS = ['#22c55e', '#a78bfa', '#fb923c', '#f472b6', '#2dd4bf', '#60a5fa', '#facc15', '#f87171', '#34d399', '#c084fc', '#fdba74', '#94a3b8'];

type Hub = DurableObjectStub<UserHub>;
type Rec = Record<string, unknown> & { id: string };
interface Ctx {
  hub: Hub;
  name: string;
  /** IANA zone of the browser that created the token, e.g. "Asia/Dhaka". */
  tz: string;
}

interface RpcMsg {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

class ToolError extends Error {}

/* ── time helpers (the server runs in UTC; the user does not) ───────────── */

function zoneOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find(p => p.type === t)?.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(utcMs / 1000) * 1000;
}

/** "2026-11-24T17:00" (user's local time) or any ISO string with Z/offset → epoch ms. */
function parseDue(v: unknown, tz: string): number | null {
  if (v === null || v === '') return null;
  if (typeof v !== 'string') throw new ToolError('due must be a date-time string like "2026-11-24T17:00", or null');
  const s = v.trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const ms = Date.parse(s);
    if (Number.isNaN(ms)) throw new ToolError(`Could not read the date "${s}"`);
    return ms;
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) throw new ToolError(`Could not read the date "${s}". Use "YYYY-MM-DDTHH:mm" in the user's local time.`);
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 17, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
  let ms = naive - zoneOffsetMs(naive, tz);
  ms = naive - zoneOffsetMs(ms, tz); // second pass settles DST edges
  return ms;
}

function fmtLocal(ms: number, tz: string): string {
  const local = new Date(ms + zoneOffsetMs(ms, tz)).toISOString().slice(0, 16);
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(ms));
  return `${local} ${wd}`;
}

/* ── data helpers ──────────────────────────────────────────────────────── */

const str = (v: unknown, field: string, required = false): string | undefined => {
  if (v === undefined || v === null) {
    if (required) throw new ToolError(`${field} is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw new ToolError(`${field} must be a string`);
  const t = v.trim();
  if (required && !t) throw new ToolError(`${field} cannot be empty`);
  return t;
};

function priority(v: unknown): 'low' | 'med' | 'high' | null {
  if (v === null || v === 'none') return null;
  if (v === 'medium') return 'med';
  if (v === 'low' || v === 'med' || v === 'high') return v;
  throw new ToolError('priority must be "low", "medium", "high" or null');
}

/** DO RPC typing can't express unknown-valued records, so cast once here. */
const list = async (ctx: Ctx, kind: 'task' | 'category') => (await ctx.hub.list(kind)) as unknown as Rec[];

async function push(ctx: Ctx, ops: unknown[]): Promise<void> {
  // Same validation as the extension's sync endpoint.
  const clean: SyncOp[] = parseOps({ ops });
  await ctx.hub.push(clean);
}

async function findTask(ctx: Ctx, id: unknown): Promise<Rec> {
  const key = str(id, 'id', true)!;
  const tasks = await list(ctx, 'task');
  const hit = tasks.find(t => t.id === key) ?? (key.length >= 6 ? tasks.filter(t => t.id.startsWith(key)) : []).at(0);
  if (!hit) throw new ToolError(`No task with id "${key}". Call list_tasks to get ids.`);
  return hit;
}

/** Category name → id. Creates it when `create` is set and it doesn't exist yet. */
async function categoryId(ctx: Ctx, name: unknown, create: boolean): Promise<string | null> {
  if (name === null || name === '') return null;
  const n = str(name, 'category', true)!;
  const cats = await list(ctx, 'category');
  const hit = cats.find(c => String(c.name).toLowerCase() === n.toLowerCase());
  if (hit) return hit.id;
  if (!create) throw new ToolError(`No category named "${n}". Existing: ${cats.map(c => c.name).join(', ') || 'none'}.`);
  const id = crypto.randomUUID();
  const now = Date.now();
  await push(ctx, [{ kind: 'category', id, op: 'upsert', data: { name: n, color: CATEGORY_COLORS[cats.length % CATEGORY_COLORS.length], order: cats.length, createdAt: now } }]);
  return id;
}

function view(t: Rec, cats: Map<string, string>, tz: string) {
  const subs = (t.subtasks as Array<{ title: string; done: boolean }>) ?? [];
  return {
    id: t.id,
    title: t.title,
    done: t.completedAt != null,
    due: typeof t.dueAt === 'number' ? fmtLocal(t.dueAt, tz) : null,
    overdue: typeof t.dueAt === 'number' && t.completedAt == null && t.dueAt < Date.now(),
    priority: t.priority === 'med' ? 'medium' : (t.priority ?? null),
    category: t.categoryId ? (cats.get(t.categoryId as string) ?? null) : null,
    ...(t.notes ? { notes: t.notes } : {}),
    ...(t.url ? { url: t.url } : {}),
    ...(subs.length ? { subtasks: subs.map(s => `${s.done ? '[x]' : '[ ]'} ${s.title}`) } : {}),
  };
}

const catMap = async (ctx: Ctx) => new Map((await list(ctx, 'category')).map(c => [c.id, String(c.name)]));

/* ── tools ─────────────────────────────────────────────────────────────── */

const DUE_DESC =
  'Date-time in the user\'s local time as "YYYY-MM-DDTHH:mm" (e.g. "2026-11-24T17:00"), or an ISO string with an offset. A date alone means 5 PM that day. null clears it.';

const TOOLS = [
  {
    name: 'list_tasks',
    title: 'List tasks',
    description:
      "List the user's Smart Tasks. Defaults to pending tasks, soonest due first. Times are in the user's local time zone.",
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'completed', 'all'], description: 'Default "pending".' },
        category: { type: 'string', description: 'Only tasks in this category (by name).' },
        search: { type: 'string', description: 'Case-insensitive text to find in titles and notes.' },
        due: { type: 'string', enum: ['overdue', 'today', 'tomorrow', 'week', 'none'], description: 'Filter by due date.' },
        limit: { type: 'number', description: 'Max tasks to return (default 50, max 200).' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'add_task',
    title: 'Add a task',
    description: 'Create a new task. A category that does not exist yet is created.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What needs doing.' },
        notes: { type: 'string' },
        due: { type: ['string', 'null'], description: DUE_DESC },
        priority: { type: ['string', 'null'], enum: ['low', 'medium', 'high', null] },
        category: { type: 'string', description: 'Category name.' },
        subtasks: { type: 'array', items: { type: 'string' }, description: 'Checklist items.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    title: 'Edit a task',
    description: 'Change fields of an existing task. Only the fields you pass are changed; pass null to clear due, priority, category or notes.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task id from list_tasks.' },
        title: { type: 'string' },
        notes: { type: ['string', 'null'] },
        due: { type: ['string', 'null'], description: DUE_DESC },
        priority: { type: ['string', 'null'], enum: ['low', 'medium', 'high', null] },
        category: { type: ['string', 'null'], description: 'Category name; created if new.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'complete_task',
    title: 'Mark done or not done',
    description: 'Mark a task done (default) or, with done=false, back to pending.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, done: { type: 'boolean', description: 'Default true.' } },
      required: ['id'],
    },
    annotations: { idempotentHint: true },
  },
  {
    name: 'delete_task',
    title: 'Delete a task',
    description: 'Permanently delete a task. Only do this when the user clearly asked to delete or remove it.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { destructiveHint: true },
  },
  {
    name: 'list_categories',
    title: 'List categories',
    description: 'List categories with how many pending tasks each has.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'notify',
    title: 'Send a notification',
    description:
      "Show a desktop notification in the user's browser (every device signed in to Smart Tasks). Use it sparingly: when the user asked to be told about something, or for something time-sensitive they would want to know now. Not for routine confirmations of task edits.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short headline, up to 60 characters.' },
        message: { type: 'string', description: 'The notification body, up to 240 characters.' },
        url: { type: 'string', description: 'Optional http(s) link opened when the notification is clicked.' },
      },
      required: ['title', 'message'],
    },
  },
  {
    name: 'create_category',
    title: 'Create a category',
    description: 'Create a category (returns the existing one if the name is taken).',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, color: { type: 'string', description: 'Optional hex colour like "#60a5fa".' } },
      required: ['name'],
    },
  },
];

function dayStart(ms: number, tz: string): number {
  const local = ms + zoneOffsetMs(ms, tz);
  const startLocal = local - (((local % 86_400_000) + 86_400_000) % 86_400_000);
  return startLocal - zoneOffsetMs(startLocal, tz);
}

async function runTool(ctx: Ctx, name: string, a: Record<string, unknown>): Promise<unknown> {
  const now = Date.now();
  switch (name) {
    case 'list_tasks': {
      const status = (a.status as string) ?? 'pending';
      const limit = Math.min(200, Math.max(1, Number(a.limit) || 50));
      const cats = await catMap(ctx);
      let tasks = await list(ctx, 'task');
      if (status === 'pending') tasks = tasks.filter(t => t.completedAt == null);
      else if (status === 'completed') tasks = tasks.filter(t => t.completedAt != null);
      if (a.category != null) {
        const want = String(a.category).toLowerCase();
        tasks = tasks.filter(t => t.categoryId && cats.get(t.categoryId as string)?.toLowerCase() === want);
      }
      if (a.search) {
        const q = String(a.search).toLowerCase();
        tasks = tasks.filter(t => `${t.title} ${t.notes ?? ''}`.toLowerCase().includes(q));
      }
      if (a.due) {
        const today = dayStart(now, ctx.tz);
        const D = 86_400_000;
        const due = (t: Rec) => t.dueAt as number | null;
        const inRange = (t: Rec, from: number, to: number) => due(t) != null && due(t)! >= from && due(t)! < to;
        tasks = tasks.filter(t =>
          a.due === 'none' ? due(t) == null
          : a.due === 'overdue' ? due(t) != null && due(t)! < now && t.completedAt == null
          : a.due === 'today' ? inRange(t, today, today + D)
          : a.due === 'tomorrow' ? inRange(t, today + D, today + 2 * D)
          : inRange(t, today, today + 7 * D),
        );
      }
      tasks.sort((x, y) => {
        const dx = (x.dueAt as number | null) ?? Infinity;
        const dy = (y.dueAt as number | null) ?? Infinity;
        return dx !== dy ? dx - dy : (y.order as number) - (x.order as number);
      });
      return {
        now: fmtLocal(now, ctx.tz),
        timeZone: ctx.tz,
        total: tasks.length,
        tasks: tasks.slice(0, limit).map(t => view(t, cats, ctx.tz)),
      };
    }

    case 'add_task': {
      const title = str(a.title, 'title', true)!;
      const data: Record<string, unknown> = { title, order: now, createdAt: now, updatedAt: now };
      if (a.notes != null) data.notes = str(a.notes, 'notes');
      if (a.due !== undefined) data.dueAt = parseDue(a.due, ctx.tz);
      if (a.priority !== undefined) data.priority = priority(a.priority);
      if (a.category != null) data.categoryId = await categoryId(ctx, a.category, true);
      if (Array.isArray(a.subtasks)) {
        data.subtasks = a.subtasks
          .filter(s => typeof s === 'string' && s.trim())
          .map(s => ({ id: crypto.randomUUID(), title: (s as string).trim(), done: false }));
      }
      const id = crypto.randomUUID();
      await push(ctx, [{ kind: 'task', id, op: 'upsert', data }]);
      const t = (await list(ctx, 'task')).find(x => x.id === id)!;
      return { added: view(t, await catMap(ctx), ctx.tz) };
    }

    case 'update_task': {
      const t = await findTask(ctx, a.id);
      const data: Record<string, unknown> = { updatedAt: now };
      if (a.title !== undefined) data.title = str(a.title, 'title', true);
      if (a.notes !== undefined) data.notes = a.notes === null ? null : str(a.notes, 'notes');
      if (a.due !== undefined) data.dueAt = parseDue(a.due, ctx.tz);
      if (a.priority !== undefined) data.priority = priority(a.priority);
      if (a.category !== undefined) data.categoryId = await categoryId(ctx, a.category, true);
      if (Object.keys(data).length === 1) throw new ToolError('Nothing to change — pass at least one field.');
      await push(ctx, [{ kind: 'task', id: t.id, op: 'upsert', data }]);
      const after = (await list(ctx, 'task')).find(x => x.id === t.id)!;
      return { updated: view(after, await catMap(ctx), ctx.tz) };
    }

    case 'complete_task': {
      const t = await findTask(ctx, a.id);
      const done = a.done !== false;
      await push(ctx, [{ kind: 'task', id: t.id, op: 'upsert', data: { completedAt: done ? now : null, updatedAt: now } }]);
      return { id: t.id, title: t.title, done };
    }

    case 'delete_task': {
      const t = await findTask(ctx, a.id);
      await push(ctx, [{ kind: 'task', id: t.id, op: 'delete' }]);
      return { deleted: { id: t.id, title: t.title } };
    }

    case 'list_categories': {
      const [cats, tasks] = await Promise.all([list(ctx, 'category'), list(ctx, 'task')]);
      return {
        categories: cats
          .sort((x, y) => (x.order as number) - (y.order as number))
          .map(c => ({ name: c.name, color: c.color, pending: tasks.filter(t => t.categoryId === c.id && t.completedAt == null).length })),
      };
    }

    case 'notify': {
      const title = str(a.title, 'title', true)!.slice(0, 60);
      const message = str(a.message, 'message', true)!.slice(0, 240);
      let url = str(a.url, 'url') || null;
      if (url) {
        try {
          const u = new URL(url);
          if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
          url = u.toString().slice(0, 2000);
        } catch {
          throw new ToolError('url must be an http(s) link');
        }
      }
      const r = await ctx.hub.notify({ title, message, url });
      if ('error' in r) throw new ToolError(r.error);
      return { sent: true, note: 'Devices with Smart Tasks show it within about a minute (instantly if the popup is open).' };
    }

    case 'create_category': {
      const n = str(a.name, 'name', true)!;
      const cats = await list(ctx, 'category');
      const hit = cats.find(c => String(c.name).toLowerCase() === n.toLowerCase());
      if (hit) return { category: { name: hit.name, color: hit.color }, existed: true };
      const color = typeof a.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(a.color) ? a.color : CATEGORY_COLORS[cats.length % CATEGORY_COLORS.length];
      await push(ctx, [{ kind: 'category', id: crypto.randomUUID(), op: 'upsert', data: { name: n, color, order: cats.length, createdAt: now } }]);
      return { category: { name: n, color }, existed: false };
    }
  }
  throw new ToolError(`Unknown tool "${name}"`);
}

/* ── JSON-RPC plumbing ─────────────────────────────────────────────────── */

async function handle(ctx: Ctx, msg: RpcMsg): Promise<object | null> {
  const isRequest = msg.id !== undefined && msg.id !== null;
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
  const err = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });

  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return err(-32600, 'Invalid request');
  if (!isRequest) return null; // notifications (e.g. notifications/initialized) need no reply

  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '');
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'smart-tasks', title: 'Smart Tasks', version: '1.0.0' },
        instructions:
          `Smart Tasks is ${ctx.name}'s to-do list (browser extension). Times are in ${ctx.tz}. ` +
          'Call list_tasks before editing so you use real ids. Only delete when explicitly asked; prefer complete_task for "done". ' +
          'Use notify to ping the user on their desktop when they asked to be told about something.',
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      if (!TOOLS.some(t => t.name === name)) return err(-32602, `Unknown tool: ${name}`);
      try {
        const result = await runTool(ctx, name, args);
        return ok({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return ok({ content: [{ type: 'text', text: message }], isError: true });
      }
    }
    default:
      return err(-32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcp(req: Request, ctx: Ctx, headers: Record<string, string>): Promise<Response> {
  if (req.method !== 'POST') {
    // Stateless server: no server-initiated SSE stream.
    return new Response(null, { status: 405, headers: { Allow: 'POST', ...headers } });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400, headers });
  }
  const batch = Array.isArray(body);
  const msgs = (batch ? body : [body]) as RpcMsg[];
  const replies = (await Promise.all(msgs.map(m => handle(ctx, m)))).filter(Boolean);
  if (replies.length === 0) return new Response(null, { status: 202, headers });
  return Response.json(batch ? replies : replies[0], { headers });
}
