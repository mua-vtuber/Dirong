import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AiCleanupAutomationSnapshot } from "../ai/cleanup/automation-service.js";
import type { NotionAutomationSnapshot } from "../notion/automation-service.js";
import { NotionDraftInputReadModel } from "../notion/draft-input-read-model.js";
import { NotionMemberRosterStore } from "../notion/member-roster-store.js";
import { NotionCustomPropertyRuleStore } from "../notion/property-rules.js";
import { NotionRegistryStore } from "../notion/registry-store.js";
import { NotionWriteStore } from "../notion/write-store.js";
import { ProjectStore } from "../projects/project-store.js";
import type { RecordingRuntimeState } from "../storage/rows.js";
import { SqlRunner } from "../storage/sql-runner.js";
import { DirongDatabase } from "../storage/sqlite.js";
import { DEFAULT_NOTION_PROPERTY_NAMES } from "../notion/settings.js";
import { getDirongUserDataPaths } from "./dirong-user-data.js";
import { LocalSecretStore } from "./local-secret-store.js";
import {
  type DirongLocalSettings,
  LocalSettingsStore,
} from "./local-settings-store.js";
import { createProductSetupStatusSource } from "./product-settings.js";
import { SettingsResetService } from "./reset-service.js";

const nowIso = "2026-05-13T00:00:00.000Z";
const resetIso = "2026-05-13T00:05:00.000Z";

test("SettingsResetService full reset preserves local Whisper and clears Discord/AI/OpenAI/Notion secrets", async () => {
  const fixture = createFixture();
  try {
    seedConfiguredSettings(fixture, {
      sttProvider: "openai",
      includeAi: true,
      includeLegacyNotion: true,
    });
    const activeProject = fixture.projectStore.createReadyProject({
      id: "project-a",
      guildId: "111111111111111111",
      notionTokenSecretRef: "notion.project.project-a.token",
      notionParentPageUrl: "https://notion.so/a",
      nowIso,
    });
    fixture.projectStore.setActiveProjectId(activeProject.id, nowIso);
    fixture.secretStore.set("notion.project.project-a.token", "secret-notion", nowIso);
    seedProjectSqliteState(fixture, activeProject.id);

    const result = await fixture.service.reset({ mode: "full", confirm: true });

    assert.equal(result.ok, true);
    assert.equal(result.status, "done");
    const settings = fixture.settingsStore.read();
    assert.equal(settings.discord.applicationId, undefined);
    assert.equal(settings.discord.botTokenSecretRef, undefined);
    assert.equal(settings.discord.guildIds, undefined);
    assert.equal(settings.stt.provider, "local-whisper");
    assert.equal(settings.stt.language, "ko");
    assert.equal(settings.stt.timeoutMs, 12345);
    assert.equal(settings.stt.localWhisper?.model, "small");
    assert.equal(settings.stt.openAiApiKeySecretRef, undefined);
    assert.equal(settings.ai.provider, undefined);
    assert.equal(settings.ai.apiKeySecretRef, undefined);
    assert.equal(settings.notion.tokenSecretRef, undefined);
    assert.equal(settings.notion.parentPageUrl, undefined);
    assert.equal(settings.notion.uploadMode, undefined);
    assert.equal(fixture.secretStore.has("discord.bot_token"), false);
    assert.equal(fixture.secretStore.has("stt.openai_api_key"), false);
    assert.equal(fixture.secretStore.has("ai.claude_api_key"), false);
    assert.equal(fixture.secretStore.has("notion.project.project-a.token"), false);
    assert.equal(fixture.projectStore.getActiveProject()?.lifecycle_status, "draft");
    assert.equal(fixture.projectStore.getProject("project-a")?.guild_id, null);
    assert.equal(fixture.projectStore.getProject("project-a")?.notion_token_secret_ref, null);
    assert.equal(result.setup.features.stt.status, "ready");
    assert.equal(result.setup.features.discord.guildAllowlistCount, 0);
    assert.equal(result.deleted.sqliteRows.notionManagedDatabases, 1);
    assert.equal(result.deleted.blockedNotionWrites, 1);
  } finally {
    fixture.close();
  }
});

