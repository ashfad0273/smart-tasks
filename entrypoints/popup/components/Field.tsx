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
      <label htmlFor={id} className="mb-1 block text-[12px] font-medium text-mut">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={actualType}
          {...rest}
          className={`w-full rounded-xl border border-white/[.06] bg-black/20 py-[9px] pl-3.5 text-[13.5px] text-txt outline-none transition-all placeholder:text-mut/60 focus:border-acc/40 focus:shadow-[0_0_0_3px_rgba(63,209,197,.12)] ${password ? 'pr-10' : 'pr-3.5'}`}
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
