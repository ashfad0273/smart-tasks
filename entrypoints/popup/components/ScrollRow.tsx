import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../../../lib/utils';

/**
 * A horizontally scrolling row that works with a plain mouse:
 * - the vertical wheel scrolls it sideways
 * - click-and-drag scrolls it
 * - arrow buttons appear on whichever side has more content
 */
export default function ScrollRow({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    // Non-passive so we can turn vertical wheel movement into sideways scrolling.
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
    };
  }, [measure, children]);

  const nudge = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.7, behavior: 'smooth' });

  const mask =
    edge.left && edge.right
      ? 'linear-gradient(90deg, transparent 0, #000 64px, #000 calc(100% - 64px), transparent 100%)'
      : edge.right
        ? 'linear-gradient(90deg, #000 calc(100% - 64px), transparent 100%)'
        : edge.left
          ? 'linear-gradient(90deg, transparent 0, #000 64px)'
          : undefined;

  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={measure}
        onPointerDown={e => {
          if (e.pointerType !== 'mouse' || e.button !== 0) return;
          drag.current = { x: e.clientX, left: ref.current!.scrollLeft, moved: false };
        }}
        onPointerMove={e => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          if (!d.moved && Math.abs(dx) < 5) return;
          if (!d.moved) ref.current!.setPointerCapture(e.pointerId);
          d.moved = true;
          ref.current!.scrollLeft = d.left - dx;
        }}
        onPointerUp={() => {
          // Swallow the click that ends a drag so it doesn't toggle a pill.
          if (drag.current?.moved) ref.current!.addEventListener('click', ev => ev.stopPropagation(), { capture: true, once: true });
          drag.current = null;
        }}
        className={cx('hide-scrollbar flex items-center overflow-x-auto', className)}
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        {children}
      </div>
      {edge.left && (
        <button
          aria-label="Scroll left"
          onClick={() => nudge(-1)}
          className="press anim-pop absolute left-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-surface2 text-txt shadow-[0_4px_14px_rgba(0,0,0,.5)] hover:border-acc/40 hover:text-acc"
        >
          <ChevronLeft size={14} />
        </button>
      )}
      {edge.right && (
        <button
          aria-label="Scroll right"
          onClick={() => nudge(1)}
          className="press anim-pop absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-surface2 text-txt shadow-[0_4px_14px_rgba(0,0,0,.5)] hover:border-acc/40 hover:text-acc"
        >
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
}
