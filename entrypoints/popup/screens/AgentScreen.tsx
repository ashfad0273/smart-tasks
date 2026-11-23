import { useCallback, useEffect, useState } from 'react';
import { Bot, Check, ChevronLeft, Copy, KeyRound } from 'lucide-react';
import { api, API_URL, ApiError } from '../../../lib/api';
import { useApp } from '../state/AppContext';

type Info = { hint: string; createdAt: number; lastUsed: number | null } | null;

const MCP_URL = `${API_URL}/mcp`;

function when(ms: number | null): string {
  if (!ms) return 'never';
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Lets an AI agent (Claude Code, Cursor, ...) manage tasks over MCP with a personal key. */
export default function AgentScreen() {
  const app = useApp();
  const acc = app.account;
  const session = acc && !acc.local ? acc.token : null;
  const [info, setInfo] = useState<Info | undefined>(undefined);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const fail = useCallback(
    (e: unknown) => app.showToast(e instanceof ApiError ? e.message : 'Something went wrong. Try again.', 'error'),
    [app],
  );

  useEffect(() => {
    if (!session) return;
    api.agentToken(session).then(r => setInfo(r.token), fail);
  }, [session, fail]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !app.confirmData && app.setScreen('settings');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  const create = async () => {
    if (!session) return;
    if (info) {
      const ok = await app.confirm({
        title: 'Make a new key?',
        message: `The key ending in ${info.hint} stops working right away. Any agent using it will need the new one.`,
        confirmText: 'New key',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const { token } = await api.createAgentToken(session, tz);
      setFresh(token);
      setInfo({ hint: token.slice(-4), createdAt: Date.now(), lastUsed: null });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!session || !info) return;
    const ok = await app.confirm({
      title: 'Disconnect AI agents?',
      message: `The key ending in ${info.hint} stops working right away. Your tasks are not touched.`,
      confirmText: 'Disconnect',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.revokeAgentToken(session);
      setInfo(null);
      setFresh(null);
      app.showToast('Agent disconnected', 'success');
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

  const key = fresh ?? 'YOUR_KEY';
  const command = `claude mcp add --transport http smart-tasks ${MCP_URL} --header "Authorization: Bearer ${key}"`;

  return (
    <div className="ambient flex h-full flex-col bg-bg">
      <header className="flex items-center justify-between px-4 py-3">
        <button onClick={() => app.setScreen('settings')} aria-label="Back" className="press rounded-lg p-1.5 text-mut hover:text-txt">
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-sm font-semibold">AI agent</h1>
        <span className="w-7" />
      </header>

      <div className="hide-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-5">
        <div className="anim-card flex items-start gap-3 px-1 pt-1">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-acc/15 bg-acc/10 text-acc">
            <Bot size={17} />
          </span>
          <p className="text-[12.5px] leading-relaxed text-mut">
            Let Claude or another AI agent add, edit and complete your tasks. Changes show up here instantly.
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
        ) : info === undefined ? (
          <div className="skeleton h-24 rounded-2xl" />
        ) : (
          <>
            <section className="anim-card rounded-2xl border border-line bg-surface p-3.5">
              <div className="flex items-center gap-2.5">
                <KeyRound size={14} className="text-mut" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">Access key</p>
                  <p className="truncate text-[11px] text-mut">
                    {info ? `Ends in ${info.hint} · last used ${when(info.lastUsed)}` : 'No key yet'}
                  </p>
                </div>
                {info && (
                  <button onClick={() => void revoke()} className="press text-[12px] font-medium text-danger hover:underline">
                    Disconnect
                  </button>
                )}
              </div>

              {fresh ? (
                <div className="anim-pop mt-3">
                  <div className="flex items-center gap-2 rounded-xl border border-acc/30 bg-acc/[.06] py-1.5 pl-3 pr-1.5">
                    <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-acc">{fresh}</code>
                    <CopyBtn done={copied === 'key'} onClick={() => void copy('key', fresh)} label="Copy key" />
                  </div>
                  <p className="mt-1.5 text-[11px] text-mut">Shown once. Anyone with this key can change your tasks.</p>
                </div>
              ) : (
                <button
                  onClick={() => void create()}
                  disabled={busy}
                  className="press btn-acc mt-3 w-full rounded-full py-2 text-[12.5px] font-semibold disabled:opacity-60"
                >
                  {busy ? 'Creating...' : info ? 'Make a new key' : 'Create access key'}
                </button>
              )}
            </section>

            <section className="anim-card rounded-2xl border border-line bg-surface p-3.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-mut">Claude Code</h3>
              <p className="mt-1.5 text-[11.5px] text-mut">Run this once in a terminal:</p>
              <Snippet text={command} done={copied === 'cmd'} onCopy={() => void copy('cmd', command)} />

              <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-mut">Other MCP apps</h3>
              <p className="mt-1.5 text-[11.5px] text-mut">Server URL (HTTP):</p>
              <Snippet text={MCP_URL} done={copied === 'url'} onCopy={() => void copy('url', MCP_URL)} />
              <p className="mt-2 text-[11.5px] text-mut">Header:</p>
              <Snippet
                text={`Authorization: Bearer ${key}`}
                done={copied === 'hdr'}
                onCopy={() => void copy('hdr', `Authorization: Bearer ${key}`)}
              />
            </section>
          </>
        )}
      </div>
    </div>
  );
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

function Snippet({ text, done, onCopy }: { text: string; done: boolean; onCopy: () => void }) {
  return (
    <div className="mt-1.5 flex items-start gap-1.5 rounded-xl border border-white/[.06] bg-black/25 py-1.5 pl-3 pr-1.5">
      <code className="min-w-0 flex-1 select-all break-all py-1 font-mono text-[11px] leading-relaxed text-txt/90">{text}</code>
      <CopyBtn done={done} onClick={onCopy} label="Copy" />
    </div>
  );
}
