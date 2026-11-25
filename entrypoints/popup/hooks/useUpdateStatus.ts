import { useEffect, useState } from 'react';
import { onStorageChange, storageGet } from '../../../lib/ext';
import { UPDATE_STATUS_KEY, type UpdateStatus } from '../../../lib/keys';

/** How long a finished result ("Up to date", "Couldn't reach…") stays on screen. */
const SHOW_RESULT_MS = 6000;
/** A busy state older than this is left over from a crash; ignore it. */
const STALE_MS = 10 * 60_000;

/**
 * What the desktop app's updater is doing right now (checking, downloading 42%,
 * installing, up to date, failed), or null when there's nothing to show.
 */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const read = () => void storageGet<UpdateStatus | null>(UPDATE_STATUS_KEY, null).then(setStatus);
    read();
    return onStorageChange(keys => keys.includes(UPDATE_STATUS_KEY) && read());
  }, []);

  const done = status?.state === 'latest' || status?.state === 'failed';
  // Re-render when a result should disappear.
  useEffect(() => {
    if (!status || !done) return;
    const left = status.at + SHOW_RESULT_MS - Date.now();
    if (left <= 0) return;
    const t = setTimeout(() => tick(n => n + 1), left + 50);
    return () => clearTimeout(t);
  }, [status, done]);

  if (!status) return null;
  const age = Date.now() - status.at;
  if (done ? age > SHOW_RESULT_MS : age > STALE_MS) return null;
  return status;
}

/** Short label for a button or line, e.g. "Downloading 42%". */
export function updateStatusLabel(s: UpdateStatus): string {
  switch (s.state) {
    case 'checking':
      return 'Checking…';
    case 'downloading':
      return `Downloading ${s.pct}%`;
    case 'installing':
      return 'Installing…';
    case 'latest':
      return "You're up to date";
    case 'failed':
      return s.message;
  }
}
