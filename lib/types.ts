export type Priority = 'low' | 'med' | 'high';
export type SyncState = 'synced' | 'syncing' | 'offline' | 'error' | 'local';

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
  /** Set by an agent when this step is one specific thing it can do once you OK it. */
  approval?: Approval | null;
  /** This step's hand-off to an agent (one open request at a time). */
  aiRequest?: AiRequest | null;
}

/** What an agent proposes to do when you press OK. No approval = no button. */
export interface Approval {
  /** The exact thing the agent will do. */
  action: string;
  /** For decisions: one button per choice; the picked text is sent as your answer. */
  choices?: string[];
  /** Irreversible (delete, upload, replace, send): ask once more before sending. */
  confirm?: boolean;
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
  /** Set when an AI agent created the task: its key name and (if it said) its session id. */
  source?: TaskSource | null;
  /** What an agent proposes for the task itself (used when it has no subtasks). */
  approval?: Approval | null;
  /** "OK, send to AI" hand-off: approved by you, then claimed and finished by an agent. */
  aiRequest?: AiRequest | null;
  /** sort key (descending) */
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface TaskSource {
  agent: string;
  session: string | null;
  /** Where the work lives (e.g. repo folder + template); requests never cross scopes. */
  scope?: string | null;
}

export interface AiRequest {
  /** Unique per send; repeats of the same send are ignored by the server. Missing on old requests. */
  id?: string;
  /** approved = sent and waiting; returned = the agent handed it back (see note); cancelled = you took it back. */
  status: 'approved' | 'claimed' | 'done' | 'returned' | 'cancelled';
  /** epoch ms of the last status change */
  at: number;
  /** agent key name that claimed or finished it */
  by: string | null;
  session: string | null;
  /** what the agent reported when it finished */
  note: string | null;
  /** your custom answer sent along with the OK (null = plain OK) */
  reply?: string | null;
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
