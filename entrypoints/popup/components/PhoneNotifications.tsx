import { useEffect, useState } from 'react';
import { BellRing, Check, Loader2, Send } from 'lucide-react';
import { api, type PushMode, type PushSettings } from '../../../lib/api';

/** Same key as web/shim.ts: agent notifications come by push, so the page doesn't show them again. */
const PUSH_ON_KEY = 'st-push-on';
const DEFAULTS: PushSettings = { mode: 'away', awayMin: 5 };
const AWAY_CHOICES = [2, 5, 10, 15, 30, 60];

const OPTIONS: Array<{ mode: PushMode; label: string; sub: (min: number) => string }> = [
  { mode: 'away', label: "When I'm away from my computer", sub: m => `No desktop app open, or no keyboard or mouse use for ${m} min` },
  { mode: 'closed', label: 'When no desktop app is open', sub: () => 'Quiet while the Smart Tasks app runs on any computer' },
  { mode: 'always', label: 'Always', sub: () => 'Every notification, on the phone and the computer' },
  { mode: 'off', label: 'Never', sub: () => 'Only inside the app' },
];

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

/** Settings card for the phone app: when AI and "No agent picked up" notifications reach this phone. */
export default function PhoneNotifications({ token }: { token: string }) {
  const supported = typeof Notification !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
  const [settings, setSettings] = useState<PushSettings>(DEFAULTS);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return;
    void (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        const info = await api.pushInfo(token, sub?.endpoint ?? '');
        if (sub && info.settings && Notification.permission === 'granted') {
          setSettings(info.settings);
          setSubscribed(true);
          localStorage.setItem(PUSH_ON_KEY, info.settings.mode === 'off' ? '0' : '1');
        } else {
          setSubscribed(false);
          localStorage.removeItem(PUSH_ON_KEY);
        }
      } catch {
        setSubscribed(false);
      }
    })();
  }, [token, supported]);

  const save = async (next: PushSettings) => {
    setBusy(true);
    setNote(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (next.mode !== 'off' && (!sub || Notification.permission !== 'granted')) {
        if ((await Notification.requestPermission()) !== 'granted') {
          setNote('Notifications are blocked. Allow them for this app in your phone or browser settings, then try again.');
          return;
        }
        const { publicKey } = await api.pushInfo(token);
        if (!publicKey) throw new Error('The server has no push key yet.');
        sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      }
      if (sub) {
        const r = await api.pushSubscribe(token, sub.toJSON(), next);
        setSettings(r.settings);
        setSubscribed(true);
        localStorage.setItem(PUSH_ON_KEY, r.settings.mode === 'off' ? '0' : '1');
      } else setSettings(next);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not turn on notifications.');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const { sent } = await api.pushTest(token);
      setNote(sent ? 'Sent. It should appear in a few seconds.' : 'Nothing was sent: turn notifications on first.');
    } catch {
      setNote("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const current = subscribed ? settings.mode : null;

  return (
    <section className="anim-card rounded-2xl border border-line bg-surface p-3.5">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-mut">
        <BellRing size={11} /> Phone notifications
      </h3>
      {!supported ? (
        <p className="mt-2 text-[12px] text-mut">This browser can't receive notifications. Open Smart Tasks in Chrome and install it to your home screen.</p>
      ) : (
        <>
          <p className="mt-1.5 text-[11.5px] leading-snug text-mut">
            Messages from your AI agents and "No agent picked up" alerts. Pick when this phone should get them:
          </p>
          <div role="radiogroup" aria-label="When this phone gets notifications" className="mt-2.5 space-y-1.5">
            {OPTIONS.map(o => {
              const on = current === o.mode;
              return (
                <button
                  key={o.mode}
                  role="radio"
                  aria-checked={on}
                  disabled={busy || subscribed === null}
                  onClick={() => void save({ ...settings, mode: o.mode })}
                  className={`press flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${on ? 'border-acc/60 bg-acc/10' : 'border-line bg-surface2 hover:bg-line'}`}
                >
                  <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${on ? 'border-acc bg-acc text-bg' : 'border-mut/50'}`}>
                    {on && <Check size={10} strokeWidth={3.5} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{o.label}</span>
                    <span className="block text-[11px] leading-snug text-mut">{o.sub(settings.awayMin)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {current === 'away' && (
            <label className="mt-2.5 flex items-center justify-between gap-2 text-[12px] text-mut">
              Away after
              <select
                value={settings.awayMin}
                disabled={busy}
                onChange={e => void save({ ...settings, awayMin: Number(e.target.value) })}
                className="rounded-lg border border-line bg-surface2 px-2 py-1 text-[12px] text-txt outline-none"
              >
                {AWAY_CHOICES.map(m => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="mt-3 flex items-center gap-2">
            {subscribed === null || busy ? (
              <Loader2 size={14} className="animate-spin text-mut" />
            ) : subscribed ? (
              <button
                onClick={() => void test()}
                className="press flex items-center gap-1.5 rounded-xl border border-line bg-surface2 px-3 py-1.5 text-xs font-semibold hover:bg-line"
              >
                <Send size={12} /> Send a test
              </button>
            ) : (
              <p className="text-[11.5px] text-mut">Off on this phone. Pick an option to turn them on.</p>
            )}
          </div>
          {note && <p className="mt-2 text-[11.5px] leading-snug text-acc">{note}</p>}
        </>
      )}
    </section>
  );
}
