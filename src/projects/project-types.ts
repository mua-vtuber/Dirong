export const DEFAULT_PROJECT_ID = "default";

export type ProjectLifecycleStatus = "draft" | "ready" | "archived" | "resetting";

export type ProjectNotionUploadMode = "manual" | "automatic_after_ai_cleanup";

export type DirongProjectRow = {
  id: string;
  name: string;
  lifecycle_status: ProjectLifecycleStatus;
  guild_id: string | null;
  guild_name: string | null;
  guild_icon_url: string | null;
  command_enabled: number;
  notion_token_secret_ref: string | null;
  notion_parent_page_url: string | null;
  notion_upload_mode: ProjectNotionUploadMode;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type DirongProjectStateRow = {
  id: typeof DEFAULT_PROJECT_ID;
  active_project_id: string | null;
  switching: number;
  updated_at: string;
};

export function projectNotionTokenSecretRef(projectId: string): string {
  const cleaned = projectId.trim();
  if (!/^[a-z0-9._:-]{1,80}$/i.test(cleaned)) {
    throw new Error("project id cannot be used as a local secret ref.");
  }
  return `notion.project.${cleaned}.token`;
}

export type NotionUploadScopeRow = {
  project_id: string;
  automatic_upload_after: string;
  reset_mode: string | null;
  reset_at: string | null;
  updated_at: string;
};
