# Changelog

All notable changes to Smart Tasks. The newest release is at the top.

## 1.8.7 - 2026-11-26

### Changed
- **Approved steps reach an agent faster.** When you press OK on a step of a task that no agent session owns (for example a task you made yourself, or one an agent made without saying which session it is), any suitable agent can pick it up right away instead of after 10 minutes.
- **A clearer "Teach your AI" prompt.** AI agents, Copy prompt now explains the rules in five short sections, including which agent gets your answers and how an agent can take over a task.
- For agents: update_task can set a task's `session` and `scope`, so a task made without them can be taken over instead of recreated.

## 1.8.6 - 2026-11-25

### Added
- **Delete with the keyboard.** Select tasks (Ctrl/Cmd-click, or Shift-click for a range) and press Delete or Backspace. You're asked before anything is deleted.
- **Select categories like tasks.** In the sidebar and on the Categories screen, Ctrl/Cmd-click or Shift-click categories to select several, then archive or delete them together (or press Delete). Their tasks become uncategorized, not deleted. Esc clears the selection.
- **Notifications open their task.** Clicking a reminder, or an AI agent message about a task, opens that task, on the computer and on the phone. The Notifications screen has an **Open task** button too. Agents can now attach a task to a message.

### Changed
- **Easier subtasks.** Click a long subtask to read all of it (click again to fold it). Hover to see a pencil for editing, or double-click; the editor grows to show the whole text. The progress ring next to "N of M done" is gone.

### Fixed
- **Updating the desktop app shows what's happening.** "Check now" says Checking…, then "You're up to date" (or why it couldn't check), and the Update button shows the download progress and Installing… until the app restarts. Before, nothing seemed to happen. You'll see this from the next update on.

## 1.8.5 - 2026-11-25

### Added
- **Clipboard sync for the Mac and Windows apps.** Copy text or an image on one computer and paste it on another. Turn it on in Settings, Sync and devices, on each computer (it is off by default). Everything is end-to-end encrypted: the key is made on your computer and handed to your other computers automatically, so the server only relays data it cannot read and deletes it after 10 minutes. Clearing or replacing the clipboard on one computer never clears the others.

## 1.8.4 - 2026-11-25

### Added
- **Smart Tasks on your phone.** Open the download page on your phone and tap **Open the phone app**, then install it from the browser menu ("Install app" or "Add to Home screen"). It is the same app with the same account, full screen and working offline.
- **Phone notifications from your AI agents.** In the phone app's Settings, pick when the phone should get agent messages and "No agent picked up" alerts: when you're away from your computer (no desktop app open, or no keyboard or mouse use for a few minutes you choose), only when no desktop app is open, always, or never. They arrive even when the phone app is closed. Settings → Phone notifications also has a **Send a test** button.
- The desktop app now tells your phone whether it's open and in use, so the phone can stay quiet while you're at your computer.

### Notes
- Due-date reminders on the phone fire only while the phone app is open.

## 1.8.3 - 2026-11-25

### Added
- **Answers reach Claude Code within a minute.** A small watcher (`smart-tasks-watch.mjs`, downloadable from the site) runs in the background of a Claude Code session, checks for your OKs every minute without using any AI, and wakes the session as soon as you approve something. The "Copy prompt" text on the AI agents page explains how to install and use it, and the server now suggests it to agents instead of a 5-minute scheduled check.

## 1.8.2 - 2026-11-25

### Changed
- **Tidier AI agents page.** In the desktop app it is one centred column (keys, connecting your AI, permissions, notifications, recent activity) instead of two uneven columns, and every card has the same kind of header.

### Fixed
- Times in Recent agent activity no longer wrap onto two lines.

## 1.8.1 - 2026-11-24

### Changed
- **The desktop app looks right at every window size.** The sidebar layout now starts at 720px wide, the sidebar narrows on small windows, and on very wide screens your list stays a comfortable centred column.
- **Smoother task panel.** On smaller windows it slides over the list instead of squeezing it; on wide ones it grows open beside the list. Closing slides it shut.
- **Tidier Settings.** One centred column with section titles above each card, and a section menu that stays in view while you scroll.
- The new-task box opens right where the "Add a task" row is.
- A task's Activity is folded away until you open it.
- **Clearer device list.** Devices show as "Smart Tasks app on Windows" or "Extension in Comet on macOS", with an icon for each, instead of guessing from the browser engine (the app used to show as Edge).
- For agents: after asking for your OK, an agent is told to schedule a check, so answers you give in the app get picked up.

