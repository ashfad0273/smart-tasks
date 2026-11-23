import { useCallback, useEffect, useState } from 'react';
import { Bell, ChevronLeft, Download, Keyboard, LogOut, Pencil, RefreshCw, Shield, Trash2, Users } from 'lucide-react';
import { API_URL } from '../../../lib/api';
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

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`press relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'grad-acc' : 'bg-line'}`}
    >
      <span
        className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-300 ease-[cubic-bezier(.2,.9,.3,1.4)] ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`}
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

const btn = 'press flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface2 py-2 text-xs font-bold hover:bg-line';

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

      <div className="hide-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-5">
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
                    className="w-full rounded-lg border border-acc/50 bg-surface2 px-2 py-1 text-sm font-bold outline-none"
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
              <p className="truncate text-xs text-mut">{acc?.local ? 'Not synced — create an account to sync' : acc?.email}</p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => app.setSwitcherOpen(true)} className={btn}>
              <Users size={12} /> Switch
            </button>
            {acc?.local ? (
              <button onClick={() => app.setScreen('signup')} className="press btn-acc flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-xs font-semibold">
                ✨ Sync my tasks
              </button>
            ) : (
              <button onClick={() => void signOut()} className={btn}>
                <LogOut size={12} /> Sign out
              </button>
            )}
          </div>
        </Card>

        {!acc?.local && (
          <Card title="Sync" icon={<RefreshCw size={11} />}>
            <div className="mt-2.5 flex items-center justify-between">
              <SyncBadge state={app.sync} onClick={app.syncNow} />
              <span className="text-[11px] font-semibold text-mut">Last synced {ago(app.lastSyncAt)}</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-mut">
              Changes appear on your other devices instantly while Smart Tasks is open, and every minute in the background. Offline edits are
              saved and sync when you reconnect.
            </p>
          </Card>
        )}

        <Card title="Reminders" icon={<Bell size={11} />}>
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <p className="text-xs leading-relaxed text-mut">A desktop nudge when a task with a time is due — finish or snooze it right there.</p>
            {remindersOn !== null && <Toggle label="Reminders" on={remindersOn} onChange={v => void toggleReminders(v)} />}
          </div>
          {remindersOn && (
            <p className="mt-2.5 rounded-xl bg-surface2 px-2.5 py-2 text-[11px] leading-relaxed text-mut">
              {nextReminder ? (
                <>
                  ⏰ Next: <span className="font-bold text-acc">{formatDue(nextReminder.dueAt).label}</span> — {nextReminder.title}
                </>
              ) : (
                '😴 Nothing scheduled. Give a task a date & time to get a reminder.'
              )}
            </p>
          )}
        </Card>

        <Card title="Shortcuts" icon={<Keyboard size={11} />}>
          <ul className="mt-2 space-y-1.5 text-xs text-mut">
            {[
              ['Open Smart Tasks', 'Ctrl/⌘ + Shift + K'],
              ['New task', 'N'],
              ['Search', '/'],
              ['Rename a task', 'Double-click'],
              ['Close a panel', 'Esc'],
            ].map(([what, key]) => (
              <li key={what} className="flex items-center justify-between">
                {what}
                <kbd className="rounded-md border border-line bg-surface2 px-1.5 py-0.5 font-sans text-[10px] font-bold text-txt">{key}</kbd>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-mut/80">Quick add understands “tomorrow 5pm”, “!high” and “#category”.</p>
        </Card>

        <Card title="Your data" icon={<Shield size={11} />}>
          <div className="mt-2.5 flex gap-2">
            <button onClick={() => void app.exportData()} className={btn}>
              <Download size={12} /> Export JSON
            </button>
            <button onClick={() => void deleteAccount()} className={`${btn} text-danger hover:bg-danger/10`}>
              <Trash2 size={12} /> {acc?.local ? 'Erase all' : 'Delete account'}
            </button>
          </div>
          <a href={`${API_URL}/privacy`} target="_blank" rel="noreferrer" className="mt-2.5 block text-[11px] font-bold text-mut underline-offset-2 hover:text-txt hover:underline">
            Privacy policy ↗
          </a>
        </Card>

        <p className="pt-1 text-center text-[11px] font-semibold text-mut/70">Smart Tasks v{manifestVersion()} · made with 💚</p>
      </div>
    </div>
  );
}
