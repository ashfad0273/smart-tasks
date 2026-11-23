import { useEffect } from 'react';
import { Check, LogOut, Plus, X } from 'lucide-react';
import type { AccountInfo } from '../../../lib/types';
import { cx } from '../../../lib/utils';
import { useApp } from '../state/AppContext';
import Avatar from './Avatar';

export default function SwitchAccountModal() {
  const app = useApp();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && app.setSwitcherOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  const remove = async (a: AccountInfo) => {
    const ok = await app.confirm(
      a.local
        ? {
            title: 'Remove local tasks?',
            message: 'Local tasks exist only in this browser. Removing this space deletes them for good.',
            confirmText: 'Delete local tasks',
            danger: true,
          }
        : {
            title: `Sign out ${a.name}?`,
            message: 'Your tasks stay safe in the cloud and come back when you sign in again.',
            confirmText: 'Sign out',
          },
    );
    if (ok) await app.signOut(a.uid);
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-5" role="dialog" aria-modal="true" aria-labelledby="switch-title">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] animate-[fadeIn_.12s_ease-out]" onClick={() => app.setSwitcherOpen(false)} />
      <div className="anim-pop relative w-full rounded-3xl border border-line bg-surface p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 id="switch-title" className="text-base font-semibold">
            Your accounts
          </h3>
          <button onClick={() => app.setSwitcherOpen(false)} aria-label="Close" className="press rounded-lg p-1 text-mut hover:text-txt">
            <X size={16} />
          </button>
        </div>

        <div className="hide-scrollbar mt-3 max-h-[300px] space-y-2 overflow-y-auto">
          {app.accounts.map((a, i) => {
            const active = a.uid === app.account?.uid;
            return (
              <div
                key={a.uid}
                className={cx(
                  'anim-card group flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors',
                  active ? 'border-acc/40 bg-acc/5' : 'border-line bg-surface2 hover:border-mut/30',
                )}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => void app.switchAccount(a.uid)}>
                  <Avatar name={a.name} email={a.email} photoURL={a.photoURL} hue={a.hue} size={36} local={a.local} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-bold">{a.local ? 'On this device' : a.name}</span>
                      {active && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-acc/15 px-1.5 py-0.5 text-[10px] font-semibold text-acc">
                          <Check size={9} strokeWidth={3} /> Active
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[11px] text-mut">{a.local ? 'Local only · no sync' : a.email}</span>
                  </span>
                </button>
                <button
                  onClick={() => void remove(a)}
                  aria-label={a.local ? 'Remove local tasks' : `Sign out ${a.name}`}
                  title={a.local ? 'Remove' : 'Sign out'}
                  className="press shrink-0 rounded-lg p-1.5 text-mut/60 opacity-0 transition-opacity hover:text-danger focus:opacity-100 group-hover:opacity-100"
                >
                  <LogOut size={13} />
                </button>
              </div>
            );
          })}
        </div>

        <button
          onClick={app.startAddAccount}
          className="press mt-3 flex w-full items-center justify-center gap-1.5 rounded-full border border-dashed border-acc/50 bg-acc/5 py-2.5 text-sm font-semibold text-acc hover:bg-acc/10"
        >
          <Plus size={15} strokeWidth={3} /> Add another account
        </button>
      </div>
    </div>
  );
}
