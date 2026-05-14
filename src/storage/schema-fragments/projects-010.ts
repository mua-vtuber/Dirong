export const PROJECT_FOUNDATION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS dirong_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL CHECK (
    lifecycle_status IN ('draft', 'ready', 'archived', 'resetting')
  ),
  guild_id TEXT,
  guild_name TEXT,
  guild_icon_url TEXT,
  command_enabled INTEGER NOT NULL DEFAULT 1 CHECK (command_enabled IN (0, 1)),
  notion_token_secret_ref TEXT,
  notion_parent_page_url TEXT,
  notion_upload_mode TEXT NOT NULL DEFAULT 'automatic_after_ai_cleanup' CHECK (
    notion_upload_mode IN ('manual', 'automatic_after_ai_cleanup')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dirong_projects_active_guild
  ON dirong_projects(guild_id)
  WHERE guild_id IS NOT NULL AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS dirong_project_state (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  active_project_id TEXT,
  switching INTEGER NOT NULL DEFAULT 0 CHECK (switching IN (0, 1)),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (active_project_id) REFERENCES dirong_projects(id)
);

CREATE TABLE IF NOT EXISTS notion_upload_scope (
  project_id TEXT PRIMARY KEY,
  automatic_upload_after TEXT NOT NULL,
  reset_mode TEXT,
  reset_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES dirong_projects(id)
);
`;
