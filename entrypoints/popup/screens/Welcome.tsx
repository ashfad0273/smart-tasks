import { useEffect, useState } from 'react';
import { BellRing, Check, HardDrive, Keyboard, MousePointerClick, Zap, type LucideIcon } from 'lucide-react';
import { useApp } from '../state/AppContext';
import Logo from '../components/Logo';
import Burst from '../components/Burst';
import { desktopShortcut, isDesktopApp } from '../../../lib/desktop';
import { cx } from '../../../lib/utils';

const PERKS: Array<[LucideIcon, string, string]> = [
  [Zap, 'Live sync', 'Add on your laptop, see it on your desktop instantly.'],
  isDesktopApp()
    ? [Keyboard, 'Always at hand', `Press ${desktopShortcut()} anywhere to open Smart Tasks.`]
    : [MousePointerClick, 'Capture anything', 'Right-click any page or text to save it as a task.'],
  [BellRing, 'Reminders that help', 'Reminders you can finish or snooze from the notification.'],
];

export default function Welcome() {
  const app = useApp();
  return (
    <div className="ambient flex h-full flex-col overflow-y-auto bg-bg px-6 pb-4 pt-6 @min-[600px]:justify-center @min-[600px]:px-12 @min-[600px]:py-10">
      <div className="flex flex-col items-center text-center">
        <Logo size={52} bob />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight @min-[600px]:mt-6 @min-[600px]:text-4xl">
          Get things <span className="grad-text">done</span>,<br />
          have fun doing it.
        </h1>
        <p className="mt-2 text-xs font-semibold text-mut @min-[600px]:mt-3 @min-[600px]:text-sm">Your to-dos, synced everywhere, one click away.</p>
      </div>

      <LiveDemo />

      {/* Narrow: one perk at a time. Wide: all three side by side. */}
      <PerkCarousel />
      <ul className="hidden @min-[600px]:mx-auto @min-[600px]:mt-8 @min-[600px]:grid @min-[600px]:w-full @min-[600px]:max-w-[880px] @min-[600px]:grid-cols-3 @min-[600px]:gap-4">
        {PERKS.map(([Icon, title, body], i) => (
          <li
            key={title}
            className="anim-card glass flex flex-col gap-3 rounded-xl p-5 transition-transform duration-300 hover:-translate-y-1"
            style={{ animationDelay: `${120 + i * 90}ms` }}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-acc/10 text-acc" aria-hidden="true">
              <Icon size={16} />
            </span>
            <span>
              <span className="block text-sm font-semibold">{title}</span>
              <span className="mt-1 block text-xs leading-relaxed text-mut">{body}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-auto grid gap-2 pt-4 @min-[520px]:grid-cols-2 @min-[520px]:gap-3 @min-[600px]:mx-auto @min-[600px]:mt-10 @min-[600px]:w-full @min-[600px]:max-w-[560px]">
        {/* Side by side once there is room; the "Skip" link spans both columns. */}
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
          className="press mx-auto flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold text-mut hover:text-txt @min-[520px]:col-span-2"
        >
          <HardDrive size={11} /> Skip — keep tasks on this device only
        </button>
      </div>
    </div>
  );
}

/* A task that types itself in and gets ticked off, on a loop. Tap the circle to tick it yourself. */
const DEMO = ['Plan the weekend trip', 'Reply to the client email', 'Water the plants', 'Book flights for June'];

function LiveDemo() {
  const [i, setI] = useState(0);
  const [n, setN] = useState(0);
  const [done, setDone] = useState(false);
  const [pop, setPop] = useState(0);
  const title = DEMO[i % DEMO.length];

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    if (done)
      t = setTimeout(() => {
        setI(x => x + 1);
        setN(0);
        setDone(false);
      }, 1500);
    else if (n < title.length) t = setTimeout(() => setN(n + 1), 55);
    else
      t = setTimeout(() => {
        setDone(true);
        setPop(p => p + 1);
      }, 1700);
    return () => clearTimeout(t);
  }, [n, done, title]);

  const tick = () => {
    if (done) return;
    setN(title.length);
    setDone(true);
    setPop(p => p + 1);
  };

  return (
    <div className="anim-card mx-auto mt-5 w-full max-w-[420px] @min-[600px]:mt-8" style={{ animationDelay: '80ms' }}>
      <div className={cx('glass flex items-center gap-3 rounded-2xl px-4 py-3 transition-colors duration-500', done && 'border-acc/25 bg-acc/[.06]')}>
        <button
          onClick={tick}
          aria-label="Complete the sample task"
          className={cx(
            'press relative grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors',
            done ? 'anim-check border-acc bg-acc text-bg' : 'border-mut/60 hover:border-acc',
          )}
        >
          {done && <Check size={13} strokeWidth={3} />}
          {done && <Burst key={pop} count={12} />}
        </button>
        <span className={cx('min-w-0 flex-1 truncate text-left text-[13px] font-medium transition-colors duration-500', done && 'text-mut line-through decoration-acc/70')}>
          {title.slice(0, n)}
          {!done && n < title.length && <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 bg-acc" />}
        </span>
        <span className={cx('text-[10.5px] font-bold uppercase tracking-wider transition-opacity duration-300', done ? 'text-acc opacity-100' : 'opacity-0')}>Done!</span>
      </div>
      <p className="mt-1.5 text-center text-[10.5px] font-semibold text-mut/80">Try it: tap the circle</p>
    </div>
  );
}

function PerkCarousel() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setI(x => (x + 1) % PERKS.length), 3800);
    return () => clearInterval(t);
  }, [paused]);
  const [Icon, title, body] = PERKS[i];
  return (
    <div className="mt-3 @min-[600px]:hidden" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div key={i} className="anim-slide-l glass flex items-start gap-3 rounded-xl p-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-acc/10 text-acc" aria-hidden="true">
          <Icon size={16} />
        </span>
        <span>
          <span className="block text-xs font-semibold">{title}</span>
          <span className="block text-[11px] leading-relaxed text-mut">{body}</span>
        </span>
      </div>
      <div className="mt-2 flex justify-center gap-1.5">
        {PERKS.map(([, t], j) => (
          <button
            key={t}
            onClick={() => setI(j)}
            aria-label={t}
            className={cx('h-1.5 rounded-full transition-all duration-300', j === i ? 'w-5 bg-acc' : 'w-1.5 bg-white/20 hover:bg-white/40')}
          />
        ))}
      </div>
    </div>
  );
}
