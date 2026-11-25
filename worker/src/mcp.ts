import { BadRequest, cleanApproval, CLAIM_STALE_MS, isOpen, parseOps, type AgentPerm, type AgentPerms, type Approval, type Req, type SyncOp } from './model';
import { requestsOf, type ReqRef } from './hub';
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
  /** Name of the agent key in use ("Claude Code", "Cursor"...), shown in History. */
  agent: string;
  /** IANA zone of the browser that created the token, e.g. "Asia/Dhaka". */
  tz: string;
  /** What the user lets agents do (Settings → AI agent → Permissions). */
  perms: AgentPerms;
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
  await ctx.hub.push(clean, 'agent', ctx.agent);
}

const PERM_LABEL: Record<AgentPerm, string> = {
  add: 'adding tasks',
  edit: 'editing tasks',
  complete: 'marking tasks done',
  archive: 'archiving',
  delete: 'deleting',
  categories: 'managing categories',
  notify: 'sending notifications',
};

function need(ctx: Ctx, ...perms: AgentPerm[]): void {
  const off = perms.filter(p => !ctx.perms[p]);
  if (off.length) {
    throw new ToolError(
      `${ctx.name} has turned off ${off.map(p => PERM_LABEL[p]).join(' and ')} for AI agents. ` +
        'Ask them to do it, or to allow it in Smart Tasks → Settings → AI agent → Permissions.',
    );
  }
}

const isArchived = (r: Rec) => r.archivedAt != null;
/** Archived itself, or sitting in an archived category. */
const taskArchived = (t: Rec, archivedCats: Set<string>) => isArchived(t) || (!!t.categoryId && archivedCats.has(t.categoryId as string));

async function findCategory(ctx: Ctx, name: unknown): Promise<Rec> {
  const n = str(name, 'category', true)!;
  const cats = await list(ctx, 'category');
  const hit = cats.find(c => c.id === n || String(c.name).toLowerCase() === n.toLowerCase());
  if (!hit) throw new ToolError(`No category named "${n}". Existing: ${cats.map(c => c.name).join(', ') || 'none'}.`);
  return hit;
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
  need(ctx, 'categories');
  const id = crypto.randomUUID();
  const now = Date.now();
  await push(ctx, [{ kind: 'category', id, op: 'upsert', data: { name: n, color: CATEGORY_COLORS[cats.length % CATEGORY_COLORS.length], order: cats.length, createdAt: now } }]);
  return id;
}

function view(t: Rec, cats: Map<string, string>, tz: string, archived = false) {
  const subs = (t.subtasks as Array<{ title: string; done: boolean; approval?: Approval | null; aiRequest?: Req | null }>) ?? [];
  const mark = (s: (typeof subs)[number]) => {
    const r = s.aiRequest;
    if (r && r.status !== 'cancelled') return ` (request ${r.status === 'approved' ? 'sent by user, waiting' : r.status === 'returned' ? 'handed back to user' : r.status})`;
    return s.approval && !s.done ? ' (awaiting user OK)' : '';
  };
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
    added: typeof t.createdAt === 'number' ? fmtLocal(t.createdAt, tz) : null,
    ...(typeof t.completedAt === 'number' ? { completed: fmtLocal(t.completedAt, tz) } : {}),
    ...(archived ? { archived: true } : {}),
    ...(subs.length ? { subtasks: subs.map((s, i) => `${i + 1}. ${s.done ? '[x]' : '[ ]'} ${s.title}${mark(s)}`), subtasksDone: `${subs.filter(s => s.done).length}/${subs.length}` } : {}),
  };
}

const catMap = async (ctx: Ctx) => new Map((await list(ctx, 'category')).map(c => [c.id, String(c.name)]));

/* ── tools ─────────────────────────────────────────────────────────────── */

const DUE_DESC =
  'Date-time in the user\'s local time as "YYYY-MM-DDTHH:mm" (e.g. "2026-11-24T17:00"), or an ISO string with an offset. A date alone means 5 PM that day. null clears it.';

