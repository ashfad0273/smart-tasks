/**
 * First-run tour: seven short, hands-on steps shown once to a brand-new
 * account (and on demand from Settings). Every step does something real:
 * the tasks typed here are created, the reminder test fires a real
 * notification, the shortcut is pressed for real, the AI pick is remembered
 * by the AI agent screen. Progress is saved after every change, so the tour
 * resumes where it was if the popup closes (it does when the extension's
 * shortcut is pressed) or the app restarts.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BellRing,
  Bot,
  Briefcase,
  Check,
  Dumbbell,
  GraduationCap,
  Heart,
  House,
  Keyboard,
  ListPlus,
  MousePointerClick,
  PartyPopper,
  Plus,
  Rocket,
  Send,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from '../state/AppContext';
import { storageGet, storageSet } from '../../../lib/ext';
import { AGENT_CLIENT_KEY, REMINDERS_ENABLED_KEY, TOUR_KEY } from '../../../lib/keys';
import { AGENT_CLIENTS } from '../../../lib/agents';
import { isDesktopApp, isMac } from '../../../lib/desktop';
import { cx } from '../../../lib/utils';
import Logo from '../components/Logo';
import Burst from '../components/Burst';
import Confetti from '../components/Confetti';
import { Toggle } from './SettingsScreen';

/* ── state ──────────────────────────────────────────────────────────────── */

interface TourState {
  step: number;
  goals: string[];
  added: string[];
  ticked: boolean;
  /** 'trying': the shortcut's modifier keys were held (the window or popup may have gone away). */
  shortcut: 'pending' | 'trying' | 'done';
  ai: string | null;
  tested: boolean;
}
const START: TourState = { step: 0, goals: [], added: [], ticked: false, shortcut: 'pending', ai: null, tested: false };

const STEPS = ['hello', 'add', 'tick', 'remind', 'shortcut', 'ai', 'ready'] as const;
const MAX_TASKS = 5;

const GOALS: Array<{ id: string; label: string; icon: LucideIcon; ideas: string[] }> = [
  { id: 'work', label: 'Work', icon: Briefcase, ideas: ['Reply to the team update', 'Prepare slides for Monday'] },
  { id: 'study', label: 'Study', icon: GraduationCap, ideas: ['Revise chapter 3', 'Finish the assignment draft'] },
  { id: 'personal', label: 'Personal', icon: Heart, ideas: ['Call mom', 'Book a dentist appointment'] },
  { id: 'home', label: 'Home', icon: House, ideas: ['Buy groceries', 'Pay the electricity bill'] },
  { id: 'fitness', label: 'Fitness', icon: Dumbbell, ideas: ['Go for a 30-minute walk', 'Drink 8 glasses of water'] },
  { id: 'side', label: 'Side project', icon: Rocket, ideas: ['Sketch the landing page', 'Write the first blog post'] },
];

const desktop = isDesktopApp();
const mac = isMac();
/** The keys to show, and the KeyboardEvent key/code values that light each one up
 *  (K matches by code too: Option + K types a symbol on a Mac). */
const KEY_K = { label: 'K', keys: ['k', 'K', 'KeyK'] };
const COMBO: Array<{ label: string; keys: string[] }> = desktop
  ? mac
    ? [{ label: '⌘', keys: ['Meta'] }, { label: '⌥', keys: ['Alt'] }, KEY_K]
    : [{ label: 'Ctrl', keys: ['Control'] }, { label: 'Alt', keys: ['Alt'] }, KEY_K]
  : [mac ? { label: '⌘', keys: ['Meta'] } : { label: 'Ctrl', keys: ['Control'] }, { label: 'Shift', keys: ['Shift'] }, KEY_K];
const COMBO_TEXT = COMBO.map(k => k.label).join(' + ');

/* ── screen ─────────────────────────────────────────────────────────────── */

