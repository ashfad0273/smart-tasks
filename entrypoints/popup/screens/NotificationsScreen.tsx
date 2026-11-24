import { useEffect, useRef, useState } from 'react';
import { Bell, BellRing, CheckCheck, ChevronLeft, ExternalLink, Trash2, X } from 'lucide-react';
import type { InboxItem } from '../../../lib/api';
import { onStorageChange, storageGet, storageSet } from '../../../lib/ext';
import { inboxKey } from '../../../lib/keys';
import { addDays, cx, formatTime, isSameDay } from '../../../lib/utils';
import { useApp } from '../state/AppContext';

function dayLabel(ms: number): string {
  const now = Date.now();
  if (isSameDay(ms, now)) return 'Today';
  if (isSameDay(ms, addDays(now, -1))) return 'Yesterday';
  const d = new Date(ms);
  return d.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** Every notification your AI agent sent you, newest first. Opening the screen marks them read. */
export default function NotificationsScreen() {
  const app = useApp();
  const uid = app.account && !app.account.local ? app.account.uid : null;
  const [items, setItems] = useState<InboxItem[] | null>(null);
  // Unread when the screen opened: they keep their "new" dot while you look.
  const fresh = useRef<Set<number> | null>(null);

  useEffect(() => {
    if (!uid) return setItems([]);
    const read = async () => {
      const list = await storageGet<InboxItem[]>(inboxKey(uid), []);
      fresh.current ??= new Set(list.filter(i => !i.read).map(i => i.id));
      setItems([...list].sort((a, b) => b.createdAt - a.createdAt));
      if (list.some(i => !i.read)) await storageSet(inboxKey(uid), list.map(i => ({ ...i, read: true })));
    };
    void read();
    return onStorageChange(keys => keys.includes(inboxKey(uid)) && void read());
  }, [uid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !app.confirmData && app.setScreen('dashboard');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  const save = async (next: InboxItem[]) => {
    if (!uid) return;
    setItems([...next].sort((a, b) => b.createdAt - a.createdAt));
    await storageSet(inboxKey(uid), next);
  };

  const remove = (id: number) => items && void save(items.filter(i => i.id !== id));

  const clearAll = async () => {
    const ok = await app.confirm({
      title: 'Clear all notifications?',
      message: 'They will be removed from this device.',
      confirmText: 'Clear',
      danger: true,
    });
    if (ok) void save([]);
  };

  const groups: Array<{ label: string; items: InboxItem[] }> = [];
  for (const n of items ?? []) {
    const label = dayLabel(n.createdAt);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(n);
    else groups.push({ label, items: [n] });
  }

  return (
    <div className="ambient flex h-full flex-col bg-bg">
      <header className="flex items-center justify-between px-4 py-3">
        <button onClick={() => app.setScreen('dashboard')} aria-label="Back" className="press rounded-lg p-1.5 text-mut hover:text-txt">
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-sm font-semibold">Notifications</h1>
        {items && items.length > 0 ? (
          <button
            onClick={() => void clearAll()}
            title="Clear all"
            aria-label="Clear all notifications"
            className="press rounded-lg p-1.5 text-mut hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 size={15} />
          </button>
        ) : (
          <span className="w-7" />
        )}
      </header>

      <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {items === null ? (
          <div className="space-y-2">
            <div className="skeleton h-14 rounded-2xl" />
            <div className="skeleton h-14 rounded-2xl" />
          </div>
        ) : items.length === 0 ? (
          <div className="anim-card flex flex-col items-center px-6 pt-14 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-2xl border border-white/[.06] bg-white/[.03] text-mut">
              <Bell size={18} />
            </span>
            <p className="mt-3 text-[13px] font-medium">No notifications</p>
            <p className="mt-1 text-[11.5px] text-mut">
              {uid ? 'When your AI agent pings you, it shows up here.' : 'Sign in to get notifications from your AI agent.'}
            </p>
          </div>
        ) : (
          <>
            <p className="mb-3 flex items-center gap-1.5 px-1 text-[11px] text-mut">
              <CheckCheck size={12} className="text-acc" /> {items.length} notification{items.length === 1 ? '' : 's'}, all read
            </p>
            {groups.map(g => (
              <section key={g.label} className="anim-card mb-4">
                <h2 className="mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-wider text-mut/70">{g.label}</h2>
                <ul className="space-y-1.5">
                  {g.items.map(n => {
                    const isNew = !!fresh.current?.has(n.id);
                    return (
                      <li
                        key={n.id}
                        className={cx(
                          'group flex items-start gap-2.5 rounded-xl border px-3 py-2.5',
                          isNew ? 'border-pop/25 bg-pop/[.06]' : 'border-white/[.04] bg-white/[.015]',
                        )}
                      >
                        <span className="mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border border-pop/30 bg-pop/15 text-pop">
                          <BellRing size={11} strokeWidth={2.4} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] font-medium text-txt">{n.title}</span>
                          {n.message && <span className="mt-0.5 block whitespace-pre-wrap text-[11.5px] leading-snug text-mut">{n.message}</span>}
                          <span className="mt-1 flex items-center gap-1.5 text-[10.5px] text-mut/80">
                            <span className="tabular-nums">{formatTime(n.createdAt)}</span>
                            {n.from && (
                              <>
                                <span className="text-mut/40">·</span>
                                <span className="truncate text-pop">{n.from}</span>
                              </>
                            )}
                            {n.url && (
                              <>
                                <span className="text-mut/40">·</span>
                                <a href={n.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-acc hover:underline">
                                  <ExternalLink size={9} /> Open link
                                </a>
                              </>
                            )}
                          </span>
                        </span>
                        {isNew && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-pop shadow-[0_0_8px_rgba(157,123,250,.8)]" aria-label="New" />}
                        <button
                          onClick={() => remove(n.id)}
                          aria-label={`Dismiss "${n.title}"`}
                          title="Dismiss"
                          className="press shrink-0 rounded-lg p-1 text-mut opacity-0 hover:text-txt focus:opacity-100 group-hover:opacity-100"
                        >
                          <X size={13} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
