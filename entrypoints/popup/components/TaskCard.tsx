import { useEffect, useRef, useState } from 'react';
import { Check, CircleCheck, Clock, ExternalLink, ListChecks, Pencil, Trash2 } from 'lucide-react';
import { cx, formatDue, formatStamp, PRIORITY_META } from '../../../lib/utils';
import type { Task } from '../../../lib/types';
import { useApp } from '../state/AppContext';
import Burst from './Burst';

export default function TaskCard({ task, index }: { task: Task; index: number }) {
  const app = useApp();
  const cat = app.categoryById(task.categoryId);
  // Inside a category's own filter the chip says nothing new, so it folds away there.
  const showCat = !!cat && app.filter !== task.categoryId;
  const done = !!task.completedAt;
  const hasMeta = showCat || !!task.dueAt || !!task.url || done;
  const due = task.dueAt ? formatDue(task.dueAt) : null;
  const doneSubs = task.subtasks.filter(s => s.done).length;
  const [burst, setBurst] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!burst) return;
    const t = setTimeout(() => setBurst(0), 650);
    return () => clearTimeout(t);
  }, [burst]);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const toggle = () => {
    if (!done) setBurst(Date.now());
    void app.toggleTaskDone(task);
  };

  const commitRename = () => {
    const t = draft.trim();
    setRenaming(false);
    if (t && t !== task.title) void app.updateTask(task.id, { title: t });
    else setDraft(task.title);
  };

  const prio = task.priority ? PRIORITY_META[task.priority] : null;
  const dueTone = !due || done ? '' : due.overdue ? 'bg-danger/15 text-[#fda4af]' : due.label.startsWith('Today') ? 'bg-sun/15 text-sun' : 'bg-surface2 text-mut';

  return (
    <div
      className={cx(
        'anim-card group relative flex items-start gap-3 overflow-hidden border border-white/[.04] bg-white/[.015] px-4 py-3.5 transition-[background-color,border-radius] duration-300',
        // Single-line cards (no chips row) get a tighter corner so they don't look like pills.
        hasMeta ? 'rounded-xl' : 'rounded-lg',
        'hover:bg-white/[.03] focus-within:bg-white/[.03]',
      )}
      style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
    >
      {prio && !done && (
        <span className="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full" style={{ background: prio.color }} aria-hidden="true" />
      )}

      <button
        onClick={toggle}
        aria-label={done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
        className="press relative mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center"
      >
        {done ? (
          <span key="d" className="anim-check grid h-4 w-4 place-items-center rounded-[4px] border-[1.5px] border-acc bg-acc/10 text-acc">
            <Check size={11} strokeWidth={3.5} />
          </span>
        ) : (
          <span className="grid h-4 w-4 place-items-center rounded-[4px] border-[1.5px] border-mut text-transparent transition-colors hover:border-acc hover:bg-acc/10 hover:text-acc">
            <Check size={11} strokeWidth={3.5} />
          </span>
        )}
        {burst > 0 && <Burst key={burst} />}
      </button>

      <div className="min-w-0 flex-1">
        {renaming ? (
          <input
            ref={inputRef}
            value={draft}
            maxLength={500}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
                e.stopPropagation();
                setDraft(task.title);
                setRenaming(false);
              }
            }}
            aria-label="Task title"
            className="w-full rounded-md border border-acc bg-black/30 px-2.5 py-1 text-[13.5px] outline-none"
          />
        ) : (
          <button
            className="block w-full text-left"
            onClick={() => app.openEdit(task.id)}
            onDoubleClick={e => {
              e.preventDefault();
              setRenaming(true);
            }}
            title="Click to open · double-click to rename"
          >
            <span
              className={cx(
                'line-clamp-2 break-words text-[13.5px] leading-snug transition-colors',
                done ? 'text-mut line-through opacity-60' : 'text-txt',
              )}
            >
              {task.title}
              {task.subtasks.length > 0 && (
                <span
                  className={cx(
                    'ml-1.5 inline-flex translate-y-[-1px] items-center gap-0.5 whitespace-nowrap align-middle text-[11px] font-semibold tabular-nums no-underline',
                    doneSubs === task.subtasks.length ? 'text-acc' : 'text-mut',
                  )}
                  title={`${doneSubs} of ${task.subtasks.length} subtasks done`}
                >
                  <ListChecks size={11} />
                  {doneSubs}/{task.subtasks.length}
                </span>
              )}
            </span>
          </button>
        )}

        {/* Chips row folds open/closed smoothly instead of popping. */}
        <div className="expander" data-open={hasMeta} style={{ marginTop: hasMeta ? 8 : 0 }} inert={!hasMeta}>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
            {cat && (
              <button
                onClick={() => app.setFilter(cat.id)}
                inert={!showCat}
                className={cx(
                  'press inline-flex items-center gap-1 overflow-hidden whitespace-nowrap rounded-full py-0.5 transition-[max-width,opacity,padding,margin,transform] duration-300 ease-[var(--ease-out)]',
                  showCat ? 'max-w-[120px] px-2 opacity-100' : '-mr-1.5 max-w-0 scale-90 px-0 opacity-0',
                )}
                style={{ background: `${cat.color}22`, color: cat.color }}
                title={`Show only ${cat.name}`}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: cat.color }} />
                <span className="truncate">{cat.name}</span>
              </button>
            )}
            {due && (
              <span className={cx('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5', dueTone || 'bg-surface2 text-mut')}>
                <Clock size={10} />
                {due.overdue && !done ? `Overdue · ${due.label}` : due.label}
              </span>
            )}
            {task.completedAt && (
              <span
                className="anim-pop inline-flex shrink-0 items-center gap-1 rounded-full bg-acc/10 px-2 py-0.5 text-acc/90"
                title={`Added ${formatStamp(task.createdAt)} · Done ${formatStamp(task.completedAt)}`}
              >
                <CircleCheck size={10} /> Done {formatStamp(task.completedAt)}
              </span>
            )}
            {task.url && (
              <a
                href={task.url}
                target="_blank"
                rel="noreferrer"
                className="press inline-flex shrink-0 items-center gap-1 rounded-full bg-pop/15 px-2 py-0.5 text-pop hover:bg-pop/25"
                title={task.url}
              >
                <ExternalLink size={10} /> Open
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-md bg-surface/95 opacity-0 shadow-[0_0_12px_8px_var(--color-surface)] transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <button
          aria-label={`Edit "${task.title}"`}
          onClick={() => app.openEdit(task.id)}
          className="press rounded-md p-1.5 text-mut hover:text-acc"
        >
          <Pencil size={13} />
        </button>
        <button
          aria-label={`Delete "${task.title}"`}
          onClick={() => void app.deleteTask(task.id)}
          className="press rounded-md p-1.5 text-mut hover:text-[#ef4444]"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
