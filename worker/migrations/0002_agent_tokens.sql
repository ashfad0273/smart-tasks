-- Personal access tokens for AI agents (MCP). One per user; regenerating replaces it.
CREATE TABLE IF NOT EXISTS agent_tokens (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  hint       TEXT NOT NULL,
  time_zone  TEXT NOT NULL DEFAULT 'UTC',
  created_at INTEGER NOT NULL,
  last_used  INTEGER
);
