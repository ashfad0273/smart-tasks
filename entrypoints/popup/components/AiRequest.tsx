import { useEffect, useState } from 'react';
import { Bot, Check, ChevronDown, Loader2, PenLine, TriangleAlert, Undo2 } from 'lucide-react';
import type { AiRequest, Approval, Subtask, Task } from '../../../lib/types';
import { cx } from '../../../lib/utils';
import { useApp } from '../state/AppContext';

/*
 * "OK, send to AI": an agent marks one specific step as approvable (`approval`), you
 * press OK (or pick a choice, or write your own answer), and the agent claims it,
 * does it and reports back. Items without `approval` never get a button.
 */

export const isOpenRequest = (r: AiRequest | null | undefined): boolean => !!r && (r.status === 'approved' || r.status === 'claimed');
/** Request states worth showing (a cancelled send is as good as none). */
const shown = (r: AiRequest | null | undefined): r is AiRequest => !!r && r.status !== 'cancelled';

/** The task's own approval counts only when it has no subtasks (the button belongs on subtasks). */
export const taskApproval = (t: Task): Approval | null => (t.subtasks.length === 0 ? (t.approval ?? null) : null);

/** Anything AI-related to show for this task: an OK button, or a request in progress. */
export const hasAiState = (t: Task) =>
  (!t.completedAt && !!taskApproval(t)) || shown(t.aiRequest) || t.subtasks.some(s => (!s.done && !!s.approval) || shown(s.aiRequest));

export function newRequest(reply: string | null): AiRequest {
  return { id: crypto.randomUUID(), status: 'approved', at: Date.now(), by: null, session: null, note: null, reply: reply?.trim() || null };
}

/** "Delete classes clip-lg/md/sm and media 74, 80-84..." → "OK: delete classes clip-lg/md/sm and media…" */
export function okLabel(action: string, max = 46): string {
  let a = action.trim().replace(/\s+/g, ' ');
  if (/^[A-Z][a-z]/.test(a)) a = a[0].toLowerCase() + a.slice(1);
  if (a.length > max) {
    const cut = a.slice(0, max);
    const sp = cut.lastIndexOf(' ');
    a = `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '')}…`;
  }
  return `OK: ${a}`;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/** Re-render every half minute so "2m ago" stays true. */
function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, [on]);
}

const who = (r: AiRequest) => (r.session ? r.session.slice(0, 8) : (r.by ?? 'AI'));

/**
 * The OK block for one item (a subtask, or a task without subtasks): the labelled
 * button (or one per choice), a confirm step for irreversible actions, your own
 * answer, and the request's progress.
 */
