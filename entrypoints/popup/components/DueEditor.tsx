import { useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, X } from 'lucide-react';
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
        <Trigger icon={<CalendarDays size={13} />} active={open === 'date'} onClick={() => setOpen(open === 'date' ? null : 'date')}>
          {value ? fmtDate(value) : 'Pick a date'}
        </Trigger>
        <Trigger icon={<Clock size={13} />} active={open === 'time'} onClick={() => setOpen(open === 'time' ? null : 'time')}>
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

      {open === 'date' && (
        <Calendar
          value={value}
          onPick={ms => {
            onChange(withDay(ms));
            setOpen(null);
          }}
        />
      )}
      {open === 'time' && <TimePanel value={d} onPick={(h, m) => onChange(withTime(h, m))} onDone={() => setOpen(null)} />}
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
  return <div className="anim-pop mt-2 rounded-2xl border border-white/[.06] bg-black/25 p-3">{children}</div>;
}

function Calendar({ value, onPick }: { value: number | null; onPick: (dayMs: number) => void }) {
  const base = value ? new Date(value) : new Date();
  const [month, setMonth] = useState(() => new Date(base.getFullYear(), base.getMonth(), 1));
  const today = startOfDay(Date.now()).getTime();

  const lead = (month.getDay() + 6) % 7; // Monday first
  const daysIn = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: Array<number | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysIn }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1).getTime()),
  ];
  const shift = (n: number) => setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <Panel>
      <div className="mb-2 flex items-center justify-between">
        <button onClick={() => shift(-1)} aria-label="Previous month" className="press rounded-lg p-1 text-mut hover:bg-white/[.05] hover:text-txt">
          <ChevronLeft size={15} />
        </button>
        <span className="text-[13px] font-medium">{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</span>
        <button onClick={() => shift(1)} aria-label="Next month" className="press rounded-lg p-1 text-mut hover:bg-white/[.05] hover:text-txt">
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEK.map(w => (
          <span key={w} className="pb-1 text-[10.5px] font-medium text-mut/70">
            {w}
          </span>
        ))}
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

  const setH12 = (h: number) => onPick((h % 12) + (pm ? 12 : 0), min);
  const stepHour = (n: number) => setH12(((h12 - 1 + n + 12) % 12) + 1);
  const stepMin = (n: number) => {
    const next = (Math.round(min / 5) * 5 + n * 5 + 60) % 60;
    onPick(h24, next);
  };

  return (
    <Panel>
      <div className="grid grid-cols-5 gap-1.5">
        {QUICK_TIMES.map(([h, m]) => {
          const active = !!value && h24 === h && min === m;
          return (
            <button
              key={h}
              onClick={() => {
                onPick(h, m);
                onDone();
              }}
              className={cx(
                'press rounded-full border py-1 text-[11.5px] font-medium',
                active ? 'border-acc/40 bg-acc/15 text-acc' : 'border-white/[.06] bg-white/[.03] text-mut hover:text-txt',
              )}
            >
              {`${h % 12 || 12} ${h >= 12 ? 'PM' : 'AM'}`}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-center gap-2">
        <Spinner label="Hour" value={String(h12)} onUp={() => stepHour(1)} onDown={() => stepHour(-1)} />
        <span className="pb-0.5 text-2xl font-light text-mut">:</span>
        <Spinner label="Minute" value={String(min).padStart(2, '0')} onUp={() => stepMin(1)} onDown={() => stepMin(-1)} />
        <div className="ml-2 flex flex-col gap-1 rounded-xl border border-white/[.06] bg-black/20 p-1">
          {(['AM', 'PM'] as const).map(ap => {
            const on = (ap === 'PM') === pm;
            return (
              <button
                key={ap}
                onClick={() => !on && onPick(pm ? h24 - 12 : h24 + 12, min)}
                aria-pressed={on}
                className={cx('press rounded-lg px-2.5 py-1 text-[11.5px] font-semibold', on ? 'bg-acc/15 text-acc' : 'text-mut hover:text-txt')}
              >
                {ap}
              </button>
            );
          })}
        </div>
      </div>

      <button onClick={onDone} className="press btn-acc mt-3 w-full rounded-full py-2 text-[12.5px] font-semibold">
        Set {fmtTime(h24, min)}
      </button>
    </Panel>
  );
}

function Spinner({ label, value, onUp, onDown }: { label: string; value: string; onUp: () => void; onDown: () => void }) {
  return (
    <div
      className="flex flex-col items-center"
      onWheel={e => (e.deltaY < 0 ? onUp() : onDown())}
      role="spinbutton"
      aria-label={label}
      aria-valuetext={value}
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          onUp();
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          onDown();
        }
      }}
    >
      <button onClick={onUp} aria-label={`${label} up`} tabIndex={-1} className="press rounded-lg p-0.5 text-mut hover:text-acc">
        <ChevronUp size={16} />
      </button>
      <span className="w-12 rounded-xl border border-white/[.06] bg-black/20 py-1.5 text-center text-xl font-medium tabular-nums">{value}</span>
      <button onClick={onDown} aria-label={`${label} down`} tabIndex={-1} className="press rounded-lg p-0.5 text-mut hover:text-acc">
        <ChevronDown size={16} />
      </button>
    </div>
  );
}
