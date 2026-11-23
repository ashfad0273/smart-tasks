import { api, ApiError } from './api';
import { desktopShortcut, isDesktopApp } from './desktop';
import { storageGet, storageRemove, storageSetMany, withLock } from './ext';
import { baseKey, outboxKey, REGISTRY_KEY, statusKey } from './keys';
import type { AccountInfo, Category, Change, DataSet, Registry, SyncOp, SyncStatus, Task } from './types';
import { DEFAULT_CATEGORIES, uid4 } from './utils';

/**
 * Offline-first sync engine, shared by the popup and the service worker.
 *
 * Per account, chrome.storage.local holds:
 *   base   — last known server state + its revision
 *   outbox — local mutations not yet acknowledged by the server
 * What the UI shows is `base` with the `outbox` replayed on top, so edits
 * are instant and survive offline periods / popup closes. `sync()` pushes
 * the outbox, then pulls everything changed since `base.rev`.
 */

export const EMPTY_SET: DataSet = { rev: 0, tasks: {}, categories: {} };

/* ── registry ─────────────────────────────────────────────────────────── */

export async function loadRegistry(): Promise<Registry> {
  const reg = await storageGet<Registry | null>(REGISTRY_KEY, null);
  // v1 (Firebase-era) registries have no tokens — start fresh.
  if (!reg || reg.v !== 2) return { v: 2, accounts: [], activeId: null };
  return reg;
}

export async function saveRegistry(reg: Registry): Promise<void> {
  await storageSetMany({ [REGISTRY_KEY]: reg });
}

export async function activeAccount(): Promise<AccountInfo | null> {
  const reg = await loadRegistry();
  return reg.accounts.find(a => a.uid === reg.activeId) ?? null;
}

/* ── applying ops / changes ───────────────────────────────────────────── */

function taskFrom(id: string, d: Record<string, unknown>, now: number): Task {
  return {
    id,
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
    ...(d as Partial<Task>),
  };
}

function categoryFrom(id: string, d: Record<string, unknown>, now: number): Category {
  return { id, name: 'Untitled', color: '#22c55e', order: now, createdAt: now, ...(d as Partial<Category>) };
}

export function applyOps(set: DataSet, ops: SyncOp[]): DataSet {
  if (ops.length === 0) return set;
  const tasks = { ...set.tasks };
  const categories = { ...set.categories };
  const now = Date.now();
  for (const op of ops) {
    if (op.kind === 'task') {
      if (op.op === 'delete') delete tasks[op.id];
      else tasks[op.id] = { ...(tasks[op.id] ?? taskFrom(op.id, {}, now)), ...(op.data as Partial<Task>), id: op.id };
    } else {
      if (op.op === 'delete') {
        delete categories[op.id];
        for (const t of Object.values(tasks)) {
          if (t.categoryId === op.id) tasks[t.id] = { ...t, categoryId: null };
        }
      } else {
        categories[op.id] = { ...(categories[op.id] ?? categoryFrom(op.id, {}, now)), ...(op.data as Partial<Category>), id: op.id };
      }
    }
  }
  return { ...set, tasks, categories };
}

function applyChanges(set: DataSet, changes: Change[], rev: number): DataSet {
  const tasks = { ...set.tasks };
  const categories = { ...set.categories };
  const now = Date.now();
  for (const c of changes) {
    const bucket = (c.kind === 'task' ? tasks : categories) as Record<string, unknown>;
    if (c.deleted || !c.data) delete bucket[c.id];
    else bucket[c.id] = c.kind === 'task' ? taskFrom(c.id, c.data, now) : categoryFrom(c.id, c.data, now);
  }
  return { rev, tasks, categories };
}

/* ── reading ──────────────────────────────────────────────────────────── */

export async function readView(uid: string): Promise<DataSet> {
  const [base, outbox] = await Promise.all([
    storageGet<DataSet>(baseKey(uid), EMPTY_SET),
    storageGet<SyncOp[]>(outboxKey(uid), []),
  ]);
  return applyOps(base, outbox);
}

export async function readStatus(uid: string): Promise<SyncStatus> {
  return storageGet<SyncStatus>(statusKey(uid), { state: 'syncing', lastSyncAt: null });
}

async function setStatus(uid: string, patch: Partial<SyncStatus>): Promise<void> {
  const prev = await readStatus(uid);
  const next = { ...prev, ...patch };
  if (JSON.stringify(prev) !== JSON.stringify(next)) await storageSetMany({ [statusKey(uid)]: next });
}

/* ── writing ──────────────────────────────────────────────────────────── */

/** Queue mutations for an account. Local accounts apply them directly. */
export async function mutate(account: AccountInfo, ops: SyncOp[]): Promise<void> {
  if (ops.length === 0) return;
  await withLock(`st-data:${account.uid}`, async () => {
    if (account.local) {
      const base = await storageGet<DataSet>(baseKey(account.uid), EMPTY_SET);
      await storageSetMany({ [baseKey(account.uid)]: applyOps(base, ops) });
    } else {
      const outbox = await storageGet<SyncOp[]>(outboxKey(account.uid), []);
      await storageSetMany({ [outboxKey(account.uid)]: [...outbox, ...ops] });
    }
  });
  if (!account.local) void sync(account);
}

