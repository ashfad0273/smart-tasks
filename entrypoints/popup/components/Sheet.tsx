import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Bottom sheet: drag the handle down, click the backdrop, or press Escape to close. */
export default function Sheet({ onClose, label, children }: { onClose: () => void; label: string; children: ReactNode }) {
  const [dy, setDy] = useState(0);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] animate-[fadeIn_.15s_ease-out]" onClick={onClose} />
      <div
        className="absolute inset-x-0 bottom-0 flex max-h-[94%] flex-col rounded-t-3xl border-t border-line bg-surface shadow-[0_-20px_60px_rgba(0,0,0,.5)] animate-[sheetUp_.32s_cubic-bezier(.2,.9,.3,1)]"
        style={dy ? { transform: `translateY(${dy}px)`, transition: 'none' } : { transition: 'transform .2s' }}
      >
        <div
          className="shrink-0 cursor-grab touch-none pb-1 pt-2.5"
          onPointerDown={e => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            startY.current = e.clientY;
          }}
          onPointerMove={e => {
            if (startY.current == null) return;
            setDy(Math.max(0, e.clientY - startY.current));
          }}
          onPointerUp={() => {
            if (dy > 90) onClose();
            setDy(0);
            startY.current = null;
          }}
        >
          <div className="mx-auto h-1.5 w-10 rounded-full bg-line" />
        </div>
        <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
