import { useState } from 'react';
import { Bot, Check, Loader2, Undo2 } from 'lucide-react';
import type { Task } from '../../../lib/types';
import { cx } from '../../../lib/utils';
import { useApp } from '../state/AppContext';

/** Tasks an agent wrote (or one you already sent) can be handed back with "OK, send to AI". */
export const canSendToAi = (t: Task) => !t.completedAt && (!!t.source || !!t.aiRequest);

function label(t: Task): string {
  const r = t.aiRequest;
  if (!r) return 'OK, send to AI';
  if (r.status === 'approved') return t.source ? `Sent to ${t.source.agent}` : 'Sent to AI';
  if (r.status === 'claimed') return `${r.by ?? 'AI'} is on it`;
  return `Done by ${r.by ?? 'AI'}`;
}

/** Compact chip for the task card. */
export function AiChip({ task }: { task: Task }) {
  const app = useApp();
  const r = task.aiRequest;
  const send = () => void app.updateTask(task.id, { aiRequest: { status: 'approved', at: Date.now(), by: null, session: null, note: null } });
  return (
    <button
      onClick={e => {
        e.stopPropagation();
        if (!r) send();
      }}
      title={r ? (r.note ?? (r.reply ? `You: ${r.reply}` : label(task))) : `Hand this task to ${task.source?.agent ?? 'your AI agent'} to do`}
      className={cx(
        'press inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5',
        !r ? 'bg-acc/15 text-acc hover:bg-acc/25' : r.status === 'done' ? 'bg-acc/10 text-acc' : 'bg-pop/12 text-pop',
      )}
    >
      {r?.status === 'claimed' ? <Loader2 size={11} className="animate-spin" /> : r?.status === 'done' ? <Check size={11} /> : <Bot size={11} />}
      {label(task)}
    </button>
  );
}

/** Full panel in the task editor: a plain OK or your own answer, status, the agent's note, and cancel. */
export function AiPanel({ task }: { task: Task }) {
  const app = useApp();
  const r = task.aiRequest;
  const [answer, setAnswer] = useState('');
  const set = (aiRequest: Task['aiRequest']) => void app.updateTask(task.id, { aiRequest });
  const send = () => {
    set({ status: 'approved', at: Date.now(), by: null, session: null, note: null, reply: answer.trim() || null });
    setAnswer('');
  };
  const from = task.source ? `${task.source.agent}${task.source.session ? ' (same session first)' : ''}` : 'any connected agent';
  const open = !r || r.status === 'done';
  return (
    <div className="mt-2 rounded-xl border border-white/[.06] bg-black/20 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Bot size={14} className="shrink-0 text-acc" />
        <div className="min-w-0 flex-1 text-[11.5px] leading-snug">
          {!r && <span className="text-mut">Answer the AI or just OK it. Goes to {from}.</span>}
          {r?.status === 'approved' && <span className="text-pop">Waiting for {from} to pick it up</span>}
          {r?.status === 'claimed' && <span className="text-pop">{r.by ?? 'AI'} is working on it</span>}
          {r?.status === 'done' && <span className="text-acc">Done by {r.by ?? 'AI'}</span>}
        </div>
        {!open && (
          <button
            onClick={() => set(null)}
            title="Take it back"
            className="press inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-mut hover:bg-white/[.06] hover:text-txt"
          >
            <Undo2 size={12} />
            Cancel
          </button>
        )}
      </div>
      {r?.reply && (
        <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-white/[.03] px-2.5 py-1.5 text-[11.5px] leading-relaxed text-txt/85">
          <span className="font-semibold text-mut">You: </span>
          {r.reply}
        </p>
      )}
      {r?.note && (
        <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-txt/85">
          <span className="font-semibold text-acc">{r.by ?? 'AI'}: </span>
          {r.note}
        </p>
      )}
      {open && (
        <div className="mt-2 flex items-end gap-2">
          <textarea
            value={answer}
            maxLength={5000}
            onChange={e => setAnswer(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Write an answer (optional)"
            aria-label="Your answer to the AI"
            rows={1}
            className="block max-h-28 min-h-[30px] flex-1 resize-none rounded-lg border border-white/[.06] bg-black/20 px-2.5 py-1.5 text-[12px] leading-snug outline-none [field-sizing:content] placeholder:text-mut/50 focus:border-acc/40"
          />
          <button
            onClick={send}
            className="press shrink-0 rounded-lg bg-acc px-2.5 py-1.5 text-[11.5px] font-bold text-black hover:brightness-110"
          >
            {answer.trim() ? 'Send answer' : r ? 'Send again' : 'OK, send to AI'}
          </button>
        </div>
      )}
    </div>
  );
}
