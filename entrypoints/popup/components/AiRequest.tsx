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
      title={r ? (r.note ?? label(task)) : `Hand this task to ${task.source?.agent ?? 'your AI agent'} to do`}
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

/** Full panel in the task editor: send, status, the agent's note, and cancel. */
export function AiPanel({ task }: { task: Task }) {
  const app = useApp();
  const r = task.aiRequest;
  const set = (aiRequest: Task['aiRequest']) => void app.updateTask(task.id, { aiRequest });
  const from = task.source ? `${task.source.agent}${task.source.session ? ' (same session first)' : ''}` : 'any connected agent';
  return (
    <div className="mt-2 rounded-xl border border-white/[.06] bg-black/20 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Bot size={14} className="shrink-0 text-acc" />
        <div className="min-w-0 flex-1 text-[11.5px] leading-snug">
          {!r && <span className="text-mut">Let the AI do this. Goes to {from}.</span>}
          {r?.status === 'approved' && <span className="text-pop">Waiting for {from} to pick it up</span>}
          {r?.status === 'claimed' && <span className="text-pop">{r.by ?? 'AI'} is working on it</span>}
          {r?.status === 'done' && <span className="text-acc">Done by {r.by ?? 'AI'}</span>}
        </div>
        {!r || r.status === 'done' ? (
          <button
            onClick={() => set({ status: 'approved', at: Date.now(), by: null, session: null, note: null })}
            className="press shrink-0 rounded-lg bg-acc px-2.5 py-1 text-[11.5px] font-bold text-black hover:brightness-110"
          >
            {r ? 'Send again' : 'OK, send to AI'}
          </button>
        ) : (
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
      {r?.note && <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-txt/85">{r.note}</p>}
    </div>
  );
}
