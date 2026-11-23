import { useCallback, useEffect, useState } from 'react';
import { Bot, ChevronLeft, Laptop, LogOut, Monitor, Smartphone } from 'lucide-react';
import { api, ApiError, type SessionsResult } from '../../../lib/api';
import { cx } from '../../../lib/utils';
import { useApp } from '../state/AppContext';

function ago(ms: number | null): string {
  if (!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 120) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86_400);
  return d < 30 ? `${d} day${d === 1 ? '' : 's'} ago` : new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const iconFor = (device: string) =>
  /Android|iOS/.test(device) ? Smartphone : /macOS|ChromeOS/.test(device) ? Laptop : Monitor;

/** Every browser signed in to this account, which ones are open right now, and remote sign-out. */
export default function DevicesScreen() {
  const app = useApp();
  const acc = app.account;
  const session = acc && !acc.local ? acc.token : null;
  const [data, setData] = useState<SessionsResult | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!session) return;
    try {
      setData(await api.sessions(session));
    } catch (e) {
      app.showToast(e instanceof ApiError ? e.message : 'Could not load devices.', 'error');
    }
  }, [session, app]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 20_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !app.confirmData && app.setScreen('settings');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  const signOut = async (id: string, device: string) => {
    if (!session) return;
    const ok = await app.confirm({
      title: `Sign out ${device}?`,
      message: 'That browser loses access right away. Any changes it has not synced yet stay on it until someone signs in there again.',
      confirmText: 'Sign out',
      danger: true,
    });
    if (!ok) return;
    try {
      setGone(g => new Set(g).add(id));
      await api.signOutDevice(session, id);
      app.showToast(`${device} signed out`, 'success');
      await load();
    } catch (e) {
      setGone(g => {
        const n = new Set(g);
        n.delete(id);
        return n;
      });
      app.showToast(e instanceof ApiError ? e.message : 'Could not sign out that device.', 'error');
    }
  };

  const signOutOthers = async () => {
    if (!session || !data) return;
    const n = data.sessions.filter(s => !s.current).length;
    const ok = await app.confirm({
      title: 'Sign out everywhere else?',
      message: `${n} other device${n === 1 ? '' : 's'} will be signed out right away. This one stays signed in.`,
      confirmText: 'Sign out others',
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await api.signOutOthers(session);
      app.showToast(`${r.signedOut} device${r.signedOut === 1 ? '' : 's'} signed out`, 'success');
      await load();
    } catch (e) {
      app.showToast(e instanceof ApiError ? e.message : 'Could not sign out devices.', 'error');
    }
  };

  const disconnectAgent = async () => {
    if (!session || !data?.agent) return;
    const ok = await app.confirm({
      title: 'Disconnect AI agents?',
      message: `The key ending in ${data.agent.hint} stops working right away. Your tasks are not touched.`,
      confirmText: 'Disconnect',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.revokeAgentToken(session);
      app.showToast('Agent disconnected', 'success');
      await load();
    } catch (e) {
      app.showToast(e instanceof ApiError ? e.message : 'Could not disconnect.', 'error');
    }
  };

  const list = (data?.sessions ?? []).filter(s => !gone.has(s.id));
  const others = list.filter(s => !s.current).length;
  const activeNow = list.filter(s => s.online).length;

  return (
    <div className="ambient flex h-full flex-col bg-bg">
      <header className="flex items-center justify-between px-4 py-3">
        <button onClick={() => app.setScreen('settings')} aria-label="Back" className="press rounded-lg p-1.5 text-mut hover:text-txt">
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-sm font-semibold">Devices</h1>
        <span className="w-7" />
      </header>

      <div className="hide-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-5">
        {!session ? (
          <p className="px-1 pt-2 text-center text-[12.5px] text-mut">This account lives on this device only, so there is nothing else signed in.</p>
        ) : !data ? (
          <>
            <div className="skeleton h-16 rounded-2xl" />
            <div className="skeleton h-16 rounded-2xl" />
          </>
        ) : (
          <>
            <p className="px-1 text-[12px] text-mut">
              <span className="text-txt">{list.length}</span> signed in
              <span className="mx-1.5 text-mut/50">·</span>
              <span className="text-acc">{activeNow}</span> active now
            </p>

            <section className="anim-card divide-y divide-white/[.05] rounded-2xl border border-line bg-surface">
              {list.map(s => {
                const Icon = iconFor(s.device);
                return (
                  <div key={s.id} className="flex items-center gap-3 px-3.5 py-3">
                    <span
                      className={cx(
                        'relative grid h-9 w-9 shrink-0 place-items-center rounded-xl border',
                        s.current ? 'border-acc/30 bg-acc/10 text-acc' : 'border-white/[.06] bg-white/[.03] text-mut',
                      )}
                    >
                      <Icon size={16} />
                      {s.online && (
                        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-[#22c55e]" aria-hidden="true" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                        {s.device}
                        {s.current && (
                          <span className="shrink-0 rounded-full border border-acc/30 px-1.5 text-[10px] font-semibold text-acc">This device</span>
                        )}
                      </p>
                      <p className="truncate text-[11px] text-mut">
                        {s.online ? <span className="text-[#4ade80]">Active now</span> : `Last active ${ago(s.lastSeen)}`}
                        {s.location && <> · {s.location}</>}
                      </p>
                    </div>
                    {!s.current && (
                      <button
                        onClick={() => void signOut(s.id, s.device)}
                        className="press shrink-0 rounded-full border border-white/[.06] px-2.5 py-1 text-[11.5px] font-medium text-mut hover:border-danger/40 hover:text-danger"
                      >
                        Sign out
                      </button>
                    )}
                  </div>
                );
              })}

              {data.agent && (
                <div className="flex items-center gap-3 px-3.5 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-pop/25 bg-pop/10 text-pop">
                    <Bot size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">AI agent</p>
                    <p className="truncate text-[11px] text-mut">
                      Key ends in {data.agent.hint} · used {ago(data.agent.lastUsed)}
                    </p>
                  </div>
                  <button
                    onClick={() => void disconnectAgent()}
                    className="press shrink-0 rounded-full border border-white/[.06] px-2.5 py-1 text-[11.5px] font-medium text-mut hover:border-danger/40 hover:text-danger"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </section>

            {others > 0 && (
              <button
                onClick={() => void signOutOthers()}
                className="press flex w-full items-center justify-center gap-1.5 rounded-full border border-danger/25 py-2.5 text-[12.5px] font-medium text-danger hover:bg-danger/10"
              >
                <LogOut size={13} /> Sign out all other devices
              </button>
            )}
            <p className="px-1 text-center text-[11px] text-mut/60">Active now means Smart Tasks is open there.</p>
          </>
        )}
      </div>
    </div>
  );
}
