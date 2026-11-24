export type Priority = 'low' | 'med' | 'high';
export type SyncState = 'synced' | 'syncing' | 'offline' | 'error' | 'local';

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  /** Source page when captured from the browser (right-click). */
  url: string | null;
  categoryId: string | null;
  priority: Priority | null;
  /** epoch ms, null = no schedule */
  dueAt: number | null;
  /** epoch ms of completion, null = pending */
  completedAt: number | null;
  /** epoch ms when archived (hidden, not deleted); null/missing = active */
  archivedAt?: number | null;
  subtasks: Subtask[];
  /** sort key (descending) */
  order: number;
  createdAt: number;
  updatedAt: number;
}

export type TaskPatch = Partial<Omit<Task, 'id' | 'createdAt'>>;

export interface Category {
  id: string;
  name: string;
  color: string;
  order: number;
  createdAt: number;
  /** epoch ms when archived; its tasks are hidden with it */
  archivedAt?: number | null;
}

export interface AuthUser {
  uid: string;
  email: string;
  name: string;
  photoURL?: string | null;
}

/** One entry per account known on this device. */
export interface AccountInfo {
  uid: string;
  email: string;
  name: string;
  photoURL?: string | null;
  hue: number;
  /** Session token for cloud accounts; null when signed out / local. */
  token: string | null;
  /** Local-only account: data never leaves this browser. */
  local: boolean;
}

export interface Registry {
  v: 2;
  accounts: AccountInfo[];
  activeId: string | null;
}

/* ── sync wire format (mirrors worker/src/model.ts) ───────────────────── */

export type Kind = 'task' | 'category';

export interface SyncOp {
  kind: Kind;
  id: string;
  op: 'upsert' | 'delete';
  data?: Record<string, unknown>;
}

export interface Change {
  kind: Kind;
  id: string;
  deleted: boolean;
  data: Record<string, unknown> | null;
}

export interface DataSet {
  rev: number;
  tasks: Record<string, Task>;
  categories: Record<string, Category>;
}

export interface SyncStatus {
  state: SyncState;
  lastSyncAt: number | null;
  error?: string;
  /** Set when the server rejected the session token. */
  signedOut?: boolean;
}
