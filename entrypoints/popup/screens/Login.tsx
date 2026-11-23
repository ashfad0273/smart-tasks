import { useState } from 'react';
import { HardDrive, Info } from 'lucide-react';
import Field from '../components/Field';
import GoogleIcon from '../components/GoogleIcon';
import AuthShell, { Divider, PrimaryButton } from '../components/AuthShell';
import { useApp } from '../state/AppContext';

export default function Login() {
  const app = useApp();
  const [email, setEmail] = useState(app.sessionExpired ? (app.account?.email ?? '') : '');
  const [password, setPassword] = useState('');
  const [shake, setShake] = useState(0);
  const [resetHelp, setResetHelp] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (app.busy) return;
    const ok = await app.signIn(email, password);
    if (!ok) setShake(Date.now());
  };

  const back = app.account ? app.cancelAddAccount : app.accounts.length === 0 ? () => app.setScreen('welcome') : undefined;

  return (
    <AuthShell
      title={app.addMode ? 'Add an account' : 'Welcome back'}
      sub={app.addMode ? 'Sign in with another account — switch between them in one click.' : 'Sign in to pick up right where you left off.'}
      onBack={back}
    >
      {app.config?.googleClientId && (
        <>
          <button
            onClick={() => void app.signInWithGoogle()}
            disabled={app.busy}
            className="press mt-5 flex w-full items-center justify-center gap-2.5 rounded-full border border-white/[.06] bg-white/[.04] py-2.5 text-[13.5px] font-semibold text-txt hover:bg-white/[.07] disabled:opacity-50"
          >
            <GoogleIcon size={16} /> Continue with Google
          </button>
          <Divider label="or with email" />
        </>
      )}

      <form key={shake} onSubmit={submit} className={`${app.config?.googleClientId ? '' : 'mt-5'} space-y-3 ${shake ? 'anim-shake' : ''}`}>
        <Field label="Email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
        <Field label="Password" password autoComplete="current-password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required />
        <div className="-mt-1 flex justify-end">
          <button
            type="button"
            onClick={() => (app.config?.passwordReset ? app.setScreen('reset') : setResetHelp(v => !v))}
            aria-expanded={app.config?.passwordReset ? undefined : resetHelp}
            className="text-[12px] font-medium text-mut underline-offset-2 hover:text-acc hover:underline"
          >
            Forgot password?
          </button>
        </div>
        {resetHelp && !app.config?.passwordReset && (
          <div className="anim-pop flex gap-2.5 rounded-xl border border-acc/15 bg-acc/[.06] p-3 text-[12px] leading-relaxed text-mut">
            <Info size={14} className="mt-0.5 shrink-0 text-acc" />
            <p>
              Email reset isn't available yet.{' '}
              {app.config?.googleClientId ? (
                <>
                  If your account uses a Gmail address, choose <span className="font-semibold text-txt">Continue with Google</span> with
                  that same address to get straight back in.
                </>
              ) : (
                'Contact support to recover your account.'
              )}
            </p>
          </div>
        )}
        <PrimaryButton type="submit" busy={app.busy} disabled={app.busy || !email || !password}>
          Sign in
        </PrimaryButton>
      </form>

      <div className="mt-4 space-y-1.5 text-center">
        <p className="text-[12.5px] text-mut">
          New here?{' '}
          <button onClick={() => app.setScreen('signup')} className="font-semibold text-acc underline-offset-2 hover:underline">
            Create an account
          </button>
        </p>
        {app.accounts.length > 0 && !app.account && (
          <button onClick={() => app.setSwitcherOpen(true)} className="text-[12px] font-medium text-mut underline-offset-2 hover:text-txt hover:underline">
            Use a saved account
          </button>
        )}
        {!app.account && !app.addMode && (
          <button
            onClick={() => void app.startLocal()}
            className="press mx-auto flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium text-mut hover:text-txt"
          >
            <HardDrive size={11} /> Use without an account
          </button>
        )}
      </div>
    </AuthShell>
  );
}