const APPROVAL_SCHEMA = {
  type: ['object', 'null'],
  description:
    'Makes this item approvable: the user gets an OK button labelled with `action`, and pressing it sends you a request (list_requests). ' +
    'Set it ONLY when all of these hold: (a) you propose one specific action, (b) an agent can do all of it, (c) nothing else blocks it, (d) it is a real ask, not a status or tracking item. ' +
    'Never for steps only the user can do (downloads to their computer, passphrases, closing tabs, wp-admin logins). Leave it out otherwise: no approval means no button.',
  properties: {
    action: { type: 'string', description: 'Exactly what you will do on OK, e.g. "Delete classes clip-lg/md/sm and media 74, 80-84, then remake the package". Up to 300 characters.' },
    choices: { type: 'array', items: { type: 'string' }, description: 'For decisions: one button per choice (up to 6), e.g. ["Both", "Badge only", "Leave out"]. The picked text arrives as userAnswer.' },
    confirm: { type: 'boolean', description: 'true for irreversible actions (delete, upload, replace, send): the user confirms once more before it is sent.' },
  },
  required: ['action'],
};

const TOOLS = [
  {
    name: 'list_requests',
    title: 'Tasks the user approved for AI',
    description:
      'Items the user approved for AI (tasks or single subtasks they pressed OK on), waiting for an agent. Each has `request` (the id to claim), `action` (what was proposed) and userAnswer: a plain OK, the choice they picked, or their own written answer (follow it). ' +
      'Requests from tasks you (this key and session) created come first. After 10 minutes the rest are offered to other agents, but only within the same `scope`: pass yours if you set one on add_task. Requests are never offered across scopes. ' +
      'Call this when checking in (e.g. on a /loop), then claim_request before starting.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Your session id, the same one you passed to add_task.' },
        scope: { type: 'string', description: 'Your scope (same value you pass to add_task), e.g. repo folder plus template name.' },
        mine_only: { type: 'boolean', description: 'Only requests for tasks this key/session created. Default false.' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'claim_request',
    title: 'Start an approved task',
    description: 'Claim a request (its `request` id from list_requests) so no other agent picks it up, then do the work. Claiming is atomic: if another session got there first you are told who has it.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The `request` id from list_requests (a task id or a subtask id).' }, session: { type: 'string' }, scope: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'finish_request',
    title: 'Report an approved task done',
    description:
      'Report the result of a claimed request. done (default): the subtask is ticked (the task is completed once every subtask is done) and your result shows as a note. ' +
      'done=false hands it back: the user sees your reason above the OK button, and their next answer comes back as a new request.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The request id you claimed.' },
        result: { type: 'string', description: 'Short summary of what you did, or why it could not be done.' },
        done: { type: 'boolean', description: 'Default true. false hands it back to the user.' },
      },
      required: ['id', 'result'],
    },
  },
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
        archived: { type: 'string', enum: ['exclude', 'only', 'include'], description: 'Archived tasks (and tasks in archived categories). Default "exclude".' },
        limit: { type: 'number', description: 'Max tasks to return (default 50, max 200).' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'add_task',
    title: 'Add a task',
    description:
      'Create a new task. A category that does not exist yet is created. To ask the user to OK something you can do, put `approval` on the subtask it belongs to ' +
      '(or on the task when it has no subtasks); plain items get no OK button. Steps only the user can do (downloads to their computer, passphrases, closing tabs, wp-admin logins) never get approval.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What needs doing.' },
        notes: { type: 'string' },
        due: { type: ['string', 'null'], description: DUE_DESC },
        priority: { type: ['string', 'null'], enum: ['low', 'medium', 'high', null] },
        category: { type: 'string', description: 'Category name.' },
        subtasks: {
          type: 'array',
          items: { anyOf: [{ type: 'string' }, { type: 'object', properties: { title: { type: 'string' }, approval: APPROVAL_SCHEMA }, required: ['title'] }] },
          description: 'Checklist items: plain strings, or {title, approval} for a step you can do once the user OKs it.',
        },
        approval: { ...APPROVAL_SCHEMA, description: 'Only for a task without subtasks. ' + APPROVAL_SCHEMA.description },
        session: { type: 'string', description: 'Your session id (e.g. Claude Code session id). Only decides who gets approved requests first; it does not add an OK button.' },
        scope: { type: 'string', description: 'Where this work lives, e.g. repo folder plus template name. After 10 minutes unclaimed requests go only to agents with the same scope.' },
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
    name: 'update_subtasks',
    title: 'Change subtasks',
    description:
      "Change a task's checklist (subtasks) in one call: add, tick off (cross out), untick, rename, move or delete items, or clear the finished ones. " +
      'Point at a subtask by its number in list_tasks (1 = first), or by its text (exact, or a unique part of it). Actions run in order, and numbers refer to the list as it is when that action runs. ' +
      'set_approval puts an OK button on a subtask (or removes it with approval null). Set it only when (a) one specific action is proposed, (b) an agent can do all of it, (c) nothing else blocks it, (d) it is a real ask, not a status or tracking item; ' +
      'never for steps only the user can do (downloads to their computer, passphrases, closing tabs, wp-admin logins).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task id from list_tasks.' },
        actions: {
          type: 'array',
          description: 'What to do, in order.',
          items: {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                enum: ['add', 'done', 'undone', 'rename', 'delete', 'move', 'set_approval', 'done_all', 'undone_all', 'clear_done', 'delete_all'],
                description:
                  'add: new item (title, optional position and approval). done / undone: tick or untick one. rename: new title. delete: remove one. move: to position. set_approval: set or clear (null) its approval. done_all / undone_all: every item. clear_done: delete ticked items. delete_all: empty the checklist.',
              },
              subtask: { type: ['string', 'number'], description: 'Which subtask: its number (1-based) or its text. Not needed for add or the *_all / clear_done ops.' },
              title: { type: 'string', description: 'For add and rename.' },
              position: { type: 'number', description: 'For add (where to insert) and move (where to put it); 1 = top. Add defaults to the end.' },
              approval: APPROVAL_SCHEMA,
            },
            required: ['op'],
          },
        },
      },
      required: ['id', 'actions'],
    },
  },
  {
    name: 'delete_task',
    title: 'Delete a task',
    description: 'Permanently delete a task. Only do this when the user clearly asked to delete it; to just get it out of the way, use archive.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { destructiveHint: true },
  },
  {
    name: 'archive',
    title: 'Archive or restore',
    description:
      'Archive a task or a category (hides it from the list without deleting it; archiving a category hides its tasks too). With restore=true, bring it back. Prefer this over deleting when the user wants something out of the way.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['task', 'category'], description: 'Default "task".' },
        id: { type: 'string', description: 'Task id from list_tasks, or the category name.' },
        restore: { type: 'boolean', description: 'true to un-archive. Default false.' },
      },
      required: ['id'],
    },
    annotations: { idempotentHint: true },
  },
  {
    name: 'delete_category',
    title: 'Delete a category',
    description:
      'Permanently delete a category by name. Its tasks are kept and become uncategorized. Only do this when the user clearly asked; to just hide it, use archive.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    annotations: { destructiveHint: true },
  },
  {
    name: 'list_categories',
    title: 'List categories',
    description: 'List categories with how many pending tasks each has, and whether each is archived.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_activity',
    title: 'Task history',
    description:
      'Recent history, newest first: tasks added, completed, reopened, archived, restored and deleted, category changes, and notifications sent. Each event says whether the user ("me") or an agent did it, and when.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'How many events (default 30, max 100).' },
        type: { type: 'string', enum: ['added', 'completed', 'reopened', 'deleted', 'archived', 'restored', 'notice'], description: 'Only this kind of event.' },
      },
    },
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
        task_id: { type: 'string', description: 'Optional id of the task this is about (from list_tasks): clicking the notification opens that task.' },
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

