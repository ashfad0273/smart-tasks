import { useEffect, useRef, useState } from 'react';
import { Archive, Bell, Bot, CalendarClock, CalendarDays, CheckCheck, History, ListTodo, Plus, Search, Settings, X } from 'lucide-react';
import { api, type InboxItem } from '../../../lib/api';
import { onStorageChange, storageGet } from '../../../lib/ext';
import { inboxKey } from '../../../lib/keys';
import { cx } from '../../../lib/utils';
import { useApp, type ListView, type Screen, type Tab } from '../state/AppContext';
import Avatar from './Avatar';
import { TASK_DRAG_TYPE } from './TaskCard';

function ago(ms: number | null): string {
  if (!ms) return 'not synced yet';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Drop target for dragged tasks (one or many). */
function useTaskDrop(onDrop?: (ids: string[]) => void) {
  const [over, setOver] = useState(false);
  if (!onDrop) return { over: false, handlers: {} };
  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(TASK_DRAG_TYPE);
  return {
    over,
    handlers: {
      onDragEnter: (e: React.DragEvent) => accepts(e) && (e.preventDefault(), setOver(true)),
      onDragOver: (e: React.DragEvent) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        setOver(false);
        if (!accepts(e)) return;
        e.preventDefault();
        try {
          const ids = JSON.parse(e.dataTransfer.getData(TASK_DRAG_TYPE));
          if (Array.isArray(ids) && ids.length) onDrop(ids.map(String));
        } catch {
          /* not ours */
        }
      },
    },
  };
}

function NavItem({
  icon,
  label,
  count,
  badge,
  active,
  onClick,
  onDropTasks,
  dropColor = '#3fd1c5',
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  badge?: number;
  active: boolean;
  onClick: () => void;
  onDropTasks?: (ids: string[]) => void;
  dropColor?: string;
}) {
  const { over, handlers } = useTaskDrop(onDropTasks);
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={onDropTasks ? `${label}: drop tasks here to move them` : undefined}
      {...handlers}
      className={cx(
        'press flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[12.5px] transition-colors',
        active ? 'bg-acc/[.1] font-semibold text-acc' : 'text-txt/80 hover:bg-white/[.04] hover:text-txt',
      )}
      style={over ? { background: `${dropColor}24`, boxShadow: `inset 0 0 0 1.5px ${dropColor}99`, color: dropColor } : undefined}
    >
      <span className="grid w-4 shrink-0 place-items-center opacity-90">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span className="grid h-4 min-w-4 place-items-center rounded-full bg-pop px-1.5 text-[10px] font-bold text-white">{badge > 99 ? '99+' : badge}</span>
      ) : count ? (
        <span className={cx('text-[11px] tabular-nums', active ? 'text-acc/80' : 'text-mut')}>{count}</span>
      ) : null}
    </button>
  );
}

