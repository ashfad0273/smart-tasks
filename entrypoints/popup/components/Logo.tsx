import { useId } from 'react';

/** The app mark: teal tile, to-do lines, a bold check and a small spark. Same artwork as the extension icon. */
export default function Logo({ size = 56, bob = false }: { size?: number; bob?: boolean }) {
  const id = useId().replace(/:/g, '');
  return (
    <span
      className={`hover-wiggle inline-grid shrink-0 place-items-center ${bob ? 'anim-bob' : ''}`}
      style={{ width: size, height: size, filter: 'drop-shadow(0 8px 18px rgba(63,209,197,.35))' }}
      aria-hidden="true"
    >
      <svg viewBox="16 16 480 480" width={size} height={size}>
        <defs>
          <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6ff0dc" />
            <stop offset="0.5" stopColor="#3fd1c5" />
            <stop offset="1" stopColor="#2794bd" />
          </linearGradient>
          <linearGradient id={`${id}sh`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
            <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x="16" y="16" width="480" height="480" rx="124" fill={`url(#${id}bg)`} />
        <rect x="16" y="16" width="480" height="480" rx="124" fill={`url(#${id}sh)`} />
        <rect x="100" y="120" width="140" height="36" rx="18" fill="#0b1a1c" opacity="0.22" />
        <rect x="100" y="190" width="88" height="36" rx="18" fill="#0b1a1c" opacity="0.22" />
        <path d="M164 318 L234 386 L404 214" fill="none" stroke="#0b1a1c" strokeWidth="62" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M392 64 C396 92 404 100 432 104 C404 108 396 116 392 144 C388 116 380 108 352 104 C380 100 388 92 392 64 Z" fill="#fff" />
        <circle cx="446" cy="160" r="11" fill="#fff" opacity="0.85" />
      </svg>
    </span>
  );
}
