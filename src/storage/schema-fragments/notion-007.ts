export const NOTION_REGISTRY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS notion_workspace_settings (
  project_id TEXT NOT NULL DEFAULT 'default',
  id TEXT NOT NULL DEFAULT 'default',
  locale TEXT NOT NULL CHECK (locale IN ('ko', 'en')),
  parent_page_url TEXT NOT NULL,
  parent_page_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id),
  FOREIGN KEY (project_id) REFERENCES dirong_projects(id)
);

CREATE TABLE IF NOT EXISTS notion_managed_databases (
  project_id TEXT NOT NULL DEFAULT 'default',
  role TEXT NOT NULL CHECK (role IN ('meeting', 'member', 'task')),
  locale TEXT NOT NULL CHECK (locale IN ('ko', 'en')),
  database_id TEXT NOT NULL,
  data_source_id TEXT NOT NULL,
  url TEXT NOT NULL,
  name TEXT NOT NULL,
  created_by_dirong INTEGER NOT NULL DEFAULT 1 CHECK (created_by_dirong IN (0, 1)),
  schema_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, role),
  FOREIGN KEY (project_id) REFERENCES dirong_projects(id)
);

CREATE TABLE IF NOT EXISTS notion_property_mappings (
  project_id TEXT NOT NULL DEFAULT 'default',
  database_role TEXT NOT NULL CHECK (database_role IN ('meeting', 'member', 'task')),
  semantic_key TEXT NOT NULL CHECK (
    semantic_key IN (
      'meeting.title',
      'meeting.date',
      'meeting.time',
      'meeting.channel',
      'meeting.memberRelation',
      'meeting.participants',
      'meeting.actionItems',
      'meeting.status',
      'meeting.sessionId',
      'meeting.draftId',
      'meeting.contentHash',
      'meeting.localStatus',
      'member.discordName',
      'member.notionPerson',
      'member.organization',
      'member.roles',
      'task.title',
      'task.meeting',
      'task.workerRelation',
      'task.assignee',
      'task.role',
      'task.dueDate',
      'task.status',
      'task.evidence',
      'task.sourceActionId'
    )
  ),
  property_name TEXT NOT NULL,
  property_id TEXT,
  property_type TEXT NOT NULL CHECK (
    property_type IN (
      'title',
      'rich_text',
      'date',
      'people',
      'select',
      'multi_select',
      'status',
      'relation',
      'rollup'
    )
  ),
  locked INTEGER NOT NULL DEFAULT 1 CHECK (locked IN (0, 1)),
  source_kind TEXT NOT NULL CHECK (
    source_kind IN ('system', 'rollup', 'user', 'ai', 'custom')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, database_role, semantic_key),
  FOREIGN KEY (project_id) REFERENCES dirong_projects(id)
);
`;
