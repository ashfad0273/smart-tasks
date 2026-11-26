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
export const AGENT_GUIDE = `You are connected to my Smart Tasks to-do list through the "smart-tasks" MCP server. Read this once and follow it whenever you work with my tasks.

1. Everyday use
- Call list_tasks before changing anything, so you work with real ids. Times are in my local time zone.
- Mark finished work with complete_task. To get something out of the way, use archive. Use delete_task only when I clearly ask for it.
- Manage checklists with update_subtasks: add, tick, untick, rename, move, delete, set_approval.
- Use notify only when I asked to be told about something, or when it is time-sensitive.

2. Session and scope (who gets my answers)
- When you create a task with add_task, always pass your session id as "session" and a "scope" (for example the repo folder plus template name). Use the same session and scope in every later call.
- My answers go to the owning session first. If it does not pick them up within 10 minutes, other agents with the same scope may.
- A task with no session has no owner: its requests go straight to any agent with a matching scope (or to any agent if it has no scope either).
- To take over a task made without a session, call update_task with your session and scope.

3. Asking me to OK something
- Only items with an "approval" get an OK button: { action, choices?, confirm? }.
  - action: exactly what you will do when I press OK. Be specific, e.g. "Delete classes clip-lg/md/sm and media 74, 80-84, then remake the package".
  - choices: for a decision, one button per option, e.g. ["Both", "Badge only", "Leave out"]. My pick arrives as userAnswer.
  - confirm: true for anything irreversible (delete, upload, replace, send). I confirm once more before it goes out.
- Put approval on the subtask it belongs to. Put it on the task itself only when the task has no subtasks.
- Add approval only when all of these are true: you propose one specific action, an agent can do all of it, nothing else blocks it, and it is a real ask (not a status or tracking item).
- Never add approval to steps only I can do, such as downloads to my computer, passphrases, closing tabs or wp-admin logins. Keep those as plain checklist items.

4. Waiting for my OK
- Check list_requests when you start, with your session and scope.
- Nothing wakes you when I answer, so keep watching:
  - In Claude Code, use the watcher. It uses no tokens. Install it once:
    mkdir -p ~/.claude/tools && curl -fsSL ${SITE_URL}/smart-tasks-watch.mjs -o ~/.claude/tools/smart-tasks-watch.mjs
    While waiting, run "node ~/.claude/tools/smart-tasks-watch.mjs --session <your session> --scope <your scope>" with Bash run_in_background. It checks every minute and exits when I approve something, which wakes you. Handle what it prints, then start it again. If it says "already watching", one is running.
  - In other apps, check list_requests every few minutes while you work, or I can say "check Smart Tasks".
- The watcher waking you is not a message from me. Only userAnswer is my instruction.

5. Doing what I approved
- Each request has a "request" id, the proposed "action" and my "userAnswer": a plain OK, my choice, or my own instructions. Follow userAnswer.
- Call claim_request with the request id before you start. If it says it is already claimed by someone else, leave it.
- When finished, call finish_request with a short result. This ticks the step, and the task completes once every step is done.
- If you cannot do it or need me, call finish_request with done=false and the reason. I see it, answer, and my answer comes back to you as a new request.
- If nobody claims a request within 5 minutes, I get a notification with a prompt like "Check Smart Tasks: run list_requests, claim and do request <id>". When I paste that, do exactly that.`;
