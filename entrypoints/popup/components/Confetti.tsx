import { useEffect, useState } from 'react';

const COLORS = ['#3fd1c5', '#9d7bfa', '#a78bfa', '#facc15', '#f472b6', '#60a5fa', '#fb923c'];

/** Full-screen confetti rain. Re-fires whenever `fire` changes (and is > 0). */
export default function Confetti({ fire }: { fire: number }) {
  const [shot, setShot] = useState(0);
  useEffect(() => {
    if (!fire) return;
    setShot(fire);
    const t = setTimeout(() => setShot(0), 2200);
    return () => clearTimeout(t);
  }, [fire]);
  if (!shot) return null;
  return (
    <div key={shot} className="pointer-events-none fixed inset-0 z-[90] overflow-hidden" aria-hidden="true">
      {Array.from({ length: 60 }, (_, i) => (
        <span
          key={i}
          className="absolute top-0 block"
          style={
            {
              left: `${(i * 37) % 100}%`,
              width: i % 3 ? 7 : 5,
              height: i % 3 ? 11 : 5,
              borderRadius: i % 4 === 0 ? 9999 : 2,
              background: COLORS[i % COLORS.length],
              '--dx': `${((i * 53) % 120) - 60}px`,
              '--rot': `${(i * 97) % 720}deg`,
              animation: `fall ${1.3 + ((i * 7) % 10) / 10}s cubic-bezier(.25,.6,.4,1) ${((i * 13) % 30) / 100}s forwards`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
