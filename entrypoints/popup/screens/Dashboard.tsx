import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleCheckBig,
  CircleDashed,
  Flame,
  FolderOpen,
  History,
  Bell,
  Layers,
  ListPlus,
  Plus,
  Search,
  SearchX,
  Settings as SettingsIcon,
  Sparkles,
  ArrowUpCircle,
  ArrowDownUp,
  Check,
  X,
  Archive,
  Trash2,
  FolderInput,
  CheckCheck,
} from 'lucide-react';
import { cx, startOfDay } from '../../../lib/utils';
import { onStorageChange, storageGet, storageSet } from '../../../lib/ext';
import { inboxKey, OPEN_SCREEN_KEY, UPDATE_KEY } from '../../../lib/keys';
import { newer, type UpdateInfo } from '../../../lib/updater';
import type { InboxItem } from '../../../lib/api';
import { useApp, type SortBy, type Tab } from '../state/AppContext';
import Confetti from '../components/Confetti';
import EmptyState from '../components/EmptyState';
import SyncBadge from '../components/SyncBadge';
import TaskCard, { TASK_DRAG_TYPE } from '../components/TaskCard';
import ScrollRow from '../components/ScrollRow';
import QuickAdd from '../components/QuickAdd';
import { useWide } from '../hooks/useWide';
import { useMarquee } from '../hooks/useMarquee';
import type { Task } from '../../../lib/types';

function Pill({
  active,
  onClick,
  children,
  color,
  onDropTasks,
  dropLabel,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
  /** Makes the pill a drop target for dragged tasks. */
  onDropTasks?: (ids: string[]) => void;
  dropLabel?: string;
}) {
  const [over, setOver] = useState(false);
  const accepts = (e: React.DragEvent) => !!onDropTasks && e.dataTransfer.types.includes(TASK_DRAG_TYPE);
  const c = color ?? '#3fd1c5';
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={dropLabel}
      onDragEnter={e => accepts(e) && (e.preventDefault(), setOver(true))}
      onDragOver={e => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        setOver(false);
        if (!accepts(e)) return;
        e.preventDefault();
        try {
          const ids = JSON.parse(e.dataTransfer.getData(TASK_DRAG_TYPE));
          if (Array.isArray(ids) && ids.length) onDropTasks!(ids.map(String));
        } catch {
          /* not ours */
        }
      }}
      className={cx(
        'press flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-[transform,box-shadow]',
        active || over ? '' : 'border-white/[.05] bg-black/15 text-mut hover:text-txt',
        over && 'scale-[1.06]',
      )}
      style={
        active || over
          ? {
              background: `${c}${over ? '33' : '1f'}`,
              color: c,
              borderColor: `${c}${over ? '99' : '33'}`,
              boxShadow: over ? `0 0 0 3px ${c}26` : undefined,
            }
          : undefined
      }
    >
      {children}
    </button>
  );
}

type Section = { key: string; label: string; tone: string; tasks: Task[] };

const SORTS: Array<{ id: SortBy; label: string; sub: string }> = [
  { id: 'due', label: 'Due date', sub: 'Overdue, today, tomorrow...' },
  { id: 'updated', label: 'Last updated', sub: 'Recently edited first' },
  { id: 'added', label: 'Newest', sub: 'Recently added first' },
  { id: 'priority', label: 'Priority', sub: 'High, medium, low' },
];

/** Splits the (already sorted) list into friendly buckets for the chosen order. */
function sectionize(list: Task[], sortBy: SortBy): Section[] {
  if (sortBy !== 'due') {
    const pmeta: Record<string, [string, string]> = {
      high: ['High priority', '#ef4444'],
      med: ['Medium priority', '#f59e0b'],
      low: ['Low priority', '#22c55e'],
      none: ['No priority', '#798a8e'],
      updated: ['Last updated', '#3fd1c5'],
      added: ['Newest first', '#3fd1c5'],
      done: ['Done', '#22c55e'],
    };
    const key = (t: Task) => (t.completedAt ? 'done' : sortBy === 'priority' ? (t.priority ?? 'none') : sortBy);
    const out: Section[] = [];
    for (const t of list) {
      const k = key(t);
      const last = out[out.length - 1];
      if (last?.key === k) last.tasks.push(t);
      else out.push({ key: k, label: pmeta[k][0], tone: pmeta[k][1], tasks: [t] });
    }
    return out;
  }
  return sectionizeByDue(list);
}

