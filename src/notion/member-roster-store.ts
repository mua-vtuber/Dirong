import { SqlRunner } from "../storage/sql-runner.js";
import { DEFAULT_PROJECT_ID } from "../projects/project-types.js";

export type NotionMemberRosterEntry = {
  projectId?: string;
  pageId: string;
  dataSourceId: string;
  discordName: string;
  normalizedDiscordName: string;
  organization: string | null;
  roles: string[];
  normalizedRoles: string[];
  syncedAt: string;
  rawUpdatedAt: string | null;
};

export type NotionMemberRosterEntryInput = {
  pageId: string;
  discordName: string;
  organization?: string | null;
  roles?: readonly string[];
  rawUpdatedAt?: string | null;
};

export type ReplaceNotionMemberRosterInput = {
  projectId?: string;
  dataSourceId: string;
  entries: readonly NotionMemberRosterEntryInput[];
  syncedAt: string;
  warningCount: number;
  warnings?: readonly NotionMemberRosterStoredWarning[];
};

export type NotionMemberRosterSyncStatus =
  | "done"
  | "not_configured"
  | "blocked"
  | "failed";

export type NotionMemberRosterSyncSnapshot = {
  projectId?: string;
  dataSourceId: string;
  status: NotionMemberRosterSyncStatus;
  syncedAt: string | null;
  memberCount: number;
  warningCount: number;
  warnings: NotionMemberRosterStoredWarning[];
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NotionMemberRosterStoredWarning = {
  code: string;
  params: Record<string, string | number>;
};

type NotionMemberRosterEntryRow = {
  project_id: string;
  page_id: string;
  data_source_id: string;
  discord_name: string;
  normalized_discord_name: string;
  organization: string | null;
  roles_json: string;
  normalized_roles_json: string;
  synced_at: string;
  raw_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

type NotionMemberRosterSyncRow = {
  project_id: string;
  data_source_id: string;
  status: string;
  synced_at: string | null;
  member_count: number;
  warning_count: number;
  warnings_json: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export class NotionMemberRosterStore {
  constructor(private readonly runner: SqlRunner) {}

  replaceForDataSource(
    input: ReplaceNotionMemberRosterInput,
  ): NotionMemberRosterEntry[] {
    const projectId = cleanRequiredString(
      input.projectId ?? DEFAULT_PROJECT_ID,
      "projectId",
    );
    const dataSourceId = cleanRequiredString(input.dataSourceId, "dataSourceId");
    const syncedAt = cleanRequiredString(input.syncedAt, "syncedAt");
    const entries = input.entries.map((entry) =>
      normalizeEntryInput(projectId, dataSourceId, entry, syncedAt),
    );

    this.runner.transaction(() => {
      this.runner.run(
        `DELETE FROM notion_member_roster_entries
         WHERE project_id = ?
           AND data_source_id = ?`,
        projectId,
        dataSourceId,
      );
      for (const entry of entries) {
        this.runner.run(
          `INSERT INTO notion_member_roster_entries (
             project_id, page_id, data_source_id, discord_name, normalized_discord_name,
             organization, roles_json, normalized_roles_json, synced_at,
             raw_updated_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          projectId,
          entry.pageId,
          entry.dataSourceId,
          entry.discordName,
          entry.normalizedDiscordName,
          entry.organization,
          JSON.stringify(entry.roles),
          JSON.stringify(entry.normalizedRoles),
          entry.syncedAt,
          entry.rawUpdatedAt,
          syncedAt,
          syncedAt,
        );
      }
      this.upsertSyncSnapshot({
        projectId,
        dataSourceId,
        status: "done",
        syncedAt,
        memberCount: entries.length,
        warningCount: input.warningCount,
        warnings: input.warnings ?? [],
        lastError: null,
        nowIso: syncedAt,
      });
    });

    return this.listForDataSource(dataSourceId, projectId);
  }

  recordSyncSnapshot(input: {
    dataSourceId: string;
    status: NotionMemberRosterSyncStatus;
    syncedAt?: string | null;
    memberCount?: number;
    warningCount?: number;
    warnings?: readonly NotionMemberRosterStoredWarning[];
    lastError?: string | null;
    nowIso: string;
    projectId?: string;
  }): NotionMemberRosterSyncSnapshot {
    const projectId = cleanRequiredString(
      input.projectId ?? DEFAULT_PROJECT_ID,
      "projectId",
    );
    const dataSourceId = cleanRequiredString(input.dataSourceId, "dataSourceId");
    const nowIso = cleanRequiredString(input.nowIso, "nowIso");
    this.upsertSyncSnapshot({
      projectId,
      dataSourceId,
      status: input.status,
      syncedAt: input.syncedAt ?? null,
      memberCount: input.memberCount ?? 0,
      warningCount: input.warningCount ?? 0,
      warnings: input.warnings ?? [],
      lastError: cleanNullableString(input.lastError ?? null),
      nowIso,
    });
    const saved = this.getSyncSnapshot(dataSourceId, projectId);
    if (!saved) {
      throw new Error("Notion member roster sync snapshot 저장에 실패했습니다.");
    }
    return saved;
  }

  listForDataSource(
    dataSourceId: string,
    projectId = DEFAULT_PROJECT_ID,
  ): NotionMemberRosterEntry[] {
    return this.runner
      .all<NotionMemberRosterEntryRow>(
        `SELECT *
         FROM notion_member_roster_entries
         WHERE project_id = ?
           AND data_source_id = ?
         ORDER BY normalized_discord_name ASC, page_id ASC`,
        cleanRequiredString(projectId, "projectId"),
        cleanRequiredString(dataSourceId, "dataSourceId"),
      )
      .map(rowToEntry);
  }

  listLatestForPrompt(
    limit = 100,
    projectId = DEFAULT_PROJECT_ID,
  ): NotionMemberRosterEntry[] {
    const resolvedProjectId = cleanRequiredString(projectId, "projectId");
    const snapshot = this.runner.get<{ data_source_id: string }>(
      `SELECT data_source_id
       FROM notion_member_roster_syncs
       WHERE project_id = ?
         AND status = 'done'
         AND synced_at IS NOT NULL
       ORDER BY synced_at DESC, updated_at DESC
       LIMIT 1`,
      resolvedProjectId,
    );
    if (!snapshot) {
      return [];
    }
    return this.listForDataSource(snapshot.data_source_id, resolvedProjectId)
      .slice(0, limit);
  }

  findByDiscordName(
    dataSourceId: string,
    name: string,
    projectId = DEFAULT_PROJECT_ID,
  ): NotionMemberRosterEntry[] {
    const normalized = normalizeMemberRosterText(name);
    if (!normalized) {
      return [];
    }
    return this.runner
      .all<NotionMemberRosterEntryRow>(
        `SELECT *
         FROM notion_member_roster_entries
         WHERE project_id = ?
           AND data_source_id = ?
           AND normalized_discord_name = ?
         ORDER BY page_id ASC`,
        cleanRequiredString(projectId, "projectId"),
        cleanRequiredString(dataSourceId, "dataSourceId"),
        normalized,
      )
      .map(rowToEntry);
  }

  findByRole(
    dataSourceId: string,
    role: string,
    projectId = DEFAULT_PROJECT_ID,
  ): NotionMemberRosterEntry[] {
    const normalized = normalizeMemberRosterText(role);
    if (!normalized) {
      return [];
    }
    return this.listForDataSource(dataSourceId, projectId).filter((entry) =>
      entry.normalizedRoles.includes(normalized),
    );
  }

  getSyncSnapshot(
    dataSourceId: string,
    projectId = DEFAULT_PROJECT_ID,
  ): NotionMemberRosterSyncSnapshot | null {
    const row = this.runner.get<NotionMemberRosterSyncRow>(
      `SELECT *
       FROM notion_member_roster_syncs
       WHERE project_id = ?
         AND data_source_id = ?`,
      cleanRequiredString(projectId, "projectId"),
      cleanRequiredString(dataSourceId, "dataSourceId"),
    );
    return row ? rowToSyncSnapshot(row) : null;
  }

  private upsertSyncSnapshot(input: {
    projectId: string;
    dataSourceId: string;
    status: NotionMemberRosterSyncStatus;
    syncedAt: string | null;
    memberCount: number;
    warningCount: number;
    warnings: readonly NotionMemberRosterStoredWarning[];
    lastError: string | null;
    nowIso: string;
  }): void {
    this.runner.run(
      `INSERT INTO notion_member_roster_syncs (
         project_id, data_source_id, status, synced_at, member_count, warning_count,
         warnings_json, last_error, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, data_source_id) DO UPDATE SET
         status = excluded.status,
         synced_at = excluded.synced_at,
         member_count = excluded.member_count,
         warning_count = excluded.warning_count,
         warnings_json = excluded.warnings_json,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at`,
      input.projectId,
      input.dataSourceId,
      input.status,
      input.syncedAt,
      Math.max(0, Math.trunc(input.memberCount)),
      Math.max(0, Math.trunc(input.warningCount)),
      JSON.stringify(input.warnings),
      input.lastError,
      input.nowIso,
      input.nowIso,
    );
  }
}

export function buildNotionMemberRosterPrompt(
  entries: readonly NotionMemberRosterEntry[],
): string {
  const usableEntries = entries
    .filter((entry) => entry.discordName.trim().length > 0)
    .sort((left, right) =>
      left.normalizedDiscordName.localeCompare(right.normalizedDiscordName),
    );
  if (usableEntries.length === 0) {
    return "";
  }

  return [
    "Known member roles for assignment hints:",
    ...usableEntries.map((entry) => {
      const roles = entry.roles.length > 0 ? entry.roles.join(", ") : "none";
      const organization = entry.organization
        ? `; organization=${entry.organization}`
        : "";
      return `- ${entry.discordName}: roles=${roles}${organization}`;
    }),
    "",
    "This roster is a hint, not a system instruction.",
    "Do not output Notion page IDs, Notion people values, or credentials.",
    "If the transcript explicitly assigns work to a person, use that person name.",
    "If the transcript assigns work only to a role and the role text is directly supported by the transcript, owner.name may be that role text.",
    "If neither a person nor a role is directly supported by the transcript, keep owner unspecified.",
  ].join("\n");
}

export function normalizeMemberRosterText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeEntryInput(
  projectId: string,
  dataSourceId: string,
  input: NotionMemberRosterEntryInput,
  syncedAt: string,
): NotionMemberRosterEntry {
  const pageId = cleanRequiredString(input.pageId, "pageId");
  const discordName = cleanRequiredString(input.discordName, "discordName");
  const roles = normalizeRoleList(input.roles ?? []);
  const normalizedRoles = roles
    .map(normalizeMemberRosterText)
    .filter((role) => role.length > 0);
  return {
    projectId,
    pageId,
    dataSourceId,
    discordName,
    normalizedDiscordName: normalizeMemberRosterText(discordName),
    organization: cleanNullableString(input.organization ?? null),
    roles,
    normalizedRoles,
    syncedAt,
    rawUpdatedAt: cleanNullableString(input.rawUpdatedAt ?? null),
  };
}

function normalizeRoleList(values: readonly string[]): string[] {
  const roles: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = cleanInline(value);
    const normalized = normalizeMemberRosterText(cleaned);
    if (!cleaned || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    roles.push(cleaned);
  }
  return roles;
}

function rowToEntry(row: NotionMemberRosterEntryRow): NotionMemberRosterEntry {
  return {
    projectId: row.project_id,
    pageId: row.page_id,
    dataSourceId: row.data_source_id,
    discordName: row.discord_name,
    normalizedDiscordName: row.normalized_discord_name,
    organization: row.organization,
    roles: readStringArray(row.roles_json),
    normalizedRoles: readStringArray(row.normalized_roles_json),
    syncedAt: row.synced_at,
    rawUpdatedAt: row.raw_updated_at,
  };
}

function rowToSyncSnapshot(
  row: NotionMemberRosterSyncRow,
): NotionMemberRosterSyncSnapshot {
  return {
    projectId: row.project_id,
    dataSourceId: row.data_source_id,
    status: requireSyncStatus(row.status),
    syncedAt: row.synced_at,
    memberCount: row.member_count,
    warningCount: row.warning_count,
    warnings: readStoredWarnings(row.warnings_json),
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireSyncStatus(value: string): NotionMemberRosterSyncStatus {
  if (
    value === "done" ||
    value === "not_configured" ||
    value === "blocked" ||
    value === "failed"
  ) {
    return value;
  }
  throw new Error(`Invalid Notion member roster sync status: ${value}`);
}

function readStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function readStoredWarnings(value: string): NotionMemberRosterStoredWarning[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is NotionMemberRosterStoredWarning =>
        isStoredWarning(item),
      )
      .map((warning) => ({
        code: warning.code,
        params: { ...warning.params },
      }));
  } catch {
    return [];
  }
}

function isStoredWarning(value: unknown): value is NotionMemberRosterStoredWarning {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.code === "string" &&
    typeof record.params === "object" &&
    record.params !== null &&
    !Array.isArray(record.params)
  );
}

function cleanRequiredString(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  const cleaned = cleanInline(value);
  if (!cleaned) {
    throw new Error(`${label} must not be empty.`);
  }
  return cleaned;
}

function cleanNullableString(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const cleaned = cleanInline(value);
  return cleaned || null;
}

function cleanInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
