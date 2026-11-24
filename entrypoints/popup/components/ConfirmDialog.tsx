import { useEffect, useRef } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { useApp } from '../state/AppContext';

export default function ConfirmDialog() {
  const { confirmData, resolveConfirm } = useApp();
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirmData) return;
    okRef.current?.focus();
    // Capture phase on window: runs before (and blocks) the sheet's own Escape handler.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        resolveConfirm(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [confirmData, resolveConfirm]);

  if (!confirmData) return null;
  const { opts } = confirmData;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-5" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] animate-[fadeIn_.12s_ease-out]" onClick={() => resolveConfirm(false)} />
      <div className="anim-pop relative w-full max-w-[360px] rounded-3xl border border-line bg-surface p-5 shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <span
            className={`grid h-12 w-12 place-items-center rounded-2xl ${opts.danger ? 'bg-danger/15 text-danger' : 'bg-acc/15 text-acc'}`}
          >
            {opts.danger ? <AlertTriangle size={22} /> : <HelpCircle size={22} />}
          </span>
          <h3 id="confirm-title" className="mt-3 text-base font-semibold text-txt">
            {opts.title}
          </h3>
          {opts.message && <p className="mt-1.5 text-xs leading-relaxed text-mut">{opts.message}</p>}
        </div>
        <div className="mt-5 flex gap-2">
          <button
            onClick={() => resolveConfirm(false)}
            className="press flex-1 rounded-full border border-white/[.06] bg-white/[.04] py-2.5 text-xs font-semibold text-txt hover:bg-white/[.07]"
          >
            Never mind
          </button>
          <button
            ref={okRef}
            onClick={() => resolveConfirm(true)}
            className={`press flex-1 rounded-full py-2.5 text-xs font-semibold ${
              opts.danger ? 'bg-danger text-white hover:bg-rose-600' : 'btn-acc'
            }`}
          >
            {opts.confirmText ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
