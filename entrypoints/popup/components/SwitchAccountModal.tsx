import { useEffect } from 'react';
import { Check, LogOut, Plus } from 'lucide-react';
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
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Switch account">
      <div className="absolute inset-0 bg-black/40 animate-[fadeIn_.12s_ease-out]" onClick={() => app.setSwitcherOpen(false)} />
      <div className="anim-pop absolute right-4 top-14 w-[272px] origin-top-right overflow-hidden rounded-2xl border border-white/[.08] bg-surface shadow-[0_20px_50px_rgba(0,0,0,.55)]">
        <div className="hide-scrollbar max-h-[300px] overflow-y-auto p-1.5">
          {app.accounts.map(a => {
            const active = a.uid === app.account?.uid;
            return (
              <div
                key={a.uid}
                className={cx('group flex items-center gap-1 rounded-xl transition-colors', active ? 'bg-white/[.04]' : 'hover:bg-white/[.04]')}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left"
                  onClick={() => (active ? app.setSwitcherOpen(false) : void app.switchAccount(a.uid))}
                  aria-current={active ? 'true' : undefined}
                >
                  <Avatar name={a.name} email={a.email} photoURL={a.photoURL} hue={a.hue} size={32} local={a.local} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{a.local ? 'On this device' : a.name}</span>
                    <span className="block truncate text-[11px] text-mut">{a.local ? 'Not synced' : a.email}</span>
                  </span>
                  {active && <Check size={15} className="shrink-0 text-acc" strokeWidth={2.5} />}
                </button>
                {!active && (
                  <button
                    onClick={() => void remove(a)}
                    aria-label={a.local ? 'Remove local tasks' : `Sign out ${a.name}`}
                    title={a.local ? 'Remove' : 'Sign out'}
                    className="press mr-1.5 shrink-0 rounded-lg p-1.5 text-mut opacity-0 transition-opacity hover:text-danger focus:opacity-100 group-hover:opacity-100"
                  >
                    <LogOut size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="border-t border-white/[.06] p-1.5">
          <button
            onClick={app.startAddAccount}
            className="press flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium text-txt hover:bg-white/[.04]"
          >
            <span className="grid h-8 w-8 place-items-center rounded-full border border-dashed border-white/20 text-mut">
              <Plus size={14} />
            </span>
            Add account
          </button>
          {app.account && (
            <button
              onClick={() => void remove(app.account!)}
              className="press flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium text-mut hover:bg-white/[.04] hover:text-txt"
            >
              <span className="grid h-8 w-8 place-items-center">
                <LogOut size={14} />
              </span>
              {app.account.local ? 'Remove local tasks' : 'Sign out'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
