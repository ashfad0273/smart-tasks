import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, BellRing, Bot, Check, ChevronLeft, ExternalLink, History, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { api, ApiError, type ActivityEvent, type ActivityType, type InboxItem } from '../../../lib/api';
import { storageGet, storageSet } from '../../../lib/ext';
import { inboxKey } from '../../../lib/keys';
import { addDays, cx, formatTime, isSameDay } from '../../../lib/utils';
import { useApp } from '../state/AppContext';

type Filter = 'all' | 'added' | 'completed' | 'agent';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'added', label: 'Added' },
  { id: 'completed', label: 'Done' },
  { id: 'agent', label: 'From AI' },
];

const META: Record<ActivityType, { label: string; Icon: typeof Plus; tone: string }> = {
  added: { label: 'Added', Icon: Plus, tone: 'border-white/[.07] bg-white/[.04] text-mut' },
  completed: { label: 'Completed', Icon: Check, tone: 'border-acc/25 bg-acc/10 text-acc' },
  reopened: { label: 'Reopened', Icon: RotateCcw, tone: 'border-sun/25 bg-sun/10 text-sun' },
  deleted: { label: 'Deleted', Icon: Trash2, tone: 'border-danger/25 bg-danger/10 text-danger' },
  archived: { label: 'Archived', Icon: Archive, tone: 'border-white/[.07] bg-white/[.04] text-mut' },
  restored: { label: 'Restored', Icon: ArchiveRestore, tone: 'border-acc/25 bg-acc/10 text-acc' },
  notice: { label: 'Notification', Icon: BellRing, tone: 'border-pop/30 bg-pop/15 text-pop' },
};

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

