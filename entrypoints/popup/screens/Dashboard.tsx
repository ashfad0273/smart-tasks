import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Flame, Hash, Plus, Search, Settings as SettingsIcon, Sparkles, X } from 'lucide-react';
import { cx, formatDue, parseQuickAdd, PRIORITY_META } from '../../../lib/utils';
import { useApp, type Tab } from '../state/AppContext';
import Avatar from '../components/Avatar';
import Confetti from '../components/Confetti';
import EmptyState from '../components/EmptyState';
import ProgressRing from '../components/ProgressRing';
import SyncBadge from '../components/SyncBadge';
import TaskCard from '../components/TaskCard';

function greetingFor(h: number): { text: string; emoji: string } {
  if (h < 5) return { text: 'Burning the midnight oil', emoji: '🦉' };
  if (h < 12) return { text: 'Good morning', emoji: '☀️' };
  if (h < 18) return { text: 'Good afternoon', emoji: '🌤️' };
  return { text: 'Good evening', emoji: '🌙' };
}

function Pill({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'press flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold',
        active ? 'border-transparent text-white shadow-lg' : 'border-line bg-surface text-mut hover:text-txt',
      )}
      style={active ? { background: color ?? 'linear-gradient(135deg,#22c55e,#2dd4bf)' } : undefined}
    >
      {children}
    </button>
  );
}

const HINTS = ['Try “Call mom tomorrow 6pm”', 'Try “Ship it !high #work”', 'Try “Gym tonight”', 'Try “Pay rent next week !high”'];

