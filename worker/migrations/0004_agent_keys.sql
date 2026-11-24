-- Several named agent keys per user (was one token per user). The name shows
-- up in History next to whatever that agent changed.
CREATE TABLE IF NOT EXISTS agent_keys (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  hint       TEXT NOT NULL,
  time_zone  TEXT NOT NULL DEFAULT 'UTC',
  created_at INTEGER NOT NULL,
  last_used  INTEGER
);
CREATE INDEX IF NOT EXISTS agent_keys_user ON agent_keys(user_id);

-- Existing tokens keep working, as a key called "AI agent".
INSERT OR IGNORE INTO agent_keys (id, user_id, name, token_hash, hint, time_zone, created_at, last_used)
  SELECT lower(hex(randomblob(8))), user_id, 'AI agent', token_hash, hint, time_zone, created_at, last_used FROM agent_tokens;

-- agent_tokens is left in place (unused) so the running worker keeps working
-- until the new code is deployed; drop it in a later migration.
