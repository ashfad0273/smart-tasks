import { useCallback, useEffect, useState } from 'react';
import { BellRing, Bot, Check, ChevronLeft, Copy, KeyRound, Pencil, Plus, ShieldCheck, Volume2 } from 'lucide-react';
import { storageGet, storageSet } from '../../../lib/ext';
import { AGENT_CLIENT_KEY, AGENT_NOTIFY_KEY, AGENT_SOUND_KEY } from '../../../lib/keys';
import { AGENT_CLIENTS } from '../../../lib/agents';
import { cx } from '../../../lib/utils';
import ScrollRow from '../components/ScrollRow';
import { Toggle } from './SettingsScreen';
import { api, API_URL, ApiError, type ActivityEvent, type AgentKey, type AgentPerm, type AgentPerms, type AgentStats } from '../../../lib/api';
import { useWide } from '../hooks/useWide';
import { useApp } from '../state/AppContext';

const MCP_URL = `${API_URL}/mcp`;

const RECENT_VERB: Record<ActivityEvent['type'], string> = {
  added: 'added',
  completed: 'completed',
  reopened: 'reopened',
  deleted: 'deleted',
  archived: 'archived',
  restored: 'restored',
  notice: 'sent',
};

const PERMS: Array<{ id: AgentPerm; label: string; sub: string }> = [
  { id: 'add', label: 'Add tasks', sub: 'Create new tasks and subtasks.' },
  { id: 'edit', label: 'Edit tasks', sub: 'Change titles, notes, due dates, priority and category.' },
  { id: 'complete', label: 'Mark tasks done', sub: 'Tick tasks off, or back to not done.' },
  { id: 'archive', label: 'Archive and restore', sub: 'Hide tasks and categories, and bring them back.' },
  { id: 'categories', label: 'Manage categories', sub: 'Create categories, and delete them if Delete is on too.' },
  { id: 'delete', label: 'Delete', sub: 'Permanently remove tasks and categories.' },
  { id: 'notify', label: 'Send notifications', sub: 'Ping you on your computers.' },
];

