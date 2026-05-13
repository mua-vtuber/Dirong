export const NOTION_WRITES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS notion_writes (
  id TEXT PRIMARY KEY,
  project_id TEXT DEFAULT 'default',
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
  UNIQUE (draft_id, project_id, target_type, target_id),
  FOREIGN KEY (project_id) REFERENCES dirong_projects(id),
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
`;
