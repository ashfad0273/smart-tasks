import { Check } from 'lucide-react';

/** The app mark: a squishy gradient tile with a check. */
export default function Logo({ size = 56, bob = false }: { size?: number; bob?: boolean }) {
  return (
    <span
      className={`grad-acc glow hover-wiggle grid place-items-center text-white ${bob ? 'anim-bob' : ''}`}
      style={{ width: size, height: size, borderRadius: size * 0.32 }}
      aria-hidden="true"
    >
      <Check size={size * 0.52} strokeWidth={3.2} />
    </span>
  );
}
