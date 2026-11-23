import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react';
import { addDays, cx, isSameDay, startOfDay } from '../../../lib/utils';

const DEFAULT_HOUR = 17;
const QUICK_TIMES: Array<[number, number]> = [
  [9, 0],
  [12, 0],
  [15, 0],
  [18, 0],
  [21, 0],
];
const WEEK = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const fmtTime = (h: number, m: number) => {
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ap}`;
};
const fmtDate = (ms: number) => {
  const today = startOfDay(Date.now()).getTime();
  const d = startOfDay(ms).getTime();
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
};

/** Due date + time editor with themed, inline pickers (no native browser popups). */
export default function DueEditor({ value, onChange }: { value: number | null; onChange: (ms: number | null) => void }) {
  const [open, setOpen] = useState<'date' | 'time' | null>(null);
  // The last panel shown stays rendered while it collapses, so closing animates too.
  const [shown, setShown] = useState<'date' | 'time' | null>(null);
  const toggle = (k: 'date' | 'time') => {
    if (open === k) return setOpen(null);
    setShown(k);
    setOpen(k);
  };
  const d = value ? new Date(value) : null;

  const withDay = (dayMs: number) => {
    const n = new Date(dayMs);
    n.setHours(d ? d.getHours() : DEFAULT_HOUR, d ? d.getMinutes() : 0, 0, 0);
    return n.getTime();
  };
  const withTime = (h: number, m: number) => {
    const n = d ? new Date(d) : startOfDay(Date.now());
    n.setHours(h, m, 0, 0);
    // A time with no date yet that has already passed today means tomorrow.
    if (!d && n.getTime() < Date.now()) n.setDate(n.getDate() + 1);
    return n.getTime();
  };

  const quickDays: Array<[string, number]> = [
    ['Today', 0],
    ['Tomorrow', 1],
    ['Next week', 7],
  ];

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {quickDays.map(([label, off]) => {
          const day = addDays(startOfDay(Date.now()), off).getTime();
          const active = !!value && isSameDay(value, day);
          return (
            <button
              key={label}
              onClick={() => onChange(withDay(day))}
              className={cx(
                'press rounded-full border px-3 py-1.5 text-xs font-medium',
                active ? 'border-acc/40 bg-acc/15 text-acc' : 'border-white/[.06] bg-white/[.03] text-mut hover:text-txt',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex gap-1.5">
        <Trigger icon={<CalendarDays size={13} />} active={open === 'date'} onClick={() => toggle('date')}>
          {value ? fmtDate(value) : 'Pick a date'}
        </Trigger>
        <Trigger icon={<Clock size={13} />} active={open === 'time'} onClick={() => toggle('time')}>
          {d ? fmtTime(d.getHours(), d.getMinutes()) : 'Pick a time'}
        </Trigger>
        {value && (
          <button
            onClick={() => {
              onChange(null);
              setOpen(null);
            }}
            aria-label="Clear date and time"
            title="Clear"
            className="press grid w-9 shrink-0 place-items-center rounded-xl border border-white/[.06] bg-white/[.03] text-mut hover:border-danger/40 hover:text-danger"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div
        className="expander"
        data-open={!!open}
        style={{ marginTop: open ? 8 : 0, scrollMarginBottom: 88 }}
        inert={!open}
        onTransitionEnd={e => {
          // Once a panel has finished opening, glide it into view if it sits below the fold.
          if (open && e.target === e.currentTarget && e.propertyName === 'grid-template-rows')
            e.currentTarget.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }}
      >
        <div>
          {shown === 'date' && (
            <Calendar
              key="date"
              value={value}
              onPick={ms => {
                onChange(withDay(ms));
                setOpen(null);
              }}
            />
          )}
          {shown === 'time' && <TimePanel key="time" value={d} onPick={(h, m) => onChange(withTime(h, m))} onDone={() => setOpen(null)} />}
        </div>
      </div>
    </div>
  );
}

function Trigger({ icon, active, onClick, children }: { icon: React.ReactNode; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-expanded={active}
      className={cx(
        'press flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-left text-[12.5px] font-medium transition-colors',
        active ? 'border-acc/40 bg-acc/10 text-acc' : 'border-white/[.06] bg-black/20 text-txt hover:border-white/[.12]',
      )}
    >
      <span className={active ? 'text-acc' : 'text-mut'}>{icon}</span>
      <span className="truncate">{children}</span>
    </button>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="anim-pop rounded-2xl border border-white/[.06] bg-black/25 p-3">{children}</div>;
}

function Calendar({ value, onPick }: { value: number | null; onPick: (dayMs: number) => void }) {
  const base = value ? new Date(value) : new Date();
  const [month, setMonth] = useState(() => new Date(base.getFullYear(), base.getMonth(), 1));
  const [dir, setDir] = useState<1 | -1 | 0>(0);
  const today = startOfDay(Date.now()).getTime();

  const lead = (month.getDay() + 6) % 7; // Monday first
  const daysIn = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: Array<number | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysIn }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1).getTime()),
  ];
  const shift = (n: 1 | -1) => {
    setDir(n);
    setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1));
  };
  const slide = dir === 1 ? 'anim-slide-l' : dir === -1 ? 'anim-slide-r' : '';

  return (
    <Panel>
      <div className="mb-2 flex items-center justify-between">
        <button onClick={() => shift(-1)} aria-label="Previous month" className="press rounded-lg p-1 text-mut hover:bg-white/[.05] hover:text-txt">
          <ChevronLeft size={15} />
        </button>
        <span key={month.getTime()} className={cx('text-[13px] font-medium', slide)}>{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</span>
        <button onClick={() => shift(1)} aria-label="Next month" className="press rounded-lg p-1 text-mut hover:bg-white/[.05] hover:text-txt">
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 pb-1 text-center">
        {WEEK.map(w => (
          <span key={w} className="text-[10.5px] font-medium text-mut/70">
            {w}
          </span>
        ))}
      </div>
      <div key={month.getTime()} className={cx('grid grid-cols-7 gap-0.5 text-center', slide)}>
        {cells.map((ms, i) =>
          ms === null ? (
            <span key={`e${i}`} />
          ) : (
            <button
              key={ms}
              onClick={() => onPick(ms)}
              className={cx(
                'press mx-auto grid h-8 w-8 place-items-center rounded-full text-[12.5px] transition-colors',
                value && isSameDay(value, ms)
                  ? 'border border-acc bg-acc/10 font-semibold text-acc'
                  : ms === today
                    ? 'font-semibold text-acc hover:bg-acc/10'
                    : ms < today
                      ? 'text-mut/40 hover:bg-white/[.04]'
                      : 'text-txt hover:bg-white/[.06]',
              )}
            >
              {new Date(ms).getDate()}
            </button>
          ),
        )}
      </div>
    </Panel>
  );
}

function TimePanel({ value, onPick, onDone }: { value: Date | null; onPick: (h: number, m: number) => void; onDone: () => void }) {
  const h24 = value ? value.getHours() : DEFAULT_HOUR;
  const min = value ? value.getMinutes() : 0;
  const pm = h24 >= 12;
  const h12 = h24 % 12 || 12;
  const to24 = (h: number, isPm: boolean) => (h % 12) + (isPm ? 12 : 0);

  const chip = (active: boolean) =>
    cx(
      'press rounded-full border py-1 text-[11.5px] font-medium',
      active ? 'border-acc/40 bg-acc/10 text-acc' : 'border-white/[.06] bg-white/[.03] text-mut hover:text-txt',
    );

  return (
    <Panel>
      <div className="grid grid-cols-5 gap-1.5">
        {QUICK_TIMES.map(([h, m]) => (
          <button
            key={h}
            onClick={() => {
              onPick(h, m);
              onDone();
            }}
            className={chip(!!value && h24 === h && min === m)}
          >
            {`${h % 12 || 12} ${h >= 12 ? 'PM' : 'AM'}`}
          </button>
        ))}
      </div>

      <div className="my-3 h-px bg-white/[.05]" />

      <div className="flex items-center gap-2">
        <NumField label="Hour" value={h12} min={1} max={12} wrap onChange={h => onPick(to24(h, pm), min)} />
        <span className="text-lg text-mut">:</span>
        <NumField label="Minute" value={min} min={0} max={59} pad wrap onChange={m => onPick(h24, m)} />
        <div className="relative ml-auto grid h-10 grid-cols-2 rounded-xl border border-white/[.06] bg-black/20 p-1">
          <span
            aria-hidden="true"
            className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-lg border border-acc/40 bg-acc/10 transition-transform duration-300 ease-[var(--ease-out)]"
            style={{ transform: pm ? 'translateX(100%)' : 'none' }}
          />
          {(['AM', 'PM'] as const).map(ap => {
            const on = (ap === 'PM') === pm;
            return (
              <button
                key={ap}
                onClick={() => !on && onPick(to24(h12, ap === 'PM'), min)}
                aria-pressed={on}
                className={cx('press relative z-10 rounded-lg px-3 text-[12px] font-semibold', on ? 'text-acc' : 'text-mut hover:text-txt')}
              >
                {ap}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-4 gap-1.5">
        {[0, 15, 30, 45].map(m => (
          <button key={m} onClick={() => onPick(h24, m)} className={chip(min === m)}>
            :{String(m).padStart(2, '0')}
          </button>
        ))}
      </div>

      <button onClick={onDone} className="press btn-acc mt-3 tabular-nums w-full rounded-full py-2 text-[12.5px] font-semibold">
        Set {fmtTime(h24, min)}
      </button>
    </Panel>
  );
}

/** A small number box you can type into; arrow keys and the wheel nudge it. */
function NumField({
  label,
  value,
  min,
  max,
  pad,
  wrap,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  pad?: boolean;
  wrap?: boolean;
  onChange: (v: number) => void;
}) {
  const show = (v: number) => (pad ? String(v).padStart(2, '0') : String(v));
  const [draft, setDraft] = useState<string | null>(null);
  const step = (n: number) => {
    let v = value + n;
    if (wrap) v = ((v - min + (max - min + 1)) % (max - min + 1)) + min;
    onChange(Math.max(min, Math.min(max, v)));
  };
  const commit = () => {
    if (draft === null) return;
    const v = parseInt(draft, 10);
    if (!Number.isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
    setDraft(null);
  };
  return (
    <input
      aria-label={label}
      inputMode="numeric"
      maxLength={2}
      value={draft ?? show(value)}
      onFocus={e => e.currentTarget.select()}
      onChange={e => {
        const t = e.target.value.replace(/\D/g, '');
        setDraft(t);
        const v = parseInt(t, 10);
        if (!Number.isNaN(v) && v >= min && v <= max) onChange(v);
      }}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          e.currentTarget.blur();
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          setDraft(null);
          step(e.key === 'ArrowUp' ? 1 : -1);
        }
      }}
      onWheel={e => {
        setDraft(null);
        step(e.deltaY < 0 ? 1 : -1);
      }}
      className="h-10 w-14 rounded-xl border border-white/[.06] bg-black/20 text-center text-[18px] font-medium tabular-nums text-txt outline-none transition-colors focus:border-acc/50 focus:shadow-[0_0_0_3px_rgba(63,209,197,.12)]"
    />
  );
}
