import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleCheckBig,
  CircleDashed,
  Flame,
  FolderOpen,
  Layers,
  ListPlus,
  Plus,
  Search,
  SearchX,
  Settings as SettingsIcon,
  Sparkles,
  X,
} from 'lucide-react';
import { cx, startOfDay } from '../../../lib/utils';
import { useApp, type Tab } from '../state/AppContext';
import Confetti from '../components/Confetti';
import EmptyState from '../components/EmptyState';
import SyncBadge from '../components/SyncBadge';
import TaskCard from '../components/TaskCard';
import ScrollRow from '../components/ScrollRow';
import QuickAdd from '../components/QuickAdd';
import type { Task } from '../../../lib/types';

function Pill({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'press flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold',
        active ? '' : 'border-white/[.05] bg-black/15 text-mut hover:text-txt',
      )}
      style={
        active
          ? { background: `${color ?? '#3fd1c5'}1f`, color: color ?? '#3fd1c5', borderColor: `${color ?? '#3fd1c5'}33` }
          : undefined
      }
    >
      {children}
    </button>
  );
}

type Section = { key: string; label: string; tone: string; tasks: Task[] };

/** Splits the (already due-sorted) list into friendly buckets. */
function sectionize(list: Task[]): Section[] {
  const today = startOfDay(Date.now()).getTime();
  const D = 86_400_000;
  const now = Date.now();
  const meta: Record<string, [string, string]> = {
    overdue: ['Overdue', '#f43f5e'],
    today: ['Today', '#3fd1c5'],
    tomorrow: ['Tomorrow', '#9d7bfa'],
    week: ['This week', '#60a5fa'],
    later: ['Later', '#94a3b8'],
    anytime: ['Anytime', '#798a8e'],
    done: ['Done', '#22c55e'],
  };
  const bucket = (t: Task) => {
    if (t.completedAt) return 'done';
    if (t.dueAt == null) return 'anytime';
    if (t.dueAt < now) return 'overdue';
    if (t.dueAt < today + D) return 'today';
    if (t.dueAt < today + 2 * D) return 'tomorrow';
    if (t.dueAt < today + 7 * D) return 'week';
    return 'later';
  };
  const out: Section[] = [];
  for (const t of list) {
    const k = bucket(t);
    const last = out[out.length - 1];
    if (last?.key === k) last.tasks.push(t);
    else out.push({ key: k, label: meta[k][0], tone: meta[k][1], tasks: [t] });
  }
  return out;
}

/** Days in a row (ending today or yesterday) with at least one task finished. */
function streakOf(tasks: Task[]): number {
  const days = new Set(tasks.filter(t => t.completedAt).map(t => startOfDay(t.completedAt!).getTime()));
  const D = 86_400_000;
  let day = startOfDay(Date.now()).getTime();
  if (!days.has(day)) day -= D;
  let n = 0;
  while (days.has(day)) {
    n++;
    day -= D;
  }
  return n;
}