### Fixed
- Confirm and New category dialogs are compact cards instead of stretching across the window.
- Pressing Escape in a dialog closes just the dialog, not the page behind it.

## 1.8.0 - 2026-11-24

### Added
- **Clearer "OK, send to AI".** The button now appears only on steps an agent marked as something it can do, and says what will happen ("OK: delete 9 items and repackage"; the full text on hover or with the arrow). It sits on subtasks; a task shows it only when it has no subtasks. Tasks an agent made without asking you for anything no longer show it.
- **Choices and confirmations.** For decisions you get one button per choice. Irreversible actions (delete, upload, replace, send) ask once more before they go. You can always write your own answer instead.
- **Progress on every step.** Sent to AI · waiting (with Cancel until an agent picks it up), Working · who · when, and Done with the agent's note. The step is ticked, and the task completes when every step is done (adding a new step reopens it). If the agent hands a step back, you see its reason and can answer it.
- **Nobody picked it up?** If no agent claims a request within 5 minutes you get a notification with a Copy prompt button to paste into any agent.
- **Teach your AI in one click.** AI agents, Connect your AI has a Copy prompt button with everything an agent needs to know about Smart Tasks and the OK flow.
- **Drag to select.** Drag a box over tasks from empty space in the list to select them, like in a file manager. Shift, Cmd or Ctrl adds to the selection.
- The desktop app checks for updates when you come back to it and every 30 minutes.

### Changed
- For agents: add_task and update_subtasks take an `approval` (action, choices, confirm) and a `scope`. Requests go to the session that made the task first, and after 10 minutes only to agents in the same scope. Pressing OK twice never makes two requests, and a second agent trying to claim one is told who has it.
- The subtasks list in the task editor is a tidier card with a progress ring.
- The task editor's Delete, Archive and Duplicate buttons are one matching group next to Done.

### Fixed
- In the desktop app, the list header no longer runs under the task panel on narrower windows.
- The account menu opens next to your profile in the sidebar.

## 1.7.0 - 2026-11-24

### Added
- **A bigger desktop app.** On Mac and Windows, a wide window gets a sidebar with search, All tasks, Today, Upcoming, From AI, Completed, your categories, Notifications, History, Archive, AI agents and Settings. Tasks open in a side panel with their own history and a Duplicate button. Settings becomes a full page with sections and stats, and the app can open at login. The browser extension keeps its compact layout.
- **Named AI keys.** Create a separate key for each AI app (for example Claude Code or Cursor), rename or revoke each one, and see in History, notifications and each task which one made a change.
- **OK, send to AI.** Tasks an agent creates get a button to hand them back to that agent, with a plain OK or your own written answer. The agent picks it up, does the work and reports back on the task.
- **Select several tasks.** Cmd or Ctrl click, Shift click or Cmd/Ctrl + A to select tasks, then mark them done, move, archive or delete them together. Drag tasks onto a category to move them.
- **Notifications screen.** Agent notifications are kept behind the bell icon instead of in History.

### Fixed
- Changes an agent makes to a task you have open are no longer overwritten by the editor.
- In the desktop app, the task editor and the new-task box stay a sensible size on wide windows.

## 1.6.1 - 2026-11-24

### Added
- **Sort your list.** A sort button next to search orders tasks by due date (the usual groups), last updated, newest or priority. Smart Tasks remembers your choice.
- **AI can manage subtasks.** Agents can add, tick off, untick, rename, move and delete checklist items.

## 1.6.0 - 2026-11-24

### Added
- **Archive.** Archive any task or category to hide it without deleting it. Archiving a category hides its tasks too. Find everything in Settings, Archive, where you can restore or delete it.
- **AI permissions.** Choose what AI agents may do: add, edit, mark done, archive, manage categories, delete and send notifications. It applies to every AI app right away, and switched-off actions disappear from the agent's tools.
- **AI can archive and delete categories.** Agents can archive and restore tasks and categories, and delete a category when you ask (its tasks are kept).

### Changed
- Activity shows archived, restored and deleted categories, and archived tasks.
- Archived tasks don't send reminders or count on the icon badge.

