import { BellRing, HardDrive, MousePointerClick, Zap, type LucideIcon } from 'lucide-react';
import { useApp } from '../state/AppContext';
import Logo from '../components/Logo';

const PERKS: Array<[LucideIcon, string, string]> = [
  [Zap, 'Live sync', 'Add on your laptop, see it on your desktop instantly.'],
  [MousePointerClick, 'Capture anything', 'Right-click any page or text to save it as a task.'],
  [BellRing, 'Reminders that help', 'Reminders you can finish or snooze from the notification.'],
];

export default function Welcome() {
  const app = useApp();
  return (
    <div className="ambient flex h-full flex-col bg-bg px-6 pb-4 pt-7">
      <div className="flex flex-col items-center text-center">
        <Logo size={56} bob />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          Get things <span className="grad-text">done</span>,<br />
          have fun doing it.
        </h1>
        <p className="mt-2 text-xs font-semibold text-mut">Your to-dos, synced everywhere, one click away.</p>
      </div>

      <ul className="mt-5 space-y-2">
        {PERKS.map(([Icon, title, body], i) => (
          <li
            key={title}
            className="anim-card glass flex items-start gap-3 rounded-xl p-3"
            style={{ animationDelay: `${120 + i * 90}ms` }}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-acc/10 text-acc" aria-hidden="true">
              <Icon size={16} />
            </span>
            <span>
              <span className="block text-xs font-semibold">{title}</span>
              <span className="block text-[11px] leading-relaxed text-mut">{body}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-auto space-y-2 pt-4">
        <button onClick={() => app.setScreen('signup')} className="press btn-acc w-full rounded-full py-3 text-sm font-semibold">
          Create a free account
        </button>
        <button
          onClick={() => app.setScreen('login')}
          className="press w-full rounded-full border border-white/[.06] bg-white/[.04] py-3 text-sm font-semibold text-txt hover:bg-white/[.07]"
        >
          I already have one
        </button>
        <button
          onClick={() => void app.startLocal()}
          className="press mx-auto flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold text-mut hover:text-txt"
        >
          <HardDrive size={11} /> Skip — keep tasks on this device only
        </button>
      </div>
    </div>
  );
}
