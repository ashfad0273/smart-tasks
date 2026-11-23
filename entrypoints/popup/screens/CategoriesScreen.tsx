import { Check, ChevronLeft, Pencil, Plus, Trash2, Tags } from 'lucide-react';
import type { Category } from '../../../lib/types';
import { useApp } from '../state/AppContext';
import EmptyState from '../components/EmptyState';

export default function CategoriesScreen() {
  const app = useApp();

  const deleteCat = async (c: Category) => {
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

      <div className="hide-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto px-5">
        {app.categories.length === 0 ? (
          <EmptyState icon={Tags} title="No categories yet" sub="Group tasks like Work or Home." />
        ) : (
          app.categories.map((c, i) => {
            const active = app.filter === c.id;
            const n = app.countsByCategory[c.id] ?? 0;
            return (
              <div
                key={c.id}
                className="anim-card relative flex items-center gap-1 rounded-2xl border border-line bg-surface py-2 pl-3 pr-1.5"
                style={{ borderColor: active ? `${c.color}99` : undefined, animationDelay: `${i * 40}ms` }}
              >
                <button
                  className="mr-1 flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => {
                    app.setFilter(c.id);
                    app.setScreen('dashboard');
                  }}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xl text-xs font-semibold text-white" style={{ background: c.color }}>{c.name.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</span>
                  <span className="shrink-0 text-xs text-mut">
                    {n ? `${n} to do` : ''}
                  </span>
                  {active && <Check size={14} className="shrink-0 text-acc" />}
                </button>

                <button
                  onClick={() => app.openCategoryModal({ mode: 'edit', id: c.id })}
                  aria-label={`Edit ${c.name}`}
                  title="Rename or recolor"
                  className="press shrink-0 rounded-lg p-1.5 text-mut hover:bg-white/[.05] hover:text-acc"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => void deleteCat(c)}
                  aria-label={`Delete ${c.name}`}
                  title="Delete"
                  className="press shrink-0 rounded-lg p-1.5 text-mut hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })
        )}
      </div>

      <div className="px-5 pb-5 pt-3">
        <button
          onClick={() => app.openCategoryModal({ mode: 'create' })}
          className="press btn-acc w-full rounded-full py-3 text-sm font-semibold"
        >
          <span className="inline-flex items-center gap-1.5"><Plus size={15} /> New category</span>
        </button>
      </div>
    </div>
  );
}