export default function Onboarding() {
  const app = useApp();
  const [s, setS] = useState<TourState>(START);
  const [loaded, setLoaded] = useState(false);
  const [dir, setDir] = useState<1 | -1>(1);

  useEffect(() => {
    void storageGet<Partial<TourState> | null>(TOUR_KEY, null).then(saved => {
      const next = { ...START, ...(saved ?? {}) };
      // Back after the extension's shortcut closed the popup: it worked.
      if (STEPS[next.step] === 'shortcut' && next.shortcut === 'trying' && !desktop) next.shortcut = 'done';
      setS(next);
      setLoaded(true);
    });
  }, []);

  const update = (patch: Partial<TourState>) =>
    setS(prev => {
      const next = { ...prev, ...patch };
      void storageSet(TOUR_KEY, next);
      return next;
    });

  const go = (to: number) => {
    if (to >= STEPS.length) return app.finishTour();
    setDir(to > s.step ? 1 : -1);
    update({ step: Math.max(0, to) });
  };

  if (!loaded) return <div className="ambient h-full bg-bg" />;

  const step = STEPS[s.step];
  const last = s.step === STEPS.length - 1;
  const first = (app.account?.local ? '' : app.account?.name ?? '').split(' ')[0];

  const page = PAGES[step]({ s, update, first });

  return (
    <div className="ambient flex h-full flex-col bg-bg">
      {/* Progress + skip */}
      <header className="flex items-center gap-3 px-5 pb-2 pt-4 @min-[600px]:px-10 @min-[600px]:pt-6">
        <div className="flex flex-1 gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={s.step + 1}>
          {STEPS.map((id, i) => (
            <button
              key={id}
              onClick={() => i < s.step && go(i)}
              disabled={i >= s.step}
              aria-label={`Step ${i + 1}`}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[.07] disabled:cursor-default"
            >
              <span
                className="block h-full rounded-full grad-acc transition-[width] duration-500 ease-[var(--ease-out)]"
                style={{ width: i <= s.step ? '100%' : '0%' }}
              />
            </button>
          ))}
        </div>
        {!last && (
          <button onClick={app.finishTour} className="press shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-mut hover:text-txt">
            Skip tour
          </button>
        )}
      </header>

      {/* Step */}
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div
          key={s.step}
          className={cx(
            dir === 1 ? 'anim-slide-l' : 'anim-slide-r',
            'mx-auto flex min-h-full w-full max-w-[1000px] flex-col gap-5 px-5 py-3',
            '@min-[600px]:grid @min-[600px]:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] @min-[600px]:items-center @min-[600px]:gap-12 @min-[600px]:px-10',
          )}
        >
          <div>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-acc/10 text-acc @min-[600px]:h-12 @min-[600px]:w-12">
              <page.icon size={20} />
            </span>
            <p className="mt-3 text-[10.5px] font-bold uppercase tracking-[.14em] text-acc/80">
              Step {s.step + 1} of {STEPS.length}
            </p>
            <h1 className="mt-1 text-xl font-semibold leading-tight tracking-tight @min-[600px]:text-[34px]">{page.title}</h1>
            <p className="mt-2 text-[12.5px] leading-relaxed text-mut @min-[600px]:mt-3 @min-[600px]:text-sm">{page.body}</p>
          </div>
          <div className="pb-2">{page.panel}</div>
        </div>
      </main>

      {/* Back / continue */}
      <footer className="flex items-center gap-2 px-5 pb-4 pt-2 @min-[600px]:mx-auto @min-[600px]:w-full @min-[600px]:max-w-[1000px] @min-[600px]:px-10 @min-[600px]:pb-8">
        {s.step > 0 && (
          <button
            onClick={() => go(s.step - 1)}
            className="press flex items-center gap-1.5 rounded-full border border-white/[.06] bg-white/[.04] px-4 py-2.5 text-sm font-semibold text-mut hover:text-txt"
          >
            <ArrowLeft size={15} /> Back
          </button>
        )}
        <button
          onClick={() => go(s.step + 1)}
          className="press btn-acc ml-auto flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold @min-[600px]:px-7"
        >
          {page.next ?? 'Continue'} {!last && <ArrowRight size={15} />}
        </button>
      </footer>
    </div>
  );
}

/* ── pages ──────────────────────────────────────────────────────────────── */

interface PageProps {
  s: TourState;
  update: (p: Partial<TourState>) => void;
  first: string;
}
interface Page {
  icon: LucideIcon;
  title: ReactNode;
  body: ReactNode;
  panel: ReactNode;
  next?: string;
}

