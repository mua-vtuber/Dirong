import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { NotionClient } from "../notion/client.js";
import {
  NOTION_MANAGED_SCHEMA_VERSION,
  type ManagedNotionSchemaCreationResult,
} from "../notion/managed-schema.js";
import { KOREAN_NOTION_SCHEMA_PRESET } from "../notion/schema-presets.js";
import type {
  NotionDatabaseRole,
  NotionPropertySemanticKey,
  NotionSchemaPresetPropertyType,
} from "../notion/schema-presets.js";
import { NotionRegistryStore } from "../notion/registry-store.js";
import {
  DEFAULT_SECRET_REFS,
  LocalSecretStore,
} from "../settings/local-secret-store.js";
import { LocalSettingsStore } from "../settings/local-settings-store.js";
import {
  DEFAULT_MEETING_NOTES_LANGUAGE,
  DEFAULT_STT_SETTINGS,
} from "../settings/defaults.js";
import { getDirongUserDataPaths } from "../settings/dirong-user-data.js";
import { SqlRunner } from "../storage/sql-runner.js";
import { DirongDatabase } from "../storage/sqlite.js";
import { ProjectStore } from "../projects/project-store.js";
import {
  SetupWizardService,
  type ClaudeSetupTester,
  type DiscordSetupGateway,
} from "./wizard-service.js";
import type {
  LocalWhisperInstaller,
  LocalWhisperInstallSnapshot,
} from "./local-whisper-install-service.js";
import type { OpenAiSttConnectionTester } from "./openai-stt-connection-test.js";

const appId = "123456789012345678";
const guildId = "111111111111111111";
const otherGuildId = "222222222222222222";
const parentPageUrl =
  "https://www.notion.so/workspace/Dirong-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const parentPageId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

test("SetupWizardService saves Discord application ID and bot token without returning raw secrets", () => {
  const fixture = createFixture();
  try {
    const appResult = fixture.service.saveDiscordApplicationId({
      applicationId: appId,
    });
    assert.equal(appResult.ok, true);
    assert.equal(appResult.messageKey, "setup.discord.applicationId.save.done.message");
    assert.equal(appResult.display?.title, "설정을 저장했어요");
    assert.match(String(appResult.inviteUrl), new RegExp(appId));

    const tokenResult = fixture.service.saveDiscordBotToken({
      botToken: "discord-secret-raw-value",
    });
    const serialized = JSON.stringify(tokenResult);

    assert.equal(tokenResult.ok, true);
    assert.match(
      tokenResult.display?.details.find((detail) => detail.label === "message")?.value ?? "",
      /Discord bot token/,
    );
    assert.equal(
      fixture.settings.read().discord.botTokenSecretRef,
      DEFAULT_SECRET_REFS.discordBotToken,
    );
    assert.equal(
      fixture.secrets.get(DEFAULT_SECRET_REFS.discordBotToken),
      "discord-secret-raw-value",
    );
    assert.equal(tokenResult.runtimeEffect?.kind, "restart_required");
    assert.match(tokenResult.runtimeEffect?.message ?? "", /Discord 봇 로그인/);
    assert.doesNotMatch(serialized, /discord-secret-raw-value/);
    assert.match(serialized, /\[REDACTED\]/);
  } finally {
    fixture.close();
  }
});

