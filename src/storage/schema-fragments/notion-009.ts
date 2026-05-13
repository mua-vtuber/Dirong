export const NOTION_MEMBER_ROSTER_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS notion_member_roster_entries (
  project_id TEXT NOT NULL DEFAULT 'default',
  page_id TEXT NOT NULL,
  data_source_id TEXT NOT NULL,
  discord_name TEXT NOT NULL,
  normalized_discord_name TEXT NOT NULL,
  organization TEXT,
  roles_json TEXT NOT NULL,
  normalized_roles_json TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  raw_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, page_id),
  FOREIGN KEY (project_id) REFERENCES dirong_projects(id)
);

CREATE TABLE IF NOT EXISTS notion_member_roster_syncs (
  project_id TEXT NOT NULL DEFAULT 'default',
  data_source_id TEXT NOT NULL,
  status TEXT NOT NULL,
  synced_at TEXT,
  member_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, data_source_id),
  FOREIGN KEY (project_id) REFERENCES dirong_projects(id)
);
`;
