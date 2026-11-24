import { defineBackground } from 'wxt/utils/define-background';
import { signInWithGoogle } from '../lib/auth';
import { storageGet, storageSet } from '../lib/ext';
import { api, SITE_URL, type InboxItem } from '../lib/api';
import { AGENT_NOTIFY_KEY, AGENT_SOUND_KEY, inboxKey, NOTICE_LINKS_KEY, OPEN_SCREEN_KEY, UPDATE_KEY, UPDATE_NOTIFIED_KEY, UPDATED_KEY, noticesSeenKey, REGISTRY_KEY, REMINDERS_ENABLED_KEY, REMINDERS_KEY, REMINDERS_SENT_KEY, baseKey, outboxKey } from '../lib/keys';
import { GRACE_MS, writeReminders, type Reminder } from '../lib/reminders';
import { activeAccount, activeTasks, loadRegistry, mutate, newId, readView, sync } from '../lib/store';
import { isSameDay } from '../lib/utils';
import { desktopHandles } from '../lib/desktop';
import { currentVersion, download, fetchLatest, hasAccess, install, isOurFolder, isUnpacked, loadFolder, newer, type UpdateInfo } from '../lib/updater';

/**
 * Service worker:
 *  - periodic background sync (every minute) so data is fresh when the popup
 *    opens and reminders know about tasks added on other devices
 *  - reminder alarms + actionable notifications (Done / Snooze)
 *  - toolbar badge with today's open + overdue count
 *  - right-click capture of selections / pages
 *  - notifications sent by the user's AI agent (MCP "notify" tool)
 *  - self-update for downloaded (unpacked) installs, see lib/updater.ts
 */

const SYNC_ALARM = 'st-sync';
const REMINDER_ALARM = 'st-reminder-due';
const SNOOZE_MS = 10 * 60_000;
const UPDATE_ALARM = 'st-update-check';
const UPDATE_PAGE = () => chrome.runtime.getURL('update.html');