export default function Dashboard() {
  const app = useApp();
  const [quick, setQuick] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [shake, setShake] = useState(0);
  const [hint] = useState(() => HINTS[Math.floor(Math.random() * HINTS.length)]);
  const addRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [party, setParty] = useState(0);
  const prevPending = useRef(app.counts.pending);

  const acc = app.account;
  const firstName = (acc?.local ? '' : acc?.name || '').split(' ')[0];
  const g = greetingFor(new Date().getHours());

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
    { id: 'pending', label: 'To do', count: app.counts.pending },
    { id: 'completed', label: 'Done', count: app.counts.completed },
    { id: 'all', label: 'All', count: app.counts.total },
  ];
  const tabIndex = tabs.findIndex(t => t.id === app.tab);

  const ringTotal = app.counts.doneToday + app.counts.dueToday;
  const subtitle =
    app.counts.dueToday > 0
      ? `${app.counts.dueToday} due today${app.counts.doneToday ? ` · ${app.counts.doneToday} done 💪` : ''}`
      : app.counts.pending === 0
        ? app.tasks.length
          ? 'All caught up — enjoy it 🎉'
          : 'A fresh start ✨'
        : `${app.counts.pending} thing${app.counts.pending === 1 ? '' : 's'} on your plate`;

  const empty = app.query
    ? { emoji: '🔍', title: 'No matches', sub: `Nothing matches “${app.query}”.` }
    : app.tasks.length === 0
      ? { emoji: '🌱', title: 'Plant your first task', sub: 'Type above and hit Enter. It syncs to your other devices instantly.' }
      : app.tab === 'completed'
        ? { emoji: '🏁', title: 'Nothing finished yet', sub: 'Tick something off and it lands here.' }
        : app.tab === 'pending'
          ? { emoji: '🏖️', title: 'Inbox zero!', sub: 'Nothing left here. Go stretch, hydrate, or add something new.' }
          : { emoji: '🫥', title: 'Nothing here', sub: 'No tasks in this category yet.' };

  return (
    <div className="ambient flex h-full flex-col bg-bg">
      <Confetti fire={party} />

      <header className="flex items-center gap-3 px-4 pt-4">
        <ProgressRing done={app.counts.doneToday} total={ringTotal} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-extrabold">
            {g.text}
            {firstName ? `, ${firstName}` : ''} <span aria-hidden="true">{g.emoji}</span>
          </h1>
          <p className="mt-0.5 truncate text-xs font-semibold text-mut">{subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <SyncBadge state={app.sync} onClick={app.syncNow} />
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

      {app.sessionExpired && acc && (
        <button
          onClick={app.startAddAccount}
          className="press mx-4 mt-3 rounded-2xl border border-danger/30 bg-danger/10 px-3 py-2 text-left text-[11px] font-semibold leading-relaxed text-[#fda4af]"
        >
          🔒 Your session for {acc.email} expired. Tap to sign in again — your offline changes are kept.
        </button>
      )}
      {acc?.local && (
        <button
          onClick={() => app.setScreen('signup')}
          className="press mx-4 mt-3 flex items-center gap-2 rounded-2xl border border-pop/25 bg-pop/10 px-3 py-2 text-left text-[11px] font-semibold leading-snug text-[#c4b5fd] hover:bg-pop/15"
        >
          <Sparkles size={14} className="shrink-0" />
          <span>
            Tasks live on this device only. <span className="underline underline-offset-2">Create a free account</span> to sync
            everywhere.
          </span>
        </button>
      )}

      {/* Quick add */}
      <form onSubmit={addQuick} className="mt-3 px-4">
        <div
          key={shake}
          className={cx(
            'flex items-center gap-2 rounded-2xl border border-line bg-surface p-1.5 pl-3.5 transition-colors focus-within:border-acc/60 focus-within:shadow-[0_0_0_4px_rgba(34,197,94,.12)]',
            shake > 0 && 'anim-shake',
          )}
        >
          <input
            ref={addRef}
            value={quick}
            maxLength={500}
            onChange={e => setQuick(e.target.value)}
            placeholder="What's next? (press N)"
            aria-label="New task"
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:font-medium placeholder:text-mut/60"
          />
          <button
            type="submit"
            aria-label="Add task"
            className={cx(
              'press grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white transition-all',
              quick.trim() ? 'grad-acc glow rotate-0' : 'bg-surface2 text-mut -rotate-90',
            )}
          >
            <Plus size={18} strokeWidth={3} />
          </button>
        </div>
        <div className="mt-1.5 flex min-h-[20px] flex-wrap items-center gap-1 px-1 text-[10.5px] font-bold">
          {quick.trim() ? (
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
                <span className="text-mut/70">Enter ↵ to add · use “tomorrow 5pm”, “!high”, “#work”</span>
              )}
            </>
          ) : (
            <span className="text-mut/60">{hint}</span>
          )}
        </div>
      </form>

      {/* Category pills */}
      <div className="hide-scrollbar mt-1.5 flex items-center gap-1.5 overflow-x-auto px-4 pb-1">
        <Pill active={app.filter === 'all'} onClick={() => app.setFilter('all')}>
          ✨ Everything
        </Pill>
        {app.categories.map(c => (
          <Pill key={c.id} active={app.filter === c.id} color={c.color} onClick={() => app.setFilter(app.filter === c.id ? 'all' : c.id)}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: app.filter === c.id ? '#fff' : c.color }} />
            {c.name}
            {(app.countsByCategory[c.id] ?? 0) > 0 && <span className="opacity-70">{app.countsByCategory[c.id]}</span>}
          </Pill>
        ))}
        <button
          aria-label="Manage categories"
          title="Manage categories"
          onClick={() => app.setScreen('categories')}
          className="press shrink-0 rounded-full border border-dashed border-line p-2 text-mut hover:border-acc/50 hover:text-acc"
        >
          <Plus size={11} />
        </button>
      </div>

      {/* Tabs + search */}
      <div className="mt-2 flex items-center gap-2 px-4">
        {searchOpen ? (
          <div className="anim-pop flex flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-2.5 py-1.5 focus-within:border-acc/60">
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
            <div className="relative flex flex-1 rounded-xl bg-surface p-1" role="tablist">
              <span
                className="absolute inset-y-1 rounded-lg bg-surface2 shadow transition-transform duration-300 ease-[cubic-bezier(.2,.9,.3,1.2)]"
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
                    'relative z-10 flex-1 rounded-lg py-1.5 text-xs font-bold transition-colors',
                    app.tab === t.id ? 'text-txt' : 'text-mut hover:text-txt',
                  )}
                >
                  {t.label} <span className={app.tab === t.id ? 'text-acc' : 'text-mut/60'}>{t.count}</span>
                </button>
              ))}
            </div>
            <button
              aria-label="Search (press /)"
              title="Search (/)"
              onClick={() => setSearchOpen(true)}
              className="press rounded-xl bg-surface p-2.5 text-mut hover:text-txt"
            >
              <Search size={13} />
            </button>
          </>
        )}
      </div>

      <div className="hide-scrollbar mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-6">
        {app.visibleTasks.length === 0 ? (
          <EmptyState emoji={empty.emoji} title={empty.title} sub={empty.sub}>
            {app.tasks.length === 0 && !app.query && (
              <button
                onClick={() => addRef.current?.focus()}
                className="press grad-acc glow mt-3 rounded-full px-4 py-2 text-xs font-extrabold text-white"
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
            className="press mx-auto mt-2 block rounded-full px-3 py-1.5 text-[11px] font-bold text-mut hover:bg-surface hover:text-danger"
          >
            🧹 Clear completed
          </button>
        )}
      </div>
    </div>
  );
}
