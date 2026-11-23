import { Inbox, type LucideIcon } from 'lucide-react';

export default function EmptyState({
  icon: Icon = Inbox,
  title,
  sub,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="anim-pop flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="anim-bob grid h-14 w-14 place-items-center rounded-2xl border border-acc/15 bg-acc/10 text-acc" aria-hidden="true">
        <Icon size={24} strokeWidth={1.8} />
      </span>
      <p className="mt-2 text-sm font-semibold text-txt">{title}</p>
      {sub && <p className="max-w-[250px] text-xs leading-relaxed text-mut">{sub}</p>}
      {children}
    </div>
  );
}
