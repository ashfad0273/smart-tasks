import type { Priority } from './types';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function uid4(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function initialsOf(name: string, email: string): string {
  const src = name?.trim() || email || '?';
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return src.slice(0, 2).toUpperCase();
}

/* ── dates ─────────────────────────────────────────────────────────────── */

export function startOfDay(d: Date | number): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date | number, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function isSameDay(a: Date | number, b: Date | number): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "Today 3:50 PM", "Yesterday 9:10 AM", "Mon 4:00 PM" (this week), else "Nov 21, 3:50 PM". */
export function formatStamp(ms: number): string {
  const now = Date.now();
  const time = formatTime(ms);
  if (isSameDay(ms, now)) return `Today ${time}`;
  if (isSameDay(ms, addDays(now, -1))) return `Yesterday ${time}`;
  const d = new Date(ms);
  if (now - ms < 6 * 86_400_000 && ms < now) return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })}, ${time}`;
}

export function formatDue(ms: number): { label: string; overdue: boolean } {
  const now = Date.now();
  const diffDays = Math.round((startOfDay(ms).getTime() - startOfDay(now).getTime()) / 86_400_000);
  let day: string;
  if (diffDays === 0) day = 'Today';
  else if (diffDays === 1) day = 'Tomorrow';
  else if (diffDays === -1) day = 'Yesterday';
  else {
    const d = new Date(ms);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    day = d.toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      ...(sameYear ? {} : { year: 'numeric' }),
    });
  }
  const hasTime = new Date(ms).getHours() !== 0 || new Date(ms).getMinutes() !== 0;
  const label = hasTime ? `${day} · ${formatTime(ms)}` : day;
  return { label, overdue: ms < now && diffDays <= 0 };
}

/** yyyy-mm-dd for <input type="date"> */
export function toDateInput(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** HH:mm (24h) for <input type="time"> */
export function toTimeInput(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Combine a yyyy-mm-dd date with an existing/default HH:mm time → epoch ms */
export function dateInputToMs(dateStr: string, prevMs: number | null, defaultHour = 17, defaultMinute = 0): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const prev = prevMs ? new Date(prevMs) : null;
  const hasTime = !!prev && (prev.getHours() !== 0 || prev.getMinutes() !== 0);
  const hour = hasTime ? prev!.getHours() : defaultHour;
  const minute = hasTime ? prev!.getMinutes() : defaultMinute;
  return new Date(y, m - 1, d, hour, minute, 0, 0).getTime();
}

export function timeInputToMs(timeStr: string, prevMs: number | null): number {
  const [h, m] = timeStr.split(':').map(Number);
  const base = prevMs ? new Date(prevMs) : new Date();
  base.setHours(h, m, 0, 0);
  return base.getTime();
}

export function dayAtTime(dayOffset: number, prevMs: number | null, defaultHour = 17): number {
  const base = addDays(startOfDay(Date.now()), dayOffset);
  const prev = prevMs ? new Date(prevMs) : null;
  const hasTime = !!prev && (prev.getHours() !== 0 || prev.getMinutes() !== 0);
  base.setHours(hasTime ? prev!.getHours() : defaultHour, hasTime ? prev!.getMinutes() : 0, 0, 0);
  return base.getTime();
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/* ── priorities & categories ───────────────────────────────────────────── */

export const PRIORITY_META: Record<Priority, { label: string; color: string }> = {
  low: { label: 'Low', color: '#22c55e' },
  med: { label: 'Med', color: '#f59e0b' },
  high: { label: 'High', color: '#ef4444' },
};

export const CATEGORY_COLORS = [
  '#22c55e', '#a78bfa', '#fb923c', '#f472b6', '#2dd4bf', '#60a5fa',
  '#facc15', '#f87171', '#34d399', '#c084fc', '#fdba74', '#94a3b8',
];

export const DEFAULT_CATEGORIES: Array<{ name: string; color: string }> = [
  { name: 'Work', color: '#22c55e' },
  { name: 'Personal', color: '#a78bfa' },
  { name: 'Side Project', color: '#fb923c' },
  { name: 'Shopping', color: '#f472b6' },
  { name: 'Fitness', color: '#2dd4bf' },
];

/* ── auth ──────────────────────────────────────────────────────────────── */

export function passwordScore(pw: string): { length: boolean; upper: boolean; number: boolean; symbol: boolean } {
  return {
    length: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    number: /\d/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
  };
}

export function strengthLabel(score: number): string {
  if (score <= 1) return 'Weak';
  if (score === 2) return 'Fair';
  if (score === 3) return 'Good';
  return 'Strong';
}

export function friendlyAuthError(e: unknown): string {
  const msg: string = (e as { message?: string })?.message ?? '';
  return msg || 'Something went wrong. Please try again.';
}

export function descErr(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}

/** Lightweight natural-language parsing for the quick-add box:
 *  "Call mom tomorrow 6pm !high #personal" → title + dueAt + priority + category name. */
export function parseQuickAdd(input: string): {
  title: string;
  dueAt: number | null;
  priority: Priority | null;
  categoryName: string | null;
} {
  // Quotes, brackets and trailing punctuation shouldn't hide a keyword:
  // `Call mom "tomorrow 6pm".` parses the same as `Call mom tomorrow 6pm`.
  let s = ' ' + input.trim().replace(/["“”«»()[\],;]/g, ' ').replace(/[.!?](?=\s|$)/g, m => (m === '!' ? m : ' ')) + ' ';
  let priority: Priority | null = null;
  let categoryName: string | null = null;
  let day: number | null = null;
  let hour: number | null = null;
  let minute = 0;

  s = s.replace(/\s!(high|hi|h|med|medium|m|low|lo|l)(?=\s)/i, (_, p: string) => {
    const k = p.toLowerCase();
    priority = k.startsWith('h') ? 'high' : k.startsWith('m') ? 'med' : 'low';
    return ' ';
  });
  s = s.replace(/\s#([\p{L}\p{N}_-]+)(?=\s)/u, (_, c: string) => {
    categoryName = c;
    return ' ';
  });
  s = s.replace(/\s(today|tonight|tomorrow|tmrw|next week)(?=\s)/i, (_, d: string) => {
    const k = d.toLowerCase();
    day = k === 'today' || k === 'tonight' ? 0 : k === 'next week' ? 7 : 1;
    if (k === 'tonight' && hour === null) hour = 20;
    return ' ';
  });
  const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  if (day === null) {
    s = s.replace(/\s(?:on\s)?(sun|mon|tues?|wed|thu(?:rs)?|fri|sat)(?:day|nesday|urday)?(?=\s)/i, (_, w: string) => {
      const target = WEEKDAYS.indexOf(w.slice(0, 3).toLowerCase());
      const diff = (target - new Date().getDay() + 7) % 7;
      day = diff === 0 ? 7 : diff; // "monday" on a Monday means next week
      return ' ';
    });
  }
  // 12-hour: 1pm, 1:20pm, 1 pm, at 9am, noon, midnight
  s = s.replace(/\s(?:at\s)?(\d{1,2})(?:[:.](\d{2}))?\s?([ap])\.?m\.?(?=\s)/i, (_, h: string, m: string | undefined, ap: string) => {
    let hh = Number(h) % 12;
    if (ap.toLowerCase() === 'p') hh += 12;
    hour = hh;
    minute = m ? Math.min(59, Number(m)) : 0;
    return ' ';
  });
  if (hour === null) {
    s = s.replace(/\s(?:at\s)?(noon|midnight)(?=\s)/i, (_, w: string) => {
      hour = w.toLowerCase() === 'noon' ? 12 : 0;
      minute = 0;
      return ' ';
    });
  }
  // 24-hour: 13:30, at 9:05
  if (hour === null) {
    s = s.replace(/\s(?:at\s)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/, (_, h: string, m: string) => {
      hour = Number(h);
      minute = Number(m);
      return ' ';
    });
  }

  const title = s.replace(/\s+/g, ' ').trim();
  let dueAt: number | null = null;
  if (day !== null || hour !== null) {
    const d = addDays(startOfDay(Date.now()), day ?? 0);
    d.setHours(hour ?? 17, minute, 0, 0);
    // "6pm" with no day and already past → tomorrow
    if (day === null && d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    dueAt = d.getTime();
  }
  return { title: title || input.trim(), dueAt, priority, categoryName };
}

const CHEERS = ['Nice work', 'Done', 'One down', 'Task complete', 'Nicely done', 'Checked off'];
export const cheer = () => CHEERS[Math.floor(Math.random() * CHEERS.length)];