const PAGES: Record<(typeof STEPS)[number], (p: PageProps) => Page> = {
  hello: ({ s, update, first }) => ({
    icon: Sparkles,
    title: (
      <>
        Hi{first ? ` ${first}` : ' there'}! <span className="grad-text">Let&apos;s make it yours.</span>
      </>
    ),
    body: 'What will you use Smart Tasks for? Pick as many as you like and we’ll suggest a few tasks to start with.',
    panel: <Goals goals={s.goals} onChange={goals => update({ goals })} />,
    next: s.goals.length ? 'Continue' : 'Let’s go',
  }),
  add: ({ s, update }) => ({
    icon: ListPlus,
    title: 'Add your first task',
    body: 'Type anything and press Enter, or tap an idea. Tasks you add here are real and waiting for you when we’re done.',
    panel: <AddTasks s={s} update={update} />,
    next: s.added.length ? 'Continue' : 'Maybe later',
  }),
  tick: ({ s, update }) => ({
    icon: Check,
    title: 'Now tick one off',
    body: 'Getting things done should feel good. Tap the circle and watch.',
    panel: <TickDemo ticked={s.ticked} onTick={() => update({ ticked: true })} />,
  }),
  remind: ({ s, update }) => ({
    icon: BellRing,
    title: 'Never miss a deadline',
    body: `Give a task a due time and Smart Tasks reminds you, even when ${desktop ? 'the window is closed' : 'the popup is closed'}. Finish or snooze right from the notification.`,
    panel: <Reminders s={s} update={update} />,
  }),
  shortcut: ({ s, update }) => ({
    icon: Keyboard,
    title: desktop ? 'Always one keystroke away' : 'Open it in a flash',
    body: desktop
      ? `Press ${COMBO_TEXT} anywhere ${mac ? 'on your Mac' : 'in Windows'} to show or hide Smart Tasks. Try it now: hide it, then bring it back.`
      : `Press ${COMBO_TEXT} on any page to open Smart Tasks. Try it now, we’ll be right here when you’re back.`,
    panel: <Shortcut state={s.shortcut} onChange={shortcut => update({ shortcut })} />,
    next: s.shortcut === 'done' ? 'Continue' : 'Skip for now',
  }),
  ai: ({ s, update }) => ({
    icon: Bot,
    title: 'Bring your AI along',
    body: 'Claude, Codex, Cursor and more can add, update and finish tasks for you. Pick yours and the setup will be ready in Settings → AI agent.',
    panel: <AiPick ai={s.ai} onPick={ai => update({ ai })} idea={s.added[0]} />,
    next: s.ai ? 'Continue' : 'Not now',
  }),
  ready: ({ s }) => ({
    icon: PartyPopper,
    title: (
      <>
        You&apos;re <span className="grad-text">all set!</span>
      </>
    ),
    body: 'That’s everything. Your tasks sync on their own, and you can replay this tour any time from Settings.',
    panel: <Ready s={s} />,
    next: 'Open my tasks',
  }),
};

/* ── step 1: goals ──────────────────────────────────────────────────────── */

