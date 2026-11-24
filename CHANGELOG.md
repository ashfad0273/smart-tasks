# Changelog

All notable changes to Smart Tasks. The newest release is at the top.

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
