import { useId, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  password?: boolean;
  hint?: string;
}

export default function Field({ label, password, type, hint, ...rest }: Props) {
  const [show, setShow] = useState(false);
  const id = useId();
  const actualType = password ? (show ? 'text' : 'password') : (type ?? 'text');
  return (
    <div className="block">
      <label htmlFor={id} className="mb-1.5 block text-xs font-bold text-mut">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={actualType}
          {...rest}
          className="w-full rounded-2xl border border-line bg-surface2 px-3.5 py-2.5 text-sm font-semibold text-txt outline-none transition-all placeholder:font-medium placeholder:text-mut/50 focus:border-acc/60 focus:shadow-[0_0_0_4px_rgba(34,197,94,.12)]"
        />
        {password && (
          <button
            type="button"
            onClick={() => setShow(s => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-mut transition-colors hover:text-txt"
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {hint && <p className="mt-1 text-[11px] text-mut">{hint}</p>}
    </div>
  );
}
