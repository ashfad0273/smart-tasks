import { CloudOff, HardDrive, RefreshCw } from 'lucide-react';
import type { SyncState } from '../../../lib/types';

const META: Record<SyncState, { label: string; color: string; pulse?: boolean }> = {
  synced: { label: 'Synced', color: '#3fd1c5' },
  syncing: { label: 'Syncing', color: '#f59e0b', pulse: true },
  offline: { label: 'Offline', color: '#94a3b8' },
  error: { label: 'Retry', color: '#f43f5e' },
  local: { label: 'Local', color: '#a78bfa' },
};

export default function SyncBadge({ state, onClick }: { state: SyncState; onClick?: () => void }) {
  const m = META[state];
  const tip =
    state === 'local'
      ? 'Tasks are stored on this device only'
      : state === 'offline'
        ? 'Offline — changes are saved and will sync when you reconnect'
        : state === 'error'
          ? 'Sync hit a snag — click to retry'
          : 'Click to sync now';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick || state === 'local'}
      title={tip}
      aria-label={`Sync status: ${m.label}. ${tip}`}
      className="press inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/80 px-2.5 py-1 text-[11px] font-semibold backdrop-blur disabled:cursor-default"
    >
      {state === 'offline' ? (
        <CloudOff size={11} style={{ color: m.color }} />
      ) : state === 'local' ? (
        <HardDrive size={11} style={{ color: m.color }} />
      ) : state === 'syncing' ? (
        <RefreshCw size={11} className="animate-spin" style={{ color: m.color }} />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
      )}
      <span style={{ color: m.color }}>{m.label}</span>
    </button>
  );
}
