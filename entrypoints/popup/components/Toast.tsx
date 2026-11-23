import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cx } from '../../../lib/utils';
import { useApp } from '../state/AppContext';

export default function Toast() {
  const { toast, dismissToast } = useApp();
  if (!toast) return null;
  const { kind, msg, action } = toast;
  return (
    <div
      key={toast.id}
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex justify-center px-4 animate-[slideUp_.22s_cubic-bezier(.2,.9,.3,1.3)]"
    >
      <div
        className={cx(
          'pointer-events-auto flex max-w-full items-center gap-2 rounded-full border py-2 pl-4 text-xs font-bold shadow-2xl',
          action ? 'pr-1.5' : 'pr-4',
          kind === 'error'
            ? 'border-danger/40 bg-[#2a1219] text-[#fda4af]'
            : kind === 'success'
              ? 'border-acc/40 bg-[#0f2318] text-[#86efac]'
              : 'border-line bg-surface2 text-txt',
        )}
      >
        {kind === 'success' ? <CheckCircle2 size={14} /> : kind === 'error' ? <AlertTriangle size={14} /> : <Info size={14} />}
        <span className="truncate">{msg}</span>
        {action && (
          <button
            onClick={() => {
              action.run();
              dismissToast();
            }}
            className="press ml-1 shrink-0 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-txt hover:bg-white/20"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
