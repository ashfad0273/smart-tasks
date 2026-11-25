import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext';

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

/**
 * Multi-select for a category list, the same way tasks work: Cmd/Ctrl-click toggles,
 * Shift-click selects a range, and while anything is selected a plain click toggles too.
 * Delete / Backspace deletes the selection (after a confirm), Esc clears it.
 * Selecting categories clears any task selection, and the other way round.
 */
export function useCategorySelection() {
  const app = useApp();
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const order = app.categories.map(c => c.id);

  const clear = useCallback(() => {
    setSelected([]);
    anchor.current = null;
  }, []);

  /** Call from a row's click handler; returns true when the click was a selection click. */
  const onRowClick = (e: React.MouseEvent, id: string): boolean => {
    const multi = e.metaKey || e.ctrlKey;
    if (!multi && !e.shiftKey && selected.length === 0) return false;
    e.preventDefault();
    if (app.selected.length) app.clearSelection();
    if (e.shiftKey && anchor.current) {
      const a = order.indexOf(anchor.current);
      const b = order.indexOf(id);
      if (a >= 0 && b >= 0) {
        const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
        setSelected(prev => [...new Set([...prev, ...range])]);
        return true;
      }
    }
    anchor.current = id;
    setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
    return true;
  };

  const remove = useCallback(async () => {
    const ids = selected;
    if (!ids.length) return;
    const open = ids.reduce((n, id) => n + (app.countsByCategory[id] ?? 0), 0);
    const one = ids.length === 1 ? app.categories.find(c => c.id === ids[0]) : null;
    const ok = await app.confirm({
      title: one ? `Delete "${one.name}"?` : `Delete ${ids.length} categories?`,
      message:
        open > 0
          ? `Their ${open} open task${open === 1 ? '' : 's'} will become uncategorized (not deleted), on all your devices.`
          : `${one ? 'This category' : 'They'} will be removed on all your devices.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    clear();
    await app.deleteCategory(ids);
  }, [app, clear, selected]);

  const archive = useCallback(async () => {
    const ids = selected;
    if (!ids.length) return;
    clear();
    await app.archiveCategory(ids);
  }, [app, clear, selected]);

  // A task selection takes over from a category selection.
  useEffect(() => {
    if (app.selected.length) clear();
  }, [app.selected.length, clear]);

  // Drop categories that went away (deleted elsewhere, archived).
  const key = order.join(',');
  useEffect(() => {
    const live = new Set(key.split(','));
    setSelected(prev => {
      const next = prev.filter(id => live.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [key]);

  // Keyboard: Delete / Backspace deletes, Esc clears, Cmd/Ctrl+A is left to the task list.
  useEffect(() => {
    if (!selected.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || app.confirmData) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopImmediatePropagation();
        void remove();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        clear();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [app.confirmData, clear, remove, selected.length]);

  return { selected, isSelected: (id: string) => selected.includes(id), onRowClick, clear, remove, archive };
}