test("SettingsResetService current project reset preserves global Discord, AI, and STT while replacing a history project", async () => {
  const fixture = createFixture();
  try {
    seedConfiguredSettings(fixture, {
      sttProvider: "openai",
      includeAi: true,
      includeLegacyNotion: true,
    });
    const activeProject = fixture.projectStore.createReadyProject({
      id: "project-current",
      guildId: "222222222222222222",
      notionTokenSecretRef: "notion.project.project-current.token",
      notionParentPageUrl: "https://notion.so/current",
      nowIso,
    });
    fixture.projectStore.setActiveProjectId(activeProject.id, nowIso);
    fixture.secretStore.set(
      "notion.project.project-current.token",
      "secret-current-notion",
      nowIso,
    );
    seedProjectSqliteState(fixture, activeProject.id);

    const result = await fixture.service.reset({
      mode: "current_project_connection",
      confirm: true,
    });

    assert.equal(result.ok, true);
    const settings = fixture.settingsStore.read();
    assert.equal(settings.discord.applicationId, "discord-app-id");
    assert.equal(settings.discord.botTokenSecretRef, "discord.bot_token");
    assert.equal(settings.discord.guildIds, undefined);
    assert.equal(settings.stt.provider, "openai");
    assert.equal(settings.ai.provider, "claude");
    assert.equal(settings.notion.tokenSecretRef, undefined);
    assert.equal(settings.notion.parentPageUrl, undefined);
    assert.equal(settings.notion.uploadMode, undefined);
    assert.equal(fixture.secretStore.has("discord.bot_token"), true);
    assert.equal(fixture.secretStore.has("stt.openai_api_key"), true);
    assert.equal(fixture.secretStore.has("ai.claude_api_key"), true);
    assert.equal(fixture.secretStore.has("notion.project.project-current.token"), false);
    assert.equal(fixture.projectStore.getProject("project-current")?.lifecycle_status, "archived");
    assert.equal(fixture.projectStore.getProject("project-current")?.guild_id, null);
    assert.equal(fixture.projectStore.getActiveProject()?.guild_id, null);
    assert.equal(fixture.registryStore.getManagedDatabase("meeting", "project-current"), null);
    assert.equal(fixture.rosterStore.listLatestForPrompt(10, "project-current").length, 0);
    assert.equal(
      fixture.ruleStore.listEnabledRules("meeting", "project-current").length,
      0,
    );
    assert.equal(result.setup.features.discord.guildAllowlistCount, 0);
    assert.equal(result.setup.features.ai.status, "ready");
    assert.equal(result.setup.features.stt.status, "ready");
  } finally {
    fixture.close();
  }
});

test("SettingsResetService rejects reset while recording, Notion upload, or AI cleanup is in flight", async (t) => {
  const cases: Array<[string, FixtureOptions, string]> = [
    [
      "recording",
      { recording: { isRecording: true } },
      "recording_active",
    ],
    [
      "notion",
      { notion: { inFlightDraftIds: ["draft-in-flight"] } },
      "notion_upload_in_flight",
    ],
    [
      "ai",
      { ai: { inFlightSessionIds: ["session-in-flight"] } },
      "ai_cleanup_in_flight",
    ],
  ];
  for (const [name, overrides, reason] of cases) {
    await t.test(name, async () => {
      const fixture = createFixture(overrides);
      try {
        seedConfiguredSettings(fixture, { sttProvider: "local-whisper" });
        const project = fixture.projectStore.createReadyProject({
          id: `project-${name}`,
          guildId: "333333333333333333",
          nowIso,
        });
        fixture.projectStore.setActiveProjectId(project.id, nowIso);

        const result = await fixture.service.reset({
          mode: "current_project_connection",
          confirm: true,
        });

        assert.equal(result.ok, false);
        assert.equal(result.status, "blocked");
        if (result.status !== "blocked") {
          throw new Error("expected reset block");
        }
        assert.equal(result.reason, reason);
        assert.equal(fixture.projectStore.getProject(project.id)?.lifecycle_status, "ready");
        assert.equal(fixture.settingsStore.read().discord.applicationId, "discord-app-id");
      } finally {
        fixture.close();
      }
    });
  }
});

test("SettingsResetService rejects concurrent reset with reset_already_running", async () => {
  const stopGate = createDeferred<void>();
  const fixture = createFixture({
    stopNotionAutomation: () => stopGate.promise,
  });
  try {
    seedConfiguredSettings(fixture, { sttProvider: "local-whisper" });
    const project = fixture.projectStore.createReadyProject({
      id: "project-concurrent",
      guildId: "444444444444444444",
      nowIso,
    });
    fixture.projectStore.setActiveProjectId(project.id, nowIso);

    const first = fixture.service.reset({ mode: "current_project_connection", confirm: true });
    const second = await fixture.service.reset({ mode: "current_project_connection", confirm: true });
    assert.equal(second.ok, false);
    assert.equal(second.status, "blocked");
    if (second.status !== "blocked") {
      throw new Error("expected reset block");
    }
    assert.equal(second.reason, "reset_already_running");
    stopGate.resolve();
    assert.equal((await first).ok, true);
  } finally {
    fixture.close();
  }
});

