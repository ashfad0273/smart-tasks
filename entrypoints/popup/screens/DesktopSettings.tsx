import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Download, LogOut, Pencil, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { api, API_URL, ApiError, SITE_URL, type AgentKey, type AgentStats, type DeviceSession } from '../../../lib/api';
import { manifestVersion, onStorageChange, storageGet, storageSet } from '../../../lib/ext';
import { AGENT_NOTIFY_KEY, AGENT_SOUND_KEY, REMINDERS_ENABLED_KEY, REMINDERS_KEY, UPDATE_KEY } from '../../../lib/keys';
import { newer, type UpdateInfo } from '../../../lib/updater';
import { desktopHost, desktopShortcut, isDesktopApp } from '../../../lib/desktop';
import { cx, formatDue } from '../../../lib/utils';
import type { Reminder } from '../../../lib/reminders';
import { useApp } from '../state/AppContext';
import Avatar from '../components/Avatar';
import { Toggle } from './SettingsScreen';
import { streakOf } from './Dashboard';

type SectionId = 'account' | 'sync' | 'notifications' | 'categories' | 'agents' | 'shortcuts' | 'data' | 'about';
const SECTIONS: Array<{ id: SectionId; label: string }> = [
  { id: 'account', label: 'Account' },
  { id: 'sync', label: 'Sync and devices' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'categories', label: 'Categories' },
  { id: 'agents', label: 'AI agents' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'data', label: 'Data' },
  { id: 'about', label: 'About' },
];