function sectionizeByDue(list: Task[]): Section[] {
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
export function streakOf(tasks: Task[]): number {
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
  const wide = useWide();
  const [adding, setAdding] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  // Drag a box over tasks from empty space to select them, like a file manager.
  const marquee = useMarquee({ selected: app.selected, setSelected: app.setSelected, clear: app.clearSelection });
  useEffect(() => {
    if (!sortOpen) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== 'Escape') return;
        e.stopPropagation(); // Escape closes the menu, not the popup screen
      } else if (sortRef.current?.contains(e.target as Node)) return;
      setSortOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
    };
  }, [sortOpen]);
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
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || (app.editTaskId && !wide) || app.confirmData || adding) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        app.setSelected(app.visibleTasks.map(x => x.id));
      } else if (e.key === 'Escape' && app.selected.length) {
        e.preventDefault();
        app.clearSelection();
      } else if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setAdding(true);
      } else if (e.key === '/') {
        e.preventDefault();
        if (wide) {
          window.dispatchEvent(new Event('st-focus-search'));
          return;
        }
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app, adding, wide]);

  // Unread AI notifications for the bell; a notification click can ask to land on Activity.
  const [unread, setUnread] = useState(0);
  const uid = acc && !acc.local ? acc.uid : null;
  useEffect(() => {
    if (!uid) return setUnread(0);
    const read = async () => setUnread((await storageGet<InboxItem[]>(inboxKey(uid), [])).filter(i => !i.read).length);
    void read();
    void storageGet<string | null>(OPEN_SCREEN_KEY, null).then(s => {
      if (s !== 'notifications' && s !== 'activity') return;
      void storageSet(OPEN_SCREEN_KEY, null);
      app.setScreen('notifications');
    });
    return onStorageChange(keys => keys.includes(inboxKey(uid)) && void read());
  }, [uid, app]);

  // A newer downloaded build is available (unpacked installs update themselves).
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  useEffect(() => {
    const ext = globalThis.chrome?.runtime;
    if (!ext?.getManifest) return;
    const read = async () => {
      const info = await storageGet<UpdateInfo | null>(UPDATE_KEY, null);
      setUpdate(info && newer(info.version, ext.getManifest().version) ? info : null);
    };
    void read();
    ext.sendMessage?.({ type: 'st-check-update' })?.catch(() => {});
    return onStorageChange(keys => keys.includes(UPDATE_KEY) && void read());
  }, []);

  const sections = useMemo(() => sectionize(app.visibleTasks, app.sortBy), [app.visibleTasks, app.sortBy]);
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

  const sortMenu = (
            <div ref={sortRef} className="relative">
              <button
                aria-label={`Sort: ${SORTS.find(s => s.id === app.sortBy)?.label}`}
                title={`Sort: ${SORTS.find(s => s.id === app.sortBy)?.label}`}
                aria-haspopup="menu"
                aria-expanded={sortOpen}
                onClick={() => setSortOpen(o => !o)}
                className={cx(
                  'press flex items-center gap-1.5 whitespace-nowrap rounded-full border hover:text-acc',
                  wide ? 'px-3 py-1.5 text-[11.5px] font-semibold @max-[600px]:px-2' : 'p-3',
                  app.sortBy !== 'due' ? 'border-acc/30 bg-acc/10 text-acc' : 'border-white/[.02] bg-black/15 text-mut',
                )}
              >
                <ArrowDownUp size={13} />
                {wide && <span className="@max-[600px]:hidden">Sort: {SORTS.find(s => s.id === app.sortBy)?.label}</span>}
              </button>
              {sortOpen && (
                <div
                  role="menu"
                  className="anim-pop absolute right-0 top-full z-30 mt-2 w-52 origin-top-right rounded-2xl border border-white/[.06] bg-surface p-1.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,.7)]"
                >
                  <p className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-mut/70">Sort by</p>
                  {SORTS.map(s => (
                    <button
                      key={s.id}
                      role="menuitemradio"
                      aria-checked={app.sortBy === s.id}
                      onClick={() => {
                        app.setSortBy(s.id);
                        setSortOpen(false);
                      }}
                      className={cx(
                        'press flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-white/[.04]',
                        app.sortBy === s.id && 'bg-acc/[.07]',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className={cx('block text-[12.5px] font-medium', app.sortBy === s.id ? 'text-acc' : 'text-txt')}>{s.label}</span>
                        <span className="block text-[10.5px] text-mut">{s.sub}</span>
                      </span>
                      {app.sortBy === s.id && <Check size={13} className="shrink-0 text-acc" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
  );

  return (
    <div className={cx('ambient relative flex h-full flex-col bg-bg', wide && 'st-wide')}>
      <Confetti fire={party} />

      {wide ? (
        <WideHeader
          sortMenu={sortMenu}
          streak={streak}
          doneToday={doneToday}
          pct={pct}
          tabs={tabs}
          onAdd={() => setAdding(true)}
        />
      ) : (
      <header className="flex items-center gap-3 px-6 pt-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[12.5px] font-semibold tabular-nums tracking-tight">
              <span key={app.counts.completed} className="anim-tick inline-block text-acc">
                {app.counts.completed}
              </span>
              <span className="text-mut/60">/{app.counts.total}</span>
              <span className="ml-1 font-medium text-mut">done</span>
            </p>
            <span className="truncate text-[10.5px] font-medium tracking-wide text-mut/70">
              {app.counts.total === 0
                ? 'Fresh start'
                : pct === 100
                  ? 'All clear, nice work'
                  : doneToday > 0
                    ? `${doneToday} finished today`
                    : `${app.counts.pending} to go`}
            </span>
          </div>
          <div className="mt-1.5 h-[3px] rounded-full bg-white/[.05]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Tasks done">
            {pct > 0 && (
              <div
                className="meter-fill h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out)]"
                style={{ width: `${Math.max(pct, 3)}%` }}
              />
            )}
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
            aria-label="History"
            title="History"
            onClick={() => app.setScreen('activity')}
            className="press rounded-full p-1.5 text-mut hover:bg-surface hover:text-txt"
          >
            <History size={16} />
          </button>
          <button
            aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}
            title="Notifications"
            onClick={() => app.setScreen('notifications')}
            className={cx('press relative rounded-full p-1.5 hover:bg-surface hover:text-txt', unread ? 'text-pop' : 'text-mut')}
          >
            <Bell size={16} />
            {unread > 0 && (
              <span className="anim-pop absolute -right-0.5 -top-0.5 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-pop px-1 text-[9.5px] font-bold leading-none text-white shadow-[0_0_10px_rgba(157,123,250,.7)]">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
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
      )}

      {update && (
        <button
          onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('update.html?go=1') })}
          className="press anim-pop mx-6 mt-4 flex items-center gap-2.5 rounded-xl border border-acc/25 bg-acc/[.08] px-3.5 py-2.5 text-left hover:bg-acc/[.12]"
        >
          <ArrowUpCircle size={15} className="shrink-0 text-acc" />
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-semibold text-txt">Version {update.version} is ready</span>
            {update.notes[0] && <span className="block truncate text-[11px] text-mut">{update.notes[0]}</span>}
          </span>
          <span className="shrink-0 rounded-full bg-acc/15 px-2.5 py-1 text-[11px] font-semibold text-acc">Update</span>
        </button>
      )}
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

      {/* Category pills (the wide desktop layout has them in the sidebar) */}
      {!wide && (
      <div className="mt-5 flex items-center">
      <div className="min-w-0 flex-1">
      <ScrollRow className="gap-2 px-6 py-0.5">
        <Pill
          active={app.filter === 'all'}
          onClick={() => app.setFilter('all')}
          onDropTasks={ids => void app.moveTasks(ids, null).then(app.clearSelection)}
          dropLabel="Drop tasks here to remove their category"
        >
          <Layers size={12} /> Everything
        </Pill>
        {app.categories.map(c => (
          <Pill
            key={c.id}
            active={app.filter === c.id}
            color={c.color}
            onClick={() => app.setFilter(app.filter === c.id ? 'all' : c.id)}
            onDropTasks={ids => void app.moveTasks(ids, c.id).then(app.clearSelection)}
            dropLabel={`Drop tasks here to move them to ${c.name}`}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
            {c.name}
            {(app.countsByCategory[c.id] ?? 0) > 0 && <span className="opacity-70">{app.countsByCategory[c.id]}</span>}
          </Pill>
        ))}
      </ScrollRow>
      </div>
      </div>

      )}

      {/* Tabs + search */}
      {!wide && (
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
            {sortMenu}
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

      )}

      <div
        ref={marquee.ref}
        onPointerDown={marquee.onPointerDown}
        className={cx('hide-scrollbar relative min-h-0 flex-1 overflow-y-auto px-6 pb-24', wide ? 'mt-3' : 'mt-4')}
      >
        {marquee.box && (
          <div
            aria-hidden
            className="pointer-events-none absolute z-20 rounded-[3px] border border-acc/70 bg-acc/[.12]"
            style={marquee.box}
          />
        )}
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
            <section
              key={sec.key}
              className="anim-pop transition-[margin] duration-300 ease-[var(--ease-out)]"
              style={{ marginTop: si > 0 ? 20 : 0 }}
              aria-label={sec.label}
            >
              {/* Always rendered so it can fold in/out when switching tabs instead of popping. */}
              <div className="expander" data-open={sections.length > 1 || sec.key !== 'anytime'}>
                <div>
                <h2 className="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: sec.tone }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: sec.tone }} />
                  {sec.label}
                  <span className="font-medium tabular-nums text-mut/60">{sec.tasks.length}</span>
                  <span className="h-px flex-1" style={{ background: `${sec.tone}26` }} />
                </h2>
                </div>
              </div>
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
      {app.selected.length > 0 && <SelectionBar />}
      <button
        hidden={app.selected.length > 0 || wide}
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

/** Bulk actions for the multi-selection (Cmd/Ctrl-click, Shift-click, Cmd/Ctrl+A). */
function SelectionBar() {
  const app = useApp();
  const ids = app.selected;
  const n = ids.length;
  const [moveOpen, setMoveOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const allDone = ids.every(id => app.tasks.find(t => t.id === id)?.completedAt);
  const allVisible = n >= app.visibleTasks.length;

  useEffect(() => {
    if (!moveOpen) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setMoveOpen(false);
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [moveOpen]);

  const done = (p: Promise<void>) => void p.then(app.clearSelection);

  const del = async () => {
    const ok = await app.confirm({
      title: `Delete ${n} task${n === 1 ? '' : 's'}?`,
      message: 'They will be removed on all your devices.',
      confirmText: 'Delete',
      danger: true,
    });
    if (ok) done(app.deleteTasks(ids));
  };

  const btn = 'press inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11.5px] font-semibold text-txt/90 hover:bg-white/[.07]';

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={`${n} selected`}
      className="st-selbar anim-card absolute inset-x-4 bottom-5 z-40 flex items-center gap-0.5 rounded-2xl border border-white/[.08] bg-[#151a20]/95 p-1.5 pl-3 shadow-[0_16px_40px_-10px_rgba(0,0,0,.7)] backdrop-blur"
    >
      <span className="mr-auto whitespace-nowrap text-[12px] font-semibold tabular-nums text-acc">{n} selected</span>
      {!allVisible && (
        <button onClick={() => app.setSelected(app.visibleTasks.map(t => t.id))} className={cx(btn, 'text-mut')} title="Select all (Cmd/Ctrl+A)">
          All
        </button>
      )}
      <button onClick={() => done(app.completeTasks(ids, !allDone))} className={btn} title={allDone ? 'Mark as not done' : 'Mark as done'}>
        <CheckCheck size={13} /> {allDone ? 'Undo' : 'Done'}
      </button>
      <div className="relative">
        <button onClick={() => setMoveOpen(o => !o)} className={btn} aria-expanded={moveOpen} title="Move to category">
          <FolderInput size={13} /> Move
        </button>
        {moveOpen && (
          <div className="anim-card absolute bottom-full right-0 mb-2 max-h-64 w-48 overflow-y-auto rounded-xl border border-white/[.08] bg-[#151a20] p-1 shadow-[0_16px_40px_-10px_rgba(0,0,0,.7)]">
            {app.categories.map(c => (
              <button
                key={c.id}
                onClick={() => done(app.moveTasks(ids, c.id))}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] hover:bg-white/[.06]"
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} />
                <span className="truncate">{c.name}</span>
              </button>
            ))}
            {app.categories.length > 0 && <div className="my-1 h-px bg-white/[.06]" />}
            <button
              onClick={() => done(app.moveTasks(ids, null))}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-mut hover:bg-white/[.06] hover:text-txt"
            >
              No category
            </button>
          </div>
        )}
      </div>
      <button onClick={() => done(app.archiveTasks(ids))} className={btn} title="Archive">
        <Archive size={13} />
      </button>
      <button onClick={() => void del()} className={cx(btn, 'hover:bg-danger/10 hover:text-danger')} title="Delete">
        <Trash2 size={13} />
      </button>
      <button onClick={app.clearSelection} className={cx(btn, 'text-mut')} aria-label="Clear selection" title="Clear selection (Esc)">
        <X size={14} />
      </button>
    </div>
  );
}

/** Desktop (wide window) page header: list title, counts, streak, tabs, sort, and an inline add row. */
function WideHeader({
  sortMenu,
  streak,
  doneToday,
  pct,
  tabs,
  onAdd,
}: {
  sortMenu: React.ReactNode;
  streak: number;
  doneToday: number;
  pct: number;
  tabs: Array<{ id: Tab; label: string; count: number }>;
  onAdd: () => void;
}) {
  const app = useApp();
  const cat = app.filter !== 'all' ? app.categoryById(app.filter) : null;
  const title = cat
    ? cat.name
    : app.filter === 'none'
      ? 'No category'
      : app.list === 'today'
      ? 'Today'
      : app.list === 'upcoming'
        ? 'Upcoming'
        : app.list === 'ai'
          ? 'From AI'
        : app.tab === 'completed'
          ? 'Completed'
          : 'All tasks';
  const sub = [
    `${app.counts.pending} open`,
    app.counts.completed ? `${app.counts.completed} done` : null,
    doneToday ? `${doneToday} finished today` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-6 pt-5">
        <div className="min-w-0 flex-1 basis-40">
          <h1 className="flex items-center gap-2 truncate text-[19px] font-bold tracking-tight">
            {cat && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cat.color }} />}
            {title}
          </h1>
          <p className="truncate text-[12px] text-mut">{app.query ? `Searching for “${app.query}”` : sub}</p>
        </div>
        {streak >= 2 && (
          <span
            title={`${streak}-day streak: you finished something ${streak} days in a row`}
            className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-warn/25 bg-warn/10 px-2 py-1 text-[11px] font-semibold tabular-nums text-warn @max-[600px]:hidden"
          >
            <Flame size={12} /> {streak}-day streak
          </span>
        )}
        {(app.sync === 'offline' || app.sync === 'error') && <SyncBadge state={app.sync} onClick={app.syncNow} />}
        <div className="ml-auto flex shrink-0 items-center gap-2 @max-[600px]:w-full @max-[600px]:justify-between">
          <div className="flex rounded-full border border-white/[.04] bg-black/20 p-[3px]" role="tablist">
            {tabs.map(t => (
              <button
                key={t.id}
                role="tab"
                aria-selected={app.tab === t.id}
                onClick={() => app.setTab(t.id)}
                className={cx(
                  'press whitespace-nowrap rounded-full px-3 py-1 text-[11.5px] font-semibold transition-colors',
                  app.tab === t.id ? 'bg-acc/[.12] text-acc' : 'text-mut hover:text-txt',
                )}
              >
                {t.label} <span className="opacity-60">{t.count}</span>
              </button>
            ))}
          </div>
          {sortMenu}
        </div>
      </header>
      <div className="mx-6 mt-3 h-[3px] rounded-full bg-white/[.05]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Tasks done">
        {pct > 0 && <div className="meter-fill h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(pct, 3)}%` }} />}
      </div>
      <button
        onClick={onAdd}
        className="press mx-6 mt-3 flex items-center gap-2.5 rounded-xl border border-dashed border-white/[.1] px-4 py-2.5 text-left text-[12.5px] text-mut hover:border-acc/40 hover:text-acc"
      >
        <Plus size={14} />
        <span className="flex-1">Add a task{cat ? ` to ${cat.name}` : ''}</span>
        <kbd className="rounded border border-white/10 bg-black/20 px-1.5 text-[10px] font-semibold">N</kbd>
      </button>
    </>
  );
}