export function AiAsk({
  approval,
  req,
  done,
  onSend,
  onCancel,
  compact = false,
}: {
  approval: Approval | null | undefined;
  req: AiRequest | null | undefined;
  done: boolean;
  onSend: (reply: string | null) => void;
  onCancel: () => void;
  compact?: boolean;
}) {
  const [confirming, setConfirming] = useState<string | null | undefined>(undefined); // undefined = not asking
  const [writing, setWriting] = useState(false);
  const [answer, setAnswer] = useState('');
  const [full, setFull] = useState(false);
  const [sending, setSending] = useState(false);
  useTick(req?.status === 'claimed' || req?.status === 'approved');
  // A new state from the server ends the local "sending" lock.
  useEffect(() => setSending(false), [req?.id, req?.status]);

  const canAsk = !!approval && !done && !isOpenRequest(req) && req?.status !== 'done';
  if (!canAsk && !shown(req)) return null;

  const send = (reply: string | null) => {
    if (sending) return; // a double click sends once
    setSending(true);
    setConfirming(undefined);
    setWriting(false);
    setAnswer('');
    onSend(reply);
  };
  // Irreversible actions ask once more (with the choice, if one was picked).
  const press = (reply: string | null) => (approval?.confirm ? setConfirming(reply) : send(reply));

  const text = compact ? 'text-[11px]' : 'text-[11.5px]';
  const btn = 'press inline-flex max-w-full items-center gap-1 rounded-lg px-2 py-1 font-semibold disabled:opacity-50';

  return (
    <div className={cx(compact ? 'mt-1.5' : 'mt-2 rounded-xl border border-white/[.06] bg-black/20 px-3 py-2.5', text)}>
      {/* progress */}
      {req?.status === 'approved' && (
        <div className="flex items-center gap-1.5 text-pop">
          <Bot size={12} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">Sent to AI · waiting</span>
          <button onClick={onCancel} className="press shrink-0 font-semibold text-mut underline-offset-2 hover:text-txt hover:underline">
            Cancel
          </button>
        </div>
      )}
      {req?.status === 'claimed' && (
        <div className="flex items-center gap-1.5 text-pop" title={req.session ? `Session ${req.session}` : undefined}>
          <Loader2 size={12} className="shrink-0 animate-spin" />
          <span className="min-w-0 truncate">
            Working · {who(req)} · {ago(req.at)}
          </span>
        </div>
      )}
      {req?.status === 'done' && (
        <div className="flex items-start gap-1.5 text-acc">
          <Check size={12} className="mt-px shrink-0" />
          <p className="min-w-0 whitespace-pre-wrap leading-snug">
            <span className="font-semibold">Done by {req.by ?? 'AI'}</span>
            {req.note && <span className="text-txt/75">: {req.note}</span>}
          </p>
        </div>
      )}
      {req?.status === 'returned' && (
        <div className="mb-1.5 flex items-start gap-1.5 rounded-lg bg-warn/10 px-2 py-1.5 text-warn">
          <TriangleAlert size={12} className="mt-px shrink-0" />
          <p className="min-w-0 whitespace-pre-wrap leading-snug">
            <span className="font-semibold">{req.by ?? 'AI'} needs you: </span>
            <span className="text-txt/85">{req.note ?? 'It could not finish this.'}</span>
          </p>
        </div>
      )}
      {req?.reply && req.status !== 'returned' && (
        <p className="mt-1 truncate text-mut" title={req.reply}>
          You: {req.reply}
        </p>
      )}

      {/* asking */}
      {canAsk && confirming !== undefined && (
        <div className="anim-pop rounded-lg border border-danger/30 bg-danger/[.06] px-2.5 py-2">
          <p className="font-semibold text-txt">This can't be undone. The agent will:</p>
          <p className="mt-0.5 whitespace-pre-wrap leading-snug text-txt/80">{approval!.action}</p>
          {confirming && <p className="mt-1 text-mut">Your answer: {confirming}</p>}
          <div className="mt-2 flex gap-1.5">
            <button disabled={sending} onClick={() => send(confirming)} className={cx(btn, 'bg-danger text-white hover:brightness-110')}>
              Yes, send to AI
            </button>
            <button onClick={() => setConfirming(undefined)} className={cx(btn, 'text-mut hover:bg-white/[.06] hover:text-txt')}>
              Back
            </button>
          </div>
        </div>
      )}
      {canAsk && confirming === undefined && (
        <>
          {full && <p className="mb-1.5 whitespace-pre-wrap leading-snug text-txt/80">{approval!.action}</p>}
          <div className="flex flex-wrap items-center gap-1.5">
            {approval!.choices?.length ? (
              approval!.choices.map(c => (
                <button key={c} disabled={sending} onClick={() => press(c)} title={approval!.action} className={cx(btn, 'bg-acc/15 text-acc hover:bg-acc/25')}>
                  {c}
                </button>
              ))
            ) : (
              <button disabled={sending} onClick={() => press(null)} title={approval!.action} className={cx(btn, 'min-w-0 bg-acc text-[#06201d] hover:brightness-110')}>
                <Bot size={12} className="shrink-0" />
                <span className="truncate">{req?.status === 'returned' ? 'OK, try again' : okLabel(approval!.action, compact ? 40 : 52)}</span>
              </button>
            )}
            {!writing && (
              <button onClick={() => setWriting(true)} className={cx(btn, 'text-mut hover:bg-white/[.06] hover:text-txt')}>
                <PenLine size={11} /> Write my own answer
              </button>
            )}
            {(approval!.choices?.length || approval!.action.length > (compact ? 40 : 52)) && (
              <button
                onClick={() => setFull(f => !f)}
                aria-expanded={full}
                title={full ? 'Hide the full action' : 'Show the full action'}
                className={cx(btn, 'px-1 text-mut hover:text-txt')}
              >
                <ChevronDown size={12} className={cx('transition-transform', full && 'rotate-180')} />
              </button>
            )}
          </div>
          {writing && (
            <div className="mt-1.5 flex items-end gap-1.5">
              <textarea
                autoFocus
                value={answer}
                maxLength={5000}
                onChange={e => setAnswer(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && answer.trim()) {
                    e.preventDefault();
                    press(answer);
                  }
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setWriting(false);
                  }
                }}
                placeholder="Your answer for the AI"
                aria-label="Your answer to the AI"
                rows={1}
                className="block max-h-28 min-h-[28px] flex-1 resize-none rounded-lg border border-white/[.06] bg-black/20 px-2 py-1 leading-snug outline-none [field-sizing:content] placeholder:text-mut/50 focus:border-acc/40"
              />
              <button disabled={!answer.trim() || sending} onClick={() => press(answer)} className={cx(btn, 'bg-acc text-[#06201d] hover:brightness-110')}>
                Send
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The task's own OK block in the editor (only for tasks without subtasks, or old requests). */
export function AiPanel({ task }: { task: Task }) {
  const app = useApp();
  const approval = taskApproval(task);
  return (
    <AiAsk
      approval={approval}
      req={task.aiRequest}
      done={!!task.completedAt}
      onSend={reply => {
        const aiRequest = newRequest(reply);
        // Sending a finished task again reopens it: agents only pick up open tasks.
        void app.updateTask(task.id, task.completedAt ? { aiRequest, completedAt: null } : { aiRequest });
      }}
      onCancel={() => task.aiRequest && void app.updateTask(task.id, { aiRequest: { ...task.aiRequest, status: 'cancelled', at: Date.now() } })}
    />
  );
}

/** Compact status for the task card. */
export function AiChip({ task }: { task: Task }) {
  const app = useApp();
  const items: Array<{ approval: Approval | null | undefined; req: AiRequest | null | undefined; done: boolean }> = [
    { approval: taskApproval(task), req: task.aiRequest, done: !!task.completedAt },
    ...task.subtasks.map((s: Subtask) => ({ approval: s.approval, req: s.aiRequest, done: s.done })),
  ];
  const working = items.find(i => i.req?.status === 'claimed')?.req;
  const returned = items.filter(i => i.req?.status === 'returned' && !i.done).length;
  const waiting = items.filter(i => i.req?.status === 'approved').length;
  const asks = items.filter(i => i.approval && !i.done && !isOpenRequest(i.req) && i.req?.status !== 'done' && i.req?.status !== 'returned').length;
  const own = taskApproval(task);
  const lastDone = items.filter(i => i.req?.status === 'done').sort((a, b) => b.req!.at - a.req!.at)[0]?.req;
  useTick(!!working);

  let label: string;
  let tone: string;
  let Icon = Bot;
  let spin = false;
  if (working) {
    label = `Working · ${who(working)} · ${ago(working.at)}`;
    tone = 'bg-pop/12 text-pop';
    Icon = Loader2;
    spin = true;
  } else if (returned) {
    label = returned === 1 ? 'AI needs you' : `AI needs you (${returned})`;
    tone = 'bg-warn/12 text-warn';
    Icon = TriangleAlert;
  } else if (waiting) {
    label = waiting === 1 ? 'Sent to AI · waiting' : `${waiting} sent to AI · waiting`;
    tone = 'bg-pop/12 text-pop';
  } else if (asks) {
    label = own && asks === 1 ? okLabel(own.action, 34) : asks === 1 ? '1 step to OK' : `${asks} steps to OK`;
    tone = 'bg-acc/15 text-acc hover:bg-acc/25';
  } else if (lastDone) {
    label = `Done by ${lastDone.by ?? 'AI'}`;
    tone = 'bg-acc/10 text-acc';
    Icon = Check;
  } else return null;

  // A plain OK on the task itself can be sent right from the card; anything else opens the editor.
  const quick = !working && !returned && !waiting && !!own && asks === 1 && !own.choices?.length && !own.confirm;
  return (
    <button
      onClick={e => {
        e.stopPropagation();
        if (quick) void app.updateTask(task.id, { aiRequest: newRequest(null) });
        else app.openEdit(task.id);
      }}
      title={own && asks ? own.action : label}
      className={cx('press inline-flex max-w-[240px] items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5', tone)}
    >
      <Icon size={11} className={cx('shrink-0', spin && 'animate-spin')} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Stored key order for subtasks (matches the server, so autosave sees no false changes). */
export const subShape = (s: Subtask): Subtask => ({
  id: s.id,
  title: s.title,
  done: s.done,
  ...(s.approval ? { approval: s.approval } : {}),
  ...(s.aiRequest ? { aiRequest: s.aiRequest } : {}),
});