/** Approved tasks go to the agent that created them first, then to anyone. */
const FALLBACK_MS = 10 * 60_000;
/** What the user said when sending the task: their own answer, or a plain OK. */
const answerOf = (r: Req) => r.reply ?? 'OK (go ahead as planned)';
const sessionArg = (a: Record<string, unknown>) => (typeof a.session === 'string' && a.session.trim() ? a.session.trim().slice(0, 120) : null);
const scopeArg = (a: Record<string, unknown>) => (typeof a.scope === 'string' && a.scope.trim() ? a.scope.trim().slice(0, 200) : null);
type Src = { agent: string; session: string | null; scope?: string | null };

/** Returned whenever an agent puts an OK button up: the answer arrives in the app, and nothing wakes the agent by itself. */
const WATCH = 'https://smart-tasks.ashfadhossain0.workers.dev/smart-tasks-watch.mjs';
const WAIT_HINT =
  'The user answers this in the Smart Tasks app, and nothing wakes you when they do. Before ending your turn, start watching: ' +
  'in Claude Code run `node ~/.claude/tools/smart-tasks-watch.mjs` with Bash run_in_background (add --scope <scope> if you set one; ' +
  `if the file is missing, download it first: curl -fsSL ${WATCH} -o ~/.claude/tools/smart-tasks-watch.mjs). ` +
  'It uses no tokens and exits, waking you, when the user approves something; handle the requests it prints (claim_request, do it, finish_request) and start it again. ' +
  'Elsewhere, check list_requests every few minutes, and tell the user they can just say "check Smart Tasks".';