/** The desktop app's left column: account, search, smart lists, categories, and every section. */
export default function Sidebar() {
  const app = useApp();
  const acc = app.account;
  const session = acc && !acc.local ? acc.token : null;
  const searchRef = useRef<HTMLInputElement>(null);
  const [unread, setUnread] = useState(0);
  const [agentKeys, setAgentKeys] = useState<number | null>(null);
  const [, tick] = useState(0);

  // "Synced 12s ago" stays fresh.
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const focus = () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener('st-focus-search', focus);
    return () => window.removeEventListener('st-focus-search', focus);
  }, []);

  useEffect(() => {
    if (!acc || acc.local) return setUnread(0);
    const read = async () => setUnread((await storageGet<InboxItem[]>(inboxKey(acc.uid), [])).filter(i => !i.read).length);
    void read();
    return onStorageChange(keys => keys.includes(inboxKey(acc.uid)) && void read());
  }, [acc]);

  // Key count for the AI agents row; refreshed when you come back from that page.
  useEffect(() => {
    if (!session) return setAgentKeys(null);
    api.agentKeys(session).then(
      r => setAgentKeys(r.keys.length),
      () => {},
    );
  }, [session, app.screen]);

  const onTasks = app.screen === 'dashboard';
  const go = (opts: { list?: ListView; filter?: string; tab?: Tab }) => {
    app.setList(opts.list ?? 'all');
    app.setFilter(opts.filter ?? 'all');
    if (opts.tab) app.setTab(opts.tab);
    else if (app.tab === 'completed') app.setTab('pending');
    app.clearSelection();
    app.setScreen('dashboard');
  };
  const isList = (l: ListView, completed = false) =>
    onTasks && app.filter === 'all' && app.list === l && (completed ? app.tab === 'completed' : app.tab !== 'completed' || l !== 'all');
  const move = (categoryId: string | null) => (ids: string[]) => void app.moveTasks(ids, categoryId).then(app.clearSelection);
  const page = (s: Screen) => app.setScreen(s);

  const syncLabel =
    app.sync === 'local'
      ? 'On this device only'
      : app.sync === 'offline'
        ? 'Offline, changes saved'
        : app.sync === 'error'
          ? 'Sync problem, tap to retry'
          : app.sync === 'syncing'
            ? 'Syncing...'
            : `Synced ${ago(app.lastSyncAt)}`;
  const syncTone = app.sync === 'error' ? 'text-danger' : app.sync === 'offline' || app.sync === 'local' ? 'text-mut' : 'text-acc';

  return (
    <aside className="st-sidebar flex h-full w-[236px] shrink-0 flex-col border-r border-white/[.05] bg-black/25 px-2.5 pb-3 pt-3.5">
      <button
        onClick={() => app.setSwitcherOpen(true)}
        title="Switch account"
        className="press mb-2.5 flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-white/[.04]"
      >
        {acc && <Avatar name={acc.name} email={acc.email} photoURL={acc.photoURL} hue={acc.hue} size={30} local={acc.local} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold">{acc?.local ? 'This device' : acc?.name}</span>
          <span
            role={app.sync === 'error' ? 'button' : undefined}
            onClick={e => {
              if (app.sync !== 'error') return;
              e.stopPropagation();
              app.syncNow();
            }}
            className={cx('flex items-center gap-1 truncate text-[10.5px]', syncTone)}
          >
            <span className={cx('h-[5px] w-[5px] shrink-0 rounded-full bg-current', app.sync === 'syncing' && 'animate-pulse')} />
            {syncLabel}
          </span>
        </span>
      </button>

      <label className="mx-1 mb-2.5 flex items-center gap-2 rounded-lg border border-white/[.05] bg-white/[.03] px-2.5 py-1.5 text-mut focus-within:border-acc/40">
        <Search size={13} className="shrink-0" />
        <input
          ref={searchRef}
          value={app.query}
          onChange={e => {
            app.setQuery(e.target.value);
            if (app.screen !== 'dashboard') app.setScreen('dashboard');
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              app.setQuery('');
              searchRef.current?.blur();
            }
          }}
          placeholder="Search tasks"
          aria-label="Search tasks"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-txt outline-none placeholder:text-mut"
        />
        {app.query ? (
          <button onClick={() => app.setQuery('')} aria-label="Clear search" className="press text-mut hover:text-txt">
            <X size={12} />
          </button>
        ) : (
          <kbd className="rounded border border-white/10 bg-black/20 px-1.5 text-[10px] font-semibold">/</kbd>
        )}
      </label>

      <div className="hide-scrollbar min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        <NavItem
          icon={<ListTodo size={15} />}
          label="All tasks"
          count={app.listCounts.all}
          active={isList('all')}
          onClick={() => go({})}
        />
        <NavItem
          icon={<CalendarDays size={15} />}
          label="Today"
          count={app.listCounts.today}
          active={isList('today')}
          onClick={() => go({ list: 'today' })}
        />
        <NavItem
          icon={<CalendarClock size={15} />}
          label="Upcoming"
          count={app.listCounts.upcoming}
          active={isList('upcoming')}
          onClick={() => go({ list: 'upcoming' })}
        />
        {(app.listCounts.ai > 0 || isList('ai')) && (
          <NavItem
            icon={<Bot size={15} />}
            label="From AI"
            count={app.listCounts.ai}
            active={isList('ai')}
            onClick={() => go({ list: 'ai' })}
          />
        )}
        <NavItem
          icon={<CheckCheck size={15} />}
          label="Completed"
          count={app.listCounts.completed}
          active={isList('all', true)}
          onClick={() => go({ tab: 'completed' })}
        />

        <div className="flex items-center justify-between px-2.5 pb-1 pt-4">
          <span className="text-[10.5px] font-bold uppercase tracking-[.08em] text-mut/70">Categories</span>
          <button
            onClick={() => app.openCategoryModal({ mode: 'create' })}
            aria-label="New category"
            title="New category"
            className="press rounded-md p-0.5 text-mut hover:bg-white/[.06] hover:text-txt"
          >
            <Plus size={13} />
          </button>
        </div>
        {app.categories.map(c => (
          <NavItem
            key={c.id}
            icon={<span className="h-2 w-2 rounded-full" style={{ background: c.color }} />}
            label={c.name}
            count={app.countsByCategory[c.id]}
            active={onTasks && app.filter === c.id}
            onClick={() => go({ filter: c.id })}
            onDropTasks={move(c.id)}
            dropColor={c.color}
          />
        ))}
        <NavItem
          icon={<span className="h-2 w-2 rounded-full bg-mut/50" />}
          label="No category"
          count={app.countsByCategory.none}
          active={onTasks && app.filter === 'none'}
          onClick={() => go({ filter: 'none' })}
          onDropTasks={move(null)}
          dropColor="#94a3b8"
        />
        {app.categories.length === 0 && (
          <p className="px-2.5 py-1 text-[11px] leading-snug text-mut/70">Add a category with + to group tasks.</p>
        )}
      </div>

      <div className="mt-2 space-y-0.5 border-t border-white/[.05] pt-2">
        {!acc?.local && (
          <NavItem icon={<Bell size={15} />} label="Notifications" badge={unread} active={app.screen === 'notifications'} onClick={() => page('notifications')} />
        )}
        <NavItem icon={<History size={15} />} label="History" active={app.screen === 'activity'} onClick={() => page('activity')} />
        <NavItem
          icon={<Archive size={15} />}
          label="Archive"
          count={app.archivedTasks.length + app.archivedCategories.length}
          active={app.screen === 'archive'}
          onClick={() => page('archive')}
        />
        <NavItem icon={<Bot size={15} />} label="AI agents" count={agentKeys ?? undefined} active={app.screen === 'agent'} onClick={() => page('agent')} />
        <NavItem
          icon={<Settings size={15} />}
          label="Settings"
          active={app.screen === 'settings' || app.screen === 'devices' || app.screen === 'categories'}
          onClick={() => page('settings')}
        />
      </div>
    </aside>
  );
}
