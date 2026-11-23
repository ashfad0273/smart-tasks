const COLORS = ['#3fd1c5', '#9d7bfa', '#a78bfa', '#facc15', '#f472b6', '#60a5fa'];

/** A tiny particle burst, rendered around its (relative) parent. */
export default function Burst({ count = 10 }: { count?: number }) {
  return (
    <span className="pointer-events-none absolute left-1/2 top-1/2" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2;
        const dist = 18 + (i % 3) * 7;
        return (
          <span
            key={i}
            className="absolute h-1.5 w-1.5 rounded-full"
            style={
              {
                background: COLORS[i % COLORS.length],
                '--dx': `${Math.cos(angle) * dist}px`,
                '--dy': `${Math.sin(angle) * dist}px`,
                '--rot': `${i * 40}deg`,
                animation: 'burst .6s cubic-bezier(.2,.8,.3,1) forwards',
              } as React.CSSProperties
            }
          />
        );
      })}
    </span>
  );
}
