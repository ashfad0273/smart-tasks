import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, type AuthResult, type ServerConfig } from '../../../lib/api';
import { completeSignIn } from '../../../lib/auth';
import { isExtension, onStorageChange, storageGet, storageSet } from '../../../lib/ext';
import { baseKey, ONBOARDED_KEY, outboxKey, REGISTRY_KEY, statusKey, TOUR_KEY } from '../../../lib/keys';
import {
  defaultCategoryOps,
  activeTasks,
  EMPTY_SET,
  loadRegistry,
  mutate,
  newId,
  purgeLocal,
  readStatus,
  readView,
  saveRegistry,
  sync,
  welcomeTaskOps,
} from '../../../lib/store';
import type { AccountInfo, Category, DataSet, Registry, SyncOp, SyncState, SyncStatus, Task, TaskPatch } from '../../../lib/types';
import { cheer, descErr, friendlyAuthError, hueFromString } from '../../../lib/utils';

export type Screen = 'welcome' | 'login' | 'signup' | 'reset' | 'dashboard' | 'categories' | 'settings' | 'agent' | 'devices' | 'activity' | 'archive';
export type Tab = 'all' | 'pending' | 'completed';
export type ToastKind = 'info' | 'error' | 'success';
export interface Toast {
  id: number;
  msg: string;
  kind: ToastKind;
  action?: { label: string; run: () => void };
}
export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  danger?: boolean;
}
export type CategoryModalState = { mode: 'create' } | { mode: 'edit'; id: string };

export interface NewTaskInput {
  title: string;
  categoryId?: string | null;
  priority?: Task['priority'];
  dueAt?: number | null;
}

interface AppCtx {
  booted: boolean;
  config: ServerConfig | null;

  screen: Screen;
  setScreen(s: Screen): void;
  addMode: boolean;
  startAddAccount(): void;
  cancelAddAccount(): void;

  accounts: AccountInfo[];
  account: AccountInfo | null;
  /** Active cloud account whose session was rejected by the server. */
  sessionExpired: boolean;
  busy: boolean;
  signIn(email: string, password: string): Promise<boolean>;
  signUp(name: string, email: string, password: string): Promise<boolean>;
  signInWithGoogle(): Promise<void>;
  startLocal(): Promise<void>;
  /** The first-run tour is showing (new accounts, or replayed from Settings). */
  tour: boolean;
  startTour(): void;
  finishTour(): void;
  requestReset(email: string): Promise<boolean>;
  confirmReset(email: string, code: string, password: string): Promise<boolean>;
  switchAccount(uid: string): Promise<void>;
  signOut(uid: string): Promise<void>;
  deleteAccount(): Promise<void>;
  renameAccount(name: string): Promise<void>;
  exportData(): Promise<void>;
  syncNow(): void;

  /** Active tasks: not archived and not in an archived category. */
  tasks: Task[];
  /** Every task, archived ones included. */
  allTasks: Task[];
  /** Archived tasks, plus tasks hidden because their category is archived. */
  archivedTasks: Task[];
  /** Active categories. */
  categories: Category[];
  archivedCategories: Category[];
  sync: SyncState;
  lastSyncAt: number | null;
  filter: string;
  setFilter(f: string): void;
  tab: Tab;
  setTab(t: Tab): void;
  query: string;
  setQuery(q: string): void;
  visibleTasks: Task[];
  categoryById(id: string | null): Category | null;
  counts: { total: number; pending: number; completed: number; doneToday: number; dueToday: number };
  countsByCategory: Record<string, number>;
  createTask(input: NewTaskInput): Promise<void>;
  updateTask(id: string, patch: TaskPatch): Promise<void>;
  deleteTask(id: string): Promise<void>;
  toggleTaskDone(task: Task): Promise<void>;
  clearCompleted(): Promise<void>;
  createCategory(input: { name: string; color: string }): Promise<string | null>;
  updateCategory(id: string, patch: { name?: string; color?: string }): Promise<void>;
  deleteCategory(id: string): Promise<void>;
  archiveTask(id: string, archived?: boolean): Promise<void>;
  archiveCategory(id: string, archived?: boolean): Promise<void>;

