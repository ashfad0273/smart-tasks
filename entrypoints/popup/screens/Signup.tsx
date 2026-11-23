import { useState } from 'react';
import Field from '../components/Field';
import GoogleIcon from '../components/GoogleIcon';
import StrengthMeter from '../components/StrengthMeter';
import AuthShell, { Divider, PrimaryButton } from '../components/AuthShell';
import { passwordScore } from '../../../lib/utils';
import { API_URL } from '../../../lib/api';
import { useApp } from '../state/AppContext';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Signup() {
  const app = useApp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shake, setShake] = useState(0);

  const fromLocal = !!app.account?.local;
  const checks = passwordScore(password);
  const score = [checks.length, checks.upper, checks.number, checks.symbol].filter(Boolean).length;
  const pwOk = checks.length && score >= 2;
  const canSubmit = !!name.trim() && EMAIL_RE.test(email.trim()) && pwOk && !app.busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const ok = await app.signUp(name, email, password);
    if (!ok) setShake(Date.now());
  };

  const back = app.account ? app.cancelAddAccount : () => app.setScreen('welcome');

  return (
    <AuthShell
      title={fromLocal ? 'Sync your tasks' : 'Create your account'}
      emoji="🚀"
      sub={fromLocal ? 'Your local tasks come along — nothing gets lost.' : 'Free forever for personal use. Takes ten seconds.'}
      onBack={back}
    >
      {app.config?.googleClientId && (
        <>
          <button
            onClick={() => void app.signInWithGoogle()}
            disabled={app.busy}
            className="press mt-6 flex w-full items-center justify-center gap-2.5 rounded-full border border-line bg-surface2 py-2.5 text-sm font-bold text-txt hover:bg-line disabled:opacity-50"
          >
            <GoogleIcon size={16} /> Sign up with Google
          </button>
          <Divider label="or with email" />
        </>
      )}

      <form key={shake} onSubmit={submit} className={`${app.config?.googleClientId ? '' : 'mt-6'} space-y-3 ${shake ? 'anim-shake' : ''}`}>
        <Field label="What should we call you?" autoComplete="name" placeholder="Alex" value={name} maxLength={80} onChange={e => setName(e.target.value)} required autoFocus />
        <Field label="Email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
        <div>
          <Field label="Password" password autoComplete="new-password" placeholder="At least 8 characters" value={password} onChange={e => setPassword(e.target.value)} required />
          <div className="mt-2">
            <StrengthMeter pw={password} />
          </div>
          {password && !pwOk && (
            <p className="mt-1.5 text-[11px] font-semibold text-mut">
              {checks.length ? 'Almost! Mix in a number, capital or symbol 💪' : `${8 - password.length} more character${8 - password.length === 1 ? '' : 's'} to go`}
            </p>
          )}
        </div>
        <PrimaryButton type="submit" busy={app.busy} disabled={!canSubmit}>
          {fromLocal ? 'Create account & sync' : 'Create account'}
        </PrimaryButton>
        <p className="text-center text-[10.5px] leading-relaxed text-mut/80">
          By continuing you agree to our{' '}
          <a href={`${API_URL}/privacy`} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-txt">
            privacy policy
          </a>
          .
        </p>
      </form>

      <p className="mt-4 text-center text-xs font-semibold text-mut">
        Already have an account?{' '}
        <button onClick={() => app.setScreen('login')} className="font-semibold text-acc underline-offset-2 hover:underline">
          Sign in
        </button>
      </p>
    </AuthShell>
  );
}