function Goals({ goals, onChange }: { goals: string[]; onChange: (g: string[]) => void }) {
  return (
    <ul className="grid grid-cols-2 gap-2 @min-[600px]:gap-3 @min-[760px]:grid-cols-3">
      {GOALS.map(({ id, label, icon: Icon }, i) => {
        const on = goals.includes(id);
        return (
          <li key={id} className="anim-card" style={{ animationDelay: `${80 + i * 50}ms` }}>
            <button
              onClick={() => onChange(on ? goals.filter(g => g !== id) : [...goals, id])}
              aria-pressed={on}
              className={cx(
                'press relative flex w-full items-center gap-2.5 rounded-xl border p-3 text-left text-[13px] font-semibold @min-[600px]:flex-col @min-[600px]:items-start @min-[600px]:gap-3 @min-[600px]:p-4',
                on ? 'border-acc/40 bg-acc/[.09] text-txt' : 'glass text-mut hover:text-txt',
              )}
            >
              <span className={cx('grid h-8 w-8 place-items-center rounded-lg transition-colors', on ? 'grad-acc text-bg' : 'bg-white/[.05]')}>
                <Icon size={16} />
              </span>
              {label}
              <span
                className={cx(
                  'absolute right-2.5 top-2.5 grid h-4 w-4 place-items-center rounded-full transition-all duration-300',
                  on ? 'scale-100 bg-acc text-bg opacity-100' : 'scale-50 opacity-0',
                )}
              >
                <Check size={11} strokeWidth={3} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ── step 2: add tasks (real) ───────────────────────────────────────────── */

function AddTasks({ s, update }: { s: TourState; update: PageProps['update'] }) {
  const app = useApp();
  const [text, setText] = useState('');
  const [shake, setShake] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const pool = (s.goals.length ? GOALS.filter(g => s.goals.includes(g.id)) : GOALS.slice(0, 3)).flatMap(g =>
    g.ideas.map(idea => ({ idea, goal: g.label })),
  );
  const ideas = pool.filter(i => !s.added.includes(i.idea)).slice(0, 4);
  const full = s.added.length >= MAX_TASKS;

  const add = (title: string, goal?: string) => {
    const t = title.trim();
    if (!t || full) {
      setShake(n => n + 1);
      return;
    }
    // File it under a matching category when there is one (Work, Personal…).
    const cat = goal ? app.categories.find(c => c.name.toLowerCase() === goal.toLowerCase()) : undefined;
    void app.createTask({ title: t.slice(0, 300), categoryId: cat?.id ?? null });
    update({ added: [...s.added, t] });
    setText('');
    input.current?.focus();
  };

  return (
    <div className="space-y-3">
      <form
        onSubmit={e => {
          e.preventDefault();
          add(text);
        }}
        key={shake}
        className={cx('glass flex items-center gap-2 rounded-2xl p-1.5 pl-4 focus-within:border-acc/40', shake > 0 && 'anim-shake')}
      >
        <input
          ref={input}
          value={text}
          onChange={e => setText(e.target.value)}
          disabled={full}
          maxLength={300}
          placeholder={full ? 'That’s plenty for now!' : 'What do you need to get done?'}
          className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-mut/70"
          aria-label="New task"
        />
        <button
          type="submit"
          disabled={!text.trim() || full}
          className="press grid h-9 w-9 shrink-0 place-items-center rounded-xl grad-acc text-bg disabled:opacity-30"
          aria-label="Add task"
        >
          <Plus size={18} strokeWidth={2.5} />
        </button>
      </form>

      {!full && ideas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {ideas.map(({ idea, goal }) => (
            <button
              key={idea}
              onClick={() => add(idea, goal)}
              className="press anim-pop rounded-full border border-white/[.06] bg-white/[.03] px-3 py-1.5 text-[11.5px] font-medium text-mut hover:border-acc/30 hover:text-txt"
            >
              + {idea}
            </button>
          ))}
        </div>
      )}

      <ul className="space-y-1.5">
        {s.added.map((t, i) => (
          <li key={t + i} className="anim-card glass flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px]">
            <span className="h-[18px] w-[18px] shrink-0 rounded-full border-2 border-mut/50" />
            <span className="min-w-0 flex-1 truncate">{t}</span>
            <span className="anim-pop text-[10px] font-bold uppercase tracking-wider text-acc">Added</span>
          </li>
        ))}
      </ul>
      {s.added.length > 0 && (
        <p className="anim-pop text-[11.5px] font-semibold text-acc">
          {s.added.length === 1 ? 'Nice, your list has begun.' : `${s.added.length} tasks ready to go.`}
        </p>
      )}
    </div>
  );
}

/* ── step 3: tick ───────────────────────────────────────────────────────── */

const TICK_LINES = ['That’s the feeling!', 'One down, momentum up.', 'Look at you go!'];

function TickDemo({ ticked, onTick }: { ticked: boolean; onTick: () => void }) {
  const [fire, setFire] = useState(0);
  const [done, setDone] = useState(ticked);
  const [line] = useState(() => TICK_LINES[Math.floor(Math.random() * TICK_LINES.length)]);
  const tick = () => {
    if (done) return setDone(false);
    setDone(true);
    setFire(f => f + 1);
    onTick();
  };
  return (
    <div className="space-y-3">
      <Confetti fire={fire} />
      <div className={cx('glass flex items-center gap-3 rounded-2xl p-4 transition-colors duration-500', done && 'border-acc/30 bg-acc/[.06]')}>
        <button
          onClick={tick}
          aria-pressed={done}
          aria-label="Complete task"
          className={cx(
            'press relative grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 transition-colors',
            done ? 'anim-check border-acc bg-acc text-bg' : 'border-mut/60 hover:border-acc',
            !done && 'shadow-[0_0_0_6px_rgba(63,209,197,.12)] [animation:pulseDot_1.6s_ease-in-out_infinite]',
          )}
        >
          {done && <Check size={15} strokeWidth={3} />}
          {done && fire > 0 && <Burst key={fire} count={14} />}
        </button>
        <div className="min-w-0">
          <p className={cx('text-sm font-semibold transition-all duration-500', done && 'text-mut line-through decoration-acc/70')}>
            Finish the Smart Tasks tour
          </p>
          <p className="mt-0.5 text-[11px] text-mut">Today · High priority</p>
        </div>
      </div>
      <p className={cx('flex items-center gap-1.5 text-[12px] font-semibold transition-opacity duration-300', done ? 'text-acc opacity-100' : 'opacity-0')}>
        <Sparkles size={13} /> {line} Completed tasks move to the Done tab.
      </p>
      {!done && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-mut">
          <MousePointerClick size={13} className="anim-bob" /> Tap the glowing circle
        </p>
      )}
    </div>
  );
}

/* ── step 4: reminders ──────────────────────────────────────────────────── */

function Reminders({ s, update }: { s: TourState; update: PageProps['update'] }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [pop, setPop] = useState(0);
  useEffect(() => void storageGet<boolean>(REMINDERS_ENABLED_KEY, true).then(setOn), []);
  const title = s.added[0] ?? 'Call mom';

  const toggle = (v: boolean) => {
    setOn(v);
    void storageSet(REMINDERS_ENABLED_KEY, v);
  };
  const test = () => {
    setPop(p => p + 1);
    update({ tested: true });
    try {
      void chrome.notifications.create(`st-tour-test:${Date.now()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon/128.png'),
        title: `Reminder: ${title}`,
        message: 'This is how reminders look. Finish or snooze them right here.',
        buttons: [{ title: 'Done' }, { title: 'Snooze 10 min' }],
      });
    } catch {
      /* notifications blocked: the preview above still shows the idea */
    }
  };

  return (
    <div className="space-y-3">
      {/* A preview of the notification, replayed by the test button. */}
      <div key={pop} className="anim-card rounded-2xl border border-white/[.07] bg-[#1c2427] p-3.5 shadow-2xl shadow-black/40">
        <div className="flex items-center gap-2 text-[10.5px] text-mut">
          <Logo size={14} /> Smart Tasks · now
        </div>
        <div className="mt-2 flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sun/10 text-sun">
            <BellRing size={17} className="hover-wiggle" style={{ animation: 'wiggle .5s ease 2' }} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">Reminder: {title}</p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-mut">Due now · tap to open</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <span className="rounded-lg bg-white/[.06] py-1.5 text-center text-[11.5px] font-semibold">Done</span>
          <span className="rounded-lg bg-white/[.06] py-1.5 text-center text-[11.5px] font-semibold">Snooze 10 min</span>
        </div>
      </div>

      <div className="glass flex items-center gap-3 rounded-xl px-3.5 py-3">
        <BellRing size={15} className="text-acc" />
        <span className="flex-1 text-[13px] font-semibold">Reminders</span>
        {on !== null && <Toggle label="Reminders" on={on} onChange={toggle} />}
      </div>
      <button
        onClick={test}
        disabled={!on}
        className="press flex w-full items-center justify-center gap-2 rounded-xl border border-white/[.06] bg-white/[.04] py-2.5 text-[12.5px] font-semibold hover:bg-white/[.07] disabled:opacity-40"
      >
        <Send size={14} /> {s.tested ? 'Send another test' : 'Send me a test reminder'}
      </button>
      {s.tested && <p className="anim-pop text-center text-[11.5px] font-semibold text-acc">Sent! Check the corner of your screen.</p>}
    </div>
  );
}

/* ── step 5: shortcut ───────────────────────────────────────────────────── */

function Shortcut({ state, onChange }: { state: TourState['shortcut']; onChange: (v: TourState['shortcut']) => void }) {
  const [held, setHeld] = useState<Set<string>>(new Set());
  const stateRef = useRef(state);
  stateRef.current = state;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const done = state === 'done';

  useEffect(() => {
    if (done) return;
    const set = (v: TourState['shortcut']) => {
      if (stateRef.current !== v && stateRef.current !== 'done') onChangeRef.current(v);
    };
    const pressed = new Set<string>();
    const sync = () => setHeld(new Set(pressed));
    const modifiersHeld = () => COMBO.slice(0, -1).every(k => k.keys.some(x => pressed.has(x)));
    // Modifier flags too: some keyboards and remote tools send them only on the K press.
    const mods = (e: KeyboardEvent) => {
      for (const [k, on] of [['Control', e.ctrlKey], ['Alt', e.altKey], ['Shift', e.shiftKey], ['Meta', e.metaKey]] as const) {
        if (on) pressed.add(k);
        else pressed.delete(k);
      }
    };
    const down = (e: KeyboardEvent) => {
      pressed.add(e.key);
      pressed.add(e.code);
      mods(e);
      sync();
      if (modifiersHeld() && stateRef.current === 'pending') set('trying');
      if (COMBO.every(k => k.keys.some(x => pressed.has(x)))) set('done');
    };
    const up = (e: KeyboardEvent) => {
      pressed.delete(e.key);
      pressed.delete(e.code);
      mods(e);
      sync();
    };
    // The app's global shortcut hides the window: coming back means it worked.
    const blur = () => {
      if (desktop && modifiersHeld()) set('trying');
      pressed.clear();
      sync();
    };
    const focus = () => {
      if (desktop && stateRef.current === 'trying') set('done');
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
    };
  }, [done]);

  return (
    <div className="space-y-4">
      <div className={cx('glass relative flex items-center justify-center gap-2 rounded-2xl px-4 py-7 transition-colors duration-500', done && 'border-acc/30 bg-acc/[.06]')}>
        {COMBO.map((k, i) => {
          const lit = done || k.keys.some(x => held.has(x));
          return (
            <span key={k.label} className="flex items-center gap-2">
              {i > 0 && <span className="text-mut">+</span>}
              <kbd
                className={cx(
                  'grid h-12 min-w-12 place-items-center rounded-xl border-b-4 px-3 font-sans text-[15px] font-bold transition-all duration-150 @min-[600px]:h-14 @min-[600px]:min-w-14',
                  lit
                    ? 'translate-y-[3px] border-b-[#1f9e94] bg-acc text-bg shadow-[0_0_24px_rgba(63,209,197,.45)]'
                    : 'border-b-black/50 bg-surface2 text-txt',
                )}
              >
                {k.label}
              </kbd>
            </span>
          );
        })}
        {done && <Burst count={16} />}
      </div>
      <p className={cx('flex items-center justify-center gap-1.5 text-[12.5px] font-semibold', done ? 'anim-pop text-acc' : 'text-mut')}>
        {done ? (
          <>
            <Check size={14} strokeWidth={3} /> Nailed it. That’s your shortcut.
          </>
        ) : state === 'trying' ? (
          desktop ? 'Now press it again to bring Smart Tasks back.' : 'Almost, add the K.'
        ) : (
          'Hold the keys together…'
        )}
      </p>
      {!desktop && (
        <div className="glass flex items-start gap-3 rounded-xl p-3.5">
          <MousePointerClick size={16} className="mt-0.5 shrink-0 text-pop" />
          <p className="text-[12px] leading-relaxed text-mut">
            <span className="font-semibold text-txt">Bonus:</span> right-click any page, link or selected text and choose{' '}
            <span className="font-semibold text-txt">Save to Smart Tasks</span>.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── step 6: AI ─────────────────────────────────────────────────────────── */

function AiPick({ ai, onPick, idea }: { ai: string | null; onPick: (id: string) => void; idea?: string }) {
  const client = AGENT_CLIENTS.find(c => c.id === ai);
  const pick = (id: string) => {
    onPick(id);
    void storageSet(AGENT_CLIENT_KEY, id); // the AI agent screen opens on this one
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {AGENT_CLIENTS.map(c => (
          <button
            key={c.id}
            onClick={() => pick(c.id)}
            aria-pressed={c.id === ai}
            className={cx(
              'press rounded-full border px-3 py-1.5 text-[12px] font-semibold',
              c.id === ai ? 'border-acc/40 bg-acc/[.12] text-acc' : 'border-white/[.06] bg-white/[.03] text-mut hover:text-txt',
            )}
          >
            {c.name}
          </button>
        ))}
      </div>
      <ChatDemo key={ai ?? 'none'} who={client?.name ?? 'Your AI'} task={idea ?? 'Buy groceries'} />
    </div>
  );
}

/** A tiny scripted chat: the request types itself out, then the task lands. */
function ChatDemo({ who, task }: { who: string; task: string }) {
  const ask = `Add “${task}” to my tasks for tomorrow`;
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN(x => (x > ask.length + 24 ? x : x + 1)), 32);
    return () => clearInterval(t);
  }, [ask]);
  const typed = ask.slice(0, n);
  const replied = n > ask.length + 6;
  const landed = n > ask.length + 20;
  return (
    <div className="glass space-y-2.5 rounded-2xl p-3.5">
      <div className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md bg-acc/[.14] px-3 py-2 text-[12.5px]">
        {typed}
        {n <= ask.length && <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 bg-acc [animation:pulseDot_1s_infinite]" />}
      </div>
      {replied && (
        <div className="anim-pop flex w-fit max-w-[90%] items-center gap-2 rounded-2xl rounded-bl-md bg-white/[.05] px-3 py-2 text-[12.5px]">
          <Bot size={14} className="shrink-0 text-pop" /> {who}: Done, it’s on your list.
        </div>
      )}
      {landed && (
        <div className="anim-card flex items-center gap-3 rounded-xl border border-acc/25 bg-acc/[.06] px-3 py-2.5 text-[13px]">
          <span className="h-[18px] w-[18px] shrink-0 rounded-full border-2 border-mut/50" />
          <span className="min-w-0 flex-1 truncate">{task}</span>
          <span className="text-[10.5px] font-semibold text-mut">Tomorrow</span>
        </div>
      )}
    </div>
  );
}

/* ── step 7: ready ──────────────────────────────────────────────────────── */

function Ready({ s }: { s: TourState }) {
  const [fire, setFire] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setFire(1), 250);
    return () => clearTimeout(t);
  }, []);
  const ai = AGENT_CLIENTS.find(c => c.id === s.ai)?.name;
  const items: Array<[boolean, string]> = [
    [s.added.length > 0, s.added.length ? `${s.added.length} task${s.added.length > 1 ? 's' : ''} on your list` : 'Add tasks any time with the + box'],
    [s.ticked, 'Ticked off your first task'],
    [s.tested, s.tested ? 'Reminders tested and working' : 'Reminders are on'],
    [s.shortcut === 'done', `Shortcut: ${COMBO_TEXT}`],
    [!!ai, ai ? `${ai} is ready to connect` : 'Connect an AI later in Settings'],
  ];
  return (
    <div>
      <Confetti fire={fire} />
      <div className="mb-4 flex justify-center @min-[600px]:justify-start">
        <Logo size={64} bob />
      </div>
      <ul className="space-y-1.5">
        {items.map(([ok, label], i) => (
          <li
            key={label}
            className="anim-card glass flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13px]"
            style={{ animationDelay: `${150 + i * 90}ms` }}
          >
            <span
              className={cx(
                'grid h-5 w-5 shrink-0 place-items-center rounded-full',
                ok ? 'anim-check bg-acc text-bg' : 'border-2 border-mut/40',
              )}
              style={{ animationDelay: `${300 + i * 90}ms` }}
            >
              {ok && <Check size={12} strokeWidth={3} />}
            </span>
            <span className={ok ? 'font-medium' : 'text-mut'}>{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
