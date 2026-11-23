import { HardDrive } from 'lucide-react';
import { useApp } from '../state/AppContext';
import Logo from '../components/Logo';

const PERKS: Array<[string, string, string]> = [
  ['⚡', 'Live sync', 'Add on your laptop, see it on your desktop instantly.'],
  ['🖱️', 'Capture anything', 'Right-click any page or text to save it as a task.'],
  ['⏰', 'Nudges that help', 'Reminders you can finish or snooze from the notification.'],
];

export default function Welcome() {
  const app = useApp();
  return (
    <div className="ambient flex h-full flex-col bg-bg px-6 pb-6 pt-10">
      <div className="flex flex-col items-center text-center">
        <Logo size={64} bob />
        <h1 className="mt-5 text-2xl font-black tracking-tight">
          Get things <span className="grad-text">done</span>,<br />
          have fun doing it.
        </h1>
        <p className="mt-2 text-xs font-semibold text-mut">Your to-dos, synced everywhere, one click away.</p>
      </div>

      <ul className="mt-6 space-y-2">
        {PERKS.map(([emoji, title, body], i) => (
          <li
            key={title}
            className="anim-card flex items-start gap-3 rounded-2xl border border-line bg-surface/80 p-3 backdrop-blur"
            style={{ animationDelay: `${120 + i * 90}ms` }}
          >
            <span className="text-xl" aria-hidden="true">
              {emoji}
            </span>
            <span>
              <span className="block text-xs font-extrabold">{title}</span>
              <span className="block text-[11px] leading-relaxed text-mut">{body}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-auto space-y-2 pt-5">
        <button onClick={() => app.setScreen('signup')} className="press grad-acc glow w-full rounded-2xl py-3 text-sm font-extrabold text-white">
          Create a free account
        </button>
        <button
          onClick={() => app.setScreen('login')}
          className="press w-full rounded-2xl border border-line bg-surface2 py-3 text-sm font-bold text-txt hover:bg-line"
        >
          I already have one
        </button>
        <button
          onClick={() => void app.startLocal()}
          className="press mx-auto flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold text-mut hover:text-txt"
        >
          <HardDrive size={11} /> Skip — keep tasks on this device only
        </button>
      </div>
    </div>
  );
}