/** History of everything that happened to your tasks, plus messages from your AI agent. */
export default function ActivityScreen() {
  const app = useApp();
  const acc = app.account;
  const session = acc && !acc.local ? acc.token : null;
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  // Notifications that were unread when the screen opened keep their "new" dot while you look.
  const unreadAtOpen = useRef<Set<number> | null>(null);

  const load = useCallback(
    async (cursor = '') => {
      if (!session) return;
      try {
        const r = await api.activity(session, cursor, 60);
        setEvents(prev => (cursor && prev ? [...prev, ...r.events] : r.events));
        setNext(r.next);
      } catch (e) {
        app.showToast(e instanceof ApiError ? e.message : 'Could not load history.', 'error');
        setEvents(prev => prev ?? []);
      }
    },
    [session, app],
  );

  // Fetch history; refresh it whenever tasks change (here or on another device).
  const taskSig = app.allTasks.length + ':' + app.allTasks.reduce((m, t) => Math.max(m, t.updatedAt), 0);
  useEffect(() => {
    void load();
  }, [load, taskSig]);

  // Inbox: remember what was unread, then mark it all read (clears the toolbar badge).
  useEffect(() => {
    if (!acc || acc.local) return;
    void (async () => {
      const items = await storageGet<InboxItem[]>(inboxKey(acc.uid), []);
      unreadAtOpen.current ??= new Set(items.filter(i => !i.read).map(i => i.id));
      setInbox(items);
      if (items.some(i => !i.read)) await storageSet(inboxKey(acc.uid), items.map(i => ({ ...i, read: true })));
    })();
  }, [acc, events]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !app.editTaskId && app.setScreen('dashboard');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  // Local accounts have no server log: rebuild a simple history from task timestamps.
  const all = useMemo<ActivityEvent[]>(() => {
    if (session) return events ?? [];
    const out: ActivityEvent[] = [];
    let n = 0;
    for (const t of app.allTasks) {
      out.push({ id: ++n, at: t.createdAt, type: 'added', taskId: t.id, title: t.title, detail: null, by: 'me' });
      if (t.completedAt) out.push({ id: ++n, at: t.completedAt, type: 'completed', taskId: t.id, title: t.title, detail: null, by: 'me' });
    }
    return out.sort((a, b) => b.at - a.at);
  }, [session, events, app.allTasks]);

  const shown = all.filter(e =>
    filter === 'all' ? true : filter === 'agent' ? e.by === 'agent' : filter === 'completed' ? e.type === 'completed' : e.type === filter,
  );

  const groups: Array<{ label: string; items: ActivityEvent[] }> = [];
  for (const e of shown) {
    const label = dayLabel(e.at);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(e);
    else groups.push({ label, items: [e] });
  }

  const inboxFor = (e: ActivityEvent) =>
    e.type === 'notice' ? inbox.find(i => i.title === e.title && Math.abs(i.createdAt - e.at) < 120_000) : undefined;
  const liveTask = (id: string | null) => (id ? app.allTasks.find(t => t.id === id) : undefined);

  const counts = {
    added: all.filter(e => e.type === 'added').length,
    completed: all.filter(e => e.type === 'completed').length,
  };

  return (
    <div className="ambient flex h-full flex-col bg-bg">
      <header className="flex items-center justify-between px-4 py-3">
        <button onClick={() => app.setScreen('dashboard')} aria-label="Back" className="press rounded-lg p-1.5 text-mut hover:text-txt">
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-sm font-semibold">Activity</h1>
        <span className="w-7" />
      </header>

      <div className="flex gap-1.5 px-5 pb-3">
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={cx(
              'press rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors',
              filter === f.id ? 'border-acc/40 bg-acc/10 text-acc' : 'border-white/[.06] text-mut hover:text-txt',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {session && events === null ? (
          <div className="space-y-2">
            <div className="skeleton h-12 rounded-2xl" />
            <div className="skeleton h-12 rounded-2xl" />
            <div className="skeleton h-12 rounded-2xl" />
          </div>
        ) : groups.length === 0 ? (
          <div className="anim-card flex flex-col items-center px-6 pt-14 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-2xl border border-white/[.06] bg-white/[.03] text-mut">
              <History size={18} />
            </span>
            <p className="mt-3 text-[13px] font-medium">Nothing here yet</p>
            <p className="mt-1 text-[11.5px] text-mut">
              {filter === 'agent' ? 'Tasks and messages from your AI agent show up here.' : 'Add or finish a task and it lands here.'}
            </p>
          </div>
        ) : (
          <>
            {filter === 'all' && (
              <p className="mb-3 px-1 text-[11px] text-mut">
                <span className="text-txt">{counts.added}</span> added
                <span className="mx-1.5 text-mut/50">·</span>
                <span className="text-acc">{counts.completed}</span> completed
                {next && <span className="text-mut/60"> so far</span>}
              </p>
            )}
            {groups.map(g => (
              <section key={g.label} className="anim-card mb-4">
                <h2 className="mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-wider text-mut/70">{g.label}</h2>
                <ol className="relative space-y-0.5 before:absolute before:bottom-3 before:left-[17px] before:top-3 before:w-px before:bg-white/[.06]">
                  {g.items.map(e => {
                    const m = META[e.type];
                    const box = inboxFor(e);
                    const fresh = !!box && !!unreadAtOpen.current?.has(box.id);
                    const task = liveTask(e.taskId);
                    const body = (
                      <>
                        <span className={cx('relative z-[1] grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border', m.tone)}>
                          <m.Icon size={11} strokeWidth={2.4} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={cx(
                              'block truncate text-[12.5px]',
                              e.type === 'deleted' ? 'text-mut line-through decoration-mut/50' : 'text-txt',
                              e.type === 'notice' && 'font-medium',
                            )}
                          >
                            {e.title || 'Untitled task'}
                          </span>
                          {e.type === 'notice' && e.detail && (
                            <span className="mt-0.5 block text-[11.5px] leading-snug text-mut">{e.detail}</span>
                          )}
                          <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-mut/80">
                            <span>{e.detail === 'category' ? `Category ${m.label.toLowerCase()}` : m.label}</span>
                            <span className="text-mut/40">·</span>
                            <span className="tabular-nums">{formatTime(e.at)}</span>
                            {e.by === 'agent' && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-pop/10 px-1.5 text-pop">
                                <Bot size={9} /> AI
                              </span>
                            )}
                            {box?.url && (
                              <a
                                href={box.url}
                                target="_blank"
                                rel="noreferrer"
                                onClick={ev => ev.stopPropagation()}
                                className="inline-flex items-center gap-0.5 text-acc hover:underline"
                              >
                                <ExternalLink size={9} /> Open link
                              </a>
                            )}
                          </span>
                        </span>
                        {fresh && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-pop shadow-[0_0_8px_rgba(157,123,250,.8)]" aria-label="New" />}
                      </>
                    );
                    return (
                      <li key={`${e.id}-${e.type}`}>
                        {task ? (
                          <button
                            onClick={() => app.openEdit(task.id)}
                            className="press flex w-full items-start gap-2.5 rounded-xl px-1.5 py-1.5 text-left hover:bg-white/[.03]"
                          >
                            {body}
                          </button>
                        ) : (
                          <div className={cx('flex items-start gap-2.5 rounded-xl px-1.5 py-1.5', fresh && 'bg-pop/[.05]')}>{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
            {next && (
              <button
                disabled={loadingMore}
                onClick={async () => {
                  setLoadingMore(true);
                  await load(next);
                  setLoadingMore(false);
                }}
                className="press mx-auto block rounded-full border border-white/[.06] px-4 py-1.5 text-[11.5px] font-medium text-mut hover:text-txt disabled:opacity-50"
              >
                {loadingMore ? 'Loading...' : 'Show older'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
