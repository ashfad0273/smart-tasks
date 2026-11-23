import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { CATEGORY_COLORS, cx } from '../../../lib/utils';
import { useApp } from '../state/AppContext';

const EMOJI_SUGGESTIONS = ['Work', 'Home', 'Health', 'Ideas', 'Learning', 'Errands'];

export default function CategoryModal() {
  const app = useApp();
  const modal = app.categoryModal;
  const editing = modal?.mode === 'edit' ? (app.categories.find(c => c.id === modal.id) ?? null) : null;

  const [name, setName] = useState(editing?.name ?? '');
  const [color, setColor] = useState(
    editing?.color ?? CATEGORY_COLORS[app.categories.length % CATEGORY_COLORS.length],
  );
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && app.closeCategoryModal();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  const save = async () => {
    const n = name.trim();
    if (!n) return setError('Give it a name first');
    if (app.categories.some(c => c.name.toLowerCase() === n.toLowerCase() && c.id !== editing?.id)) {
      return setError('You already have a category with that name');
    }
    if (editing) await app.updateCategory(editing.id, { name: n, color });
    else await app.createCategory({ name: n, color });
    app.closeCategoryModal();
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-5" role="dialog" aria-modal="true" aria-labelledby="cat-title">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] animate-[fadeIn_.12s_ease-out]" onClick={app.closeCategoryModal} />
      <div className="anim-pop relative w-full rounded-3xl border border-line bg-surface p-5 shadow-2xl">
        <h3 id="cat-title" className="text-base font-extrabold">
          {editing ? 'Edit category' : 'New category'} 🎨
        </h3>

        <div
          className="mt-3 flex items-center gap-2.5 rounded-2xl border-2 px-3 py-2.5 transition-colors"
          style={{ borderColor: `${color}88`, background: `${color}14` }}
        >
          <span className="h-3.5 w-3.5 shrink-0 rounded-full transition-colors" style={{ background: color }} />
          <input
            autoFocus
            value={name}
            onChange={e => {
              setName(e.target.value);
              setError('');
            }}
            onKeyDown={e => e.key === 'Enter' && void save()}
            placeholder="e.g. Side hustle"
            maxLength={40}
            aria-label="Category name"
            className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none placeholder:font-medium placeholder:text-mut/50"
          />
        </div>
        {error && <p className="mt-1.5 text-[11px] font-bold text-danger">{error}</p>}
        {!editing && !name && (
          <div className="mt-2 flex flex-wrap gap-1">
            {EMOJI_SUGGESTIONS.filter(s => !app.categories.some(c => c.name === s)).slice(0, 4).map(s => (
              <button key={s} onClick={() => setName(s)} className="press rounded-full bg-surface2 px-2 py-0.5 text-[11px] font-bold text-mut hover:text-txt">
                + {s}
              </button>
            ))}
          </div>
        )}

        <p className="mb-2 mt-4 text-xs font-bold text-mut">Pick a color</p>
        <div className="grid grid-cols-6 gap-2">
          {CATEGORY_COLORS.map(c => (
            <button
              key={c}
              onClick={() => setColor(c)}
              aria-label={`Color ${c}`}
              aria-pressed={color === c}
              className={cx(
                'press grid h-8 w-8 place-items-center rounded-full transition-transform hover:scale-110',
                color === c && 'scale-110 ring-2 ring-white/80 ring-offset-2 ring-offset-surface',
              )}
              style={{ background: c }}
            >
              {color === c && <Check size={13} strokeWidth={3} className="text-black/70" />}
            </button>
          ))}
        </div>

        <div className="mt-5 flex gap-2">
          <button onClick={app.closeCategoryModal} className="press flex-1 rounded-2xl border border-line bg-surface2 py-2.5 text-xs font-bold text-txt hover:bg-line">
            Cancel
          </button>
          <button onClick={() => void save()} className="press grad-acc glow flex-1 rounded-2xl py-2.5 text-xs font-extrabold text-white">
            {editing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
