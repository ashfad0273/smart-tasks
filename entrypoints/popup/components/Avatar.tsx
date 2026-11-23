import { HardDrive } from 'lucide-react';
import { hueFromString, initialsOf } from '../../../lib/utils';

export default function Avatar({
  name,
  email,
  photoURL,
  hue,
  size = 36,
  local = false,
}: {
  name: string;
  email: string;
  photoURL?: string | null;
  hue?: number;
  size?: number;
  local?: boolean;
}) {
  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt=""
        referrerPolicy="no-referrer"
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  if (local) {
    return (
      <span
        className="grid shrink-0 place-items-center rounded-full bg-pop/20 text-pop"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <HardDrive size={size * 0.46} />
      </span>
    );
  }
  const h = hue ?? hueFromString(email || name || 'user');
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, size * 0.38),
        background: `linear-gradient(135deg, hsl(${h} 70% 50%), hsl(${(h + 50) % 360} 70% 36%))`,
      }}
      aria-hidden="true"
    >
      {initialsOf(name, email)}
    </span>
  );
}