/* ── syncing ──────────────────────────────────────────────────────────── */

const inflight = new Map<string, Promise<void>>();
const again = new Set<string>();

/** Push pending ops, then pull changes. Coalesces concurrent calls. */
export function sync(account: AccountInfo): Promise<void> {
  if (account.local || !account.token) return Promise.resolve();
  const running = inflight.get(account.uid);
  if (running) {
    again.add(account.uid);
    return running;
  }
  const p = (async () => {
    do {
      again.delete(account.uid);
      await withLock(`st-sync:${account.uid}`, () => syncOnce(account));
    } while (again.has(account.uid));
  })().finally(() => inflight.delete(account.uid));
  inflight.set(account.uid, p);
  return p;
}

async function syncOnce(account: AccountInfo): Promise<void> {
  const uid = account.uid;
  const token = account.token!;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await setStatus(uid, { state: 'offline' });
    return;
  }
  await setStatus(uid, { state: 'syncing' });
  try {
    // 1. push
    const pending = await storageGet<SyncOp[]>(outboxKey(uid), []);
    for (let i = 0; i < pending.length; i += 500) {
      const chunk = pending.slice(i, i + 500);
      await api.push(token, chunk);
      // Fold the acknowledged ops into base and drop them from the outbox
      // in one write (ops appended meanwhile stay queued).
      await withLock(`st-data:${uid}`, async () => {
        const [base, outbox] = await Promise.all([
          storageGet<DataSet>(baseKey(uid), EMPTY_SET),
          storageGet<SyncOp[]>(outboxKey(uid), []),
        ]);
        await storageSetMany({
          [baseKey(uid)]: applyOps(base, chunk),
          [outboxKey(uid)]: outbox.slice(chunk.length),
        });
      });
    }
    // 2. pull
    for (;;) {
      const base = await storageGet<DataSet>(baseKey(uid), EMPTY_SET);
      const res = await api.pull(token, base.rev);
      if (res.changes.length > 0 || res.rev !== base.rev) {
        await withLock(`st-data:${uid}`, async () => {
          const fresh = await storageGet<DataSet>(baseKey(uid), EMPTY_SET);
          await storageSetMany({ [baseKey(uid)]: applyChanges(fresh, res.changes, res.rev) });
        });
      }
      if (!res.more) break;
    }
    await setStatus(uid, { state: 'synced', lastSyncAt: Date.now(), error: undefined, signedOut: false });
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e));
    if (err.isAuth) {
      await setStatus(uid, { state: 'error', error: err.message, signedOut: true });
    } else if (err.status === 400) {
      // The server rejected something in the queue — drop it rather than
      // retrying forever, then resync from the server's truth.
      await storageSetMany({ [outboxKey(uid)]: [] });
      await setStatus(uid, { state: 'error', error: err.message });
    } else {
      await setStatus(uid, { state: err.isNetwork ? 'offline' : 'error', error: err.message });
    }
  }
}

/* ── account lifecycle ────────────────────────────────────────────────── */

export function defaultCategoryOps(): SyncOp[] {
  const now = Date.now();
  return DEFAULT_CATEGORIES.map((c, i) => ({
    kind: 'category' as const,
    id: uid4(),
    op: 'upsert' as const,
    data: { name: c.name, color: c.color, order: i, createdAt: now + i },
  }));
}

/** Friendly first tasks that teach the app by doing. */
export function welcomeTaskOps(categoryOps: SyncOp[]): SyncOp[] {
  const now = Date.now();
  const personal = categoryOps.find(o => o.data?.name === 'Personal')?.id ?? null;
  const tonight = new Date();
  tonight.setHours(20, 0, 0, 0);
  if (tonight.getTime() < now) tonight.setDate(tonight.getDate() + 1);
  const t = (title: string, extra: Record<string, unknown>, i: number): SyncOp => ({
    kind: 'task',
    id: uid4(),
    op: 'upsert',
    data: { title, order: now - i, createdAt: now - i, updatedAt: now - i, ...extra },
  });
  return [
    t('Tick the box to complete a task', { priority: 'high' }, 0),
    t('Click a task to edit, schedule or add subtasks', {
      categoryId: personal,
      subtasks: [
        { id: uid4(), title: 'Pick a priority', done: false },
        { id: uid4(), title: 'Set a due time to get a reminder', done: false },
        { id: uid4(), title: 'Drag subtasks to reorder', done: false },
      ],
    }, 1),
    t(isDesktopApp() ? `Press ${desktopShortcut()} to open Smart Tasks from anywhere` : 'Right-click any web page to save it here', {
      dueAt: tonight.getTime(),
      priority: 'low',
    }, 2),
  ];
}

/** Remove everything stored locally for an account. */
export async function purgeLocal(uid: string): Promise<void> {
  await storageRemove([baseKey(uid), outboxKey(uid), statusKey(uid)]);
}

export function newId(): string {
  return uid4();
}
