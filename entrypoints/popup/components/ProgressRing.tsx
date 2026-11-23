/** Today's progress: completed today vs (completed today + still due today). */
export default function ProgressRing({ done, total, size = 46 }: { done: number; total: number; size?: number }) {
  const pct = total === 0 ? 0 : Math.min(1, done / total);
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const full = total > 0 && pct === 1;
  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={total ? `${done} of ${total} done today` : 'Nothing due today'}
      title={total ? `${done} of ${total} done today` : 'Nothing due today'}
    >
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#2dd4bf" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={5} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ring)"
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.2,.9,.3,1.2)' }}
        />
      </svg>
      <span className={`absolute text-[11px] font-extrabold ${full ? 'anim-pop text-base' : ''}`}>
        {full ? '🏆' : total ? `${Math.round(pct * 100)}%` : '☕'}
      </span>
    </div>
  );
}
