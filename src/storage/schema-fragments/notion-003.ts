export const NOTION_CUSTOM_PROPERTY_RULES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS notion_custom_property_rules (
  database_role TEXT NOT NULL DEFAULT 'meeting',
  property_name TEXT NOT NULL,
  property_id TEXT,
  property_type TEXT NOT NULL,
  value_source TEXT NOT NULL DEFAULT 'ai',
  enabled INTEGER NOT NULL DEFAULT 0,
  prompt_description TEXT NOT NULL DEFAULT '',
  max_length INTEGER NOT NULL DEFAULT 1000,
  relation_target_url TEXT,
  relation_data_source_id TEXT,
  relation_target_page_url TEXT,
  relation_target_page_id TEXT,
  relation_match_property_name TEXT NOT NULL DEFAULT 'Name',
  relation_auto_create INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (database_role, property_name)
);
`;