  /** Bumped every time a task gets completed — drives the confetti. */
  celebrate: number;
  editTaskId: string | null;
  openEdit(id: string): void;
  closeEdit(): void;
  switcherOpen: boolean;
  setSwitcherOpen(v: boolean): void;
  categoryModal: CategoryModalState | null;
  openCategoryModal(m: CategoryModalState): void;
  closeCategoryModal(): void;
  toast: Toast | null;
  showToast(msg: string, kind?: ToastKind, action?: Toast['action']): void;
  dismissToast(): void;
  confirm(opts: ConfirmOptions): Promise<boolean>;
  confirmData: { opts: ConfirmOptions; resolve: (v: boolean) => void } | null;
  resolveConfirm(v: boolean): void;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}

const isPending = (t: Task) => !t.completedAt;
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

export function AppProvider({ children }: { children: ReactNode }) {
  const [booted, setBooted] = useState(false);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [registry, setRegistry] = useState<Registry>({ v: 2, accounts: [], activeId: null });
  const [screen, setScreenRaw] = useState<Screen>('welcome');
  const [addMode, setAddMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tour, setTour] = useState(false);
  const loadTour = useCallback(async () => setTour((await storageGet<unknown>(TOUR_KEY, null)) != null), []);

  const [data, setData] = useState<DataSet>(EMPTY_SET);
  const [status, setStatus] = useState<SyncStatus>({ state: 'syncing', lastSyncAt: null });
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  const [filter, setFilter] = useState('all');
  const [tab, setTab] = useState<Tab>('pending');
  const [query, setQuery] = useState('');
  const [celebrate, setCelebrate] = useState(0);

  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [categoryModal, setCategoryModal] = useState<CategoryModalState | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmData, setConfirmData] = useState<AppCtx['confirmData']>(null);

  const account = useMemo(
    () => registry.accounts.find(a => a.uid === registry.activeId) ?? null,
    [registry],
  );
  const accountRef = useRef(account);
  accountRef.current = account;

  /* ── toast / confirm ──────────────────────────────────────────────── */

  const showToast = useCallback<AppCtx['showToast']>((msg, kind = 'info', action) => {
    setToast({ id: Date.now(), msg, kind, action });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), action ? 5000 : 3000);
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>(resolve => setConfirmData({ opts, resolve })),
    [],
  );
  const resolveConfirm = useCallback((v: boolean) => {
    setConfirmData(d => {
      d?.resolve(v);
      return null;
    });
  }, []);

  /* ── boot ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    let alive = true;
    void (async () => {
      const reg = await loadRegistry();
      if (!alive) return;
      setRegistry(reg);
      const active = reg.accounts.find(a => a.uid === reg.activeId);
      await loadTour();
      if (active) setScreenRaw('dashboard');
      else if (reg.accounts.length > 0 || (await storageGet<boolean>(ONBOARDED_KEY, false))) setScreenRaw('login');
      setBooted(true);
    })();
    api.config().then(c => alive && setConfig(c)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Keep the registry in sync with other contexts (other popup windows, SW).
  useEffect(
    () =>
      onStorageChange(keys => {
        if (keys.includes(REGISTRY_KEY)) void loadRegistry().then(setRegistry);
      }),
    [],
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  /* ── live data for the active account ─────────────────────────────── */

  const uid = account?.uid ?? null;
  useEffect(() => {
    if (!uid) {
      setData(EMPTY_SET);
      return;
    }
    let alive = true;
    const refresh = () => readView(uid).then(v => alive && setData(v));
    const refreshStatus = () => readStatus(uid).then(s => alive && setStatus(s));
    void refresh();
    void refreshStatus();
    const un = onStorageChange(keys => {
      if (keys.includes(baseKey(uid)) || keys.includes(outboxKey(uid))) void refresh();
      if (keys.includes(statusKey(uid))) void refreshStatus();
    });
    return () => {
      alive = false;
      un();
    };
  }, [uid]);

  // Realtime: a WebSocket per open popup; the server pings "rev" on every change.
  const token = account && !account.local ? account.token : null;
  useEffect(() => {
    const acc = accountRef.current;
    if (!acc || !token || !online) return;
    void sync(acc);
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      ws = new WebSocket(api.wsUrl(token));
      ws.onopen = () => {
        retry = 0;
        pingTimer = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), 25_000);
      };
      ws.onmessage = async e => {
        if (typeof e.data !== 'string' || !e.data.startsWith('{')) return;
        const msg = JSON.parse(e.data) as { type: string; rev: number };
        if (msg.type === 'notice') {
          // An AI agent sent a notification: let the service worker show it now.
          globalThis.chrome?.runtime?.sendMessage?.({ type: 'st-check-notices' })?.catch(() => {});
          return;
        }
        if (msg.type !== 'rev') return;
        const base = await storageGet<DataSet>(baseKey(acc.uid), EMPTY_SET);
        if (msg.rev > base.rev) void sync(acc);
      };
      ws.onclose = ev => {
        if (pingTimer) clearInterval(pingTimer);
        if (closed || ev.code === 4001) return;
        // Signed out from another device: one sync surfaces the "sign in again" banner.
        if (ev.code === 4003) return void sync(acc);
        retry++;
        retryTimer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(retry, 5)));
      };
    };
    connect();
    return () => {
      closed = true;
      if (pingTimer) clearInterval(pingTimer);
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, [token, online]);

  /* ── registry helpers ─────────────────────────────────────────────── */

  const commitRegistry = useCallback(async (next: Registry) => {
    setRegistry(next);
    await saveRegistry(next);
  }, []);

  const resetView = useCallback(() => {
    setFilter('all');
    setTab('pending');
    setQuery('');
    setEditTaskId(null);
    setSwitcherOpen(false);
  }, []);

  const finishAuth = useCallback(
    async (res: AuthResult) => {
      const { importedLocal } = await completeSignIn(res);
      setRegistry(await loadRegistry());
      if (importedLocal) showToast('Your local tasks now sync everywhere', 'success');
      await loadTour();
      resetView();
      setAddMode(false);
      setScreenRaw('dashboard');
    },
    [resetView, showToast],
  );

  const runAuth = useCallback(
    async (fn: () => Promise<AuthResult>): Promise<boolean> => {
      setBusy(true);
      try {
        await finishAuth(await fn());
        return true;
      } catch (e) {
        showToast(friendlyAuthError(e), 'error');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [finishAuth, showToast],
  );

  /* ── auth actions ─────────────────────────────────────────────────── */

  const signIn = useCallback((email: string, password: string) => runAuth(() => api.login(email.trim(), password)), [runAuth]);
  const signUp = useCallback(
    (name: string, email: string, password: string) => runAuth(() => api.signup(name.trim(), email.trim(), password)),
    [runAuth],
  );
  const signInWithGoogle = useCallback(async () => {
    const clientId = config?.googleClientId;
    if (!clientId) return;
    if (!isExtension()) {
      showToast('Google sign-in works inside the Chrome extension only.', 'error');
      return;
    }
    setBusy(true);
    try {
      // Runs in the background worker: Chrome closes this popup as soon as
      // Google's window takes focus, which would otherwise kill the flow.
      const res = (await chrome.runtime.sendMessage({ type: 'st-google-signin', clientId })) as
        | { ok: true; importedLocal: boolean }
        | { ok: false; error: string };
      if (!res?.ok) throw new Error(res?.error || 'Google sign-in failed.');
      setRegistry(await loadRegistry());
      if (res.importedLocal) showToast('Your local tasks now sync everywhere', 'success');
      await loadTour();
      resetView();
      setAddMode(false);
      setScreenRaw('dashboard');
    } catch (e) {
      showToast(friendlyAuthError(e), 'error');
    } finally {
      setBusy(false);
    }
  }, [config, resetView, showToast]);

  const startLocal = useCallback(async () => {
    const reg = await loadRegistry();
    const existing = reg.accounts.find(a => a.local);
    if (existing) {
      await commitRegistry({ ...reg, activeId: existing.uid });
    } else {
      const acc: AccountInfo = {
        uid: `local-${newId()}`,
        email: 'Stored on this device',
        name: 'Local',
        photoURL: null,
        hue: 145,
        token: null,
        local: true,
      };
      await commitRegistry({ v: 2, accounts: [...reg.accounts, acc], activeId: acc.uid });
      const cats = defaultCategoryOps();
      await mutate(acc, [...cats, ...welcomeTaskOps(cats)]);
      await storageSet(TOUR_KEY, { step: 0 });
    }
    await storageSet(ONBOARDED_KEY, true);
    await loadTour();
    resetView();
    setAddMode(false);
    setScreenRaw('dashboard');
  }, [commitRegistry, resetView]);

  const requestReset = useCallback(
    async (email: string) => {
      setBusy(true);
      try {
        await api.resetRequest(email.trim());
        return true;
      } catch (e) {
        showToast(friendlyAuthError(e), 'error');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [showToast],
  );
  const confirmReset = useCallback(
    (email: string, code: string, password: string) => runAuth(() => api.resetConfirm(email.trim(), code, password)),
    [runAuth],
  );

  const switchAccount = useCallback(
    async (target: string) => {
      const reg = await loadRegistry();
      if (reg.activeId !== target) await commitRegistry({ ...reg, activeId: target });
      await loadTour();
      resetView();
      setAddMode(false);
      setScreenRaw('dashboard');
    },
    [commitRegistry, resetView],
  );

  const removeFromDevice = useCallback(
    async (target: string) => {
      const reg = await loadRegistry();
      const remaining = reg.accounts.filter(a => a.uid !== target);
      const activeId = reg.activeId === target ? (remaining[0]?.uid ?? null) : reg.activeId;
      await commitRegistry({ v: 2, accounts: remaining, activeId });
      await purgeLocal(target);
      resetView();
      setScreenRaw(activeId ? 'dashboard' : 'login');
    },
    [commitRegistry, resetView],
  );

  const signOut = useCallback(
    async (target: string) => {
      const acc = registry.accounts.find(a => a.uid === target);
      if (acc?.token) {
        // Flush anything queued first so nothing is lost; best effort.
        await sync(acc).catch(() => {});
        api.logout(acc.token).catch(() => {});
      }
      await removeFromDevice(target);
    },
    [registry, removeFromDevice],
  );

  const deleteAccount = useCallback(async () => {
    const acc = accountRef.current;
    if (!acc) return;
    try {
      if (acc.token && !acc.local) await api.deleteAccount(acc.token);
      await removeFromDevice(acc.uid);
      showToast('Account deleted', 'success');
    } catch (e) {
      showToast(descErr(e), 'error');
    }
  }, [removeFromDevice, showToast]);

  const renameAccount = useCallback(
    async (name: string) => {
      const acc = accountRef.current;
      const n = name.trim().slice(0, 80);
      if (!acc || !n) return;
      try {
        if (acc.token && !acc.local) await api.rename(acc.token, n);
        const reg = await loadRegistry();
        await commitRegistry({ ...reg, accounts: reg.accounts.map(a => (a.uid === acc.uid ? { ...a, name: n } : a)) });
        showToast('Name updated', 'success');
      } catch (e) {
        showToast(descErr(e), 'error');
      }
    },
    [commitRegistry, showToast],
  );

  const exportData = useCallback(async () => {
    const acc = accountRef.current;
    if (!acc) return;
    const v = await readView(acc.uid);
    const blob = new Blob(
      [JSON.stringify({ exportedAt: new Date().toISOString(), account: acc.email, categories: Object.values(v.categories), tasks: Object.values(v.tasks) }, null, 2)],
      { type: 'application/json' },
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `smart-tasks-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, []);

  const syncNow = useCallback(() => {
    const acc = accountRef.current;
    if (acc && !acc.local) void sync(acc);
  }, []);

  /* ── data actions ─────────────────────────────────────────────────── */

  const write = useCallback(
    async (ops: SyncOp[]) => {
      const acc = accountRef.current;
      if (!acc) return;
      try {
        await mutate(acc, ops);
      } catch (e) {
        showToast(descErr(e), 'error');
      }
    },
    [showToast],
  );

  const createTask = useCallback<AppCtx['createTask']>(
    async input => {
      const now = Date.now();
      await write([
        {
          kind: 'task',
          id: newId(),
          op: 'upsert',
          data: {
            title: input.title.trim().slice(0, 500),
            categoryId: input.categoryId ?? null,
            priority: input.priority ?? null,
            dueAt: input.dueAt ?? null,
            order: now,
            createdAt: now,
            updatedAt: now,
          },
        },
      ]);
    },
    [write],
  );

  const updateTask = useCallback<AppCtx['updateTask']>(
    (id, patch) => write([{ kind: 'task', id, op: 'upsert', data: { ...patch, updatedAt: Date.now() } }]),
    [write],
  );

  const deleteTask = useCallback<AppCtx['deleteTask']>(
    async id => {
      const task = data.tasks[id];
      await write([{ kind: 'task', id, op: 'delete' }]);
      setEditTaskId(null);
      if (task) {
        const { id: _old, ...rest } = task;
        showToast('Task deleted', 'info', {
          label: 'Undo',
          // Deletions are final on the server, so undo restores a copy.
          run: () => void write([{ kind: 'task', id: newId(), op: 'upsert', data: { ...rest, updatedAt: Date.now() } }]),
        });
      }
    },
    [data.tasks, showToast, write],
  );

  const toggleTaskDone = useCallback<AppCtx['toggleTaskDone']>(
    async task => {
      const completing = !task.completedAt;
      await updateTask(task.id, { completedAt: completing ? Date.now() : null });
      if (completing) {
        setCelebrate(c => c + 1);
        showToast(cheer(), 'success', { label: 'Undo', run: () => void updateTask(task.id, { completedAt: null }) });
      }
    },
    [showToast, updateTask],
  );

  const clearCompleted = useCallback(async () => {
    const done = activeTasks(data).filter(t => t.completedAt);
    await write(done.map(t => ({ kind: 'task' as const, id: t.id, op: 'delete' as const })));
    showToast(`Cleared ${done.length} completed task${done.length === 1 ? '' : 's'}`, 'success');
  }, [data, showToast, write]);

  const archiveTask = useCallback<AppCtx['archiveTask']>(
    async (id, archived = true) => {
      const set = (on: boolean) => write([{ kind: 'task', id, op: 'upsert', data: { archivedAt: on ? Date.now() : null, updatedAt: Date.now() } }]);
      await set(archived);
      if (archived) setEditTaskId(null);
      showToast(archived ? 'Task archived' : 'Task restored', archived ? 'info' : 'success', { label: 'Undo', run: () => void set(!archived) });
    },
    [showToast, write],
  );

  const archiveCategory = useCallback<AppCtx['archiveCategory']>(
    async (id, archived = true) => {
      const set = (on: boolean) => write([{ kind: 'category', id, op: 'upsert', data: { archivedAt: on ? Date.now() : null } }]);
      await set(archived);
      if (archived && filter === id) setFilter('all');
      showToast(archived ? 'Category archived with its tasks' : 'Category restored', archived ? 'info' : 'success', {
        label: 'Undo',
        run: () => void set(!archived),
      });
    },
    [filter, showToast, write],
  );

  const createCategory = useCallback<AppCtx['createCategory']>(
    async input => {
      const id = newId();
      const now = Date.now();
      const order = Math.max(-1, ...Object.values(data.categories).map(c => c.order)) + 1;
      await write([{ kind: 'category', id, op: 'upsert', data: { name: input.name.trim(), color: input.color, order, createdAt: now } }]);
      showToast('Category added', 'success');
      return id;
    },
    [data.categories, showToast, write],
  );

  const updateCategory = useCallback<AppCtx['updateCategory']>(
    (id, patch) => write([{ kind: 'category', id, op: 'upsert', data: patch }]),
    [write],
  );

  const deleteCategory = useCallback<AppCtx['deleteCategory']>(
    async id => {
      await write([{ kind: 'category', id, op: 'delete' }]);
      if (filter === id) setFilter('all');
      showToast('Category deleted — its tasks are now uncategorized');
    },
    [filter, showToast, write],
  );

  /* ── derived ──────────────────────────────────────────────────────── */

  const allTasks = useMemo(() => Object.values(data.tasks).sort((a, b) => b.order - a.order), [data.tasks]);
  const isArchivedTask = useCallback(
    (t: Task) => !!t.archivedAt || !!(t.categoryId && data.categories[t.categoryId]?.archivedAt),
    [data.categories],
  );
  const tasks = useMemo(() => allTasks.filter(t => !isArchivedTask(t)), [allTasks, isArchivedTask]);
  const archivedTasks = useMemo(
    () => allTasks.filter(isArchivedTask).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)),
    [allTasks, isArchivedTask],
  );
  const sortedCategories = useMemo(
    () => Object.values(data.categories).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt),
    [data.categories],
  );
  const categories = useMemo(() => sortedCategories.filter(c => !c.archivedAt), [sortedCategories]);
  const archivedCategories = useMemo(() => sortedCategories.filter(c => !!c.archivedAt), [sortedCategories]);
  const categoryById = useCallback((id: string | null) => (id ? (data.categories[id] ?? null) : null), [data.categories]);

  const inFilter = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter(
      t =>
        (filter === 'all' || t.categoryId === filter) &&
        (!q || t.title.toLowerCase().includes(q) || t.subtasks.some(s => s.title.toLowerCase().includes(q))),
    );
  }, [tasks, filter, query]);

  const counts = useMemo(() => {
    const now = Date.now();
    return {
      total: inFilter.length,
      pending: inFilter.filter(isPending).length,
      completed: inFilter.filter(t => !!t.completedAt).length,
      doneToday: tasks.filter(t => t.completedAt && sameDay(t.completedAt, now)).length,
      dueToday: tasks.filter(t => isPending(t) && t.dueAt != null && (t.dueAt < now || sameDay(t.dueAt, now))).length,
    };
  }, [inFilter, tasks]);

  const countsByCategory = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of tasks) if (t.categoryId && isPending(t)) m[t.categoryId] = (m[t.categoryId] ?? 0) + 1;
    return m;
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    let list = inFilter;
    if (tab === 'pending') list = list.filter(isPending);
    if (tab === 'completed') list = list.filter(t => !!t.completedAt);
    const pr = { high: 0, med: 1, low: 2 } as const;
    return [...list].sort((a, b) => {
      const ac = a.completedAt ? 1 : 0;
      const bc = b.completedAt ? 1 : 0;
      if (ac !== bc) return ac - bc;
      if (ac === 1) return (b.completedAt ?? 0) - (a.completedAt ?? 0);
      const ad = a.dueAt ?? Number.MAX_SAFE_INTEGER;
      const bd = b.dueAt ?? Number.MAX_SAFE_INTEGER;
      if (ad !== bd) return ad - bd;
      const ap = a.priority ? pr[a.priority] : 3;
      const bp = b.priority ? pr[b.priority] : 3;
      if (ap !== bp) return ap - bp;
      return b.order - a.order;
    });
  }, [inFilter, tab]);

  const syncState: SyncState = !account
    ? 'synced'
    : account.local
      ? 'local'
      : !online
        ? 'offline'
        : status.state;
  const sessionExpired = !!account && !account.local && !!status.signedOut;

  /* ── ui actions ───────────────────────────────────────────────────── */

  const setScreen = useCallback((s: Screen) => setScreenRaw(s), []);
  const openEdit = useCallback((id: string) => setEditTaskId(id), []);
  const closeEdit = useCallback(() => setEditTaskId(null), []);
  const openCategoryModal = useCallback((m: CategoryModalState) => setCategoryModal(m), []);
  const closeCategoryModal = useCallback(() => setCategoryModal(null), []);
  const startAddAccount = useCallback(() => {
    setSwitcherOpen(false);
    setAddMode(true);
    setScreenRaw('login');
  }, []);
  const startTour = useCallback(() => {
    void storageSet(TOUR_KEY, { step: 0 });
    setTour(true);
  }, []);
  const finishTour = useCallback(() => {
    void storageSet(TOUR_KEY, null);
    setTour(false);
    setScreenRaw('dashboard');
  }, []);
  const cancelAddAccount = useCallback(() => {
    setAddMode(false);
    setScreenRaw('dashboard');
  }, []);

  const value: AppCtx = {
    booted,
    config,
    screen,
    setScreen,
    addMode,
    startAddAccount,
    cancelAddAccount,
    accounts: registry.accounts,
    account,
    sessionExpired,
    busy,
    signIn,
    signUp,
    signInWithGoogle,
    startLocal,
    tour,
    startTour,
    finishTour,
    requestReset,
    confirmReset,
    switchAccount,
    signOut,
    deleteAccount,
    renameAccount,
    exportData,
    syncNow,
    tasks,
    allTasks,
    archivedTasks,
    categories,
    archivedCategories,
    sync: syncState,
    lastSyncAt: status.lastSyncAt,
    filter,
    setFilter,
    tab,
    setTab,
    query,
    setQuery,
    visibleTasks,
    categoryById,
    counts,
    countsByCategory,
    createTask,
    updateTask,
    deleteTask,
    toggleTaskDone,
    clearCompleted,
    createCategory,
    updateCategory,
    deleteCategory,
    archiveTask,
    archiveCategory,
    celebrate,
    editTaskId,
    openEdit,
    closeEdit,
    switcherOpen,
    setSwitcherOpen,
    categoryModal,
    openCategoryModal,
    closeCategoryModal,
    toast,
    showToast,
    dismissToast,
    confirm,
    confirmData,
    resolveConfirm,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { ApiError };
