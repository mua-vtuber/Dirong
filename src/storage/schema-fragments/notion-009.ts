export const NOTION_MEMBER_ROSTER_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS notion_member_roster_entries (
  page_id TEXT PRIMARY KEY,
  data_source_id TEXT NOT NULL,
  discord_name TEXT NOT NULL,
  normalized_discord_name TEXT NOT NULL,
  organization TEXT,
  roles_json TEXT NOT NULL,
  normalized_roles_json TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  raw_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notion_member_roster_entries_discord_name
  ON notion_member_roster_entries(normalized_discord_name);

CREATE INDEX IF NOT EXISTS idx_notion_member_roster_entries_data_source
  ON notion_member_roster_entries(data_source_id, synced_at);

CREATE TABLE IF NOT EXISTS notion_member_roster_syncs (
  data_source_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  synced_at TEXT,
  member_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
