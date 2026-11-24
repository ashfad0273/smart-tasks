import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, ChevronLeft, Trash2 } from 'lucide-react';
import type { Category, Task } from '../../../lib/types';
import { cx, formatStamp } from '../../../lib/utils';
import { useApp } from '../state/AppContext';

type Tab = 'tasks' | 'categories';

/** Everything archived: tasks and categories, with Restore and Delete. */
export default function ArchiveScreen() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>(app.archivedTasks.length === 0 && app.archivedCategories.length > 0 ? 'categories' : 'tasks');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !app.editTaskId && !app.confirmData && app.setScreen('dashboard');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  const tasksIn = (c: Category) => app.allTasks.filter(t => t.categoryId === c.id).length;

  const deleteTask = async (t: Task) => {
    const ok = await app.confirm({
      title: `Delete "${t.title}"?`,
      message: 'It will be removed on all your devices.',
      confirmText: 'Delete',
      danger: true,
    });
    if (ok) void app.deleteTask(t.id);
  };

  const deleteCat = async (c: Category) => {
    const n = tasksIn(c);
    const ok = await app.confirm({
      title: `Delete "${c.name}"?`,
      message: n > 0 ? `Its ${n} task${n === 1 ? '' : 's'} will be kept, uncategorized and back in your list.` : 'It will be removed on all your devices.',
      confirmText: 'Delete',
      danger: true,
    });
    if (ok) void app.deleteCategory(c.id);
  };

  const tabs: Array<{ id: Tab; label: string; n: number }> = [
    { id: 'tasks', label: 'Tasks', n: app.archivedTasks.length },
    { id: 'categories', label: 'Categories', n: app.archivedCategories.length },
  ];

  const empty = tab === 'tasks' ? app.archivedTasks.length === 0 : app.archivedCategories.length === 0;

  return (
    <div className="ambient flex h-full flex-col bg-bg">
      <header className="flex items-center justify-between px-4 py-3">
        <button onClick={() => app.setScreen('dashboard')} aria-label="Back" className="press rounded-lg p-1.5 text-mut hover:text-txt">
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-sm font-semibold">Archive</h1>
        <span className="w-7" />
      </header>

      <div className="flex gap-1.5 px-5 pb-3">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={cx(
              'press rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors',
              tab === t.id ? 'border-acc/40 bg-acc/10 text-acc' : 'border-white/[.06] text-mut hover:text-txt',
            )}
          >
            {t.label}
            {t.n > 0 && <span className="ml-1 tabular-nums opacity-70">{t.n}</span>}
          </button>
        ))}
      </div>

      <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {empty ? (
          <div className="anim-card flex flex-col items-center px-6 pt-14 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-2xl border border-white/[.06] bg-white/[.03] text-mut">
              <Archive size={18} />
            </span>
            <p className="mt-3 text-[13px] font-medium">Nothing archived</p>
            <p className="mt-1 text-[11.5px] text-mut">
              {tab === 'tasks'
                ? 'Archive a task to hide it from your list without deleting it.'
                : 'Archive a category to hide it and its tasks. Restore it any time.'}
            </p>
          </div>
        ) : tab === 'tasks' ? (
          <ul className="space-y-1.5">
            {app.archivedTasks.map((t, i) => {
              const cat = app.categoryById(t.categoryId);
              const viaCategory = !t.archivedAt && !!cat?.archivedAt;
              return (
                <li
                  key={t.id}
                  className="anim-card flex items-center gap-2 rounded-xl border border-white/[.04] bg-white/[.015] py-2 pl-3 pr-1.5"
                  style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                >
                  <button onClick={() => app.openEdit(t.id)} className="min-w-0 flex-1 text-left">
                    <span className={cx('block truncate text-[12.5px]', t.completedAt ? 'text-mut line-through decoration-mut/50' : 'text-txt')}>
                      {t.title || 'Untitled task'}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-mut/80">
                      {cat && (
                        <span className="inline-flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: cat.color }} />
                          {cat.name}
                        </span>
                      )}
                      {cat && <span className="text-mut/40">·</span>}
                      <span>{viaCategory ? 'Category archived' : `Archived ${formatStamp(t.archivedAt!)}`}</span>
                    </span>
                  </button>
                  <button
                    onClick={() => void (viaCategory ? app.archiveCategory(cat!.id, false) : app.archiveTask(t.id, false))}
                    title={viaCategory ? `Restore the ${cat!.name} category` : 'Restore'}
                    aria-label={`Restore "${t.title}"`}
                    className="press inline-flex shrink-0 items-center gap-1 rounded-full border border-acc/30 px-2.5 py-1 text-[11px] font-medium text-acc hover:bg-acc/10"
                  >
                    <ArchiveRestore size={12} /> Restore
                  </button>
                  <button
                    onClick={() => void deleteTask(t)}
                    title="Delete"
                    aria-label={`Delete "${t.title}"`}
                    className="press shrink-0 rounded-lg p-1.5 text-mut hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="space-y-1.5">
            {app.archivedCategories.map((c, i) => {
              const n = tasksIn(c);
              return (
                <li
                  key={c.id}
                  className="anim-card flex items-center gap-2.5 rounded-xl border border-white/[.04] bg-white/[.015] py-2 pl-3 pr-1.5"
                  style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xl text-xs font-semibold text-white" style={{ background: c.color }}>
                    {c.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium">{c.name}</span>
                    <span className="block text-[10.5px] text-mut/80">
                      {n} task{n === 1 ? '' : 's'}
                      {c.archivedAt ? ` · Archived ${formatStamp(c.archivedAt)}` : ''}
                    </span>
                  </span>
                  <button
                    onClick={() => void app.archiveCategory(c.id, false)}
                    aria-label={`Restore ${c.name}`}
                    className="press inline-flex shrink-0 items-center gap-1 rounded-full border border-acc/30 px-2.5 py-1 text-[11px] font-medium text-acc hover:bg-acc/10"
                  >
                    <ArchiveRestore size={12} /> Restore
                  </button>
                  <button
                    onClick={() => void deleteCat(c)}
                    title="Delete"
                    aria-label={`Delete ${c.name}`}
                    className="press shrink-0 rounded-lg p-1.5 text-mut hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