export default function Dashboard() {
  const app = useApp();
  const [adding, setAdding] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [party, setParty] = useState(0);
  const prevPending = useRef(app.counts.pending);

  const acc = app.account;

  // Confetti when the last pending task gets checked off.
  useEffect(() => {
    if (prevPending.current > 0 && app.counts.pending === 0 && app.counts.completed > 0 && app.tab !== 'completed') {
      setParty(Date.now());
    }
    prevPending.current = app.counts.pending;
  }, [app.counts.pending, app.counts.completed, app.tab]);

  // Keyboard shortcuts: N = new task, / = search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || app.editTaskId || app.confirmData || adding) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setAdding(true);
      } else if (e.key === '/') {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app.editTaskId, app.confirmData, adding]);

  const sections = useMemo(() => sectionize(app.visibleTasks), [app.visibleTasks]);
  const streak = useMemo(() => streakOf(app.tasks), [app.tasks]);
  const doneToday = useMemo(() => {
    const t0 = startOfDay(Date.now()).getTime();
    return app.tasks.filter(t => (t.completedAt ?? 0) >= t0).length;
  }, [app.tasks]);
  const pct = app.counts.total ? Math.round((app.counts.completed / app.counts.total) * 100) : 0;

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'all', label: 'All', count: app.counts.total },
    { id: 'pending', label: 'Pending', count: app.counts.pending },
    { id: 'completed', label: 'Completed', count: app.counts.completed },
  ];
  const tabIndex = tabs.findIndex(t => t.id === app.tab);

  const empty = app.query
    ? { icon: SearchX, title: 'No matches', sub: `Nothing matches “${app.query}”.` }
    : app.tasks.length === 0
      ? { icon: ListPlus, title: 'Add your first task', sub: 'Tap the plus button, or press N.' }
      : app.tab === 'completed'
        ? { icon: CircleDashed, title: 'Nothing finished yet', sub: 'Tick something off and it lands here.' }
        : app.tab === 'pending'
          ? { icon: CircleCheckBig, title: 'Inbox zero', sub: 'Nothing left here. Go stretch, hydrate, or add something new.' }
          : { icon: FolderOpen, title: 'Nothing here', sub: 'No tasks in this category yet.' };

  return (
    <div className="ambient relative flex h-full flex-col bg-bg">
      <Confetti fire={party} />

      <header className="flex items-center gap-3 px-6 pt-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[15px] font-medium tabular-nums">
              <span key={app.counts.completed} className="anim-tick inline-block text-acc">
                {app.counts.completed}
              </span>{' '}
              <span className="text-mut">of {app.counts.total} done</span>
            </p>
            <span className="truncate text-[11px] text-mut">
              {app.counts.total === 0
                ? 'Fresh start'
                : pct === 100
                  ? 'All clear, nice work'
                  : doneToday > 0
                    ? `${doneToday} finished today`
                    : `${app.counts.pending} to go`}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.06]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Tasks done">
            <div
              className={cx('grad-acc h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out)]', pct === 100 && 'glow')}
              style={{ width: `${Math.max(pct, app.counts.total ? 2 : 0)}%` }}
            />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {streak >= 2 && (
            <span
              title={`${streak}-day streak: you finished something ${streak} days in a row`}
              className="anim-pop flex items-center gap-1 rounded-full border border-warn/25 bg-warn/10 px-2 py-1 text-[11px] font-semibold tabular-nums text-warn"
            >
              <Flame size={12} /> {streak}
            </span>
          )}
          {/* Only surface sync when something needs attention. */}
          {(app.sync === 'offline' || app.sync === 'error') && <SyncBadge state={app.sync} onClick={app.syncNow} />}
          <button
            aria-label="Settings"
            onClick={() => app.setScreen('settings')}
            className="press hover-wiggle rounded-full p-1.5 text-mut hover:bg-surface hover:text-txt"
          >
            <SettingsIcon size={16} />
          </button>
        </div>
      </header>

      {app.sessionExpired && acc && (
        <button
          onClick={app.startAddAccount}
          className="press mx-6 mt-4 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-left text-[11px] font-semibold leading-relaxed text-[#fda4af]"
        >
          {acc.email} was signed out on this device. Tap to sign in again; your offline changes are kept.
        </button>
      )}
      {acc?.local && (
        <button
          onClick={() => app.setScreen('signup')}
          className="press mx-6 mt-4 flex items-center gap-2.5 rounded-xl border border-pop/25 bg-pop/10 px-3.5 py-2.5 text-left text-[11.5px] font-semibold leading-snug text-[#c4b5fd] hover:bg-pop/15"
        >
          <Sparkles size={14} className="shrink-0" />
          <span>
            Tasks live on this device only. <span className="underline underline-offset-2">Create a free account</span> to sync
            everywhere.
          </span>
        </button>
      )}

      {/* Category pills */}
      <div className="mt-5 flex items-center">
      <div className="min-w-0 flex-1">
      <ScrollRow className="gap-2 px-6 py-0.5">
        <Pill active={app.filter === 'all'} onClick={() => app.setFilter('all')}>
          <Layers size={12} /> Everything
        </Pill>
        {app.categories.map(c => (
          <Pill key={c.id} active={app.filter === c.id} color={c.color} onClick={() => app.setFilter(app.filter === c.id ? 'all' : c.id)}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
            {c.name}
            {(app.countsByCategory[c.id] ?? 0) > 0 && <span className="opacity-70">{app.countsByCategory[c.id]}</span>}
          </Pill>
        ))}
      </ScrollRow>
      </div>
      </div>

      {/* Tabs + search */}
      <div className="mt-5 flex items-center gap-2 px-6">
        {searchOpen ? (
          <div className="anim-pop flex flex-1 items-center gap-2 rounded-full border border-white/[.04] bg-black/20 px-3.5 py-2 focus-within:border-acc/30">
            <Search size={13} className="text-mut" />
            <input
              ref={searchRef}
              autoFocus
              value={app.query}
              onChange={e => app.setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  app.setQuery('');
                  setSearchOpen(false);
                }
              }}
              placeholder="Search tasks…"
              aria-label="Search tasks"
              className="min-w-0 flex-1 bg-transparent text-xs font-semibold outline-none placeholder:text-mut/60"
            />
            <button
              aria-label="Close search"
              onClick={() => {
                app.setQuery('');
                setSearchOpen(false);
              }}
              className="press text-mut hover:text-txt"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <>
            <div className="relative isolate flex flex-1 rounded-full border border-white/[.02] bg-black/15 p-1" role="tablist">
              <span
                className="absolute inset-y-1 left-1 rounded-full bg-white/[.04] transition-transform duration-300 ease-[var(--ease-out)]"
                style={{ width: `calc((100% - 8px) / 3)`, transform: `translateX(${tabIndex * 100}%)` }}
                aria-hidden="true"
              />
              {tabs.map(t => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={app.tab === t.id}
                  onClick={() => app.setTab(t.id)}
                  className={cx(
                    'relative z-10 flex-1 rounded-full py-2 text-[12.5px] font-medium transition-colors',
                    app.tab === t.id ? 'text-acc' : 'text-mut hover:text-txt',
                  )}
                >
                  {t.label} <span className={app.tab === t.id ? 'text-acc/70' : 'text-mut/50'}>{t.count}</span>
                </button>
              ))}
            </div>
            <button
              aria-label="Search (press /)"
              title="Search (/)"
              onClick={() => setSearchOpen(true)}
              className="press rounded-full border border-white/[.02] bg-black/15 p-3 text-mut hover:text-acc"
            >
              <Search size={13} />
            </button>
          </>
        )}
      </div>

      <div className="hide-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto px-6 pb-24">
        {app.visibleTasks.length === 0 ? (
          <EmptyState icon={empty.icon} title={empty.title} sub={empty.sub}>
            {app.tasks.length === 0 && !app.query && (
              <button
                onClick={() => setAdding(true)}
                className="press btn-acc mt-3 rounded-full px-4 py-2 text-xs font-semibold"
              >
                Add a task
              </button>
            )}
          </EmptyState>
        ) : (
          sections.map((sec, si) => (
            <section key={sec.key} className={si > 0 ? 'mt-5' : ''} aria-label={sec.label}>
              {(sections.length > 1 || sec.key !== 'anytime') && (
                <h2 className="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: sec.tone }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: sec.tone }} />
                  {sec.label}
                  <span className="font-medium text-mut/60">{sec.tasks.length}</span>
                  <span className="h-px flex-1" style={{ background: `${sec.tone}26` }} />
                </h2>
              )}
              <div className="space-y-2.5">
                {sec.tasks.map((t, i) => (
                  <TaskCard key={t.id} task={t} index={si * 2 + i} />
                ))}
              </div>
            </section>
          ))
        )}
        {app.tab === 'completed' && app.counts.completed > 0 && (
          <button
            onClick={async () => {
              const ok = await app.confirm({
                title: 'Clear completed tasks?',
                message: `${app.counts.completed} completed task${app.counts.completed === 1 ? '' : 's'} will be deleted on all your devices.`,
                confirmText: 'Clear them',
                danger: true,
              });
              if (ok) void app.clearCompleted();
            }}
            className="press mx-auto mt-2 block rounded-full px-3 py-1.5 text-[11px] font-semibold text-mut hover:bg-surface hover:text-danger"
          >
            Clear completed
          </button>
        )}
      </div>

      <QuickAdd open={adding} onClose={() => setAdding(false)} />
      <button
        onClick={() => setAdding(a => !a)}
        aria-label={adding ? 'Close new task' : 'New task (N)'}
        title={adding ? 'Close' : 'New task (N)'}
        className="press glow grad-acc absolute bottom-5 right-5 z-40 grid h-12 w-12 place-items-center rounded-full text-[#0b1a1c] shadow-[0_10px_30px_-6px_rgba(63,209,197,.6)] hover:brightness-110"
      >
        <Plus
          size={22}
          strokeWidth={2.6}
          className="transition-transform duration-300 ease-[var(--ease-out)]"
          style={{ transform: adding ? 'rotate(45deg)' : 'none' }}
        />
      </button>
    </div>
  );
}
