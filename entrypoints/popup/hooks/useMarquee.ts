import { useCallback, useEffect, useRef, useState } from 'react';

/** Box in the scroll container's content coordinates. */
export interface MarqueeBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const THRESHOLD = 4; // px before a press on empty space becomes a drag
const EDGE = 36; // auto-scroll zone at the top/bottom of the list
const SKIP = '[data-task-id], button, a, input, textarea, select, [role="button"], [role="menu"]';

/**
 * File-manager style rubber-band selection: press on empty space in the list and drag
 * a box over tasks to select them. Shift / Cmd / Ctrl adds to the current selection.
 * A plain click on empty space clears the selection.
 */
export function useMarquee(opts: {
  selected: string[];
  setSelected: (ids: string[]) => void;
  clear: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<MarqueeBox | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => () => stop.current?.(), []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.button !== 0 || e.pointerType === 'touch') return;
    if ((e.target as HTMLElement).closest(SKIP)) return;
    // Clicks on the scrollbar itself.
    const r0 = el.getBoundingClientRect();
    if (e.clientX > r0.left + el.clientWidth) return;
    e.preventDefault(); // no text highlighting while dragging

    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = additive ? optsRef.current.selected : [];
    const start = { x: e.clientX - r0.left, y: e.clientY - r0.top + el.scrollTop };
    let pointer = { x: e.clientX, y: e.clientY };
    let moved = false;
    let raf = 0;

    const update = () => {
      const r = el.getBoundingClientRect();
      const cur = { x: pointer.x - r.left, y: pointer.y - r.top + el.scrollTop };
      const b = {
        left: Math.min(start.x, cur.x),
        top: Math.min(start.y, cur.y),
        width: Math.abs(cur.x - start.x),
        height: Math.abs(cur.y - start.y),
      };
      setBox(b);
      const hits: string[] = [];
      el.querySelectorAll<HTMLElement>('[data-task-id]').forEach(card => {
        const c = card.getBoundingClientRect();
        const cl = c.left - r.left;
        const ct = c.top - r.top + el.scrollTop;
        if (cl < b.left + b.width && cl + c.width > b.left && ct < b.top + b.height && ct + c.height > b.top) {
          hits.push(card.dataset.taskId!);
        }
      });
      const next = [...new Set([...base, ...hits])];
      const cur0 = optsRef.current.selected;
      if (next.length !== cur0.length || next.some((id, i) => id !== cur0[i])) optsRef.current.setSelected(next);
    };

    // Keep scrolling while the pointer rests near the top or bottom edge.
    const tick = () => {
      const r = el.getBoundingClientRect();
      const dy = pointer.y < r.top + EDGE ? -(r.top + EDGE - pointer.y) : pointer.y > r.bottom - EDGE ? pointer.y - (r.bottom - EDGE) : 0;
      if (dy) {
        el.scrollTop += Math.max(-24, Math.min(24, dy / 2));
        update();
      }
      raf = requestAnimationFrame(tick);
    };

    const onMove = (ev: PointerEvent) => {
      pointer = { x: ev.clientX, y: ev.clientY };
      if (!moved) {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < THRESHOLD) return;
        moved = true;
        document.documentElement.dataset.marquee = '';
        raf = requestAnimationFrame(tick);
      }
      update();
    };
    const end = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      cancelAnimationFrame(raf);
      delete document.documentElement.dataset.marquee;
      stop.current = null;
      setBox(null);
      if (!moved && !additive) optsRef.current.clear();
    };
    stop.current = end;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }, []);

  return { ref, box, onPointerDown };
}