function when(ms: number | null): string {
  if (!ms) return 'never';
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Lets an AI agent (Claude, Codex, Gemini, Cursor, ...) manage tasks over MCP with a personal key. */
export default function AgentScreen() {
  const app = useApp();
  const acc = app.account;
  const session = acc && !acc.local ? acc.token : null;
  const [keys, setKeys] = useState<AgentKey[] | undefined>(undefined);
  // The just-created key's secret: shown once, then gone.
  const [fresh, setFresh] = useState<{ id: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [notifyOn, setNotifyOn] = useState<boolean | null>(null);
  const [soundOn, setSoundOn] = useState<boolean | null>(null);
  const [clientId, setClientId] = useState(AGENT_CLIENTS[0].id);
  const [perms, setPerms] = useState<AgentPerms | null>(null);
  const wide = useWide();
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [recent, setRecent] = useState<ActivityEvent[] | null>(null);

  useEffect(() => {
    void storageGet<string>(AGENT_CLIENT_KEY, AGENT_CLIENTS[0].id).then(id => {
      if (AGENT_CLIENTS.some(c => c.id === id)) setClientId(id);
    });
    void storageGet<boolean>(AGENT_NOTIFY_KEY, true).then(setNotifyOn);
    void storageGet<boolean>(AGENT_SOUND_KEY, true).then(setSoundOn);
  }, []);

  const fail = useCallback(
    (e: unknown) => app.showToast(e instanceof ApiError ? e.message : 'Something went wrong. Try again.', 'error'),
    [app],
  );

  useEffect(() => {
    if (!session) return;
    api.agentKeys(session).then(r => setKeys(r.keys), fail);
    api.agentPerms(session).then(r => setPerms(r.permissions), fail);
    api.stats(session).then(setStats, () => {});
    api.activity(session, '', 60).then(
      r => setRecent(r.events.filter(e => e.by === 'agent').slice(0, 6)),
      () => setRecent([]),
    );
  }, [session, fail]);

  const setPerm = async (id: AgentPerm, on: boolean) => {
    if (!session || !perms) return;
    const before = perms;
    setPerms({ ...perms, [id]: on });
    try {
      setPerms((await api.setAgentPerms(session, { [id]: on })).permissions);
    } catch (e) {
      setPerms(before);
      fail(e);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !app.confirmData && app.setScreen('settings');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  const client = AGENT_CLIENTS.find(c => c.id === clientId) ?? AGENT_CLIENTS[0];

  // Suggest the picked AI app's name, made unique ("Claude Code 2").
  const suggestName = () => {
    const taken = new Set((keys ?? []).map(k => k.name.toLowerCase()));
    if (!taken.has(client.name.toLowerCase())) return client.name;
    let n = 2;
    while (taken.has(`${client.name} ${n}`.toLowerCase())) n++;
    return `${client.name} ${n}`;
  };

  const create = async () => {
    if (!session) return;
    const name = newName.trim() || suggestName();
    setBusy(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const r = await api.createAgentKey(session, name, tz);
      setFresh({ id: r.key.id, token: r.token });
      setKeys(k => [r.key, ...(k ?? [])]);
      setNewName('');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    if (!session || !renaming) return;
    const { id, name } = renaming;
    const before = keys?.find(k => k.id === id);
    setRenaming(null);
    if (!before || !name.trim() || name.trim() === before.name) return;
    try {
      const r = await api.renameAgentKey(session, id, name);
      setKeys(k => k?.map(x => (x.id === id ? r.key : x)));
    } catch (e) {
      fail(e);
    }
  };

  const revoke = async (k: AgentKey) => {
    if (!session) return;
    const ok = await app.confirm({
      title: `Revoke "${k.name}"?`,
      message: `The key ending in ${k.hint} stops working right away. Other keys keep working, and your tasks are not touched.`,
      confirmText: 'Revoke',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.revokeAgentKey(session, k.id);
      setKeys(list => list?.filter(x => x.id !== k.id));
      if (fresh?.id === k.id) setFresh(null);
      app.showToast(`${k.name} disconnected`, 'success');
    } catch (e) {
      fail(e);
    }
  };

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(c => (c === label ? null : c)), 1600);
    } catch {
      app.showToast('Could not copy. Select the text instead.', 'error');
    }
  };

  const key = fresh?.token ?? 'YOUR_KEY';
  const setup = client.snippet(MCP_URL, key);
  const pickClient = (id: string) => {
    setClientId(id);
    void storageSet(AGENT_CLIENT_KEY, id);
  };

  const keysSection = keys === undefined ? null : (
            <section className="anim-card rounded-2xl border border-line bg-surface">
              <div className="flex items-center gap-2.5 px-3.5 pb-1 pt-3.5">
                <KeyRound size={14} className="shrink-0 text-mut" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">Access keys</p>
                  <p className="text-[11px] text-mut">One key per AI app. Its name shows in History next to what it changed.</p>
                </div>
              </div>

              {keys.length > 0 && (
                <ul className="divide-y divide-white/[.04] px-3.5">
                  {keys.map(k => (
                    <li key={k.id} className="py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-pop/25 bg-pop/10 text-pop">
                          <Bot size={13} />
                        </span>
                        <div className="min-w-0 flex-1">
                          {renaming?.id === k.id ? (
                            <input
                              autoFocus
                              value={renaming.name}
                              maxLength={40}
                              aria-label="Key name"
                              onChange={e => setRenaming({ id: k.id, name: e.target.value })}
                              onBlur={() => void rename()}
                              onKeyDown={e => {
                                if (e.key === 'Enter') void rename();
                                if (e.key === 'Escape') {
                                  e.stopPropagation();
                                  setRenaming(null);
                                }
                              }}
                              className="w-full rounded-md border border-acc/40 bg-black/20 px-1.5 py-0.5 text-[12.5px] outline-none"
                            />
                          ) : (
                            <button
                              onClick={() => setRenaming({ id: k.id, name: k.name })}
                              title="Rename"
                              className="group flex max-w-full items-center gap-1 text-left text-[12.5px] font-medium"
                            >
                              <span className="truncate">{k.name}</span>
                              <Pencil size={10} className="shrink-0 text-mut opacity-0 group-hover:opacity-100" />
                            </button>
                          )}
                          <p className="truncate text-[10.5px] text-mut">
                            Ends in {k.hint} · last used {when(k.lastUsed)}
                            {stats?.byAgent[k.name] ? ` · ${stats.byAgent[k.name]} changes in 30 days` : ''}
                          </p>
                        </div>
                        <button
                          onClick={() => void revoke(k)}
                          className="press shrink-0 rounded-full border border-white/[.06] px-2.5 py-1 text-[11px] font-medium text-mut hover:border-danger/40 hover:text-danger"
                        >
                          Revoke
                        </button>
                      </div>
                      {fresh?.id === k.id && (
                        <div className="anim-pop mt-2">
                          <div className="flex items-center gap-2 rounded-xl border border-acc/30 bg-acc/[.06] py-1.5 pl-3 pr-1.5">
                            <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-acc">{fresh.token}</code>
                            <CopyBtn done={copied === 'key'} onClick={() => void copy('key', fresh.token)} label="Copy key" />
                          </div>
                          <p className="mt-1.5 text-[11px] text-mut">Shown once. Anyone with this key can change your tasks.</p>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <form
                onSubmit={e => {
                  e.preventDefault();
                  void create();
                }}
                className="flex items-center gap-2 border-t border-white/[.04] p-3.5"
              >
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  maxLength={40}
                  placeholder={`Name, e.g. ${suggestName()}`}
                  aria-label="New key name"
                  className="min-w-0 flex-1 rounded-full border border-white/[.06] bg-black/20 px-3 py-1.5 text-[12.5px] outline-none placeholder:text-mut/60 focus:border-acc/40"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="press btn-acc inline-flex shrink-0 items-center gap-1 rounded-full px-3.5 py-1.5 text-[12px] font-semibold disabled:opacity-60"
                >
                  <Plus size={13} /> {busy ? 'Creating...' : keys.length ? 'Add key' : 'Create key'}
                </button>
              </form>
            </section>
  );
  const permsSection = (
            <section className="anim-card rounded-2xl border border-line bg-surface">
              <div className="flex items-center gap-2.5 px-3.5 pb-1 pt-3.5">
                <ShieldCheck size={14} className="shrink-0 text-mut" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">Permissions</p>
                  <p className="text-[11px] text-mut">What AI agents may do. Applies to every AI app, right away.</p>
                </div>
              </div>
              {perms === null ? (
                <div className="skeleton mx-3.5 my-3 h-24 rounded-xl" />
              ) : (
                <ul className="divide-y divide-white/[.04] px-3.5 pb-1.5">
                  {PERMS.map(p => (
                    <li key={p.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className={cx('text-[12.5px]', p.id === 'delete' && perms.delete && 'text-danger')}>{p.label}</p>
                        <p className="text-[10.5px] leading-snug text-mut">{p.sub}</p>
                      </div>
                      <Toggle label={p.label} on={perms[p.id]} onChange={v => void setPerm(p.id, v)} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
  );
  const notifySection = (
            <section className="anim-card divide-y divide-white/[.05] rounded-2xl border border-line bg-surface">
              <div className="flex items-center gap-2.5 p-3.5">
                <BellRing size={14} className="shrink-0 text-mut" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">Agent notifications</p>
                  <p className="text-[11px] text-mut">Let your agent ping you on this computer when it has news.</p>
                </div>
                {notifyOn !== null && (
                  <Toggle
                    label="Agent notifications"
                    on={notifyOn}
                    onChange={v => {
                      setNotifyOn(v);
                      void storageSet(AGENT_NOTIFY_KEY, v);
                    }}
                  />
                )}
              </div>
              <div className="expander" data-open={!!notifyOn}>
                <div>
                  <div className="flex items-center gap-2.5 p-3.5">
                    <Volume2 size={14} className="shrink-0 text-mut" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium">Sound</p>
                      <p className="text-[11px] text-mut">A soft two-note chime, different from reminders.</p>
                    </div>
                    {soundOn !== null && (
                      <Toggle
                        label="Notification sound"
                        on={soundOn}
                        onChange={v => {
                          setSoundOn(v);
                          void storageSet(AGENT_SOUND_KEY, v);
                          if (v) previewChime();
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            </section>
  );
  const connectSection = (
            <section className="anim-card rounded-2xl border border-line bg-surface py-3.5">
              <h3 className="px-3.5 text-[11px] font-semibold uppercase tracking-wider text-mut">Connect your AI</h3>
              <ScrollRow className="mt-2 gap-1.5 px-3.5 py-0.5">
                {AGENT_CLIENTS.map(c => (
                  <button
                    key={c.id}
                    onClick={() => pickClient(c.id)}
                    aria-pressed={c.id === client.id}
                    className={cx(
                      'press shrink-0 rounded-full border px-3 py-1 text-[11.5px] font-semibold',
                      c.id === client.id ? 'border-acc/40 bg-acc/15 text-acc' : 'border-white/[.05] bg-black/15 text-mut hover:text-txt',
                    )}
                  >
                    {c.name}
                  </button>
                ))}
              </ScrollRow>
              <div key={client.id} className="anim-pop px-3.5">
                <p className="mt-3 text-[11.5px] text-mut">{client.where}</p>
                <Snippet
                  text={setup}
                  pre={setup.includes('\n')}
                  done={copied === 'setup'}
                  onCopy={() => void copy('setup', setup)}
                />
                {client.after && <p className="mt-1.5 text-[11px] text-mut">{client.after}</p>}
                {!fresh && <p className="mt-1.5 text-[11px] text-mut">Add a key above, then copy this: YOUR_KEY is filled in for you.</p>}
              </div>
            </section>
  );
  const recentSection = (
    <section className="anim-card rounded-2xl border border-line bg-surface p-3.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-mut">Recent agent activity</h3>
      {recent === null ? (
        <div className="skeleton mt-2 h-16 rounded-xl" />
      ) : recent.length === 0 ? (
        <p className="mt-2 text-[11.5px] text-mut">Nothing yet. Changes your agents make show up here.</p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {recent.map(e => (
            <li key={e.id} className="flex items-baseline gap-2 text-[11.5px]">
              <span className="w-12 shrink-0 tabular-nums text-mut">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="min-w-0 flex-1 truncate text-txt/85">
                <span className="font-semibold text-pop">{e.agent || 'AI agent'}</span> {RECENT_VERB[e.type]} “{e.title}”
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );

  return (
    <div className="ambient flex h-full flex-col bg-bg">
      <header className={cx('flex items-center justify-between px-4 py-3', wide && 'hidden')}>
        <button onClick={() => app.setScreen('settings')} aria-label="Back" className="press rounded-lg p-1.5 text-mut hover:text-txt">
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-sm font-semibold">AI agent</h1>
        <span className="w-7" />
      </header>

      <div className={cx('hide-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto pb-5', wide ? 'mx-auto w-full max-w-[900px] px-7 pt-6' : 'px-5')}>
        {wide && (
          <div className="px-1">
            <h1 className="text-[19px] font-bold tracking-tight">AI agents</h1>
            <p className="text-[12px] text-mut">One key per AI app. Its name shows in History next to everything it changes.</p>
          </div>
        )}
        <div className={cx('anim-card flex items-start gap-3 px-1 pt-1', wide && 'hidden')}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-acc/15 bg-acc/10 text-acc">
            <Bot size={17} />
          </span>
          <p className="text-[12.5px] leading-relaxed text-mut">
            Let Claude or another AI agent add, edit, complete and archive your tasks, and send you notifications. You choose what it may do. Changes show up here instantly.
          </p>
        </div>

        {!session ? (
          <section className="anim-card rounded-2xl border border-line bg-surface p-4 text-center">
            <p className="text-[12.5px] text-mut">Agents connect through the cloud, so this needs a synced account.</p>
            <button
              onClick={() => app.setScreen('signup')}
              className="press btn-acc mt-3 w-full rounded-full py-2 text-[12.5px] font-semibold"
            >
              Sync my tasks
            </button>
          </section>
        ) : keys === undefined ? (
          <div className="skeleton h-24 rounded-2xl" />
        ) : (
          <>
            {keysSection}
            {wide ? (
              <div className="grid grid-cols-2 items-start gap-3">
                <div className="space-y-3">
                  {permsSection}
                  {notifySection}
                </div>
                <div className="space-y-3">
                  {connectSection}
                  {recentSection}
                </div>
              </div>
            ) : (
              <>
                {permsSection}
                {notifySection}
                {connectSection}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Play the agent chime right here so the user hears what it sounds like. */
function previewChime() {
  try {
    const ac = new AudioContext();
    const t = ac.currentTime + 0.02;
    for (const [freq, at, len, vol] of [
      [1318.5, 0, 0.55, 0.22],
      [1975.5, 0.11, 0.8, 0.18],
    ] as const) {
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(vol, t + at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + len);
      g.connect(ac.destination);
      const o = ac.createOscillator();
      o.frequency.value = freq;
      o.connect(g);
      o.start(t + at);
      o.stop(t + at + len + 0.05);
    }
    setTimeout(() => void ac.close(), 1500);
  } catch {
    /* no audio available */
  }
}

function CopyBtn({ done, onClick, label }: { done: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="press grid h-7 w-7 shrink-0 place-items-center rounded-lg text-mut hover:bg-white/[.06] hover:text-txt"
    >
      {done ? <Check size={13} className="anim-check text-acc" /> : <Copy size={13} />}
    </button>
  );
}

function Snippet({ text, done, onCopy, pre = false }: { text: string; done: boolean; onCopy: () => void; pre?: boolean }) {
  return (
    <div className="mt-1.5 flex items-start gap-1.5 rounded-xl border border-white/[.06] bg-black/25 py-1.5 pl-3 pr-1.5">
      <code
        className={cx(
          'min-w-0 flex-1 select-all py-1 font-mono text-[11px] leading-relaxed text-txt/90',
          pre ? 'hide-scrollbar max-h-48 overflow-auto whitespace-pre' : 'break-all',
        )}
      >
        {text}
      </code>
      <CopyBtn done={done} onClick={onCopy} label="Copy" />
    </div>
  );
}
