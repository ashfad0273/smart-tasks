-- Device list: a public id per session (so the token hash never leaves the
-- server), plus a readable device name and rough location.
ALTER TABLE sessions ADD COLUMN id TEXT;
ALTER TABLE sessions ADD COLUMN device TEXT;
ALTER TABLE sessions ADD COLUMN location TEXT;
UPDATE sessions SET id = lower(hex(randomblob(9))) WHERE id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_id ON sessions(id);
