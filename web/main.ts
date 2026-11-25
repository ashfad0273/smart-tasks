// Phone (installable web app) entry. Order matters: the chrome.* shim must
// exist before any shared module loads (lib/ext.ts checks for it once).
import { onStartup } from './shim';
import { OPEN_TASK_KEY } from '../lib/keys';
import background from '../entrypoints/background';
import '../entrypoints/offscreen/main';
import '../entrypoints/popup/main';
import './webapp.css';

document.documentElement.classList.add('webapp');
// Offline start-up, and the push notifications (sw.js lives next to index.html).
if ('serviceWorker' in navigator) void navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});

// Opened from a tapped notification about a task (./?task=<id>).
const openTask = new URLSearchParams(location.search).get('task');
if (openTask) {
  void chrome.storage.local.set({ [OPEN_TASK_KEY]: openTask });
  history.replaceState(null, '', location.pathname);
}

background.main();
onStartup.emit();