function ago(ms: number | null): string {
  if (!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86_400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function Box({ id, title, sub, wide, right, children }: { id?: SectionId; title: string; sub?: string; wide?: boolean; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section data-section={id} className={cx('anim-card rounded-2xl border border-line bg-surface p-4', wide && 'col-span-2')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold">{title}</h3>
          {sub && <p className="mt-0.5 text-[11.5px] text-mut">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Line({ label, sub, children, tone }: { label: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode; tone?: string }) {
  return (
    <div className="flex min-h-[44px] items-center gap-3 border-t border-white/[.05] py-2 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className={cx('truncate text-[12.5px]', tone)}>{label}</p>
        {sub && <p className="truncate text-[11px] text-mut">{sub}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2.5 text-[11.5px] text-mut">{children}</div>
    </div>
  );
}

const linkBtn = 'press text-[12px] font-semibold text-acc hover:underline';
const pillBtn = 'press inline-flex items-center gap-1.5 rounded-full border border-white/[.08] px-3 py-1.5 text-[11.5px] font-semibold text-txt/90 hover:bg-white/[.05]';

/** Settings as a full page for the desktop app's wide layout. */
export default function DesktopSettings() {
  const app = useApp();
  const acc = app.account;
  const session = acc && !acc.local ? acc.token : null;
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<SectionId>('account');

  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(acc?.name ?? '');
  const [devices, setDevices] = useState<DeviceSession[] | null>(null);
  const [keys, setKeys] = useState<AgentKey[] | null>(null);
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [remindersOn, setRemindersOn] = useState<boolean | null>(null);
  const [nextReminder, setNextReminder] = useState<Reminder | null>(null);
  const [agentNotify, setAgentNotify] = useState<boolean | null>(null);
  const [agentSound, setAgentSound] = useState<boolean | null>(null);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [updateTo, setUpdateTo] = useState<string | null>(null);

  const fail = useCallback((e: unknown) => app.showToast(e instanceof ApiError ? e.message : 'Something went wrong. Try again.', 'error'), [app]);

  useEffect(() => {
    if (!session) return;
    api.sessions(session).then(r => {
      setDevices(r.sessions);
      setKeys(r.agents ?? null);
    }, fail);
    api.stats(session).then(setStats, () => {});
  }, [session, fail]);

  useEffect(() => {
    const read = async () => {
      setRemindersOn(await storageGet<boolean>(REMINDERS_ENABLED_KEY, true));
      setAgentNotify(await storageGet<boolean>(AGENT_NOTIFY_KEY, true));
      setAgentSound(await storageGet<boolean>(AGENT_SOUND_KEY, true));
      const list = await storageGet<Reminder[]>(REMINDERS_KEY, []);
      setNextReminder(list.find(r => r.dueAt > Date.now()) ?? null);
      const info = await storageGet<UpdateInfo | null>(UPDATE_KEY, null);
      setUpdateTo(info && newer(info.version, manifestVersion()) ? info.version : null);
    };
    void read();
    void desktopHost()?.getAutostart().then(setAutostart, () => {});
    return onStorageChange(() => void read());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !app.confirmData && !app.editTaskId && app.setScreen('dashboard');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  // Highlight the section in view in the left list.
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + 40;
    let current: SectionId = 'account';
    for (const s of el.querySelectorAll<HTMLElement>('[data-section]')) {
      if (s.getBoundingClientRect().top <= top) current = s.dataset.section as SectionId;
    }
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) current = SECTIONS[SECTIONS.length - 1].id;
    setActive(current);
  };
  const jump = (id: SectionId) => {
    scroller.current?.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  };

  const weekAgo = Date.now() - 7 * 86_400_000;
  const finishedWeek = useMemo(() => app.tasks.filter(t => (t.completedAt ?? 0) >= weekAgo).length, [app.tasks, weekAgo]);
  const streak = useMemo(() => streakOf(app.tasks), [app.tasks]);
  const aiShare = stats && stats.total ? Math.round((stats.agent / stats.total) * 100) : null;

  const setPref = (key: string, set: (v: boolean) => void) => (v: boolean) => {
    set(v);
    void storageSet(key, v);
  };

  const signOut = async () => {
    if (!acc) return;
    const ok = await app.confirm({
      title: 'Sign out?',
      message: `${acc.email} will be signed out on this device. Your tasks stay safe in the cloud.`,
      confirmText: 'Sign out',
    });
    if (ok) await app.signOut(acc.uid);
  };

  const signOutDevice = async (d: DeviceSession) => {
    if (!session) return;
    const ok = await app.confirm({ title: `Sign out ${d.device}?`, message: 'It will need to sign in again to see your tasks.', confirmText: 'Sign out' });
    if (!ok) return;
    try {
      await api.signOutDevice(session, d.id);
      setDevices(list => list?.filter(x => x.id !== d.id) ?? null);
    } catch (e) {
      fail(e);
    }
  };

  const deleteAccount = async () => {
    if (!acc) return;
    const ok = await app.confirm({
      title: acc.local ? 'Delete all local tasks?' : 'Delete your account?',
      message: acc.local
        ? 'Every task and category stored on this device will be erased. This cannot be undone.'
        : `This permanently deletes ${acc.email} and every task and category on all devices. This cannot be undone.`,
      confirmText: 'Delete forever',
      danger: true,
    });
    if (ok) await app.deleteAccount();
  };

  const shortcuts: Array<[string, string]> = [
    ['Show or hide the app', isDesktopApp() ? desktopShortcut() : 'Ctrl/⌘ + Shift + K'],
    ['New task', 'N'],
    ['Search', '/'],
    ['Select all', '⌘/Ctrl + A'],
    ['Add to selection', '⌘/Ctrl + click'],
    ['Select a range', 'Shift + click'],
    ['Move tasks', 'Drag onto a category'],
    ['Close panel, clear selection', 'Esc'],
  ];

  return (
    <div className="ambient flex h-full bg-bg">
      <nav className="w-[200px] shrink-0 border-r border-white/[.05] px-2.5 pt-5">
        <h1 className="px-2.5 pb-3 text-[18px] font-bold tracking-tight">Settings</h1>
        {SECTIONS.filter(s => !(acc?.local && s.id === 'sync')).map(s => (
          <button
            key={s.id}
            onClick={() => jump(s.id)}
            className={cx(
              'press block w-full rounded-lg px-2.5 py-[7px] text-left text-[12.5px]',
              active === s.id ? 'bg-acc/[.1] font-semibold text-acc' : 'text-txt/80 hover:bg-white/[.04]',
            )}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div ref={scroller} onScroll={onScroll} className="hide-scrollbar min-w-0 flex-1 overflow-y-auto px-7 py-6">
        <div className="mx-auto grid max-w-[880px] grid-cols-2 gap-3.5">
          {/* Account + stats */}
          <section data-section="account" className="anim-card col-span-2 rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-center gap-3.5">
              {acc && <Avatar name={acc.name} email={acc.email} photoURL={acc.photoURL} hue={acc.hue} size={52} local={acc.local} />}
              <div className="min-w-0 flex-1">
                {editingName ? (
                  <form
                    onSubmit={e => {
                      e.preventDefault();
                      setEditingName(false);
                      void app.renameAccount(name);
                    }}
                  >
                    <input
                      autoFocus
                      value={name}
                      maxLength={80}
                      onChange={e => setName(e.target.value)}
                      onBlur={() => setEditingName(false)}
                      aria-label="Display name"
                      className="w-full max-w-xs rounded-lg border border-acc/50 bg-surface2 px-2 py-1 text-[15px] font-semibold outline-none"
                    />
                  </form>
                ) : (
                  <p className="truncate text-[16px] font-semibold">{acc?.local ? 'On this device' : acc?.name}</p>
                )}
                <p className="truncate text-[12px] text-mut">{acc?.local ? 'Not synced: tasks stay on this computer' : acc?.email}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                {!acc?.local && (
                  <button onClick={() => setEditingName(true)} className={pillBtn}>
                    <Pencil size={12} /> Edit name
                  </button>
                )}
                <button onClick={() => app.setSwitcherOpen(true)} className={pillBtn}>
                  <Users size={12} /> Switch account
                </button>
                {acc?.local ? (
                  <button onClick={() => app.setScreen('signup')} className="press btn-acc rounded-full px-3.5 py-1.5 text-[11.5px] font-semibold">
                    Sync my tasks
                  </button>
                ) : (
                  <button onClick={() => void signOut()} className={cx(pillBtn, 'border-danger/30 text-danger hover:bg-danger/10')}>
                    <LogOut size={12} /> Sign out
                  </button>
                )}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2.5">
              {[
                { n: app.listCounts.all, label: 'Open tasks', tone: '' },
                { n: finishedWeek, label: 'Finished this week', tone: '' },
                { n: streak, label: streak === 1 ? 'Day streak' : 'Day streak', tone: 'text-warn' },
                { n: aiShare == null ? '–' : `${aiShare}%`, label: 'Changes by AI, 30 days', tone: 'text-pop' },
              ].map(s => (
                <div key={s.label} className="rounded-xl border border-white/[.05] bg-black/20 px-3 py-2.5">
                  <p className={cx('text-[20px] font-bold tabular-nums leading-tight', s.tone)}>{s.n}</p>
                  <p className="text-[11px] text-mut">{s.label}</p>
                </div>
              ))}
            </div>
          </section>

          {!acc?.local && (
            <Box
              id="sync"
              title="Sync and devices"
              sub="Changes reach your other devices instantly."
              right={
                <button onClick={app.syncNow} className={pillBtn} title="Sync now">
                  <RefreshCw size={12} className={app.sync === 'syncing' ? 'animate-spin' : ''} />
                  {app.sync === 'offline' ? 'Offline' : app.sync === 'error' ? 'Retry' : `Synced ${ago(app.lastSyncAt)}`}
                </button>
              }
            >
              <div className="mt-2">
                {devices === null ? (
                  <div className="skeleton mt-2 h-20 rounded-xl" />
                ) : (
                  devices.slice(0, 5).map(d => (
                    <Line
                      key={d.id}
                      label={
                        <span className="flex items-center gap-2">
                          <span className={cx('h-[7px] w-[7px] shrink-0 rounded-full', d.online ? 'bg-acc shadow-[0_0_8px_var(--color-acc)]' : 'bg-white/20')} />
                          {d.device}
                          {d.current && <span className="text-[10.5px] font-semibold text-acc">This one</span>}
                        </span>
                      }
                    >
                      <span>
                        {d.location ? `${d.location} · ` : ''}
                        {d.online ? 'now' : ago(d.lastSeen)}
                      </span>
                      {!d.current && (
                        <button onClick={() => void signOutDevice(d)} className={linkBtn}>
                          Sign out
                        </button>
                      )}
                    </Line>
                  ))
                )}
                {devices && devices.length > 5 && (
                  <button onClick={() => app.setScreen('devices')} className={cx(linkBtn, 'mt-1')}>
                    All {devices.length} devices
                  </button>
                )}
              </div>
            </Box>
          )}

          <Box id="notifications" title="Notifications" sub="What may pop up on this computer.">
            <div className="mt-2">
              <Line label="Due-date reminders" sub={remindersOn && nextReminder ? `Next: ${formatDue(nextReminder.dueAt).label}` : undefined}>
                {remindersOn !== null && <Toggle label="Due-date reminders" on={remindersOn} onChange={setPref(REMINDERS_ENABLED_KEY, setRemindersOn)} />}
              </Line>
              {!acc?.local && (
                <Line label="AI agent notifications">
                  {agentNotify !== null && <Toggle label="AI agent notifications" on={agentNotify} onChange={setPref(AGENT_NOTIFY_KEY, setAgentNotify)} />}
                </Line>
              )}
              {!acc?.local && (
                <Line label="Notification sound" sub="A soft chime for AI agent messages">
                  {agentSound !== null && <Toggle label="Notification sound" on={agentSound} onChange={setPref(AGENT_SOUND_KEY, setAgentSound)} />}
                </Line>
              )}
              {autostart !== null && (
                <Line label="Open at login" sub="Start Smart Tasks in the background when you sign in">
                  <Toggle
                    label="Open at login"
                    on={autostart}
                    onChange={v => {
                      setAutostart(v);
                      void desktopHost()?.setAutostart(v).then(setAutostart, () => setAutostart(!v));
                    }}
                  />
                </Line>
              )}
            </div>
          </Box>

          <Box
            id="categories"
            title="Categories"
            sub="Drag tasks onto a category in the sidebar to move them."
            right={
              <button onClick={() => app.openCategoryModal({ mode: 'create' })} className={pillBtn}>
                <Plus size={12} /> New
              </button>
            }
          >
            <div className="mt-2">
              {app.categories.length === 0 ? (
                <p className="py-2 text-[12px] text-mut">No categories yet.</p>
              ) : (
                app.categories.map(c => (
                  <Line
                    key={c.id}
                    label={
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                        {c.name}
                      </span>
                    }
                  >
                    <span className="tabular-nums">{app.countsByCategory[c.id] ?? 0} open</span>
                    <button onClick={() => app.openCategoryModal({ mode: 'edit', id: c.id })} className={linkBtn}>
                      Edit
                    </button>
                  </Line>
                ))
              )}
              <button onClick={() => app.setScreen('categories')} className={cx(linkBtn, 'mt-1')}>
                Reorder and archive
              </button>
            </div>
          </Box>

          <Box
            id="agents"
            title="AI agents"
            sub="Let Claude, Cursor and others manage your tasks."
            right={
              <button onClick={() => app.setScreen('agent')} className={pillBtn}>
                <Bot size={12} /> Manage
              </button>
            }
          >
            <div className="mt-2">
              {acc?.local ? (
                <p className="py-2 text-[12px] text-mut">Agents connect through the cloud, so they need a synced account.</p>
              ) : keys === null ? (
                <div className="skeleton mt-2 h-14 rounded-xl" />
              ) : keys.length === 0 ? (
                <p className="py-2 text-[12px] text-mut">No keys yet. Add one to connect an AI app.</p>
              ) : (
                keys.slice(0, 4).map(k => (
                  <Line key={k.id} label={k.name} sub={`Key ends in ${k.hint}`}>
                    <span>
                      {stats?.byAgent[k.name] ? `${stats.byAgent[k.name]} changes · ` : ''}used {ago(k.lastUsed)}
                    </span>
                  </Line>
                ))
              )}
            </div>
          </Box>

          <Box id="shortcuts" title="Keyboard shortcuts">
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-[12px] text-mut">
              {shortcuts.map(([what, key]) => (
                <div key={what} className="contents">
                  <span>{what}</span>
                  <kbd className="justify-self-end rounded-md border border-line bg-surface2 px-1.5 py-0.5 font-sans text-[10.5px] font-semibold text-txt">{key}</kbd>
                </div>
              ))}
            </div>
          </Box>

          <Box id="data" title="Data" sub="Your tasks, categories and history.">
            <div className="mt-2">
              <Line
                label="Archive"
                sub={`${app.archivedTasks.length} task${app.archivedTasks.length === 1 ? '' : 's'}, ${app.archivedCategories.length} categor${app.archivedCategories.length === 1 ? 'y' : 'ies'}`}
              >
                <button onClick={() => app.setScreen('archive')} className={linkBtn}>
                  Open
                </button>
              </Line>
              <Line label="Export everything" sub="A JSON file with all tasks and categories">
                <button onClick={() => void app.exportData()} className={cx(linkBtn, 'inline-flex items-center gap-1')}>
                  <Download size={12} /> JSON
                </button>
              </Line>
              <Line label="Welcome tour">
                <button onClick={app.startTour} className={linkBtn}>
                  Replay
                </button>
              </Line>
              <Line label={acc?.local ? 'Erase all tasks' : 'Delete account'} tone="text-danger">
                <button onClick={() => void deleteAccount()} className="press inline-flex items-center gap-1 text-[12px] font-semibold text-danger hover:underline">
                  <Trash2 size={12} /> Delete
                </button>
              </Line>
            </div>
          </Box>

          <Box id="about" title="About" wide>
            <div className="mt-2">
              <Line label={`Smart Tasks ${manifestVersion()}`} sub={updateTo ? `Version ${updateTo} is ready to install` : 'Updates install by themselves'}>
                <button
                  onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL(updateTo ? 'update.html?go=1' : 'update.html') })}
                  className={linkBtn}
                >
                  {updateTo ? `Update to ${updateTo}` : 'Check now'}
                </button>
              </Line>
              <Line label="What's new">
                <a href={`${SITE_URL}/#changelog`} target="_blank" rel="noreferrer" className={linkBtn}>
                  Changelog
                </a>
              </Line>
              <Line label="Privacy">
                <a href={`${API_URL}/privacy`} target="_blank" rel="noreferrer" className={linkBtn}>
                  Read
                </a>
              </Line>
            </div>
          </Box>
        </div>
      </div>
    </div>
  );
}
