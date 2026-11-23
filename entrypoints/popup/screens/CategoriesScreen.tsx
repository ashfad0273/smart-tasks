import { useState } from 'react';
import { Check, ChevronLeft, MoreVertical, Pencil, Trash2, Tags } from 'lucide-react';
import type { Category } from '../../../lib/types';
import { useApp } from '../state/AppContext';
import EmptyState from '../components/EmptyState';

export default function CategoriesScreen() {
  const app = useApp();
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const deleteCat = async (c: Category) => {
    setMenuFor(null);
    const n = app.countsByCategory[c.id] ?? 0;
    const ok = await app.confirm({
      title: `Delete "${c.name}"?`,
      message:
        n > 0
          ? `Its ${n} open task${n === 1 ? '' : 's'} will become uncategorized (not deleted), on all your devices.`
          : 'This category will be removed on all your devices.',
      confirmText: 'Delete',
      danger: true,
    });
    if (ok) void app.deleteCategory(c.id);
  };

  return (
    <div className="ambient flex h-full flex-col bg-bg">
      <header className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => app.setScreen('dashboard')}
          aria-label="Back"
          className="rounded-lg p-1.5 text-mut hover:text-txt"
        >
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-sm font-semibold">Categories</h1>
        <span className="w-7" />
      </header>

      <div className="hide-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto px-4">
        {app.categories.length === 0 ? (
          <EmptyState icon={Tags} title="No categories yet" sub="Categories keep work, home and side projects apart. Create one below." />
        ) : (
          app.categories.map((c, i) => {
            const active = app.filter === c.id;
            const n = app.countsByCategory[c.id] ?? 0;
            return (
              <div
                key={c.id}
                className="anim-card relative flex items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2.5"
                style={{ borderColor: active ? `${c.color}99` : undefined, animationDelay: `${i * 40}ms` }}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => {
                    app.setFilter(c.id);
                    app.setScreen('dashboard');
                  }}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xl text-xs font-semibold text-white" style={{ background: c.color }}>{c.name.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</span>
                  <span className="shrink-0 text-xs text-mut">
                    {n ? `${n} to do` : 'all clear'}
                  </span>
                  {active && <Check size={14} className="shrink-0 text-acc" />}
                </button>

                <div className="relative shrink-0">
                  <button
                    onClick={() => setMenuFor(menuFor === c.id ? null : c.id)}
                    aria-label="Category options"
                    className="press rounded-lg p-1.5 text-mut hover:bg-line hover:text-txt"
                    aria-expanded={menuFor === c.id}
                  >
                    <MoreVertical size={14} />
                  </button>
                  {menuFor === c.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
                      <div className="anim-pop absolute right-0 z-20 mt-1 w-40 rounded-xl border border-line bg-surface p-1 shadow-2xl">
                        <button
                          onClick={() => {
                            setMenuFor(null);
                            app.openCategoryModal({ mode: 'edit', id: c.id });
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs hover:bg-surface2"
                        >
                          <Pencil size={12} /> Rename / recolor
                        </button>
                        <button
                          onClick={() => void deleteCat(c)}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-danger hover:bg-danger/10"
                        >
                          <Trash2 size={12} /> Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="p-4">
        <button
          onClick={() => app.openCategoryModal({ mode: 'create' })}
          className="press btn-acc w-full rounded-full py-3 text-sm font-semibold"
        >
          + Add Category
        </button>
      </div>
    </div>
  );
}