## 1.5.1 - 2026-11-24

### Fixed
- **Continue with Google** in the Windows app now opens Google in your default browser and brings you back to the app when you're signed in. Before, it failed with "failed to create webview".

## 1.5.0 - 2026-11-24

### Added
- **Smart Tasks for Windows.** A small desktop app (Rust and WebView2) with the same screens, a resizable window, a tray icon, a taskbar badge, Windows notifications with Mark done and Snooze, Ctrl + Alt + K from anywhere and start with Windows. It updates itself.
- **More AI apps.** The AI agent screen has setup for Claude Code, Claude Desktop, Codex CLI, Gemini CLI, Cursor, VS Code, Windsurf, Cline and Zed.
- **Welcome tour.** New accounts get a short hands-on tour: pick what you use it for, add your first tasks, tick one off, send a test reminder, try the shortcut and pick your AI. Replay it from Settings.
- **Livelier welcome screen** with a task you can tick off before signing up.
- **Loading screen** while Smart Tasks starts.

### Changed
- The Windows app fills its window and spreads out as you make it wider.
- When the Windows app runs on the same computer, it shows your reminders and agent notifications and the extension stays quiet, so nothing pops up twice.

## 1.4.1 - 2026-11-23

### Changed
- When a new version is ready, the link at the bottom of Settings says Update to that version and starts the update in one click.

## 1.4.0 - 2026-11-23

### Added
- **Automatic updates.** Smart Tasks checks for new versions when your browser starts, every 30 minutes and whenever you open it. Click Update once and pick your Smart Tasks folder; choose Allow on every visit and later updates install on their own, with a notification when they do.
- **Update banner.** The popup shows when a new version is ready, with what changed.
- **Check for updates** at the bottom of Settings.

## 1.3.0 - 2026-11-23

### Added
- **Activity history.** A new Activity screen lists every task you added, completed, reopened or deleted, plus messages from your AI agent, grouped by day. Filter by Added, Done or From AI.
- **Agent notifications.** Your AI agent can send you desktop notifications on every computer you are signed in on.
- **A sound of its own.** Agent notifications play a soft two-note chime that is different from reminders. You can turn it off in Settings, AI agent.
- **Unread count on the icon.** The toolbar icon shows unread agent notifications in purple. Opening Activity clears it.
- **Task times.** Finished tasks show when they were done, and the task editor shows when a task was added and completed.

### Changed
- New logo and icon.
- Clearer name and description: Smart Tasks: To-Do List & Reminders.
- Slimmer progress header with a glowing meter.

## 1.2.0 - 2026-11-23

### Added
- **AI agents.** Connect Claude Code or any MCP app with a personal access key. Agents can list, add, edit, complete and delete tasks, and changes show up instantly.
- **Devices.** See every browser signed in to your account, which ones are active right now, and sign any of them out remotely.
- **Floating add button.** Press the plus button or N to add tasks; the panel stays open so you can add several in a row.

### Changed
- The dashboard groups tasks into Overdue, Today, Tomorrow, This week, Later and Anytime.
- The header shows how many tasks are done, a progress bar and your streak.
- Category chips hide inside their own filter, and the subtask count sits next to the title.
- Section headers and chips fold in and out smoothly.

## 1.1.0 - 2026-11-23

### Added
- **Categories you can manage.** Add, rename, recolor and remove categories, and create one right from the task editor.
- **Autosave.** Task edits save as you type.
- **Smarter quick add.** Understands times in quotes, weekdays, noon and 24-hour times.
- **Account switcher.** Switch between accounts from a menu under your avatar.

### Changed
- New teal theme, themed date and time pickers, and smoother motion everywhere.
- Calmer dashboard with a scrollable category row and more breathing room.
- Google sign-in runs in the background so the popup can close safely.

## 1.0.0 - 2026-11-23

### Added
- First release: a to-do list that syncs across your devices in real time.
- Quick add with natural language, for example "Pay rent next week 9am !high #personal".
- Categories, subtasks, notes, links, priorities and due dates.
- Desktop reminders you can mark done or snooze from the notification.
- Right-click to save selected text, a page or a link as a task.
- Works offline; changes sync when you are back online.
- Sign in with email or Google, or use it without an account.
