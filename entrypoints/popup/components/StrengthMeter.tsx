import { passwordScore, strengthLabel } from '../../../lib/utils';

export default function StrengthMeter({ pw }: { pw: string }) {
  const s = passwordScore(pw);
  const score = [s.length, s.upper, s.number, s.symbol].filter(Boolean).length;
  const colors = ['#ef4444', '#f97316', '#f59e0b', '#3fd1c5', '#3fd1c5'];
  const color = pw ? colors[score] : '#212b3a';
  const filled = pw ? Math.max(score, 1) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            className="h-1.5 flex-1 rounded-full transition-colors"
            style={{ background: i < filled ? color : '#212b3a' }}
          />
        ))}
      </div>
      <span className="w-12 text-right text-xs font-medium" style={{ color: pw ? color : '#8b97a8' }}>
        {pw ? strengthLabel(score) : '—'}
      </span>
    </div>
  );
}
