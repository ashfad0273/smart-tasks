import { useState } from 'react';
import Field from '../components/Field';
import AuthShell, { PrimaryButton } from '../components/AuthShell';
import { useApp } from '../state/AppContext';

export default function Reset() {
  const app = useApp();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await app.requestReset(email)) setSent(true);
  };
  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    await app.confirmReset(email, code, password);
  };

  return (
    <AuthShell
      title={sent ? 'Check your inbox' : 'Reset password'}
      sub={sent ? `If ${email} has an account, we sent it a 6-digit code.` : "Enter your email and we'll send you a code."}
      onBack={() => app.setScreen('login')}
    >
      {!sent ? (
        <form onSubmit={request} className="mt-5 space-y-3">
          <Field label="Email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          <PrimaryButton type="submit" busy={app.busy} disabled={app.busy || !email}>
            Send code
          </PrimaryButton>
        </form>
      ) : (
        <form onSubmit={confirm} className="mt-5 space-y-3">
          <Field
            label="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            required
            autoFocus
          />
          <Field label="New password" password autoComplete="new-password" placeholder="At least 8 characters" value={password} onChange={e => setPassword(e.target.value)} required />
          <PrimaryButton type="submit" busy={app.busy} disabled={app.busy || code.length !== 6 || password.length < 8}>
            Set new password
          </PrimaryButton>
          <button type="button" onClick={() => setSent(false)} className="w-full text-center text-xs font-semibold text-mut hover:text-txt">
            Didn't get it? Try again
          </button>
        </form>
      )}
    </AuthShell>
  );
}
