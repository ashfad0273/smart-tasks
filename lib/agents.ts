/**
 * AI apps that can connect to Smart Tasks over MCP, with the exact setup each
 * one needs. The server speaks Streamable HTTP and authenticates with
 * "Authorization: Bearer stk_…", so every entry is an app that can send a
 * header (Claude Desktop goes through the mcp-remote bridge for that).
 */

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
