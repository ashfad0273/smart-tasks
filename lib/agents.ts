/**
 * AI apps that can connect to Smart Tasks over MCP, with the exact setup each
 * one needs. The server speaks Streamable HTTP and authenticates with
 * "Authorization: Bearer stk_…", so every entry is an app that can send a
 * header (Claude Desktop goes through the mcp-remote bridge for that).
 */

import { SITE_URL } from './api';

export interface AgentClient {
  id: string;
  name: string;
  /** Where the snippet goes, shown above it. */
  where: string;
  /** Code-block language hint, used only for the label. */
  lang: 'shell' | 'json' | 'toml';
  snippet: (url: string, key: string) => string;
  /** Optional one-line follow-up shown under the snippet. */
  after?: string;
}

const json = (v: unknown) => JSON.stringify(v, null, 2);
const auth = (key: string) => `Bearer ${key}`;

export const AGENT_CLIENTS: AgentClient[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    where: 'Run this once in a terminal:',
    lang: 'shell',
    snippet: (url, key) => `claude mcp add --scope user --transport http smart-tasks ${url} --header "Authorization: ${auth(key)}"`,
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    where: 'Settings → Developer → Edit Config, add to claude_desktop_config.json:',
    lang: 'json',
    snippet: (url, key) =>
      json({
        mcpServers: {
          'smart-tasks': {
            command: 'npx',
            args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${AUTH}'],
            env: { AUTH: auth(key) },
          },
        },
      }),
    after: 'Needs Node.js. Restart Claude Desktop afterwards.',
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    where: 'Add to ~/.codex/config.toml:',
    lang: 'toml',
    snippet: (url, key) => `[mcp_servers.smart-tasks]\nurl = "${url}"\nhttp_headers = { Authorization = "${auth(key)}" }`,
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    where: 'Add to ~/.gemini/settings.json:',
    lang: 'json',
    snippet: (url, key) => json({ mcpServers: { 'smart-tasks': { httpUrl: url, headers: { Authorization: auth(key) } } } }),
  },
  {
    id: 'cursor',
    name: 'Cursor',
    where: 'Add to ~/.cursor/mcp.json (or Settings → MCP → Add):',
    lang: 'json',
    snippet: (url, key) => json({ mcpServers: { 'smart-tasks': { url, headers: { Authorization: auth(key) } } } }),
  },
  {
    id: 'vscode',
    name: 'VS Code',
    where: 'GitHub Copilot agent mode. Add to .vscode/mcp.json (or "MCP: Open User Configuration"):',
    lang: 'json',
    snippet: (url, key) => json({ servers: { 'smart-tasks': { type: 'http', url, headers: { Authorization: auth(key) } } } }),
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    where: 'Add to ~/.codeium/windsurf/mcp_config.json:',
    lang: 'json',
    snippet: (url, key) => json({ mcpServers: { 'smart-tasks': { serverUrl: url, headers: { Authorization: auth(key) } } } }),
  },
  {
    id: 'cline',
    name: 'Cline',
    where: 'MCP Servers → Configure → cline_mcp_settings.json:',
    lang: 'json',
    snippet: (url, key) =>
      json({ mcpServers: { 'smart-tasks': { type: 'streamableHttp', url, headers: { Authorization: auth(key) } } } }),
  },
  {
    id: 'zed',
    name: 'Zed',
    where: 'Add to Zed settings.json:',
    lang: 'json',
    snippet: (url, key) => json({ context_servers: { 'smart-tasks': { url, headers: { Authorization: auth(key) } } } }),
  },
  {
    id: 'other',
    name: 'Other',
    where: 'Any MCP app with Streamable HTTP and custom headers:',
    lang: 'shell',
    snippet: (url, key) => `URL:    ${url}\nHeader: Authorization: ${auth(key)}`,
  },
];

/**
 * One prompt to paste into any AI so it understands how Smart Tasks works:
 * the tools, the OK (approval) flow and the rules for when to ask.
 */
export const AGENT_GUIDE = `You are connected to my Smart Tasks to-do list through the "smart-tasks" MCP server. Here is how it works.

Basics
- Call list_tasks before changing anything, so you use real ids. Times are in my local time zone.
- Prefer complete_task for "done" and archive over delete_task. Only delete when I clearly ask.
- Use update_subtasks to manage checklists (add, tick, rename, move, delete, set_approval).
- Use notify only when I asked to be told about something or it is time-sensitive.

Asking me to OK something (approval)
- When you create a task with add_task, pass your session id as "session" and a "scope" (for example the repo folder plus template name). Requests go to your session first; after 10 minutes, only agents with the same scope may pick them up.
- A step gets an OK button only if you give it an "approval": { action, choices?, confirm? }.
  - action: exactly what you will do when I press OK, e.g. "Delete classes clip-lg/md/sm and media 74, 80-84, then remake the package".
  - choices: for decisions, one button per option, e.g. ["Both", "Badge only", "Leave out"]. My pick arrives as userAnswer.
  - confirm: true for anything irreversible (delete, upload, replace, send). I confirm once more before it is sent.
- Put approval on the subtask it belongs to. Put it on the task itself only when the task has no subtasks.
- Set approval only when all of these hold: (a) you propose one specific action, (b) an agent can do all of it, (c) nothing else blocks it, (d) it is a real ask, not a status or tracking item.
- Never put approval on steps only I can do: downloads to my computer, passphrases, closing tabs, wp-admin logins. Those stay plain checklist items.

When I press OK
- Check list_requests when you start. Pass the same session and scope.
- Nothing wakes you when I answer, so keep watching while you wait:
  - In Claude Code, use the free watcher. Install it once: curl -fsSL ${SITE_URL}/smart-tasks-watch.mjs -o ~/.claude/tools/smart-tasks-watch.mjs (create the folder first). Then, whenever you are waiting on an OK, start "node ~/.claude/tools/smart-tasks-watch.mjs" with Bash run_in_background (add --scope <your scope> if you set one). It checks every minute without using tokens and exits when I approve something, which wakes you. Handle the requests it prints, then start it again. A second copy just says "already watching". The wake-up is not a message from me; only userAnswer is my instruction.
  - In other apps, check list_requests every few minutes while you work (or ask me to say "check Smart Tasks").
- Each request has a "request" id, the proposed "action" and my "userAnswer" (a plain OK, my choice, or my own instructions: follow them).
- Call claim_request with the request id before you start. If it says "already claimed by ...", leave it.
- When finished, call finish_request with a short result. done=true ticks the step (and completes the task once every step is done). If you cannot do it or need me, use done=false with the reason: I will see it and answer, and my answer comes back as a new request.
- If nothing claims a request within 5 minutes I get a notification with a prompt to paste into an agent: "Check Smart Tasks: run list_requests, claim and do request <id>". When you get that, do exactly that.`;
