import { useEffect, useState } from 'react';

/** Desktop app window at least this wide gets the sidebar layout. */
export const WIDE_MIN = 720;

const isWide = () =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('desktop') && window.innerWidth >= WIDE_MIN;

/** True in the desktop app when the window is wide enough for the sidebar + panels layout.
 *  The browser extension popup (400px) never is. */
export function useWide(): boolean {
  const [wide, setWide] = useState(isWide);
  useEffect(() => {
    const on = () => setWide(isWide());
    window.addEventListener('resize', on);
    // The desktop class is added once at startup; catch it if it lands after first render.
    const mo = new MutationObserver(on);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      window.removeEventListener('resize', on);
      mo.disconnect();
    };
  }, []);
  return wide;
}
