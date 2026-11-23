// Windows app entry. Order matters: the chrome.* shim must exist before any
// shared module loads (lib/ext.ts checks for it once).
import { onStartup } from './shim';
import background from '../../entrypoints/background';
import '../../entrypoints/offscreen/main';
import { startHost } from './host';
import '../../entrypoints/popup/main';
import './desktop.css';

startHost();
background.main();
// The extension's boot sequence (alarms, first sync, reminders, update notice).
onStartup.emit();
