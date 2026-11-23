import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  CircleCheckBig,
  CircleDashed,
  Flame,
  FolderOpen,
  Hash,
  Layers,
  ListPlus,
  Plus,
  Search,
  SearchX,
  Settings as SettingsIcon,
  Sparkles,
  X,
} from 'lucide-react';
import { cx, formatDue, parseQuickAdd, PRIORITY_META } from '../../../lib/utils';
import { useApp, type Tab } from '../state/AppContext';
import Avatar from '../components/Avatar';
import Confetti from '../components/Confetti';
import EmptyState from '../components/EmptyState';
import SyncBadge from '../components/SyncBadge';
import TaskCard from '../components/TaskCard';
import ScrollRow from '../components/ScrollRow';

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

export default function Dashboard() {
  const app = useApp();
  const [quick, setQuick] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [shake, setShake] = useState(0);
  const addRef = useRef<HTMLInputElement>(null);
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
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || app.editTaskId || app.confirmData) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        addRef.current?.focus();
      } else if (e.key === '/') {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app.editTaskId, app.confirmData]);

  const parsed = useMemo(() => parseQuickAdd(quick), [quick]);
  const parsedCat = parsed.categoryName
    ? (app.categories.find(c => c.name.toLowerCase().replace(/\s+/g, '') === parsed.categoryName!.toLowerCase()) ??
      app.categories.find(c => c.name.toLowerCase().startsWith(parsed.categoryName!.toLowerCase())) ??
      null)
    : null;

  const addQuick = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quick.trim()) {
      setShake(Date.now());
      addRef.current?.focus();
      return;
    }
    void app.createTask({
      title: parsed.title,
      dueAt: parsed.dueAt,
      priority: parsed.priority,
      categoryId: parsedCat?.id ?? (app.filter !== 'all' ? app.filter : null),
    });
    setQuick('');
    if (app.tab === 'completed') app.setTab('pending');
  };

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'all', label: 'All', count: app.counts.total },
    { id: 'pending', label: 'Pending', count: app.counts.pending },
    { id: 'completed', label: 'Completed', count: app.counts.completed },
  ];
  const tabIndex = tabs.findIndex(t => t.id === app.tab);

  const empty = app.query
    ? { icon: SearchX, title: 'No matches', sub: `Nothing matches “${app.query}”.` }
    : app.tasks.length === 0
      ? { icon: ListPlus, title: 'Add your first task', sub: 'Type above and hit Enter. It syncs to your other devices instantly.' }
      : app.tab === 'completed'
        ? { icon: CircleDashed, title: 'Nothing finished yet', sub: 'Tick something off and it lands here.' }
        : app.tab === 'pending'
          ? { icon: CircleCheckBig, title: 'Inbox zero', sub: 'Nothing left here. Go stretch, hydrate, or add something new.' }
          : { icon: FolderOpen, title: 'Nothing here', sub: 'No tasks in this category yet.' };

  return (
    <div className="ambient flex h-full flex-col bg-bg">
      <Confetti fire={party} />

      <header className="flex items-center gap-3 px-6 pt-6">
        <h1 className="min-w-0 flex-1 truncate text-[20px] font-medium leading-tight tracking-[-.01em]">Organize your daily targets</h1>
        <div className="flex shrink-0 items-center gap-1">
          {/* Only surface sync when something needs attention. */}
          {(app.sync === 'offline' || app.sync === 'error') && <SyncBadge state={app.sync} onClick={app.syncNow} />}
          <button
            aria-label="Switch account"
            onClick={() => app.setSwitcherOpen(true)}
            className="press rounded-full p-0.5 hover:ring-2 hover:ring-line"
          >
            {acc && <Avatar name={acc.name} email={acc.email} photoURL={acc.photoURL} hue={acc.hue} size={26} local={acc.local} />}
          </button>
          <button
            aria-label="Settings"
            onClick={() => app.setScreen('settings')}
            className="press hover-wiggle rounded-full p-1.5 text-mut hover:bg-surface hover:text-txt"
          >
            <SettingsIcon size={16} />
          </button>
        </div>
      </header>

      {app.counts.total > 0 && (
        <div className="mt-3 flex items-center gap-3 px-6" title="Tasks completed">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[.06]">
            <div
              className="grad-acc h-full rounded-full transition-[width] duration-700 ease-out"
              style={{ width: `${Math.round((app.counts.completed / app.counts.total) * 100)}%` }}
            />
          </div>
          <span className="shrink-0 text-[11.5px] tabular-nums text-mut">
            <span className="text-txt">{app.counts.completed}</span> of {app.counts.total} done
          </span>
        </div>
      )}

      {app.sessionExpired && acc && (
        <button
          onClick={app.startAddAccount}
          className="press mx-6 mt-4 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-left text-[11px] font-semibold leading-relaxed text-[#fda4af]"
        >
          Your session for {acc.email} expired. Tap to sign in again — your offline changes are kept.
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

      {/* Quick add */}
      <form onSubmit={addQuick} className="mt-6 px-6">
        <div key={shake} className={cx('flex items-stretch gap-2', shake > 0 && 'anim-shake')}>
          <input
            ref={addRef}
            value={quick}
            maxLength={500}
            onChange={e => setQuick(e.target.value)}
            placeholder="Add a new task... (press N)"
            aria-label="New task"
            className="min-w-0 flex-1 rounded-full border border-white/[.04] bg-black/20 px-4 py-2.5 text-[13.5px] outline-none transition-colors placeholder:text-mut/70 focus:border-acc/30"
          />
          <button
            type="submit"
            aria-label="Add task"
            className="press btn-acc flex shrink-0 items-center gap-1 rounded-full px-4 text-[13px] font-semibold"
          >
            <Plus size={14} strokeWidth={2.5} /> Add
          </button>
        </div>
        {quick.trim() && (
        <div className="anim-pop mt-2 flex flex-wrap items-center gap-1 px-3 text-[11px] font-medium">
          {(
            <>
              {parsed.dueAt && (
                <span className="anim-pop inline-flex items-center gap-1 rounded-full bg-sun/15 px-2 py-0.5 text-sun">
                  <CalendarClock size={10} /> {formatDue(parsed.dueAt).label}
                </span>
              )}
              {parsed.priority && (
                <span
                  className="anim-pop inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                  style={{ background: `${PRIORITY_META[parsed.priority].color}26`, color: PRIORITY_META[parsed.priority].color }}
                >
                  <Flame size={10} /> {PRIORITY_META[parsed.priority].label}
                </span>
              )}
              {parsed.categoryName && (
                <span
                  className="anim-pop inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                  style={parsedCat ? { background: `${parsedCat.color}26`, color: parsedCat.color } : undefined}
                >
                  <Hash size={10} /> {parsedCat ? parsedCat.name : `${parsed.categoryName}?`}
                </span>
              )}
              {!parsed.dueAt && !parsed.priority && !parsed.categoryName && (
                <span className="text-mut/70">Enter to add · try tomorrow 5pm, !high, #work</span>
              )}
            </>
          )}
        </div>
        )}
      </form>

      {/* Category pills */}
      <div className="mt-4 flex items-center">
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

      <div className="hide-scrollbar mt-5 min-h-0 flex-1 space-y-2.5 overflow-y-auto px-6 pb-6">
        {app.visibleTasks.length === 0 ? (
          <EmptyState icon={empty.icon} title={empty.title} sub={empty.sub}>
            {app.tasks.length === 0 && !app.query && (
              <button
                onClick={() => addRef.current?.focus()}
                className="press btn-acc mt-3 rounded-full px-4 py-2 text-xs font-semibold"
              >
                Add a task
              </button>
            )}
          </EmptyState>
        ) : (
          app.visibleTasks.map((t, i) => <TaskCard key={t.id} task={t} index={i} />)
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
    </div>
  );
}
