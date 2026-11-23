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
/** Set by the service worker when a notification click should land on a screen. */
export const OPEN_SCREEN_KEY = 'st-open-screen';

export const baseKey = (uid: string) => `st-base:${uid}`;
export const outboxKey = (uid: string) => `st-outbox:${uid}`;
export const statusKey = (uid: string) => `st-status:${uid}`;
export const noticesSeenKey = (uid: string) => `st-notices-seen:${uid}`;
/** Agent notifications received on this device, newest last, with a read flag. */
export const inboxKey = (uid: string) => `st-inbox:${uid}`;