test("SetupWizardService lists bot guilds and stores only guilds returned by the bot", async () => {
  const discordGateway = fakeDiscordGateway();
  const fixture = createFixture({ discordGateway });
  try {
    fixture.service.saveDiscordApplicationId({ applicationId: appId });
    fixture.service.saveDiscordBotToken({ botToken: "discord-secret-raw-value" });

    const guilds = await fixture.service.listDiscordGuilds();
    assert.equal(guilds.ok, true);
    assert.deepEqual(
      (guilds.guilds as Array<{ id: string; name: string }>).map((guild) => guild.name),
      ["Dirong Test Server", "Side Server"],
    );

    const saved = await fixture.service.saveDiscordGuildAllowlist({
      guildIds: [guildId],
    });
    assert.equal(saved.ok, true);
    assert.deepEqual(fixture.settings.read().discord.guildIds, [guildId]);

    const blocked = await fixture.service.saveDiscordGuildAllowlist({
      guildIds: ["333333333333333333"],
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.status, "blocked");
    assert.deepEqual(fixture.settings.read().discord.guildIds, [guildId]);
  } finally {
    fixture.close();
  }
});

test("SetupWizardService saves STT and Claude settings and uses the fake Claude boundary for tests", async () => {
  const claudeCalls: string[] = [];
  const fixture = createFixture({
    claudeTester: {
      test: async (input) => {
        claudeCalls.push(input.mode);
        return {
          provider: "claude",
          mode: input.mode,
          model: input.model,
          detail: "ok",
        };
      },
    },
  });
  try {
    const stt = fixture.service.saveSttSettings({
      provider: "local-whisper",
      model: "small",
      device: "cpu",
      computeType: "int8",
    });
    assert.equal(stt.ok, true);
    assert.equal(stt.runtimeEffect?.kind, "restart_required");
    assert.equal(fixture.settings.read().stt.provider, "local-whisper");
    assert.equal(
      fixture.settings.read().stt.localWhisper?.profile,
      "local-whisper-python-script",
    );
    assert.equal(fixture.settings.read().stt.localWhisper?.command, undefined);
    assert.equal(fixture.settings.read().stt.localWhisper?.args, undefined);
    assert.equal(fixture.settings.read().stt.localWhisper?.model, "small");

    const claude = fixture.service.saveClaudeSettings({
      mode: "cli",
      cliCommand: "claude",
      model: "sonnet",
    });
    assert.equal(claude.ok, true);
    assert.equal(claude.runtimeEffect?.kind, "restart_required");
    assert.equal(fixture.settings.read().ai.mode, "cli");
    assert.equal(fixture.settings.read().ai.model, "sonnet");
    assert.equal(fixture.settings.read().ai.claudeProfile, "claude-cli-default");
    assert.equal(fixture.settings.read().ai.claudeCommand, undefined);

    const tested = await fixture.service.testClaudeConnection();
    assert.equal(tested.ok, true);
    assert.deepEqual(claudeCalls, ["cli"]);
  } finally {
    fixture.close();
  }
});

test("SetupWizardService saves alone finalize wait time settings", () => {
  const fixture = createFixture();
  try {
    const result = fixture.service.saveRecordingSettings({
      enabled: false,
      graceSeconds: 45,
    });

    assert.equal(result.ok, true);
    assert.equal(result.runtimeEffect?.scope, "recording");
    assert.deepEqual(fixture.settings.read().recording, {
      aloneFinalizeEnabled: false,
      aloneFinalizeGraceMs: 45000,
    });

    const invalid = fixture.service.saveRecordingSettings({
      graceSeconds: 2,
    });
    assert.equal(invalid.ok, false);
    assert.equal(
      invalid.messageKey,
      "setup.recording.aloneFinalize.error.invalidGrace.message",
    );
    assert.equal(
      fixture.settings.read().recording.aloneFinalizeGraceMs,
      45000,
    );
  } finally {
    fixture.close();
  }
});

test("SetupWizardService rejects versioned Claude model names from setup", () => {
  const fixture = createFixture();
  try {
    const claude = fixture.service.saveClaudeSettings({
      mode: "cli",
      cliCommand: "claude",
      model: "claude-3-5-sonnet-20241022",
    });

    assert.equal(claude.ok, false);
    assert.equal(claude.messageKey, "setup.ai.claude.error.invalidModel.message");
    assert.equal(fixture.settings.read().ai.mode, undefined);
  } finally {
    fixture.close();
  }
});

test("SetupWizardService applies server STT defaults when optional setup fields are empty", () => {
  const fixture = createFixture();
  try {
    const result = fixture.service.saveSttSettings({
      provider: "local-whisper",
    });

    assert.equal(result.ok, true);
    assert.deepEqual(fixture.settings.read().stt, {
      provider: "local-whisper",
      language: DEFAULT_MEETING_NOTES_LANGUAGE,
      timeoutMs: DEFAULT_STT_SETTINGS.timeoutMs,
      localWhisper: {
        profile: DEFAULT_STT_SETTINGS.localWhisper.profile,
        command: undefined,
        args: undefined,
        model: DEFAULT_STT_SETTINGS.localWhisper.model,
        device: DEFAULT_STT_SETTINGS.localWhisper.device,
        computeType: DEFAULT_STT_SETTINGS.localWhisper.computeType,
      },
      openAiApiKeySecretRef: undefined,
      openAiModel: undefined,
    });
  } finally {
    fixture.close();
  }
});

test("SetupWizardService starts local Whisper install with selected model", () => {
  const starts: unknown[] = [];
  const snapshot: LocalWhisperInstallSnapshot = {
    status: "running",
    stage: "checking_python",
    model: "medium",
    message: "Checking Python environment.",
    detail: null,
    lastLog: null,
    startedAt: "2026-05-10T00:00:00.000Z",
    updatedAt: "2026-05-10T00:00:00.000Z",
    completedAt: null,
  };
  const installer: LocalWhisperInstaller = {
    getSnapshot: () => ({ ...snapshot }),
    start: (input) => {
      starts.push(input);
      return { ...snapshot, model: input.model };
    },
  };
  const fixture = createFixture({ localWhisperInstaller: installer });
  try {
    const result = fixture.service.startLocalWhisperInstall({
      model: "medium",
      device: "cpu",
      computeType: "int8",
    });

    assert.equal(result.ok, true);
    assert.equal(result.httpStatus, 202);
    assert.equal(result.install.status, "running");
    assert.equal(result.install.model, "medium");
    assert.deepEqual(starts, [
      { model: "medium", device: "cpu", computeType: "int8" },
    ]);

    const invalid = fixture.service.startLocalWhisperInstall({ model: "tiny" });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.httpStatus, 400);
    assert.equal(starts.length, 1);
  } finally {
    fixture.close();
  }
});

