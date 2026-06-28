-- Arcadia Intelligence v0.1
--
-- This is intentionally a starting point, not an instruction to introduce a
-- second database layer. Codex should adapt this migration to existing Arcadia
-- SQLite migration conventions.

CREATE TABLE IF NOT EXISTS intelligence_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,

  capability TEXT NOT NULL,
  client_app TEXT NOT NULL,
  project_id TEXT,
  mission_id TEXT,

  request_json TEXT NOT NULL,

  status TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'blocked')
  ),

  selected_route TEXT,

  result_json TEXT,
  validation_json TEXT,
  usage_json TEXT,

  error_code TEXT,
  error_message TEXT,

  retry_count INTEGER NOT NULL DEFAULT 0,

  lease_owner TEXT,
  lease_expires_at TEXT,

  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT NOT NULL
);
