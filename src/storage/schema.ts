export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS dirong_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS transcript_segments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  stt_job_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  display_name_snapshot TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  speech_status TEXT NOT NULL DEFAULT 'speech',
  source TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_audio_sha256 TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE,
  FOREIGN KEY (stt_job_id) REFERENCES stt_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transcript_segments_session_start
  ON transcript_segments(session_id, start_ms);

CREATE TABLE IF NOT EXISTS ai_cleanup_jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_by TEXT,
  locked_until TEXT,
  next_attempt_at TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  command TEXT,
  prompt_version TEXT NOT NULL,
  input_contract_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  input_entry_count INTEGER NOT NULL,
  input_timeline_json_path TEXT,
  input_timeline_markdown_path TEXT,
  prompt_path TEXT,
  raw_output_path TEXT,
  stderr_path TEXT,
  parsed_json_path TEXT,
  markdown_path TEXT,
  output_hash TEXT,
  failure_kind TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE (session_id, provider, model, prompt_version, input_hash)
);

CREATE INDEX IF NOT EXISTS idx_ai_cleanup_jobs_status_next_attempt
  ON ai_cleanup_jobs(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_ai_cleanup_jobs_session_created
  ON ai_cleanup_jobs(session_id, created_at);

CREATE TABLE IF NOT EXISTS meeting_notes_drafts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ai_cleanup_job_id TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL,
  language TEXT NOT NULL,
  title TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  draft_json TEXT NOT NULL,
  markdown TEXT NOT NULL,
  json_path TEXT NOT NULL,
  markdown_path TEXT NOT NULL,
  raw_output_path TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_hash TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (ai_cleanup_job_id) REFERENCES ai_cleanup_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meeting_notes_drafts_session_created
  ON meeting_notes_drafts(session_id, created_at);

CREATE TABLE IF NOT EXISTS notion_writes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type = 'data_source'),
  target_id TEXT NOT NULL,
  target_url TEXT NOT NULL,
  notion_page_id TEXT,
  notion_page_url TEXT,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  status_message TEXT,
  last_successful_block_index INTEGER NOT NULL DEFAULT -1,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_by TEXT,
  locked_until TEXT,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (draft_id, target_type, target_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (draft_id) REFERENCES meeting_notes_drafts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notion_writes_status_next_attempt
  ON notion_writes(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_notion_writes_session_created
  ON notion_writes(session_id, created_at);

CREATE TABLE IF NOT EXISTS notion_blocks (
  notion_write_id TEXT NOT NULL,
  block_index INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  notion_block_id TEXT,
  status TEXT NOT NULL,
  appended_at TEXT,
  last_error TEXT,
  PRIMARY KEY (notion_write_id, block_index),
  FOREIGN KEY (notion_write_id) REFERENCES notion_writes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notion_custom_property_rules (
  property_name TEXT PRIMARY KEY,
  property_id TEXT,
  property_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  prompt_description TEXT NOT NULL DEFAULT '',
  max_length INTEGER NOT NULL DEFAULT 1000,
  relation_target_url TEXT,
  relation_data_source_id TEXT,
  relation_match_property_name TEXT NOT NULL DEFAULT 'Name',
  relation_auto_create INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notion_custom_property_rules_enabled
  ON notion_custom_property_rules(enabled, property_name);

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
