import { ArrowLeft } from 'lucide-react';
import { useApp } from '../state/AppContext';
import Logo from './Logo';

export default function AuthShell({
  title,
  sub,
  onBack,
  children,
}: {
  title: string;
  sub?: string;
  onBack?: () => void;
  children: React.ReactNode;
}) {
  const app = useApp();
  const back = onBack ?? (app.account ? app.cancelAddAccount : undefined);
  return (
    <div className="ambient h-full overflow-y-auto bg-bg px-6 pb-4 pt-4">
      {back ? (
        <button onClick={back} className="press -ml-1 inline-flex items-center gap-1 rounded-lg px-1 py-0.5 text-xs font-semibold text-mut hover:text-txt">
          <ArrowLeft size={13} /> Back
        </button>
      ) : (
        <div className="h-5" />
      )}
      <div className="flex flex-col items-center text-center">
        <Logo size={44} bob />
        <h1 className="mt-3 text-lg font-semibold">
          {title}
        </h1>
        {sub && <p className="mt-1 max-w-[280px] text-[12.5px] leading-relaxed text-mut">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

export function PrimaryButton({ busy, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      {...rest}
      className={`press btn-acc w-full rounded-full py-3 text-sm font-semibold disabled:opacity-40 disabled:shadow-none ${rest.className ?? ''}`}
    >
      {busy ? <span className="mx-auto block h-4 w-4 animate-spin rounded-full border-2 border-acc/30 border-t-acc" /> : children}
    </button>
  );
}

export function Divider({ label }: { label: string }) {
  return (
    <div className="my-3.5 flex items-center gap-3 text-[11px] font-medium text-mut">
      <span className="h-px flex-1 bg-line" />
      {label}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