test("SettingsResetService restarts Notion automation and refreshes its snapshot after successful reset", async () => {
  const calls: string[] = [];
  const fixture = createFixture({
    stopNotionAutomation: async () => {
      calls.push("stop");
    },
    startNotionAutomation: () => {
      calls.push("start");
    },
    runNotionAutomationOnce: async () => {
      calls.push("runOnce");
      return notionSnapshot({ status: "not_configured" });
    },
  });
  try {
    seedConfiguredSettings(fixture, { sttProvider: "local-whisper" });
    const project = fixture.projectStore.createReadyProject({
      id: "project-restart",
      guildId: "666666666666666666",
      nowIso,
    });
    fixture.projectStore.setActiveProjectId(project.id, nowIso);

    const result = await fixture.service.reset({
      mode: "current_project_connection",
      confirm: true,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(calls, ["stop", "start", "runOnce"]);
  } finally {
    fixture.close();
  }
});

test("SettingsResetService restores active project lifecycle when stopping Notion automation fails", async () => {
  const fixture = createFixture({
    stopNotionAutomation: async () => {
      throw new Error("stop failed");
    },
  });
  try {
    seedConfiguredSettings(fixture, { sttProvider: "local-whisper" });
    const project = fixture.projectStore.createReadyProject({
      id: "project-stop-fails",
      guildId: "777777777777777777",
      nowIso,
    });
    fixture.projectStore.setActiveProjectId(project.id, nowIso);

    const result = await fixture.service.reset({
      mode: "current_project_connection",
      confirm: true,
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, "failed");
    if (result.status !== "failed") {
      throw new Error("expected reset failure");
    }
    assert.equal(result.httpStatus, 500);
    assert.equal(result.recovery.activeProjectLifecycleRestored, true);
    assert.equal(result.recovery.notionAutomationRestarted, false);
    assert.equal(
      fixture.projectStore.getProject(project.id)?.lifecycle_status,
      "ready",
    );
    assert.equal(fixture.projectStore.getActiveProjectId(), project.id);
    assert.equal(fixture.settingsStore.read().discord.applicationId, "discord-app-id");
  } finally {
    fixture.close();
  }
});

test("SettingsResetService restores active project lifecycle and restarts Notion automation when reset storage fails before project boundary commit", async () => {
  const calls: string[] = [];
  const fixture = createFixture({
    stopNotionAutomation: async () => {
      calls.push("stop");
    },
    startNotionAutomation: () => {
      calls.push("start");
    },
    runNotionAutomationOnce: async () => {
      calls.push("runOnce");
      return notionSnapshot({ status: "not_configured" });
    },
  });
  try {
    seedConfiguredSettings(fixture, { sttProvider: "local-whisper" });
    const project = fixture.projectStore.createReadyProject({
      id: "project-store-fails",
      guildId: "888888888888888888",
      notionTokenSecretRef: "notion.project.project-store-fails.token",
      notionParentPageUrl: "https://notion.so/store-fails",
      nowIso,
    });
    fixture.projectStore.setActiveProjectId(project.id, nowIso);
    fixture.registryStore.clearProject = (() => {
      throw new Error("registry clear failed");
    }) as typeof fixture.registryStore.clearProject;

    const result = await fixture.service.reset({
      mode: "current_project_connection",
      confirm: true,
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, "failed");
    if (result.status !== "failed") {
      throw new Error("expected reset failure");
    }
    assert.equal(result.httpStatus, 500);
    assert.equal(result.recovery.activeProjectLifecycleRestored, true);
    assert.equal(result.recovery.notionAutomationRestarted, true);
    assert.deepEqual(calls, ["stop", "start", "runOnce"]);
    assert.equal(
      fixture.projectStore.getProject(project.id)?.lifecycle_status,
      "ready",
    );
    assert.equal(fixture.projectStore.getActiveProjectId(), project.id);
    assert.equal(
      fixture.projectStore.getProject(project.id)?.notion_token_secret_ref,
      "notion.project.project-store-fails.token",
    );
  } finally {
    fixture.close();
  }
});

test("SettingsResetService reset prevents old drafts from becoming new project automatic upload candidates", async () => {
  const fixture = createFixture();
  try {
    seedConfiguredSettings(fixture, { sttProvider: "local-whisper" });
    const project = fixture.projectStore.createReadyProject({
      id: "project-old",
      guildId: "555555555555555555",
      notionTokenSecretRef: "notion.project.project-old.token",
      notionParentPageUrl: "https://notion.so/old",
      nowIso,
    });
    fixture.projectStore.setActiveProjectId(project.id, nowIso);
    insertSessionGraph(fixture.database, {
      projectId: project.id,
      sessionId: "session-old",
      draftId: "draft-old",
      aiJobId: "ai-old",
      createdAt: "2026-05-13T00:01:00.000Z",
    });

    const result = await fixture.service.reset({
      mode: "current_project_connection",
      confirm: true,
    });
    assert.equal(result.ok, true);
    const freshProjectId = fixture.projectStore.getActiveProjectId();
    assert.ok(freshProjectId);
    fixture.registryStore.upsertManagedDatabase({
      projectId: freshProjectId,
      role: "meeting",
      locale: "ko",
      databaseId: "fresh-db",
      dataSourceId: "fresh-target",
      url: "https://notion.so/fresh",
      name: "Fresh",
      createdByDirong: true,
      schemaVersion: "notion-managed-db-v1",
      nowIso: resetIso,
    });

    const candidates = new NotionDraftInputReadModel(fixture.runner)
      .listLatestValidDraftsMissingDoneWrite({
        projectId: freshProjectId,
        targetId: "fresh-target",
        limit: 10,
        createdAtOrAfter:
          fixture.projectStore.getUploadScope(project.id)?.automatic_upload_after,
      });

    assert.deepEqual(candidates, []);
  } finally {
    fixture.close();
  }
});

type FixtureOptions = {
  recording?: Partial<RecordingRuntimeState>;
  notion?: Partial<NotionAutomationSnapshot>;
  ai?: Partial<AiCleanupAutomationSnapshot>;
  stopNotionAutomation?: () => Promise<void>;
  startNotionAutomation?: () => void | Promise<void>;
  runNotionAutomationOnce?: () => Promise<NotionAutomationSnapshot>;
};

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value?: T | PromiseLike<T>) => void;
} {
  let resolve: (value?: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>((innerResolve) => {
    resolve = (value) => innerResolve(value as T | PromiseLike<T>);
  });
  return { promise, resolve };
}

type Fixture = {
  dir: string;
  paths: ReturnType<typeof getDirongUserDataPaths>;
  database: DirongDatabase;
  runner: SqlRunner;
  settingsStore: LocalSettingsStore;
  secretStore: LocalSecretStore;
  projectStore: ProjectStore;
  registryStore: NotionRegistryStore;
  rosterStore: NotionMemberRosterStore;
  ruleStore: NotionCustomPropertyRuleStore;
  writeStore: NotionWriteStore;
  service: SettingsResetService;
  close: () => void;
};

function createFixture(options: FixtureOptions = {}): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-settings-reset-"));
  const paths = getDirongUserDataPaths(dir);
  const database = new DirongDatabase(paths.databasePath, 1000);
  const runner = new SqlRunner(database);
  const settingsStore = new LocalSettingsStore(paths.settingsFile);
  const secretStore = new LocalSecretStore(paths.secretsFile);
  const projectStore = new ProjectStore(runner);
  const registryStore = new NotionRegistryStore(runner);
  const rosterStore = new NotionMemberRosterStore(runner);
  const ruleStore = new NotionCustomPropertyRuleStore(runner);
  const writeStore = new NotionWriteStore(runner);
  const setupStatus = createProductSetupStatusSource({
    paths,
    registryStore,
    projectStore,
  });
  const service = new SettingsResetService({
    settingsStore,
    secretStore,
    projectStore,
    registryStore,
    memberRosterStore: rosterStore,
    customPropertyRuleStore: ruleStore,
    writeStore,
    setupStatus,
    getRecordingRuntimeState: () => recordingSnapshot(options.recording),
    getNotionAutomationSnapshot: () => notionSnapshot(options.notion),
    getAiCleanupAutomationSnapshot: () => aiSnapshot(options.ai),
    stopNotionAutomation: options.stopNotionAutomation ?? (async () => {}),
    startNotionAutomation: options.startNotionAutomation,
    runNotionAutomationOnce: options.runNotionAutomationOnce,
    now: () => new Date(resetIso),
  });

  return {
    dir,
    paths,
    database,
    runner,
    settingsStore,
    secretStore,
    projectStore,
    registryStore,
    rosterStore,
    ruleStore,
    writeStore,
    service,
    close: () => {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function seedConfiguredSettings(
  fixture: Fixture,
  options: {
    sttProvider: "local-whisper" | "openai";
    includeAi?: boolean;
    includeLegacyNotion?: boolean;
  },
): void {
  const settings: DirongLocalSettings = {
    schemaVersion: 1,
    app: { locale: "ko", dashboardTheme: "dark" },
    discord: {
      applicationId: "discord-app-id",
      botTokenSecretRef: "discord.bot_token",
      guildIds: ["legacy-guild"],
    },
    stt: {
      provider: options.sttProvider,
      language: "ko",
      timeoutMs: 12345,
      localWhisper: {
        model: "small",
        device: "cpu",
        computeType: "int8",
      },
      openAiApiKeySecretRef: "stt.openai_api_key",
      openAiModel: "gpt-4o-mini-transcribe",
    },
    ai: options.includeAi
      ? {
          provider: "claude",
          mode: "api",
          model: "claude-test",
          apiKeySecretRef: "ai.claude_api_key",
        }
      : {},
    notion: options.includeLegacyNotion
      ? {
          tokenSecretRef: "notion.internal_connection_token",
          parentPageUrl: "https://notion.so/legacy",
          uploadMode: "automatic_after_ai_cleanup",
        }
      : {},
    recording: {},
    retention: {
      deleteAudioAfterNotionUpload: false,
      textDraftRetentionDays: 90,
    },
  };
  fixture.settingsStore.write(settings);
  fixture.secretStore.set("discord.bot_token", "secret-discord", nowIso);
  fixture.secretStore.set("stt.openai_api_key", "secret-openai", nowIso);
  fixture.secretStore.set("ai.claude_api_key", "secret-claude", nowIso);
  fixture.secretStore.set("notion.internal_connection_token", "secret-notion-legacy", nowIso);
}

function seedProjectSqliteState(fixture: Fixture, projectId: string): void {
  fixture.registryStore.saveWorkspaceSettings({
    projectId,
    locale: "ko",
    parentPageUrl: "https://notion.so/parent",
    parentPageId: "parent-id",
    nowIso,
  });
  fixture.registryStore.upsertManagedDatabase({
    projectId,
    role: "meeting",
    locale: "ko",
    databaseId: "meeting-db",
    dataSourceId: "meeting-ds",
    url: "https://notion.so/meeting",
    name: "Meetings",
    createdByDirong: true,
    schemaVersion: "notion-managed-db-v1",
    nowIso,
  });
  fixture.registryStore.upsertPropertyMapping({
    projectId,
    databaseRole: "meeting",
    semanticKey: "meeting.title",
    propertyName: "Name",
    propertyId: "title",
    propertyType: "title",
    locked: true,
    sourceKind: "system",
    nowIso,
  });
  fixture.rosterStore.replaceForDataSource({
    projectId,
    dataSourceId: "member-ds",
    entries: [{ pageId: "member-page", discordName: "Taniar", roles: ["owner"] }],
    syncedAt: nowIso,
    warningCount: 0,
  });
  fixture.ruleStore.saveRules({
    projectId,
    databaseRole: "meeting",
    rules: [
      {
        propertyName: "Discussion",
        propertyType: "rich_text",
        enabled: true,
        promptDescription: "회의 논의 요약",
      },
    ],
    requiredPropertyNames: Object.values(DEFAULT_NOTION_PROPERTY_NAMES),
    nowIso,
  });
  insertSessionGraph(fixture.database, {
    projectId,
    sessionId: `session-${projectId}`,
    draftId: `draft-${projectId}`,
    aiJobId: `ai-${projectId}`,
    createdAt: nowIso,
  });
  fixture.writeStore.createOrGetWrite({
    id: `write-${projectId}`,
    projectId,
    sessionId: `session-${projectId}`,
    draftId: `draft-${projectId}`,
    targetType: "data_source",
    targetId: "meeting-ds",
    targetUrl: "https://notion.so/meeting",
    contentHash: "hash",
    maxAttempts: 3,
    nowIso,
  });
  fixture.database.db.prepare(
    `INSERT INTO repair_items (
       dedupe_key, session_id, item_type, status, severity, path, chunk_id,
       stt_job_id, details_json, created_at, updated_at, resolved_at
     ) VALUES (?, NULL, 'notion_managed_schema', 'open', 'warn', NULL, NULL,
       NULL, '{}', ?, ?, NULL)`,
  ).run(`notion_managed_schema:${projectId}:meeting`, nowIso, nowIso);
}

function insertSessionGraph(
  database: DirongDatabase,
  input: {
    projectId: string;
    sessionId: string;
    draftId: string;
    aiJobId: string;
    createdAt: string;
  },
): void {
  database.db.prepare(
    `INSERT INTO sessions (
       id, project_id, guild_id, guild_name, text_channel_id, voice_channel_id,
       voice_channel_name, started_by_user_id, started_by_display_name,
       stopped_by_user_id, stopped_by_display_name, status, started_at,
       stopped_at, finalized_at, data_dir, last_error, created_at, updated_at
     ) VALUES (
       ?, ?, 'guild', 'Guild', 'text', 'voice', 'Voice', 'starter', 'Taniar',
       NULL, NULL, 'finalized', ?, ?, ?, ?, NULL, ?, ?
     )`,
  ).run(
    input.sessionId,
    input.projectId,
    input.createdAt,
    input.createdAt,
    input.createdAt,
    path.dirname(database.dbPath),
    input.createdAt,
    input.createdAt,
  );
  database.db.prepare(
    `INSERT INTO ai_cleanup_jobs (
       id, session_id, status, attempts, max_attempts, locked_by,
       locked_until, next_attempt_at, provider, model, command,
       prompt_version, input_contract_version, input_hash, input_entry_count,
       input_timeline_json_path, input_timeline_markdown_path, prompt_path,
       raw_output_path, stderr_path, parsed_json_path, markdown_path,
       output_hash, failure_kind, last_error, created_at, updated_at
     ) VALUES (
       ?, ?, 'done', 1, 3, NULL, NULL, ?, 'fake', 'model', NULL,
       'prompt-v1', 'timeline-v1', ?, 1, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, ?, NULL, NULL, ?, ?
     )`,
  ).run(
    input.aiJobId,
    input.sessionId,
    input.createdAt,
    `input-${input.aiJobId}`,
    `output-${input.aiJobId}`,
    input.createdAt,
    input.createdAt,
  );
  database.db.prepare(
    `INSERT INTO meeting_notes_drafts (
       id, session_id, ai_cleanup_job_id, schema_version, language, title,
       summary_text, draft_json, markdown, json_path, markdown_path,
       raw_output_path, provider, model, prompt_version, input_hash,
       output_hash, validation_status, created_at, updated_at
     ) VALUES (
       ?, ?, ?, 'v1', 'ko', '회의록', '요약', '{}', '# 회의록',
       'draft.json', 'draft.md', 'raw.txt', 'fake', 'model', 'prompt-v1',
       'input-hash', ?, 'valid', ?, ?
     )`,
  ).run(
    input.draftId,
    input.sessionId,
    input.aiJobId,
    `draft-output-${input.draftId}`,
    input.createdAt,
    input.createdAt,
  );
}

function recordingSnapshot(
  overrides: Partial<RecordingRuntimeState> = {},
): RecordingRuntimeState {
  return {
    isRecording: false,
    sessionId: null,
    voiceChannelId: null,
    voiceChannelName: null,
    openChunks: 0,
    ...overrides,
  };
}

function notionSnapshot(
  overrides: Partial<NotionAutomationSnapshot> = {},
): NotionAutomationSnapshot {
  return {
    enabled: true,
    configured: true,
    uploadMode: "manual",
    status: "idle",
    checkedAt: null,
    sessionId: null,
    draftId: null,
    targetId: null,
    writeId: null,
    pageUrl: null,
    message: "idle",
    userAction: null,
    technicalDetail: null,
    lastRunStatus: null,
    inFlightDraftIds: [],
    repairedExpiredLeases: 0,
    ...overrides,
  } as NotionAutomationSnapshot;
}

function aiSnapshot(
  overrides: Partial<AiCleanupAutomationSnapshot> = {},
): AiCleanupAutomationSnapshot {
  return {
    enabled: true,
    status: "waiting_for_stt",
    provider: "claude-cli",
    model: "model",
    checkedAt: null,
    sessionId: null,
    message: "idle",
    userAction: null,
    technicalDetail: null,
    stt: null,
    job: null,
    lastRunStatus: null,
    inFlightSessionIds: [],
    repairedExpiredJobs: { requeued: 0, failed: 0 },
    repairedExpiredSttLeases: 0,
    warnings: [],
    progress: null,
    ...overrides,
  } as AiCleanupAutomationSnapshot;
}
