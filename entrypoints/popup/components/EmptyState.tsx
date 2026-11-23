export default function EmptyState({ emoji = '📭', title, sub, children }: { emoji?: string; title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="anim-pop flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="anim-bob text-5xl drop-shadow-[0_8px_16px_rgba(0,0,0,.4)]" aria-hidden="true">
        {emoji}
      </span>
      <p className="mt-2 text-sm font-extrabold text-txt">{title}</p>
      {sub && <p className="max-w-[250px] text-xs leading-relaxed text-mut">{sub}</p>}
      {children}
    </div>
  );
}