test("SetupWizardService tests OpenAI STT before saving credentials", async () => {
  const calls: unknown[] = [];
  const tester: OpenAiSttConnectionTester = {
    test: async (input) => {
      calls.push(input);
      return input.apiKey === "valid-openai-key"
        ? { ok: true, model: input.model, detail: null }
        : {
            ok: false,
            model: input.model,
            statusCode: 401,
            detail: "invalid api key",
          };
    },
  };
  const fixture = createFixture({ openAiSttTester: tester });
  try {
    const failed = await fixture.service.testAndSaveOpenAiSttSettings({
      apiKey: "bad-openai-key",
      model: DEFAULT_STT_SETTINGS.openai.model,
    });
    assert.equal(failed.ok, false);
    assert.equal(fixture.secrets.get(DEFAULT_SECRET_REFS.openAiApiKey), null);
    assert.equal(fixture.settings.read().stt.provider, undefined);

    const saved = await fixture.service.testAndSaveOpenAiSttSettings({
      apiKey: "valid-openai-key",
      model: DEFAULT_STT_SETTINGS.openai.model,
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.runtimeEffect?.scope, "stt");
    assert.equal(
      fixture.secrets.get(DEFAULT_SECRET_REFS.openAiApiKey),
      "valid-openai-key",
    );
    assert.equal(fixture.settings.read().stt.provider, "openai");
    assert.deepEqual(
      calls.map((call) => ({
        apiKey: (call as { apiKey: string }).apiKey,
        model: (call as { model: string }).model,
      })),
      [
        {
          apiKey: "bad-openai-key",
          model: DEFAULT_STT_SETTINGS.openai.model,
        },
        {
          apiKey: "valid-openai-key",
          model: DEFAULT_STT_SETTINGS.openai.model,
        },
      ],
    );
  } finally {
    fixture.close();
  }
});

test("SetupWizardService rejects unsafe dashboard command inputs", () => {
  const fixture = createFixture();
  try {
    for (const command of [
      "cmd.exe",
      "powershell.exe",
      "pwsh.exe",
      "tool.cmd",
      "tool.bat",
      "script.ps1",
    ]) {
      const stt = fixture.service.saveSttSettings({
        provider: "local-whisper",
        model: "small",
        command,
        args: ["--anything"],
      });
      assert.equal(stt.ok, false);
      assert.equal(stt.messageKey, "setup.stt.settings.error.invalidCommand.message");
      assert.equal(fixture.settings.read().stt.provider, undefined);
    }

    const claude = fixture.service.saveClaudeSettings({
      mode: "cli",
      cliCommand: "powershell.exe",
      model: "sonnet",
    });
    assert.equal(claude.ok, false);
    assert.equal(claude.messageKey, "setup.ai.claude.error.invalidCommand.message");
    assert.equal(fixture.settings.read().ai.mode, undefined);
  } finally {
    fixture.close();
  }
});

test("SetupWizardService verifies a Notion parent page and creates managed DBs through an injected creator", async () => {
  const retrievedPages: string[] = [];
  const fixture = createFixture({
    notionClientFactory: () => ({
      retrievePage: async (pageId: string) => {
        retrievedPages.push(pageId);
        return { id: pageId };
      },
    } as unknown as NotionClient),
    managedSchemaCreator: async (input) => {
      input.registryStore.saveManagedSchema({
        workspaceSettings: {
          locale: "ko",
          parentPageUrl,
          parentPageId,
        },
        managedDatabases: [
          managedDatabase("meeting", "회의록", "meeting-db-id", "meeting-ds-id"),
          managedDatabase("member", "작업자", "member-db-id", "member-ds-id"),
          managedDatabase("task", "할 일 목록", "task-db-id", "task-ds-id"),
        ],
        propertyMappings: allKoreanPropertyMappings(),
        nowIso: "2026-05-10T00:00:00.000Z",
      });
      return {
        locale: "ko",
        parentPageUrl,
        parentPageId,
        databases: {
          meeting: {
            role: "meeting",
            name: "회의록",
            databaseId: "meeting-db-id",
            dataSourceId: "meeting-ds-id",
            url: "https://notion.so/meeting",
          },
          member: {
            role: "member",
            name: "작업자",
            databaseId: "member-db-id",
            dataSourceId: "member-ds-id",
            url: "https://notion.so/member",
          },
          task: {
            role: "task",
            name: "할 일 목록",
            databaseId: "task-db-id",
            dataSourceId: "task-ds-id",
            url: "https://notion.so/task",
          },
        },
        propertyMappings: {
          meeting: allKoreanPropertyMappings("meeting"),
          member: allKoreanPropertyMappings("member"),
          task: allKoreanPropertyMappings("task"),
        },
      } satisfies ManagedNotionSchemaCreationResult;
    },
  });
  try {
    fixture.service.saveNotionToken({ token: "notion-secret-raw-value" });
    const parent = fixture.service.saveNotionParentPageUrl({ parentPageUrl });
    assert.equal(parent.ok, true);

    const verified = await fixture.service.verifyNotionParentPage();
    assert.equal(verified.ok, true);
    assert.deepEqual(retrievedPages, [parentPageId]);

    const created = await fixture.service.createManagedDatabases();
    const serialized = JSON.stringify(created);

    assert.equal(created.ok, true);
    assert.equal(created.setup.features.notion.managedRegistryReady, true);
    assert.doesNotMatch(serialized, /notion-secret-raw-value/);
    assert.doesNotMatch(serialized, /meeting-db-id/);
    assert.doesNotMatch(serialized, /meeting-ds-id/);
  } finally {
    fixture.close();
  }
});

test("SetupWizardService stores project-scoped Discord and Notion setup values", async () => {
  const fixture = createFixture({ withProjectStore: true });
  try {
    if (!fixture.projectStore) {
      throw new Error("expected project store");
    }
    fixture.projectStore.createDraftProject({
      id: "project-active",
      nowIso: "2026-05-10T00:00:00.000Z",
    });
    fixture.projectStore.setActiveProjectId("project-active");
    fixture.service.saveDiscordApplicationId({ applicationId: appId });
    fixture.service.saveDiscordBotToken({ botToken: "discord-secret-raw-value" });

    const guild = await fixture.service.saveDiscordGuildAllowlist({
      guildIds: [guildId],
    });
    const token = fixture.service.saveNotionToken({
      token: "notion-secret-raw-value",
    });
    const parent = fixture.service.saveNotionParentPageUrl({ parentPageUrl });

    const project = fixture.projectStore.getProject("project-active");
    assert.equal(guild.ok, true);
    assert.equal(token.ok, true);
    assert.equal(parent.ok, true);
    assert.equal(project?.guild_id, guildId);
    assert.equal(project?.guild_name, "Dirong Test Server");
    assert.equal(
      project?.notion_token_secret_ref,
      "notion.project.project-active.token",
    );
    assert.equal(project?.notion_parent_page_url, parentPageUrl);
    assert.equal(
      fixture.secrets.get("notion.project.project-active.token"),
      "notion-secret-raw-value",
    );
    assert.deepEqual(fixture.settings.read().discord.guildIds, [guildId]);
    assert.equal(
      fixture.settings.read().notion.tokenSecretRef,
      "notion.project.project-active.token",
    );
  } finally {
    fixture.close();
  }
});

test("SetupWizardService saves managed registry rows under the active project", async () => {
  const fixture = createFixture({
    withProjectStore: true,
    notionClientFactory: () => ({
      retrievePage: async (pageId: string) => ({ id: pageId }),
    } as unknown as NotionClient),
    managedSchemaCreator: async (input) => {
      input.registryStore.saveManagedSchema({
        projectId: input.projectId,
        workspaceSettings: {
          locale: "ko",
          parentPageUrl,
          parentPageId,
        },
        managedDatabases: [
          managedDatabase("meeting", "회의록", "meeting-db-id", "meeting-ds-id"),
          managedDatabase("member", "작업자", "member-db-id", "member-ds-id"),
          managedDatabase("task", "할 일 목록", "task-db-id", "task-ds-id"),
        ],
        propertyMappings: allKoreanPropertyMappings(),
        nowIso: "2026-05-10T00:00:00.000Z",
      });
      return {
        locale: "ko",
        parentPageUrl,
        parentPageId,
        databases: {
          meeting: {
            role: "meeting",
            name: "회의록",
            databaseId: "meeting-db-id",
            dataSourceId: "meeting-ds-id",
            url: "https://notion.so/meeting",
          },
          member: {
            role: "member",
            name: "작업자",
            databaseId: "member-db-id",
            dataSourceId: "member-ds-id",
            url: "https://notion.so/member",
          },
          task: {
            role: "task",
            name: "할 일 목록",
            databaseId: "task-db-id",
            dataSourceId: "task-ds-id",
            url: "https://notion.so/task",
          },
        },
        propertyMappings: {
          meeting: allKoreanPropertyMappings("meeting"),
          member: allKoreanPropertyMappings("member"),
          task: allKoreanPropertyMappings("task"),
        },
      } satisfies ManagedNotionSchemaCreationResult;
    },
  });
  try {
    if (!fixture.projectStore) {
      throw new Error("expected project store");
    }
    fixture.projectStore.createDraftProject({
      id: "project-active",
      nowIso: "2026-05-10T00:00:00.000Z",
    });
    fixture.projectStore.setActiveProjectId("project-active");
    fixture.service.saveNotionToken({ token: "notion-secret-raw-value" });
    fixture.service.saveNotionParentPageUrl({ parentPageUrl });

    const created = await fixture.service.createManagedDatabases();

    assert.equal(created.ok, true);
    assert.equal(
      fixture.registryStore.getManagedDatabase("meeting", "project-active")?.dataSourceId,
      "meeting-ds-id",
    );
    assert.equal(fixture.registryStore.getManagedDatabase("meeting"), null);
    assert.equal(created.setup.features.notion.managedRegistryReady, true);
  } finally {
    fixture.close();
  }
});

test("SetupWizardService blocks managed DB creation when registry is partial", async () => {
  const fixture = createFixture();
  try {
    fixture.service.saveNotionToken({ token: "notion-secret-raw-value" });
    fixture.service.saveNotionParentPageUrl({ parentPageUrl });
    fixture.registryStore.upsertManagedDatabase({
      role: "meeting",
      locale: "ko",
      databaseId: "meeting-db-id",
      dataSourceId: "meeting-ds-id",
      url: "https://notion.so/meeting",
      name: "회의록",
      createdByDirong: true,
      schemaVersion: NOTION_MANAGED_SCHEMA_VERSION,
      nowIso: "2026-05-10T00:00:00.000Z",
    });

    const result = await fixture.service.createManagedDatabases();

    assert.equal(result.ok, false);
    assert.equal(result.status, "blocked");
    assert.equal(
      result.messageKey,
      "setup.notion.managedDatabases.error.partialRegistry.message",
    );
    assert.equal(result.setup.features.notion.managedRegistryReady, false);
  } finally {
    fixture.close();
  }
});

function createFixture(options: {
  discordGateway?: DiscordSetupGateway;
  claudeTester?: ClaudeSetupTester;
  localWhisperInstaller?: LocalWhisperInstaller;
  openAiSttTester?: OpenAiSttConnectionTester;
  notionClientFactory?: (apiKey: string) => NotionClient;
  managedSchemaCreator?: ConstructorParameters<typeof SetupWizardService>[0]["managedSchemaCreator"];
  withProjectStore?: boolean;
} = {}): {
  service: SetupWizardService;
  settings: LocalSettingsStore;
  secrets: LocalSecretStore;
  registryStore: NotionRegistryStore;
  projectStore?: ProjectStore;
  close: () => void;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-setup-wizard-"));
  const paths = getDirongUserDataPaths(dir);
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  const runner = new SqlRunner(database);
  const registryStore = new NotionRegistryStore(runner);
  const projectStore = options.withProjectStore
    ? new ProjectStore(runner)
    : undefined;
  const settingsStore = new LocalSettingsStore(paths.settingsFile);
  const secretStore = new LocalSecretStore(paths.secretsFile);
  return {
    service: new SetupWizardService({
      paths,
      settingsStore,
      secretStore,
      registryStore,
      projectStore,
      discordGateway: options.discordGateway ?? fakeDiscordGateway(),
      claudeTester: options.claudeTester ?? fakeClaudeTester(),
      localWhisperInstaller: options.localWhisperInstaller,
      openAiSttTester: options.openAiSttTester,
      notionClientFactory: options.notionClientFactory,
      managedSchemaCreator: options.managedSchemaCreator,
      now: () => new Date("2026-05-10T00:00:00.000Z"),
    }),
    settings: settingsStore,
    secrets: secretStore,
    registryStore,
    projectStore,
    close: () => {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function fakeDiscordGateway(): DiscordSetupGateway {
  return {
    testConnection: async () => ({
      botUserId: appId,
      username: "Dirong#0001",
    }),
    listGuilds: async () => [
      {
        id: guildId,
        name: "Dirong Test Server",
        iconUrl: null,
        owner: false,
      },
      {
        id: otherGuildId,
        name: "Side Server",
        iconUrl: null,
        owner: false,
      },
    ],
  };
}

function fakeClaudeTester(): ClaudeSetupTester {
  return {
    test: async (input) => ({
      provider: "claude",
      mode: input.mode,
      model: input.model,
      detail: "ok",
    }),
  };
}

function managedDatabase(
  role: "meeting" | "member" | "task",
  name: string,
  databaseId: string,
  dataSourceId: string,
) {
  return {
    role,
    locale: "ko" as const,
    databaseId,
    dataSourceId,
    url: `https://notion.so/${role}`,
    name,
    createdByDirong: true,
    schemaVersion: NOTION_MANAGED_SCHEMA_VERSION,
  };
}

function allKoreanPropertyMappings(): ReturnType<typeof mappingBase>[];
function allKoreanPropertyMappings(
  databaseRole: NotionDatabaseRole,
): ReturnType<typeof mappingBase>[];
function allKoreanPropertyMappings(
  databaseRole?: NotionDatabaseRole,
): ReturnType<typeof mappingBase>[] {
  const roles = databaseRole
    ? [databaseRole]
    : (["meeting", "member", "task"] as const);
  return roles.flatMap((role) =>
    KOREAN_NOTION_SCHEMA_PRESET.databases[role].properties.map((property) =>
      mappingBase(role, property.key, property.name, property.type),
    ),
  );
}

function mappingBase(
  databaseRole: NotionDatabaseRole,
  semanticKey: NotionPropertySemanticKey,
  propertyName: string,
  propertyType: NotionSchemaPresetPropertyType,
) {
  return {
    databaseRole,
    semanticKey,
    propertyName,
    propertyId: `${semanticKey}-id`,
    propertyType,
    locked: true,
    sourceKind: "system" as const,
    createdAt: "2026-05-10T00:00:00.000Z",
    updatedAt: "2026-05-10T00:00:00.000Z",
  };
}
