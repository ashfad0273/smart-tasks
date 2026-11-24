import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Bot, Check, ChevronDown, Copy, ExternalLink, GripVertical, Plus, Trash2, X } from 'lucide-react';
import { api, type ActivityEvent } from '../../../lib/api';
import {
  addDays,
  CATEGORY_COLORS,
  cx,
  dateInputToMs,
  dayAtTime,
  formatStamp,
  isSameDay,
  PRIORITY_META,
  startOfDay,
  timeInputToMs,
  toDateInput,
  toTimeInput,
  uid4,
} from '../../../lib/utils';
import type { Priority, Subtask, Task } from '../../../lib/types';
import { useApp } from '../state/AppContext';
import Sheet from './Sheet';
import { AiPanel, canSendToAi } from './AiRequest';
import DueEditor from './DueEditor';

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <span className="mb-1.5 block text-xs font-semibold text-mut">{label}</span>
      {children}
    </div>
  );
}


/** Desktop side panel: the same editor, docked to the right instead of a pop-up sheet. */
function Dock({ onClose, label, children }: { onClose: () => void; label: string; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Escape in a field that handles it itself (subtask rename) shouldn't close the panel.
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' && t.closest('[data-sub-row]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <aside
      aria-label={label}
      className="st-dock flex h-full w-[360px] shrink-0 flex-col border-l border-white/[.05] bg-[#0f181b]/80 animate-[dockIn_.32s_var(--ease-out)]"
    >
      <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto pt-3.5">{children}</div>
    </aside>
  );
}

const VERB: Record<ActivityEvent['type'], string> = {
  added: 'Added',
  completed: 'Completed',
  reopened: 'Reopened',
  deleted: 'Deleted',
  archived: 'Archived',
  restored: 'Restored',
  notice: 'Notification',
};

