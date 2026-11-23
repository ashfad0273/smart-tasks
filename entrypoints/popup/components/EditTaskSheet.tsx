import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ExternalLink, GripVertical, Plus, Trash2, X } from 'lucide-react';
import {
  addDays,
  cx,
  dateInputToMs,
  dayAtTime,
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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <span className="mb-1.5 block text-xs font-semibold text-mut">{label}</span>
      {children}
    </div>
  );
}


export default function EditTaskSheet() {
  const app = useApp();
  const task = app.tasks.find(t => t.id === app.editTaskId);

  const [title, setTitle] = useState(task?.title ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(task?.categoryId ?? null);
  const [priority, setPriority] = useState<Priority | null>(task?.priority ?? null);
  const [dueAt, setDueAt] = useState<number | null>(task?.dueAt ?? null);
  const [subtasks, setSubtasks] = useState<Subtask[]>(() => (task?.subtasks ?? []).map(s => ({ ...s })));

  const [catOpen, setCatOpen] = useState(false);
  const [newSub, setNewSub] = useState('');
  const [editingSub, setEditingSub] = useState<string | null>(null);
  const [editSubText, setEditSubText] = useState('');

  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; y: number } | null>(null);

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

  const cat = app.categoryById(categoryId);
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
    <Sheet onClose={() => void requestClose()} label="Edit task">
      <div className="px-4">
        <div className="flex items-center justify-between pb-2">
          <h2 className="text-base font-semibold">Edit task</h2>
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
          rows={notes ? 3 : 1}
          className="mt-2 w-full resize-none rounded-2xl border border-transparent bg-transparent px-3.5 py-1.5 text-xs leading-relaxed text-txt outline-none placeholder:text-mut/50 focus:border-line focus:bg-surface2"
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

        <Section label="Category">
          <div className="relative">
            <button
              onClick={() => setCatOpen(o => !o)}
              aria-expanded={catOpen}
              className="press flex w-full items-center justify-between rounded-2xl border border-line bg-surface2 px-3 py-2.5 text-sm font-semibold"
            >
              <span className="flex min-w-0 items-center gap-2">
                {cat ? (
                  <>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cat.color }} />
                    <span className="truncate">{cat.name}</span>
                  </>
                ) : (
                  <span className="text-mut">No category</span>
                )}
              </span>
              <ChevronDown size={14} className={cx('shrink-0 text-mut transition-transform', catOpen && 'rotate-180')} />
            </button>
            {catOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setCatOpen(false)} />
                <div className="anim-pop absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-2xl border border-line bg-surface p-1 shadow-2xl">
                  {[{ id: null as string | null, name: 'No category', color: '' }, ...app.categories].map(c => (
                    <button
                      key={c.id ?? 'none'}
                      onClick={() => {
                        setCategoryId(c.id);
                        setCatOpen(false);
                      }}
                      className={cx('flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm hover:bg-surface2', !c.id && 'text-mut')}
                    >
                      {c.color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />}
                      <span className="truncate">{c.name}</span>
                      {categoryId === c.id && <Check size={13} className="ml-auto shrink-0 text-acc" />}
                    </button>
                  ))}
                </div>
              </>
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
                  'press rounded-xl border py-2 text-xs font-semibold transition-all',
                  priority === p ? 'scale-[1.03] border-transparent text-white shadow-lg' : 'border-line bg-surface2 text-mut hover:text-txt',
                )}
                style={priority === p ? { background: PRIORITY_META[p].color } : undefined}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: PRIORITY_META[p].color }} /> {PRIORITY_META[p].label}
              </button>
            ))}
          </div>
        </Section>

        <Section label="When">
          <div className="flex flex-wrap gap-1.5">
            {([['Today', 0], ['Tomorrow', 1], ['Next week', 7]] as Array<[string, number]>).map(([label, off]) => (
              <button
                key={label}
                onClick={() => setDueAt(dayAtTime(off, dueAt))}
                className={cx(
                  'press rounded-full border px-3 py-1.5 text-xs font-semibold',
                  isDayActive(off) ? 'border-acc/50 bg-acc/15 text-acc' : 'border-line bg-surface2 text-mut hover:text-txt',
                )}
              >
                {label}
              </button>
            ))}
            <input
              type="date"
              value={toDateInput(dueAt)}
              onChange={e => e.target.value && setDueAt(dateInputToMs(e.target.value, dueAt))}
              aria-label="Due date"
              className="rounded-full border border-line bg-surface2 px-3 py-1.5 text-xs font-semibold text-txt outline-none focus:border-acc/60"
            />
            <input
              type="time"
              value={toTimeInput(dueAt)}
              onChange={e => e.target.value && setDueAt(timeInputToMs(e.target.value, dueAt))}
              aria-label="Due time"
              className="rounded-full border border-line bg-surface2 px-3 py-1.5 text-xs font-semibold text-txt outline-none focus:border-acc/60"
            />
            {dueAt && (
              <button
                onClick={() => setDueAt(null)}
                className="press inline-flex items-center gap-1 rounded-full border border-line bg-surface2 px-3 py-1.5 text-xs font-semibold text-mut hover:border-danger/40 hover:text-danger"
              >
                <X size={10} /> Clear
              </button>
            )}
          </div>
          {dueAt && <p className="mt-1.5 text-[11px] font-semibold text-mut">You'll get a reminder at this time.</p>}
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

        <div className="sticky bottom-0 -mx-4 mt-4 flex gap-2 border-t border-white/[.05] bg-surface px-4 pb-4 pt-3">
          <button
            onClick={() => void remove()}
            className="press inline-flex shrink-0 items-center gap-1.5 rounded-full border border-danger/30 px-3.5 py-2.5 text-xs font-semibold text-danger hover:bg-danger/10"
          >
            <Trash2 size={13} /> Delete
          </button>
          <button onClick={() => void requestClose()} className="press btn-acc flex-1 rounded-full py-2.5 text-sm font-semibold">
            Done
          </button>
        </div>
      </div>
    </Sheet>
  );
}
