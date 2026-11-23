import type { AuthUser, Change, SyncOp } from './types';

/**
 * API base URL, baked in at build time. Override with VITE_API_URL in `.env`
 * (see .env.example), e.g. http://localhost:8787 for `wrangler dev`.
 */
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') ||
  'https://smart-tasks-api.ashfadhossain0.workers.dev';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
  get isAuth() {
    return this.status === 401;
  }
}

async function call<T>(path: string, init: RequestInit & { token?: string | null; timeoutMs?: number } = {}): Promise<T> {
  const { token, timeoutMs = 15_000, ...rest } = init;
  const headers: Record<string, string> = { ...(rest.headers as Record<string, string>) };
  if (rest.body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(API_URL + path, { ...rest, headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ApiError(0, 'network', "Can't reach the server — check your connection.");
  }
  const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? 'http', body?.error?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export interface AuthResult {
  token: string;
  user: AuthUser;
  created?: boolean;
}

export interface ServerConfig {
  googleClientId: string | null;
  passwordReset: boolean;
}

export interface DeviceSession {
  id: string;
  device: string;
  location: string | null;
  createdAt: number;
  lastSeen: number;
  current: boolean;
  online: boolean;
}
export interface SessionsResult {
  sessions: DeviceSession[];
  agent: { hint: string; createdAt: number; lastUsed: number | null } | null;
}

const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });

export const api = {
  config: () => call<ServerConfig>('/v1/config', { timeoutMs: 5000 }),
  signup: (name: string, email: string, password: string) => call<AuthResult>('/v1/auth/signup', post({ name, email, password })),
  login: (email: string, password: string) => call<AuthResult>('/v1/auth/login', post({ email, password })),
  google: (idToken: string, nonce: string) => call<AuthResult>('/v1/auth/google', post({ idToken, nonce })),
  resetRequest: (email: string) => call<{ ok: true }>('/v1/auth/reset/request', post({ email })),
  resetConfirm: (email: string, code: string, password: string) =>
    call<AuthResult>('/v1/auth/reset/confirm', post({ email, code, password })),
  logout: (token: string) => call<{ ok: true }>('/v1/auth/logout', { method: 'POST', token }),
  me: (token: string) => call<{ user: AuthUser }>('/v1/me', { token }),
  rename: (token: string, name: string) => call<{ user: AuthUser }>('/v1/me', { method: 'PATCH', body: JSON.stringify({ name }), token }),
  deleteAccount: (token: string) => call<{ ok: true }>('/v1/me', { method: 'DELETE', token }),
  pull: (token: string, since: number) =>
    call<{ rev: number; changes: Change[]; more: boolean }>(`/v1/sync?since=${since}`, { token }),
  push: (token: string, ops: SyncOp[]) => call<{ rev: number }>('/v1/sync', { ...post({ ops }), token }),
  agentToken: (token: string) =>
    call<{ token: { hint: string; createdAt: number; lastUsed: number | null } | null }>('/v1/agent-token', { token }),
  createAgentToken: (token: string, timeZone: string) => call<{ token: string }>('/v1/agent-token', { ...post({ timeZone }), token }),
  revokeAgentToken: (token: string) => call<{ ok: true }>('/v1/agent-token', { method: 'DELETE', token }),
  sessions: (token: string) => call<SessionsResult>('/v1/sessions', { token }),
  signOutDevice: (token: string, id: string) => call<{ ok: true }>(`/v1/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', token }),
  signOutOthers: (token: string) => call<{ ok: true; signedOut: number }>('/v1/sessions?others=1', { method: 'DELETE', token }),
  wsUrl: (token: string) => `${API_URL.replace(/^http/, 'ws')}/v1/ws?token=${encodeURIComponent(token)}`,
};