function approvalArg(v: unknown): Approval | null {
  try {
    return cleanApproval(v);
  } catch (e) {
    throw new ToolError(e instanceof BadRequest ? e.message : 'bad approval');
  }
}

/** Finds the request an id points at: a task, one of its subtasks, or (old agents) a task with exactly one open subtask request. */
async function findRequest(ctx: Ctx, id: unknown): Promise<ReqRef> {
  const key = str(id, 'id', true)!;
  const tasks = await list(ctx, 'task');
  for (const t of tasks) {
    const hit = reqs(t).find(r => r.sub?.id === key);
    if (hit) return hit;
  }
  const t = await findTask(ctx, key);
  const own = t.aiRequest as Req | null | undefined;
  if (isOpen(own)) return { task: reqs(t)[0].task, sub: null, req: own };
  const open = reqs(t).filter(r => r.sub && isOpen(r.req));
  if (open.length === 1) return open[0];
  if (open.length > 1) throw new ToolError(`That task has ${open.length} open requests; pass the \`request\` id from list_requests.`);
  return { task: reqs(t)[0].task, sub: null, req: own };
}
const reqs = (t: Rec) => requestsOf(t as Parameters<typeof requestsOf>[0]);

async function runTool(ctx: Ctx, name: string, a: Record<string, unknown>): Promise<unknown> {
  const now = Date.now();
  switch (name) {
    case 'list_requests': {
      const session = sessionArg(a);
      const scope = scopeArg(a);
      const cats = await catMap(ctx);
      const mine = (t: Rec) => {
        const src = t.source as Src | null | undefined;
        if (!src) return false;
        return session && src.session ? src.session === session : src.agent === ctx.agent;
      };
      // After 10 minutes: other agents, but never across scopes.
      // Unscoped (older) tasks keep the old rule: anyone after 10 minutes.
      const sameScope = (t: Rec) => {
        const s = (t.source as Src | null | undefined)?.scope ?? null;
        return s == null || s === scope;
      };
      const out = (await list(ctx, 'task'))
        .filter(t => t.completedAt == null)
        .flatMap(t => reqs(t))
        .filter(({ task, sub, req }) => {
          if (!req || (sub && sub.done)) return false;
          const open = req.status === 'approved' || (req.status === 'claimed' && now - req.at > CLAIM_STALE_MS);
          if (!open) return false;
          if (mine(task)) return true;
          return !a.mine_only && now - req.at > FALLBACK_MS && sameScope(task);
        })
        .sort((x, y) => Number(mine(y.task)) - Number(mine(x.task)) || x.req!.at - y.req!.at)
        .map(({ task, sub, req }) => {
          const approval = (sub ? sub.approval : (task.approval as Approval | null | undefined)) ?? null;
          return {
            request: sub ? sub.id : task.id,
            ...(sub ? { subtask: sub.title, task: view(task, cats, ctx.tz) } : view(task, cats, ctx.tz)),
            ...(approval ? { action: approval.action } : {}),
            approved: fmtLocal(req!.at, ctx.tz),
            userAnswer: answerOf(req!),
            yours: mine(task),
          };
        });
      return { total: out.length, requests: out, hint: out.length ? 'claim_request with each `request` id before starting it.' : 'Nothing approved right now.' };
    }

    case 'claim_request': {
      need(ctx, 'edit');
      const ref = await findRequest(ctx, a.id);
      const src = ref.task.source as Src | null | undefined;
      const scope = scopeArg(a);
      if (scope && src?.scope && src.scope !== scope) throw new ToolError(`That request belongs to another scope (${src.scope}).`);
      const r = await ctx.hub.claim(ref.task.id, ref.sub?.id ?? null, ctx.agent, sessionArg(a));
      if ('error' in r) throw new ToolError(r.error);
      const approval = (ref.sub ? ref.sub.approval : (ref.task.approval as Approval | null | undefined)) ?? null;
      return {
        claimed: ref.sub ? { request: ref.sub.id, subtask: ref.sub.title, task: view(ref.task, await catMap(ctx), ctx.tz) } : { request: ref.task.id, ...view(ref.task, await catMap(ctx), ctx.tz) },
        ...(approval ? { action: approval.action } : {}),
        userAnswer: answerOf(r.req),
        next: "Follow the user's answer for this request, then call finish_request with a short result.",
      };
    }

    case 'finish_request': {
      need(ctx, 'edit');
      const ref = await findRequest(ctx, a.id);
      const result = str(a.result, 'result', true)!.slice(0, 2000);
      const done = a.done !== false;
      if (done) need(ctx, 'complete');
      const r = await ctx.hub.finish(ref.task.id, ref.sub?.id ?? null, ctx.agent, result, done);
      if ('error' in r) throw new ToolError(r.error);
      return { finished: done, request: ref.sub?.id ?? ref.task.id, item: ref.sub?.title ?? ref.task.title, taskCompleted: r.taskDone };
    }

    case 'list_tasks': {
      const status = (a.status as string) ?? 'pending';
      const limit = Math.min(200, Math.max(1, Number(a.limit) || 50));
      const cats = await catMap(ctx);
      const archCats = new Set((await list(ctx, 'category')).filter(isArchived).map(c => c.id));
      const arch = (a.archived as string) ?? 'exclude';
      let tasks = await list(ctx, 'task');
      if (arch === 'exclude') tasks = tasks.filter(t => !taskArchived(t, archCats));
      else if (arch === 'only') tasks = tasks.filter(t => taskArchived(t, archCats));
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
        tasks: tasks.slice(0, limit).map(t => view(t, cats, ctx.tz, taskArchived(t, archCats))),
      };
    }

    case 'add_task': {
      need(ctx, 'add');
      const title = str(a.title, 'title', true)!;
      const scope = scopeArg(a);
      const data: Record<string, unknown> = { title, order: now, createdAt: now, updatedAt: now, source: { agent: ctx.agent, session: sessionArg(a), ...(scope ? { scope } : {}) } };
      if (a.approval != null) data.approval = approvalArg(a.approval);
      if (a.notes != null) data.notes = str(a.notes, 'notes');
      if (a.due !== undefined) data.dueAt = parseDue(a.due, ctx.tz);
      if (a.priority !== undefined) data.priority = priority(a.priority);
      if (a.category != null) data.categoryId = await categoryId(ctx, a.category, true);
      if (Array.isArray(a.subtasks)) {
        data.subtasks = a.subtasks
          .map(s => (typeof s === 'string' ? { title: s } : (s as Record<string, unknown>)))
          .filter(s => typeof s?.title === 'string' && s.title.trim())
          .map(s => ({
            id: crypto.randomUUID(),
            title: (s.title as string).trim().slice(0, 300),
            done: false,
            ...(s.approval != null ? { approval: approvalArg(s.approval) } : {}),
          }));
      }
      const id = crypto.randomUUID();
      await push(ctx, [{ kind: 'task', id, op: 'upsert', data }]);
      const t = (await list(ctx, 'task')).find(x => x.id === id)!;
      const asks = data.approval != null || (Array.isArray(data.subtasks) && (data.subtasks as Array<{ approval?: unknown }>).some(s => s.approval != null));
      return { added: view(t, await catMap(ctx), ctx.tz), ...(asks ? { next: WAIT_HINT } : {}) };
    }

    case 'update_task': {
      need(ctx, 'edit');
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

    case 'update_subtasks': {
      const t = await findTask(ctx, a.id);
      if (!Array.isArray(a.actions) || a.actions.length === 0) throw new ToolError('actions must be a non-empty array');
      if (a.actions.length > 100) throw new ToolError('At most 100 actions per call');
      type Sub = { id: string; title: string; done: boolean; approval?: Approval | null; aiRequest?: Req | null };
      let subs: Sub[] = ((t.subtasks as Sub[]) ?? []).map(x => ({ ...x }));
      const pick = (ref: unknown): number => {
        if (ref === undefined || ref === null || ref === '') throw new ToolError('Say which subtask (its number or text).');
        const n = typeof ref === 'number' ? ref : /^\d+$/.test(String(ref).trim()) ? Number(String(ref).trim()) : NaN;
        if (!Number.isNaN(n)) {
          if (n < 1 || n > subs.length) throw new ToolError(`There is no subtask ${n}; this task has ${subs.length}.`);
          return n - 1;
        }
        const q = String(ref).trim().toLowerCase();
        const exact = subs.findIndex(x => x.id === ref || x.title.toLowerCase() === q);
        if (exact >= 0) return exact;
        const part = subs.map((x, i) => (x.title.toLowerCase().includes(q) ? i : -1)).filter(i => i >= 0);
        if (part.length === 1) return part[0];
        if (part.length > 1) throw new ToolError(`"${ref}" matches ${part.length} subtasks; use its number instead.`);
        throw new ToolError(`No subtask matching "${ref}". Subtasks: ${subs.map((x, i) => `${i + 1}. ${x.title}`).join('; ') || 'none'}.`);
      };
      const pos = (v: unknown, len: number) => Math.min(len, Math.max(0, (Number(v) || len + 1) - 1));
      const title = (v: unknown) => {
        const s = str(v, 'title', true)!.slice(0, 300);
        return s;
      };
      const done: string[] = [];
      for (const raw of a.actions as Array<Record<string, unknown>>) {
        const op = String(raw?.op ?? '');
        switch (op) {
          case 'add': {
            need(ctx, 'edit');
            if (subs.length >= 100) throw new ToolError('A task can have at most 100 subtasks.');
            const item: Sub = { id: crypto.randomUUID(), title: title(raw.title), done: false, ...(raw.approval != null ? { approval: approvalArg(raw.approval) } : {}) };
            subs.splice(raw.position === undefined ? subs.length : pos(raw.position, subs.length), 0, item);
            done.push(`added "${item.title}"`);
            break;
          }
          case 'done':
          case 'undone': {
            need(ctx, 'complete');
            const i = pick(raw.subtask);
            subs[i].done = op === 'done';
            done.push(`${op === 'done' ? 'ticked' : 'unticked'} "${subs[i].title}"`);
            break;
          }
          case 'rename': {
            need(ctx, 'edit');
            const i = pick(raw.subtask);
            const before = subs[i].title;
            subs[i].title = title(raw.title);
            done.push(`renamed "${before}" to "${subs[i].title}"`);
            break;
          }
          case 'delete': {
            need(ctx, 'edit');
            const i = pick(raw.subtask);
            done.push(`deleted "${subs[i].title}"`);
            subs.splice(i, 1);
            break;
          }
          case 'move': {
            need(ctx, 'edit');
            const i = pick(raw.subtask);
            const [item] = subs.splice(i, 1);
            subs.splice(pos(raw.position, subs.length), 0, item);
            done.push(`moved "${item.title}" to ${subs.indexOf(item) + 1}`);
            break;
          }
          case 'set_approval': {
            need(ctx, 'edit');
            const i = pick(raw.subtask);
            if (raw.approval === undefined) throw new ToolError('set_approval needs approval (an object, or null to remove it).');
            subs[i] = { ...subs[i], approval: approvalArg(raw.approval) };
            done.push(subs[i].approval ? `asked for OK on "${subs[i].title}"` : `removed the OK button from "${subs[i].title}"`);
            break;
          }
          case 'done_all':
          case 'undone_all':
            need(ctx, 'complete');
            subs = subs.map(x => ({ ...x, done: op === 'done_all' }));
            done.push(op === 'done_all' ? 'ticked all' : 'unticked all');
            break;
          case 'clear_done': {
            need(ctx, 'edit');
            const n = subs.filter(x => x.done).length;
            subs = subs.filter(x => !x.done);
            done.push(`cleared ${n} finished`);
            break;
          }
          case 'delete_all':
            need(ctx, 'edit');
            done.push(`deleted all ${subs.length}`);
            subs = [];
            break;
          default:
            throw new ToolError(`Unknown op "${op}". Use add, done, undone, rename, delete, move, set_approval, done_all, undone_all, clear_done or delete_all.`);
        }
      }
      await push(ctx, [{ kind: 'task', id: t.id, op: 'upsert', data: { subtasks: subs, updatedAt: now } }]);
      const after = (await list(ctx, 'task')).find(x => x.id === t.id)!;
      const asks = (a.actions as Array<{ op?: string; approval?: unknown }>).some(x => (x.op === 'add' || x.op === 'set_approval') && x.approval != null);
      return { changes: done, task: view(after, await catMap(ctx), ctx.tz), ...(asks ? { next: WAIT_HINT } : {}) };
    }

    case 'complete_task': {
      need(ctx, 'complete');
      const t = await findTask(ctx, a.id);
      const done = a.done !== false;
      await push(ctx, [{ kind: 'task', id: t.id, op: 'upsert', data: { completedAt: done ? now : null, updatedAt: now } }]);
      return { id: t.id, title: t.title, done };
    }

    case 'delete_task': {
      need(ctx, 'delete');
      const t = await findTask(ctx, a.id);
      await push(ctx, [{ kind: 'task', id: t.id, op: 'delete' }]);
      return { deleted: { id: t.id, title: t.title } };
    }

    case 'list_categories': {
      const [cats, tasks] = await Promise.all([list(ctx, 'category'), list(ctx, 'task')]);
      return {
        categories: cats
          .sort((x, y) => (x.order as number) - (y.order as number))
          .map(c => ({
            name: c.name,
            color: c.color,
            pending: tasks.filter(t => t.categoryId === c.id && t.completedAt == null && !isArchived(t)).length,
            ...(isArchived(c) ? { archived: true } : {}),
          })),
      };
    }

    case 'archive': {
      need(ctx, 'archive');
      const restore = a.restore === true;
      const archivedAt = restore ? null : now;
      if ((a.kind ?? 'task') === 'category') {
        const c = await findCategory(ctx, a.id);
        await push(ctx, [{ kind: 'category', id: c.id, op: 'upsert', data: { archivedAt } }]);
        return { category: c.name, archived: !restore };
      }
      const t = await findTask(ctx, a.id);
      await push(ctx, [{ kind: 'task', id: t.id, op: 'upsert', data: { archivedAt, updatedAt: now } }]);
      return { id: t.id, title: t.title, archived: !restore };
    }

    case 'delete_category': {
      need(ctx, 'categories', 'delete');
      const c = await findCategory(ctx, a.name);
      await push(ctx, [{ kind: 'category', id: c.id, op: 'delete' }]);
      return { deleted: c.name, note: 'Its tasks are kept and are now uncategorized.' };
    }

    case 'list_activity': {
      const limit = Math.min(100, Math.max(1, Number(a.limit) || 30));
      const type = typeof a.type === 'string' ? a.type : null;
      const out: Array<Record<string, unknown>> = [];
      let cursor = '';
      for (let page = 0; page < 10 && out.length < limit; page++) {
        const r = await ctx.hub.activity(cursor, 100);
        for (const e of r.events) if (!type || e.type === type) out.push({ when: fmtLocal(e.at, ctx.tz), event: e.type, title: e.title, ...(e.detail === 'category' ? { kind: 'category' } : e.detail ? { message: e.detail } : {}), by: e.by === 'agent' ? 'agent' : 'user', ...(e.taskId ? { taskId: e.taskId } : {}) });
        if (!r.next) break;
        cursor = r.next;
      }
      return { events: out.slice(0, limit) };
    }

    case 'notify': {
      need(ctx, 'notify');
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
      const taskId = str(a.task_id, 'task_id')?.slice(0, 64) || null;
      const r = await ctx.hub.notify({ title, message, url, taskId }, ctx.agent);
      if ('error' in r) throw new ToolError(r.error);
      return { sent: true, note: 'Devices with Smart Tasks show it within about a minute (instantly if the popup is open).' };
    }

    case 'create_category': {
      need(ctx, 'categories');
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

/** Tools the user has turned off are left out of tools/list. */
const TOOL_PERMS: Record<string, AgentPerm[]> = {
  add_task: ['add'],
  update_task: ['edit'],
  update_subtasks: ['edit'],
  complete_task: ['complete'],
  delete_task: ['delete'],
  archive: ['archive'],
  delete_category: ['categories', 'delete'],
  create_category: ['categories'],
  notify: ['notify'],
  claim_request: ['edit'],
  finish_request: ['edit'],
};
const allowed = (ctx: Ctx, tool: string) => (TOOL_PERMS[tool] ?? []).every(p => ctx.perms[p]);

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
          'Use notify to ping the user on their desktop when they asked to be told about something. ' +
          'Prefer archive over delete when something just needs to be out of the way. ' +
          'Pass your session id as `session` (and a `scope`, e.g. repo folder plus template) to add_task so requests come back to you. ' +
          'To ask the user to OK something you can do, set `approval` on that subtask; only those items get an OK button. Never for steps only the user can do. ' +
          `When the user OKs (plain, a choice, or their own answer, as userAnswer), it shows in list_requests: check it when you start; while waiting, in Claude Code run \`node ~/.claude/tools/smart-tasks-watch.mjs\` in the background (it wakes you when the user approves; download from ${WATCH} if missing), elsewhere check periodically. ` +
          'claim_request before working, and finish_request with a short result when done. ' +
          `The user controls what agents may do; right now: ${Object.entries(ctx.perms).map(([k, v]) => `${k} ${v ? 'on' : 'off'}`).join(', ')}.`,
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS.filter(t => allowed(ctx, t.name)) });
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      if (!TOOLS.some(t => t.name === name)) return err(-32602, `Unknown tool: ${name}`);
      // Turned-off tools still answer with a clear reason (clients may have cached the list).
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
