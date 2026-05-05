export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  guild_name TEXT,
  text_channel_id TEXT,
  voice_channel_id TEXT NOT NULL,
  voice_channel_name TEXT,
  started_by_user_id TEXT NOT NULL,
  started_by_display_name TEXT,
  stopped_by_user_id TEXT,
  stopped_by_display_name TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  stopped_at TEXT,
  finalized_at TEXT,
  data_dir TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_speakers (
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name_snapshot TEXT NOT NULL,
  is_bot INTEGER NOT NULL DEFAULT 0,
  first_seen_at_ms INTEGER NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  last_seen_at TEXT NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, user_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  display_name_snapshot TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  duration_ms INTEGER,
  raw_audio_path TEXT NOT NULL,
  raw_audio_format TEXT NOT NULL,
  raw_byte_size INTEGER,
  raw_sha256 TEXT,
  stt_audio_path TEXT,
  stt_audio_format TEXT,
  stt_byte_size INTEGER,
  stt_sha256 TEXT,
  transcode_status TEXT NOT NULL DEFAULT 'pending',
  transcode_error TEXT,
  close_reason TEXT,
  pipeline_error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (session_id, chunk_index),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id, user_id) REFERENCES session_speakers(session_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stt_jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  display_name_snapshot TEXT NOT NULL,
  input_audio_path TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_by TEXT,
  locked_until TEXT,
  next_attempt_at TEXT NOT NULL,
  input_audio_sha256 TEXT,
  result_text_sha256 TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_stt_jobs_status_next_attempt
  ON stt_jobs(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS connection_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  event_type TEXT NOT NULL,
  level TEXT NOT NULL,
  started_at_ms INTEGER,
  ended_at_ms INTEGER,
  details_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_connection_events_session_created
  ON connection_events(session_id, created_at);

CREATE TABLE IF NOT EXISTS repair_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT NOT NULL UNIQUE,
  session_id TEXT,
  item_type TEXT NOT NULL,
  status TEXT NOT NULL,
  severity TEXT NOT NULL,
  path TEXT,
  chunk_id TEXT,
  stt_job_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE SET NULL,
  FOREIGN KEY (stt_job_id) REFERENCES stt_jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_repair_items_status_updated
  ON repair_items(status, updated_at);
`;
