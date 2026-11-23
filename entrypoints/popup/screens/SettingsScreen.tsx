import { useCallback, useEffect, useState } from 'react';
import { Bell, Bot, ChevronLeft, MonitorSmartphone, Download, Keyboard, LogOut, Pencil, RefreshCw, Tags, Trash2, Users } from 'lucide-react';
import { API_URL, SITE_URL } from '../../../lib/api';
import { manifestVersion, onStorageChange, storageGet, storageSet } from '../../../lib/ext';
import { REMINDERS_ENABLED_KEY, REMINDERS_KEY } from '../../../lib/keys';
import { formatDue } from '../../../lib/utils';
import type { Reminder } from '../../../lib/reminders';
import { useApp } from '../state/AppContext';
import Avatar from '../components/Avatar';
import SyncBadge from '../components/SyncBadge';

function Card({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="anim-card rounded-2xl border border-line bg-surface p-3.5">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-mut">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ icon, label, sub, children }: { icon: React.ReactNode; label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[52px] items-center gap-3 px-3.5 py-2.5">
      <span className="text-mut">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{label}</p>
        {sub && <p className="truncate text-[11px] text-acc">{sub}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2.5">{children}</div>
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`press relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'grad-acc' : 'bg-line'}`}
    >
      <span
        className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-300 ease-[var(--ease-out)] ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`}
      />
    </button>
  );
}

function ago(ms: number | null): string {
  if (!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(ms).toLocaleString([], { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });
}

const btn = 'press flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface2 py-2 text-xs font-semibold hover:bg-line';

export default function SettingsScreen() {
  const app = useApp();
  const acc = app.account;
  const [remindersOn, setRemindersOn] = useState<boolean | null>(null);
  const [nextReminder, setNextReminder] = useState<Reminder | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(acc?.name ?? '');

  const refreshReminders = useCallback(async () => {
    setRemindersOn(await storageGet<boolean>(REMINDERS_ENABLED_KEY, true));
    const list = await storageGet<Reminder[]>(REMINDERS_KEY, []);
    setNextReminder(list.find(r => r.dueAt > Date.now()) ?? null);
  }, []);

  useEffect(() => {
    void refreshReminders();
    return onStorageChange(() => void refreshReminders());
  }, [refreshReminders]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !app.confirmData && app.setScreen('dashboard');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  const toggleReminders = async (v: boolean) => {
    setRemindersOn(v);
    await storageSet(REMINDERS_ENABLED_KEY, v);
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

  const deleteAccount = async () => {
    if (!acc) return;
    const ok = await app.confirm({
      title: acc.local ? 'Delete all local tasks?' : 'Delete your account?',
      message: acc.local
        ? 'Every task and category stored in this browser will be erased. This cannot be undone.'
        : `This permanently deletes ${acc.email} and every task and category on all devices. This cannot be undone.`,
      confirmText: 'Delete forever',
      danger: true,
    });
    if (ok) await app.deleteAccount();
  };

  return (
    <div className="ambient flex h-full flex-col bg-bg">
      <header className="flex items-center justify-between px-4 py-3">
        <button onClick={() => app.setScreen('dashboard')} aria-label="Back" className="press rounded-lg p-1.5 text-mut hover:text-txt">
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-sm font-semibold">Settings</h1>
        <span className="w-7" />
      </header>

      <div className="hide-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-5">
        <Card title={acc?.local ? 'Storage' : 'Account'}>
          <div className="mt-2.5 flex items-center gap-3">
            {acc && <Avatar name={acc.name} email={acc.email} photoURL={acc.photoURL} hue={acc.hue} size={44} local={acc.local} />}
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
                    className="w-full rounded-lg border border-acc/50 bg-surface2 px-2 py-1 text-sm font-semibold outline-none"
                  />
                </form>
              ) : (
                <p className="flex items-center gap-1 truncate text-sm font-semibold">
                  {acc?.local ? 'On this device' : acc?.name}
                  {!acc?.local && (
                    <button aria-label="Edit name" onClick={() => setEditingName(true)} className="press rounded p-0.5 text-mut hover:text-txt">
                      <Pencil size={11} />
                    </button>
                  )}
                </p>
              )}
              <p className="truncate text-xs text-mut">{acc?.local ? 'Not synced' : acc?.email}</p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => app.setSwitcherOpen(true)} className={btn}>
              <Users size={12} /> Switch
            </button>
            {acc?.local ? (
              <button onClick={() => app.setScreen('signup')} className="press btn-acc flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-xs font-semibold">
                Sync my tasks
              </button>
            ) : (
              <button onClick={() => void signOut()} className={btn}>
                <LogOut size={12} /> Sign out
              </button>
            )}
          </div>
        </Card>

        <section className="anim-card divide-y divide-white/[.05] rounded-2xl border border-line bg-surface">
          {!acc?.local && (
            <Row icon={<RefreshCw size={14} />} label="Sync">
              <button onClick={app.syncNow} className="press text-[12px] text-mut hover:text-txt" title="Sync now">
                {ago(app.lastSyncAt)}
              </button>
              <SyncBadge state={app.sync} onClick={app.syncNow} />
            </Row>
          )}
          <Row
            icon={<Bell size={14} />}
            label="Reminders"
            sub={remindersOn && nextReminder ? `Next: ${formatDue(nextReminder.dueAt).label}` : undefined}
          >
            {remindersOn !== null && <Toggle label="Reminders" on={remindersOn} onChange={v => void toggleReminders(v)} />}
          </Row>
          <Row icon={<Tags size={14} />} label="Categories">
            <button onClick={() => app.setScreen('categories')} className="press text-[12px] font-medium text-acc hover:underline">
              Manage
            </button>
          </Row>
          {!acc?.local && (
            <Row icon={<MonitorSmartphone size={14} />} label="Devices">
              <button onClick={() => app.setScreen('devices')} className="press text-[12px] font-medium text-acc hover:underline">
                Manage
              </button>
            </Row>
          )}
          <Row icon={<Bot size={14} />} label="AI agent">
            <button onClick={() => app.setScreen('agent')} className="press text-[12px] font-medium text-acc hover:underline">
              Connect
            </button>
          </Row>
          <Row icon={<Download size={14} />} label="Export data">
            <button onClick={() => void app.exportData()} className="press text-[12px] font-medium text-acc hover:underline">
              JSON
            </button>
          </Row>
        </section>

        <Card title="Shortcuts" icon={<Keyboard size={11} />}>
          <ul className="mt-2.5 space-y-2 text-[12.5px] text-mut">
            {[
              ['Open', 'Ctrl/⌘ + Shift + K'],
              ['New task', 'N'],
              ['Search', '/'],
              ['Close', 'Esc'],
            ].map(([what, key]) => (
              <li key={what} className="flex items-center justify-between">
                {what}
                <kbd className="rounded-md border border-line bg-surface2 px-1.5 py-0.5 font-sans text-[10.5px] font-semibold text-txt">{key}</kbd>
              </li>
            ))}
          </ul>
        </Card>

        <button
          onClick={() => void deleteAccount()}
          className="press flex w-full items-center justify-center gap-1.5 rounded-full border border-danger/25 py-2.5 text-[12.5px] font-medium text-danger hover:bg-danger/10"
        >
          <Trash2 size={13} /> {acc?.local ? 'Erase all tasks' : 'Delete account'}
        </button>

        <p className="flex items-center justify-center gap-2 pt-1 text-[11px] text-mut/70">
          <a href={`${SITE_URL}/#changelog`} target="_blank" rel="noreferrer" className="hover:text-txt hover:underline" title="What's new">
            v{manifestVersion()}
          </a>
          <span aria-hidden="true">·</span>
          <a href={`${API_URL}/privacy`} target="_blank" rel="noreferrer" className="hover:text-txt hover:underline">
            Privacy
          </a>
        </p>
      </div>
    </div>
  );
}
