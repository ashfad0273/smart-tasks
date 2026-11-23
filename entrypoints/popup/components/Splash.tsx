/**
 * Shown until the app has booted. Same markup (and CSS, inlined in
 * index.html) as the HTML preloader, so React taking over is seamless.
 */
export default function Splash() {
  return (
    <div className="st-pl" role="status" aria-label="Loading Smart Tasks">
      <span className="st-pl-mark" aria-hidden="true">
        <svg viewBox="16 16 480 480">
          <defs>
            <linearGradient id="stplbg-r" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#6ff0dc" />
              <stop offset=".5" stopColor="#3fd1c5" />
              <stop offset="1" stopColor="#2794bd" />
            </linearGradient>
          </defs>
          <rect x="16" y="16" width="480" height="480" rx="124" fill="url(#stplbg-r)" />
          <rect x="100" y="120" width="140" height="36" rx="18" fill="#0b1a1c" opacity=".22" />
          <rect x="100" y="190" width="88" height="36" rx="18" fill="#0b1a1c" opacity=".22" />
          <path d="M164 318 L234 386 L404 214" fill="none" stroke="#0b1a1c" strokeWidth="62" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M392 64 C396 92 404 100 432 104 C404 108 396 116 392 144 C388 116 380 108 352 104 C380 100 388 92 392 64 Z" fill="#fff" />
        </svg>
      </span>
      <span>Smart Tasks</span>
      <span className="st-pl-bar" />
    </div>
  );
}
