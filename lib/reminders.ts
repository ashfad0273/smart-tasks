import { storageGet, storageSet } from './ext';
import { REMINDERS_ENABLED_KEY, REMINDERS_KEY } from './keys';
import type { Task } from './types';

export interface Reminder {
  id: string;
  title: string;
  dueAt: number;
}

/** Still notify for tasks that came due up to 30 minutes ago (covers the
 *  browser having been closed right before a task was due). */
export const GRACE_MS = 30 * 60_000;

/** Pending tasks with a due date, soonest first (max 50). */
export function extractReminders(tasks: Task[], now = Date.now()): Reminder[] {
  return tasks
    .filter(t => !t.completedAt && t.dueAt != null && t.dueAt > now - GRACE_MS)
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
    .slice(0, 50)
    .map(t => ({ id: t.id, title: t.title, dueAt: t.dueAt as number }));
}

/**
 * Persist the upcoming-reminder snapshot. The service worker listens for
 * changes to this key and (re)schedules its alarm at the next due time.
 * Written by the popup and by the offscreen document (whichever sees new data).
 */
export async function writeReminders(tasks: Task[]): Promise<void> {
  const next = extractReminders(tasks);
  const prev = await storageGet<Reminder[]>(REMINDERS_KEY, []);
  if (JSON.stringify(prev) === JSON.stringify(next)) return;
  await storageSet(REMINDERS_KEY, next);
}

export async function remindersEnabled(): Promise<boolean> {
  return storageGet<boolean>(REMINDERS_ENABLED_KEY, true);
}
