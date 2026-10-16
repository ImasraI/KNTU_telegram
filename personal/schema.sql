-- Separate D1 database. NEVER bind the public/shared bot database here.
CREATE TABLE IF NOT EXISTS personal_connections (
  tg_id INTEGER PRIMARY KEY,
  sealed TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  last_attempt_at INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'disconnected',
  last_error TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0
);
