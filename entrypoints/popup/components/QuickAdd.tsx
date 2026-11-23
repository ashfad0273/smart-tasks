import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Check, CornerDownLeft, Flame, Hash } from 'lucide-react';
import { cx, formatDue, parseQuickAdd, PRIORITY_META } from '../../../lib/utils';
import { useApp } from '../state/AppContext';

const IDEAS = ['Water the plants tomorrow 9am', 'Reply to Sam #work !high', 'Book dentist friday 4pm', 'Plan the week sunday'];

/** Quick-add panel that slides up above the floating plus button. Stays open for several tasks in a row. */
export default function QuickAdd({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp();
  const [text, setText] = useState('');
  const [added, setAdded] = useState(0);
  const [shake, setShake] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const idea = useMemo(() => IDEAS[Math.floor(Math.random() * IDEAS.length)], [open]);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Reset and focus only when the panel opens (not on every parent render).
  useEffect(() => {
    if (!open) return;
    setAdded(0);
    const id = setTimeout(() => ref.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(id);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const parsed = useMemo(() => parseQuickAdd(text), [text]);
  const cat = parsed.categoryName
    ? (app.categories.find(c => c.name.toLowerCase().replace(/\s+/g, '') === parsed.categoryName!.toLowerCase()) ??
      app.categories.find(c => c.name.toLowerCase().startsWith(parsed.categoryName!.toLowerCase())) ??
      null)
    : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      setShake(Date.now());
      return;
    }
    void app.createTask({
      title: parsed.title,
      dueAt: parsed.dueAt,
      priority: parsed.priority,
      categoryId: cat?.id ?? (app.filter !== 'all' ? app.filter : null),
    });
    setText('');
    setAdded(n => n + 1);
    if (app.tab === 'completed') app.setTab('pending');
  };

  return (
    <div className={cx('absolute inset-0 z-30', !open && 'pointer-events-none')} aria-hidden={!open}>
      <div
        onClick={onClose}
        className={cx('absolute inset-0 bg-black/55 backdrop-blur-[2px] transition-opacity duration-300', open ? 'opacity-100' : 'opacity-0')}
      />
      <form
        onSubmit={submit}
        inert={!open}
        className={cx(
          'absolute inset-x-4 bottom-20 rounded-3xl border border-white/[.07] bg-surface p-3.5 shadow-[0_24px_60px_rgba(0,0,0,.55)] transition-[transform,opacity] duration-300 ease-[var(--ease-out)]',
          open ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0',
        )}
        style={{ transformOrigin: 'bottom right' }}
      >
        <div className="flex items-center justify-between px-1">
          <p className="text-[12px] font-semibold text-mut">New task</p>
          {added > 0 && (
            <span key={added} className="anim-pop flex items-center gap-1 text-[11px] font-semibold text-acc">
              <Check size={12} /> {added === 1 ? 'Added' : `${added} added`}
            </span>
          )}
        </div>
        <div key={shake} className={cx('mt-2 flex items-center gap-2', shake > 0 && 'anim-shake')}>
          <input
            ref={ref}
            value={text}
            maxLength={500}
            onChange={e => setText(e.target.value)}
            placeholder={idea}
            aria-label="New task"
            className="min-w-0 flex-1 rounded-2xl border border-white/[.06] bg-black/25 px-4 py-3 text-[14px] outline-none placeholder:text-mut/50 focus:border-acc/40"
          />
          <button
            type="submit"
            aria-label="Add task"
            className="press btn-acc grid h-[46px] w-[46px] shrink-0 place-items-center rounded-2xl"
          >
            <CornerDownLeft size={16} />
          </button>
        </div>
        <div className="mt-2.5 flex min-h-[22px] flex-wrap items-center gap-1.5 px-1 text-[11px] font-medium">
          {parsed.dueAt && (
            <span className="anim-pop inline-flex items-center gap-1 rounded-full border border-sun/30 px-2 py-0.5 text-sun">
              <CalendarClock size={10} /> {formatDue(parsed.dueAt).label}
            </span>
          )}
          {parsed.priority && (
            <span
              className="anim-pop inline-flex items-center gap-1 rounded-full border px-2 py-0.5"
              style={{ borderColor: `${PRIORITY_META[parsed.priority].color}55`, color: PRIORITY_META[parsed.priority].color }}
            >
              <Flame size={10} /> {PRIORITY_META[parsed.priority].label}
            </span>
          )}
          {parsed.categoryName && (
            <span
              className="anim-pop inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-mut"
              style={cat ? { borderColor: `${cat.color}55`, color: cat.color } : undefined}
            >
              <Hash size={10} /> {cat ? cat.name : `${parsed.categoryName}?`}
            </span>
          )}
          {!parsed.dueAt && !parsed.priority && !parsed.categoryName && (
            <span className="text-mut/60">Try: tomorrow 5pm · !high · #work</span>
          )}
        </div>
      </form>
    </div>
  );
}