/** What happened to this task and who did it (you, or a named AI agent). */
function TaskHistory({ task }: { task: Task }) {
  const app = useApp();
  const session = app.account && !app.account.local ? app.account.token : null;
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  useEffect(() => {
    if (!session) return;
    let live = true;
    const t = setTimeout(
      () =>
        api.activity(session, '', 12, task.id).then(
          r => live && setEvents(r.events),
          () => live && setEvents([]),
        ),
      events ? 600 : 0, // after an edit, give the server a moment
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, task.id, task.completedAt, task.archivedAt, task.categoryId]);
  if (!session) return null;
  return (
    <Section label="Activity">
      {events === null ? (
        <div className="skeleton h-14 rounded-xl" />
      ) : events.length === 0 ? (
        <p className="px-1 text-[11.5px] text-mut">Nothing recorded yet.</p>
      ) : (
        <ol className="space-y-1">
          {events.map(e => (
            <li key={e.id} className="flex items-baseline gap-2 px-1 text-[11.5px]">
              <span className="w-[92px] shrink-0 tabular-nums text-mut">{formatStamp(e.at)}</span>
              <span className="min-w-0 flex-1 text-txt/85">
                {VERB[e.type]} by{' '}
                {e.by === 'agent' ? (
                  <span className="inline-flex items-center gap-0.5 font-semibold text-pop">
                    <Bot size={10} /> {e.agent || 'AI agent'}
                  </span>
                ) : (
                  'you'
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

export default function EditTaskSheet({ docked = false }: { docked?: boolean }) {
  const app = useApp();
  const Wrap = docked ? Dock : Sheet;
  const task = app.allTasks.find(t => t.id === app.editTaskId);

  const [title, setTitle] = useState(task?.title ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(task?.categoryId ?? null);
  const [priority, setPriority] = useState<Priority | null>(task?.priority ?? null);
  const [dueAt, setDueAt] = useState<number | null>(task?.dueAt ?? null);
  const [subtasks, setSubtasks] = useState<Subtask[]>(() => (task?.subtasks ?? []).map(s => ({ ...s })));

  const [newCat, setNewCat] = useState<string | null>(null);
  const [newSub, setNewSub] = useState('');
  const [editingSub, setEditingSub] = useState<string | null>(null);
  const [editSubText, setEditSubText] = useState('');

  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; y: number } | null>(null);

  // Changes that arrive from elsewhere (an AI agent, another device) while the editor is
  // open: take them for every field you haven't edited, so autosave doesn't write the old
  // value back over them.
  const seen = useRef(task);
  useEffect(() => {
    const prev = seen.current;
    seen.current = task;
    if (!task || !prev || prev.id !== task.id || prev === task) return;
    if (task.title !== prev.title && title.trim() === prev.title) setTitle(task.title);
    if ((task.notes || null) !== (prev.notes || null) && (notes.trim() || null) === (prev.notes || null)) setNotes(task.notes ?? '');
    if (task.categoryId !== prev.categoryId && categoryId === prev.categoryId) setCategoryId(task.categoryId);
    if (task.priority !== prev.priority && priority === prev.priority) setPriority(task.priority);
    if (task.dueAt !== prev.dueAt && dueAt === prev.dueAt) setDueAt(task.dueAt);
    const subs = JSON.stringify(task.subtasks);
    if (subs !== JSON.stringify(prev.subtasks) && JSON.stringify(subtasks) === JSON.stringify(prev.subtasks)) setSubtasks(task.subtasks.map(s => ({ ...s })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  // Autosave: only fields that differ from the stored task are written, shortly
  // after the user stops typing, and immediately when the sheet closes.
  const buildPatch = useCallback(() => {
    if (!task) return null;
    const p: Partial<Task> = {};
    const t = title.trim();
    if (t && t !== task.title) p.title = t;
    if ((notes.trim() || null) !== (task.notes || null)) p.notes = notes.trim() || null;
    if (categoryId !== task.categoryId) p.categoryId = categoryId;
    if (priority !== task.priority) p.priority = priority;
    if (dueAt !== task.dueAt) p.dueAt = dueAt;
    if (JSON.stringify(subtasks) !== JSON.stringify(task.subtasks)) p.subtasks = subtasks;
    return Object.keys(p).length ? p : null;
  }, [task, title, notes, categoryId, priority, dueAt, subtasks]);

  const flush = useCallback(async () => {
    const p = buildPatch();
    if (task && p) await app.updateTask(task.id, p);
  }, [app, task, buildPatch]);

  const flushRef = useRef(flush);
  flushRef.current = flush;
  const pending = !!buildPatch();
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => void flushRef.current(), 350);
    return () => clearTimeout(t);
  }, [pending, title, notes, categoryId, priority, dueAt, subtasks]);
  // Save whatever is left if the sheet unmounts (popup closed, task opened elsewhere).
  useEffect(() => () => void flushRef.current(), []);

  const requestClose = useCallback(async () => {
    await flush();
    app.closeEdit();
  }, [app, flush]);

  if (!task) return null;

  const createCat = async () => {
    const name = newCat?.trim();
    if (!name) return;
    const existing = app.categories.find(c => c.name.toLowerCase() === name.toLowerCase());
    const id = existing ? existing.id : await app.createCategory({ name, color: CATEGORY_COLORS[app.categories.length % CATEGORY_COLORS.length] });
    if (id) setCategoryId(id);
    setNewCat(null);
  };
  const doneSubs = subtasks.filter(s => s.done).length;

  const isDayActive = (offset: number) => !!dueAt && isSameDay(dueAt, addDays(startOfDay(Date.now()), offset));

  const addSub = () => {
    const t = newSub.trim();
    if (!t) return;
    setSubtasks(list => [...list, { id: uid4(), title: t.slice(0, 300), done: false }]);
    setNewSub('');
  };
  const toggleSub = (id: string) => setSubtasks(list => list.map(s => (s.id === id ? { ...s, done: !s.done } : s)));
  const removeSub = (id: string) => setSubtasks(list => list.filter(s => s.id !== id));
  const commitSubEdit = () => {
    if (editingSub == null) return;
    const t = editSubText.trim();
    setSubtasks(list => (t ? list.map(s => (s.id === editingSub ? { ...s, title: t } : s)) : list.filter(s => s.id !== editingSub)));
    setEditingSub(null);
  };

  const dragTarget = (): number | null => {
    if (!drag || !listRef.current) return null;
    const rows = Array.from(listRef.current.querySelectorAll<HTMLElement>('[data-sub-row]'));
    if (rows.length === 0) return null;
    const top = rows[0].getBoundingClientRect().top;
    const bottom = rows[rows.length - 1].getBoundingClientRect().bottom;
    const per = (bottom - top) / rows.length;
    return Math.max(0, Math.min(rows.length - 1, Math.round((drag.y - top) / per - 0.5)));
  };
  const finishDrag = () => {
    if (!drag) return;
    const to = dragTarget();
    if (to != null && to !== drag.from) {
      const from = drag.from;
      setSubtasks(list => {
        const next = [...list];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        return next;
      });
    }
    setDrag(null);
  };
  const moveSub = (i: number, delta: number) =>
    setSubtasks(list => {
      const j = i + delta;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const target = dragTarget();

  const remove = async () => {
    await app.deleteTask(task.id);
  };

  return (
    <Wrap onClose={() => void requestClose()} label="Edit task">
      <div className="px-4">
        <div className="flex items-center justify-between pb-2">
          {docked ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-mut">
              {(() => {
                const c = app.categoryById(categoryId);
                return c ? (
                  <>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} />
                    <span className="truncate">{c.name}</span>
                  </>
                ) : (
                  'No category'
                );
              })()}
            </span>
          ) : (
            <h2 className="text-base font-semibold">Edit task</h2>
          )}
          <button onClick={() => void requestClose()} aria-label="Close" className="press rounded-lg p-1 text-mut hover:text-txt">
            <X size={16} />
          </button>
        </div>

        <textarea
          value={title}
          maxLength={500}
          rows={1}
          onChange={e => setTitle(e.target.value.replace(/\n/g, ' '))}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void requestClose();
            }
          }}
          placeholder="Task title"
          aria-label="Task title"
          className="block max-h-24 min-h-[42px] w-full resize-none rounded-xl border border-white/[.06] bg-black/20 px-3.5 py-2.5 text-[13.5px] font-medium leading-snug outline-none [field-sizing:content] focus:border-acc/40 focus:shadow-[0_0_0_3px_rgba(63,209,197,.12)]"
        />
        <textarea
          value={notes}
          maxLength={5000}
          onChange={e => setNotes(e.target.value)}
          placeholder="Add notes…"
          aria-label="Notes"
          rows={1}
          className="mt-1 block max-h-32 min-h-[28px] w-full resize-none border-0 bg-transparent px-3.5 py-1 text-[12.5px] leading-relaxed text-txt outline-none [field-sizing:content] placeholder:text-mut/50"
        />
        {task.url && (
          <a
            href={task.url}
            target="_blank"
            rel="noreferrer"
            className="press mt-1 flex items-center gap-1.5 truncate rounded-xl bg-pop/10 px-3 py-2 text-[11px] font-semibold text-pop hover:bg-pop/15"
          >
            <ExternalLink size={11} className="shrink-0" />
            <span className="truncate">{task.url.replace(/^https?:\/\//, '')}</span>
          </a>
        )}
        {(canSendToAi(task) || !!task.aiRequest) && <AiPanel task={task} />}

        <Section label="Category">
          <div className="flex flex-wrap gap-1.5">
            {app.categories.map(c => {
              const on = categoryId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setCategoryId(on ? null : c.id)}
                  aria-pressed={on}
                  className={cx(
                    'press flex max-w-[160px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                    !on && 'border-white/[.06] bg-white/[.03] text-mut hover:text-txt',
                  )}
                  style={on ? { borderColor: c.color, color: c.color, background: `${c.color}14` } : undefined}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c.color }} />
                  <span className="truncate">{c.name}</span>
                </button>
              );
            })}
            {newCat === null ? (
              <button
                onClick={() => setNewCat('')}
                className="press flex items-center gap-1 rounded-full border border-dashed border-white/15 px-3 py-1.5 text-xs font-medium text-mut hover:border-acc/50 hover:text-acc"
              >
                <Plus size={12} /> New
              </button>
            ) : (
              <form
                onSubmit={e => {
                  e.preventDefault();
                  void createCat();
                }}
                className="anim-pop flex items-center gap-1 rounded-full border border-acc/40 bg-acc/5 py-0.5 pl-3 pr-0.5"
              >
                <input
                  autoFocus
                  value={newCat}
                  maxLength={40}
                  onChange={e => setNewCat(e.target.value)}
                  onBlur={() => !newCat.trim() && setNewCat(null)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setNewCat(null);
                    }
                  }}
                  placeholder="Category name"
                  aria-label="New category name"
                  className="w-28 bg-transparent text-xs text-txt outline-none placeholder:text-mut/60"
                />
                <button type="submit" disabled={!newCat.trim()} aria-label="Create category" className="press grid h-6 w-6 place-items-center rounded-full bg-acc/15 text-acc disabled:opacity-40">
                  <Check size={12} />
                </button>
              </form>
            )}
          </div>
        </Section>

        <Section label="Priority">
          <div className="grid grid-cols-3 gap-1.5">
            {(['low', 'med', 'high'] as Priority[]).map(p => (
              <button
                key={p}
                onClick={() => setPriority(priority === p ? null : p)}
                aria-pressed={priority === p}
                className={cx(
                  'press flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-semibold transition-colors',
                  priority === p ? '' : 'border-white/[.06] bg-white/[.03] text-mut hover:text-txt',
                )}
                style={
                  priority === p
                    ? { borderColor: PRIORITY_META[p].color, color: PRIORITY_META[p].color, background: `${PRIORITY_META[p].color}12` }
                    : undefined
                }
              >
                {PRIORITY_META[p].label}
              </button>
            ))}
          </div>
        </Section>

        <Section label="When">
          <DueEditor value={dueAt} onChange={setDueAt} />
          {dueAt && <p className="mt-2 text-[11px] text-mut">Reminder at this time.</p>}
        </Section>

        <Section label={`Subtasks${subtasks.length ? ` · ${doneSubs}/${subtasks.length}` : ''}`}>
          {subtasks.length > 0 && (
            <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-line">
              <div className="grad-acc h-full rounded-full transition-[width] duration-500" style={{ width: `${(doneSubs / subtasks.length) * 100}%` }} />
            </div>
          )}
          <div ref={listRef} className="space-y-0.5">
            {subtasks.map((s, i) => (
              <div
                key={s.id}
                data-sub-row
                className={cx(
                  'group/sub flex items-center gap-2 rounded-xl px-1 py-1.5',
                  drag?.from === i && 'opacity-40',
                  drag && target === i && drag.from !== i && 'ring-1 ring-acc/60',
                )}
              >
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Reorder (drag, or use arrow keys)"
                  className="cursor-grab touch-none text-mut/40 hover:text-mut"
                  onPointerDown={e => {
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    setDrag({ from: i, y: e.clientY });
                  }}
                  onPointerMove={e => setDrag(d => (d ? { ...d, y: e.clientY } : d))}
                  onPointerUp={finishDrag}
                  onKeyDown={e => {
                    if (e.key === 'ArrowUp') moveSub(i, -1);
                    if (e.key === 'ArrowDown') moveSub(i, 1);
                  }}
                >
                  <GripVertical size={14} />
                </span>
                <button onClick={() => toggleSub(s.id)} aria-label={s.done ? 'Mark subtask not done' : 'Complete subtask'} className="press shrink-0">
                  {s.done ? (
                    <span className="anim-check grad-acc grid h-4 w-4 place-items-center rounded-full text-white">
                      <Check size={10} strokeWidth={3.5} />
                    </span>
                  ) : (
                    <span className="block h-4 w-4 rounded-full border-2 border-mut/40 hover:border-acc" />
                  )}
                </button>
                {editingSub === s.id ? (
                  <input
                    autoFocus
                    value={editSubText}
                    onChange={e => setEditSubText(e.target.value)}
                    onBlur={commitSubEdit}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitSubEdit();
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setEditingSub(null);
                      }
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-acc/50 bg-surface2 px-2 py-1 text-xs outline-none"
                  />
                ) : (
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      setEditingSub(s.id);
                      setEditSubText(s.title);
                    }}
                  >
                    <span className={cx('block truncate text-xs font-semibold', s.done ? 'text-mut line-through' : 'text-txt')}>{s.title}</span>
                  </button>
                )}
                <button
                  onClick={() => removeSub(s.id)}
                  aria-label="Remove subtask"
                  className="shrink-0 rounded p-0.5 text-mut/40 opacity-0 transition-opacity hover:text-danger focus:opacity-100 group-hover/sub:opacity-100"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              value={newSub}
              onChange={e => setNewSub(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addSub();
                }
              }}
              placeholder="Break it down… (Enter to add)"
              aria-label="New subtask"
              className="min-w-0 flex-1 rounded-xl border border-dashed border-line bg-transparent px-2.5 py-1.5 text-xs outline-none placeholder:text-mut/50 focus:border-acc/50"
            />
            <button
              onClick={addSub}
              aria-label="Add subtask"
              disabled={!newSub.trim()}
              className="press grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line text-mut hover:border-acc/40 hover:text-acc disabled:opacity-40"
            >
              <Plus size={13} />
            </button>
          </div>
        </Section>

        {docked && <TaskHistory task={task} />}

        {task && (
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-mut">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-mut/50" /> Added {formatStamp(task.createdAt)}
            </span>
            {task.completedAt && (
              <span className="inline-flex items-center gap-1.5 text-acc/90">
                <span className="h-1.5 w-1.5 rounded-full bg-acc" /> Completed {formatStamp(task.completedAt)}
              </span>
            )}
          </div>
        )}

        <div className="sticky bottom-0 -mx-4 mt-4 flex gap-2 border-t border-white/[.05] bg-surface px-4 pb-4 pt-3">
          <button
            onClick={() => void remove()}
            className="press inline-flex shrink-0 items-center gap-1.5 rounded-full border border-danger/30 px-3.5 py-2.5 text-xs font-semibold text-danger hover:bg-danger/10"
          >
            <Trash2 size={13} /> Delete
          </button>
          <button
            onClick={() => void app.archiveTask(task.id, !task.archivedAt)}
            title={task.archivedAt ? 'Bring back to your list' : 'Hide from your list without deleting'}
            className="press inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3.5 py-2.5 text-xs font-semibold text-mut hover:border-acc/40 hover:text-acc"
          >
            {task.archivedAt ? <ArchiveRestore size={13} /> : <Archive size={13} />} {task.archivedAt ? 'Restore' : 'Archive'}
          </button>
          {docked && (
            <button
              onClick={() => void flush().then(() => app.duplicateTask(task.id))}
              title="Make a copy with the same details"
              aria-label="Duplicate"
              className="press inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-2.5 text-xs font-semibold text-mut hover:border-acc/40 hover:text-acc"
            >
              <Copy size={13} />
            </button>
          )}
          <button onClick={() => void requestClose()} className="press btn-acc flex-1 rounded-full py-2.5 text-sm font-semibold">
            Done
          </button>
        </div>
      </div>
    </Wrap>
  );
}
