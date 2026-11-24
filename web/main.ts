// Phone (installable web app) entry. Order matters: the chrome.* shim must
// exist before any shared module loads (lib/ext.ts checks for it once).
import { onStartup } from './shim';
import background from '../entrypoints/background';
import '../entrypoints/offscreen/main';
import '../entrypoints/popup/main';
import './webapp.css';

document.documentElement.classList.add('webapp');
// Offline start-up, and the push notifications (sw.js lives next to index.html).
if ('serviceWorker' in navigator) void navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});

background.main();
onStartup.emit();
