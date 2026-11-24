/**
 * Offscreen page: MV3 service workers can't play audio, so the background
 * opens this hidden page to play the agent notification chime.
 * The chime is synthesised (no audio file): a bright two-note "pling"
 * that sounds different from the system's reminder sound.
 */

let ctx: AudioContext | null = null;

function note(ac: AudioContext, freq: number, start: number, length: number, gain: number) {
  const out = ac.createGain();
  out.gain.setValueAtTime(0.0001, start);
  out.gain.exponentialRampToValueAtTime(gain, start + 0.008);
  out.gain.exponentialRampToValueAtTime(0.0001, start + length);
  out.connect(ac.destination);
  // Fundamental plus a soft octave shimmer for a glassy, bell-like tone.
  for (const [mult, type, level] of [
    [1, 'sine', 1],
    [2, 'triangle', 0.18],
    [3.01, 'sine', 0.06],
  ] as const) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq * mult, start);
    g.gain.value = level;
    osc.connect(g).connect(out);
    osc.start(start);
    osc.stop(start + length + 0.05);
  }
}

async function chime() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  const t = ctx.currentTime + 0.02;
  note(ctx, 1318.5, t, 0.55, 0.22); // E6
  note(ctx, 1975.5, t + 0.11, 0.8, 0.18); // B6
}

/** Offscreen pages can't use navigator.clipboard (no focus); a selected textarea + copy works. */
function copy(text: string) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg?.type === 'st-offscreen-chime') void chime();
  // The desktop app copies through its host instead (desktop/web/host.ts).
  if (msg?.type === 'st-offscreen-copy' && typeof msg.text === 'string' && !(globalThis as Record<string, unknown>).__ST_DESKTOP__) copy(msg.text);
});
if (location.hash.startsWith('#copy=')) copy(decodeURIComponent(location.hash.slice(6)));

// Opened specifically to play: do it now (the background's message may arrive before the listener).
if (location.hash === '#chime') void chime();