export default defineBackground(() => {
  /* ── context menus ────────────────────────────────────────────────── */

  function setupMenus() {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: 'st-add-selection', title: 'Add task: “%s”', contexts: ['selection'] });
      chrome.contextMenus.create({ id: 'st-add-page', title: 'Save this page as a task', contexts: ['page'] });
      chrome.contextMenus.create({ id: 'st-add-link', title: 'Save this link as a task', contexts: ['link'] });
    });
  }

  /* ── badge + reminder snapshot ────────────────────────────────────── */

  async function unreadNotices(): Promise<number> {
    const reg = await loadRegistry();
    let n = 0;
    for (const a of reg.accounts) {
      if (a.local) continue;
      n += (await storageGet<InboxItem[]>(inboxKey(a.uid), [])).filter(i => !i.read).length;
    }
    return n;
  }

  async function refreshDerived(): Promise<void> {
    const acc = await activeAccount();
    const tasks = acc ? activeTasks(await readView(acc.uid)) : [];
    await writeReminders(tasks);
    const now = Date.now();
    const due = tasks.filter(t => !t.completedAt && t.dueAt != null && (t.dueAt < now || isSameDay(t.dueAt, now))).length;
    const overdue = tasks.some(t => !t.completedAt && t.dueAt != null && t.dueAt < now);
    const unread = await unreadNotices();
    // Unread agent notifications win the badge (purple); otherwise today's due count.
    const count = unread > 0 ? unread : due;
    await chrome.action.setBadgeText({ text: count > 0 ? String(Math.min(count, 99)) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: unread > 0 ? '#9d7bfa' : overdue ? '#ef4444' : '#22c55e' });
    await chrome.action.setTitle({
      title: unread > 0 ? `Smart Tasks: ${unread} unread notification${unread === 1 ? '' : 's'}` : 'Smart Tasks',
    });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  }

  /* ── reminders ────────────────────────────────────────────────────── */

  async function scheduleNextReminder(): Promise<void> {
    await chrome.alarms.clear(REMINDER_ALARM);
    if (!(await storageGet<boolean>(REMINDERS_ENABLED_KEY, true))) return;
    const list = await storageGet<Reminder[]>(REMINDERS_KEY, []);
    const now = Date.now();
    const next = list.find(r => r.dueAt > now);
    if (next) await chrome.alarms.create(REMINDER_ALARM, { when: Math.max(next.dueAt, now + 30_000) });
  }

  async function checkReminders(): Promise<void> {
    if (await storageGet<boolean>(REMINDERS_ENABLED_KEY, true)) {
      const list = await storageGet<Reminder[]>(REMINDERS_KEY, []);
      const sent = await storageGet<Record<string, number>>(REMINDERS_SENT_KEY, {});
      const now = Date.now();
      let dirty = false;
      // The Windows app on this computer shows reminders itself: stay quiet (but
      // still mark them sent, so nothing fires late if the app quits).
      let deferred: boolean | null = null;
      const toDesktop = async () => {
        if (deferred === null) {
          const acc = await activeAccount();
          deferred = !!acc && !acc.local && (await desktopHandles(acc.uid, 'reminders'));
        }
        return deferred;
      };
      for (const r of list) {
        if (r.dueAt <= now && r.dueAt > now - GRACE_MS && sent[r.id] !== r.dueAt) {
          sent[r.id] = r.dueAt;
          dirty = true;
          if (await toDesktop()) continue;
          chrome.notifications.create(`st-reminder:${r.id}`, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icon/128.png'),
            title: 'Task due',
            message: r.title,
            buttons: [{ title: 'Mark done' }, { title: 'Snooze 10 min' }],
            priority: 2,
            requireInteraction: true,
          });
        }
      }
      const horizon = now - 24 * 3600_000;
      const pruned = Object.fromEntries(Object.entries(sent).filter(([, t]) => t > horizon));
      if (dirty || Object.keys(pruned).length !== Object.keys(sent).length) await storageSet(REMINDERS_SENT_KEY, pruned);
    }
    await scheduleNextReminder();
  }

  /* ── agent notifications ──────────────────────────────────────────── */

  async function playChime(): Promise<void> {
    if (!(await storageGet<boolean>(AGENT_SOUND_KEY, true)) || !chrome.offscreen) return;
    try {
      const open = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
      if (open.length) {
        await chrome.runtime.sendMessage({ type: 'st-offscreen-chime' });
      } else {
        await chrome.offscreen.createDocument({
          url: 'offscreen.html#chime',
          reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
          justification: 'Play a short sound when your AI agent sends a notification.',
        });
      }
    } catch {
      /* a sound is nice to have; the notification still shows */
    }
  }

  // One check at a time, so a WS nudge and the minute alarm can't show a notice twice.
  let noticeCheck: Promise<void> | null = null;
  function checkNotices(): Promise<void> {
    noticeCheck ??= (async () => {
      try {
        const reg = await loadRegistry();
        const allowed = await storageGet<boolean>(AGENT_NOTIFY_KEY, true);
        for (const a of reg.accounts) {
          if (a.local || !a.token) continue;
          const seen = await storageGet<number | null>(noticesSeenKey(a.uid), null);
          let r;
          try {
            r = await api.notices(a.token, seen ?? 0);
          } catch {
            continue; // offline or signed out: try again next time
          }
          // First check on this device: only show what was sent in the last few minutes.
          const fresh = seen == null ? r.notices.filter(n => n.createdAt > Date.now() - 10 * 60_000) : r.notices;
          if (fresh.length) {
            const inbox = await storageGet<InboxItem[]>(inboxKey(a.uid), []);
            const have = new Set(inbox.map(i => i.id));
            const add = fresh.filter(n => !have.has(n.id));
            // The Windows app on this computer shows them instead: keep them as read here.
            const show = allowed && add.length > 0 && !(await desktopHandles(a.uid, 'agent'));
            await storageSet(inboxKey(a.uid), [...inbox, ...add.map(n => ({ ...n, read: !show }))].slice(-100));
            if (show) {
              const links = await storageGet<Record<string, string>>(NOTICE_LINKS_KEY, {});
              for (const n of add) {
                const id = `st-agent:${a.uid}:${n.id}`;
                chrome.notifications.create(id, {
                  type: 'basic',
                  iconUrl: chrome.runtime.getURL('icon/128.png'),
                  title: n.title,
                  message: n.message,
                  contextMessage: `From ${n.from || 'your AI agent'}${reg.accounts.filter(x => !x.local).length > 1 ? ` · ${a.email}` : ''}`,
                  priority: 2,
                  silent: true, // our own chime plays instead of the system sound
                });
                if (n.url) links[id] = n.url;
              }
              await storageSet(NOTICE_LINKS_KEY, Object.fromEntries(Object.entries(links).slice(-50)));
              await playChime();
            }
          }
          const last = Math.max(seen ?? 0, r.latest, ...r.notices.map(n => n.id));
          if (last !== seen) await storageSet(noticesSeenKey(a.uid), last);
        }
      } finally {
        noticeCheck = null;
      }
    })();
    return noticeCheck;
  }

  /* ── self-update ──────────────────────────────────────────────────── */

  let updateCheck: Promise<void> | null = null;
  function checkUpdate(): Promise<void> {
    updateCheck ??= (async () => {
      try {
        if (!(await isUnpacked())) return;
        const info = await fetchLatest();
        if (!newer(info.version, currentVersion())) {
          await storageSet(UPDATE_KEY, null);
          return;
        }
        await storageSet(UPDATE_KEY, info);
        if (await installQuietly(info)) return;
        // Can't install on our own: tell the user once per version.
        if ((await storageGet<string | null>(UPDATE_NOTIFIED_KEY, null)) !== info.version) {
          await storageSet(UPDATE_NOTIFIED_KEY, info.version);
          chrome.notifications.create('st-update', {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icon/128.png'),
            title: `Smart Tasks ${info.version} is ready`,
            message: info.notes[0] ?? 'A new version is available.',
            buttons: [{ title: 'Update now' }],
            priority: 1,
          });
        }
      } catch {
        /* offline or the site is down: try again next time */
      } finally {
        updateCheck = null;
      }
    })();
    return updateCheck;
  }

  /** Install without asking when the user already allowed folder access for good. */
  async function installQuietly(info: UpdateInfo): Promise<boolean> {
    try {
      const dir = await loadFolder();
      if (!dir || !(await hasAccess(dir)) || !(await isOurFolder(dir))) return false;
      // Don't yank the popup out from under someone; the popup offers the update instead.
      const popups = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.POPUP] });
      if (popups.length) return true;
      const files = await download(info);
      await install(dir, files);
      await storageSet(UPDATED_KEY, { from: currentVersion(), to: info.version });
      chrome.runtime.reload();
      return true;
    } catch {
      return false;
    }
  }

  async function announceUpdate(): Promise<void> {
    const done = await storageGet<{ from: string; to: string } | null>(UPDATED_KEY, null);
    if (!done) return;
    await storageSet(UPDATED_KEY, null);
    await storageSet(UPDATE_KEY, null);
    if (done.to !== currentVersion()) return;
    chrome.notifications.create('st-updated', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon/128.png'),
      title: `Smart Tasks updated to ${done.to}`,
      message: 'Click to see what changed.',
      priority: 0,
    });
  }

  /* ── background sync ──────────────────────────────────────────────── */

  async function syncAll(): Promise<void> {
    const reg = await loadRegistry();
    for (const a of reg.accounts) {
      if (a.local || !a.token) continue;
      // Active account: full sync. Others: only flush queued edits.
      const queued = (await storageGet<unknown[]>(outboxKey(a.uid), [])).length > 0;
      if (a.uid === reg.activeId || queued) await sync(a);
    }
    await checkNotices();
  }

  /* ── quick capture ────────────────────────────────────────────────── */

  async function addTask(title: string, url: string | null = null): Promise<{ ok: boolean; error?: string }> {
    const acc = await activeAccount();
    if (!acc) {
      chrome.notifications.create('st-setup', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon/128.png'),
        title: 'Smart Tasks',
        message: 'Open Smart Tasks and sign in (or start locally) to save tasks from pages.',
      });
      return { ok: false, error: 'no-account' };
    }
    const now = Date.now();
    await mutate(acc, [
      {
        kind: 'task',
        id: newId(),
        op: 'upsert',
        data: { title: title.slice(0, 500), url, order: now, createdAt: now, updatedAt: now },
      },
    ]);
    chrome.notifications.create(`st-saved:${now}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon/128.png'),
      title: 'Saved to Smart Tasks',
      message: title.slice(0, 120),
    });
    setTimeout(() => chrome.notifications.clear(`st-saved:${now}`), 4000);
    return { ok: true };
  }

  async function updateTaskFromNotification(taskId: string, patch: Record<string, unknown>) {
    const acc = await activeAccount();
    if (!acc) return;
    await mutate(acc, [{ kind: 'task', id: taskId, op: 'upsert', data: { ...patch, updatedAt: Date.now() } }]);
  }

  /* ── events ───────────────────────────────────────────────────────── */

  const boot = () => {
    setupMenus();
    void chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 1 });
    void chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: 1, periodInMinutes: 30 });
    void announceUpdate().then(checkUpdate);
    void syncAll();
    void refreshDerived().then(checkReminders);
  };
  chrome.runtime.onInstalled.addListener(boot);
  chrome.runtime.onStartup.addListener(boot);

  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === SYNC_ALARM) void syncAll().then(refreshDerived);
    else if (alarm.name === REMINDER_ALARM) void checkReminders();
    else if (alarm.name === UPDATE_ALARM) void checkUpdate();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const keys = Object.keys(changes);
    if (keys.some(k => k === REGISTRY_KEY || k.startsWith(baseKey('')) || k.startsWith(outboxKey('')) || k.startsWith(inboxKey('')))) {
      void refreshDerived();
    }
    if (REMINDERS_KEY in changes || REMINDERS_ENABLED_KEY in changes) void checkReminders();
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'st-add-selection') {
      const text = (info.selectionText ?? '').trim();
      if (text) void addTask(text.slice(0, 300), info.pageUrl ?? tab?.url ?? null);
    } else if (info.menuItemId === 'st-add-page') {
      void addTask((tab?.title || 'Saved page').trim(), tab?.url ?? info.pageUrl ?? null);
    } else if (info.menuItemId === 'st-add-link' && info.linkUrl) {
      const label = (info.selectionText || info.linkUrl).trim();
      void addTask(`Read: ${label}`.slice(0, 300), info.linkUrl);
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'st-google-signin' && typeof msg.clientId === 'string') {
      signInWithGoogle(msg.clientId)
        .then(r => {
          sendResponse({ ok: true, importedLocal: r.importedLocal });
          void syncAll();
        })
        .catch((e: unknown) => {
          const error = e instanceof Error ? e.message : String(e);
          sendResponse({ ok: false, error });
          // The popup may have closed while Google's window was open: tell the user.
          if (!/cancelled/i.test(error)) {
            chrome.notifications.create(`st-auth:${Date.now()}`, {
              type: 'basic',
              iconUrl: chrome.runtime.getURL('icon/128.png'),
              title: 'Google sign-in failed',
              message: error.slice(0, 200),
            });
          }
        });
      return true;
    }
    if (msg?.type === 'st-check-update') {
      void checkUpdate();
      return false;
    }
    if (msg?.type === 'st-check-notices') {
      void checkNotices();
      return false;
    }
    if (msg?.type === 'st-add-task' && typeof msg.title === 'string' && msg.title.trim()) {
      void addTask(msg.title.trim(), typeof msg.url === 'string' ? msg.url : null).then(sendResponse);
      return true;
    }
    return false;
  });

  chrome.notifications.onButtonClicked.addListener((id, button) => {
    if (id === 'st-update') {
      void chrome.notifications.clear(id);
      void chrome.tabs.create({ url: `${UPDATE_PAGE()}?go=1` });
      return;
    }
    if (!id.startsWith('st-reminder:')) return;
    const taskId = id.slice('st-reminder:'.length);
    void chrome.notifications.clear(id);
    if (button === 0) void updateTaskFromNotification(taskId, { completedAt: Date.now() });
    else void updateTaskFromNotification(taskId, { dueAt: Date.now() + SNOOZE_MS });
  });

  chrome.notifications.onClicked.addListener(id => {
    void chrome.notifications.clear(id);
    if (id === 'st-update') {
      void chrome.tabs.create({ url: UPDATE_PAGE() });
      return;
    }
    if (id === 'st-updated') {
      void chrome.tabs.create({ url: `${SITE_URL}/#changelog` });
      return;
    }
    void (async () => {
      if (id.startsWith('st-agent:')) {
        const [, uid, nid] = id.split(':');
        const inbox = await storageGet<InboxItem[]>(inboxKey(uid), []);
        if (inbox.some(i => i.id === Number(nid) && !i.read)) {
          await storageSet(inboxKey(uid), inbox.map(i => (i.id === Number(nid) ? { ...i, read: true } : i)));
        }
        const links = await storageGet<Record<string, string>>(NOTICE_LINKS_KEY, {});
        if (links[id]) {
          await chrome.tabs.create({ url: links[id] });
          return;
        }
        await storageSet(OPEN_SCREEN_KEY, 'notifications');
      }
      try {
        await chrome.action.openPopup();
      } catch {
        await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
      }
    })();
  });

  // Every service-worker wake.
  void refreshDerived().then(checkReminders);
});
