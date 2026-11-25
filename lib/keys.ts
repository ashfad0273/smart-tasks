/** Shared chrome.storage.local keys — used by the popup and the service
 *  worker so they stay in sync. */
export const REGISTRY_KEY = 'st-registry';
export const REMINDERS_KEY = 'st-reminders';
export const REMINDERS_ENABLED_KEY = 'st-reminders-enabled';
export const REMINDERS_SENT_KEY = 'st-reminders-sent';
export const ONBOARDED_KEY = 'st-onboarded';
export const AGENT_NOTIFY_KEY = 'st-agent-notify';
export const NOTICE_LINKS_KEY = 'st-notice-links';
export const AGENT_SOUND_KEY = 'st-agent-sound';
/** Last AI app picked on the AI agent screen (an id from lib/agents.ts). */
export const AGENT_CLIENT_KEY = 'st-agent-client';
/** Set by the service worker when a notification click should land on a screen. */
export const OPEN_SCREEN_KEY = 'st-open-screen';
/** A task to open next time the app shows (set when a notification about it is clicked). */
export const OPEN_TASK_KEY = 'st-open-task';
/** Newer release found by the updater: UpdateInfo or null. */
export const UPDATE_KEY = 'st-update';
/** Set just before the updater reloads the extension: {from, to}. */
export const UPDATED_KEY = 'st-updated';
/** Version we last sent an "update ready" notification for. */
export const UPDATE_NOTIFIED_KEY = 'st-update-notified';

export const baseKey = (uid: string) => `st-base:${uid}`;
export const outboxKey = (uid: string) => `st-outbox:${uid}`;
export const statusKey = (uid: string) => `st-status:${uid}`;
export const noticesSeenKey = (uid: string) => `st-notices-seen:${uid}`;
/** Agent notifications received on this device, newest last, with a read flag. */
export const inboxKey = (uid: string) => `st-inbox:${uid}`;
/** The first-run tour: `{ step }` while it is in progress (it resumes there), null once finished. */
export const TOUR_KEY = 'st-tour';
/** Dashboard sort order (SortBy in the popup), remembered across opens. */
export const SORT_KEY = 'st-sort';

/* ── clipboard sync (desktop app) ─────────────────────────────────────── */
/** On/off for this computer (default off). */
export const CLIP_SYNC_KEY = 'st-clip-sync';
/** What the sync is doing, for Settings: see ClipStatus in desktop/web/clip.ts. */
export const CLIP_STATUS_KEY = 'st-clip-status';
/** Settings writes a timestamp here to start over with a new key. */
export const CLIP_RESET_KEY = 'st-clip-reset';
/** This computer's id and key pair (the private half never leaves it). */
export const CLIP_DEVICE_KEY = 'st-clip-device';
/** The shared clipboard key for one account. */
export const clipKeyKey = (uid: string) => `st-clip-key:${uid}`;

export interface ClipStatus {
  state: 'off' | 'connecting' | 'waiting' | 'on' | 'error' | 'signed-out';
  /** Last thing synced: sent from here or received. */
  last?: { kind: 'text' | 'image'; dir: 'out' | 'in'; at: number } | null;
  error?: string | null;
}
