import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  AttachmentBuilder,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
} from "discord.js";
import {
  snapshotPhase1Config,
} from "../config.js";
import { createAppLocaleResolver } from "../i18n/app-locale.js";
import { formatLocaleText, t } from "../i18n/catalog.js";
import { formatSessionStatus } from "../messages/session-status.js";
import {
  canStartAiAutomation,
  canStartDiscordRuntime,
  canStartSttAutomation,
  createProductNotionRuntimeSettingsProvider,
  createProductSetupStatusSource,
  loadProductRuntimeSettings,
} from "../settings/product-settings.js";
import { LocalSecretStore } from "../settings/local-secret-store.js";
import { LocalSettingsStore } from "../settings/local-settings-store.js";
import { SettingsResetService } from "../settings/reset-service.js";
import {
  createAiCleanupProviderFromSettings,
  type ManagedAiCleanupProvider,
} from "../ai/cleanup/provider-factory.js";
import {
  AiCleanupAutomationService,
  formatAiCleanupAutomationForStatus,
} from "../ai/cleanup/automation-service.js";
import type { AiCleanupProvider } from "../ai/cleanup/provider.js";
import {
  AiProviderLifecycleService,
  formatAiReadinessForStatus,
} from "../ai/cleanup/provider-lifecycle-service.js";
import { wrapAiCleanupProviderWithLifecycle } from "../ai/cleanup/provider-lifecycle.js";
import { DashboardServer } from "../dashboard/server.js";
import { evaluateActiveProjectCommandGate } from "../discord/active-project-command-gate.js";
import { phase1GuildCommandPayloads } from "../discord/commands.js";
import { createProductSetupWizardService } from "../setup/wizard-service.js";
import {
  redactForJson,
  safeErrorInfo,
  toLocalizedErrorMessage,
} from "../errors.js";
import { printCliError } from "../cli/error-output.js";
import {
  AloneFinalizeService,
  formatAloneFinalizeForStatus,
  type AloneFinalizeMemberCountResult,
} from "../recording/alone-finalize-service.js";
import {
  NotionAutomationService,
  formatNotionAutomationForStatus,
} from "../notion/automation-service.js";
import { createNotionClient, type NotionClient } from "../notion/client.js";
import type { NotionRuntimeSettings } from "../notion/settings.js";
import { NotionDashboardService } from "../notion/dashboard-service.js";
import { NotionDraftInputReadModel } from "../notion/draft-input-read-model.js";
import type { NotionUploadRetentionHandler } from "../notion/upload-retention.js";
import {
  buildNotionCustomPropertyPrompt,
  NotionCustomPropertyRuleStore,
} from "../notion/property-rules.js";
import {
  buildNotionMemberRosterPrompt,
  NotionMemberRosterStore,
} from "../notion/member-roster-store.js";
import { NotionRegistryStore } from "../notion/registry-store.js";
import { NotionWriteStore } from "../notion/write-store.js";
import {
  DEFAULT_PROJECT_ID,
  type DirongProjectRow,
} from "../projects/project-types.js";
import { ActiveProjectService } from "../projects/active-project-service.js";
import { ProjectStore } from "../projects/project-store.js";
import { RecordingProducer } from "../recording/recording-producer.js";
import { runStartupRepair } from "../storage/repair-scan.js";
import {
  DEFAULT_RETENTION_POLICY,
  buildRetentionDeletionPlan,
  executeRetentionDeletionPlan,
  type RetentionDeletionExecutionResult,
  type RetentionPolicy,
} from "../storage/file-retention.js";
import {
  createStorageContext,
  flattenStorageContext,
} from "../storage/storage-context.js";
import { SqlRunner } from "../storage/sql-runner.js";
import { DirongDatabase } from "../storage/sqlite.js";
import { RetentionAutomationService } from "../storage/retention-automation-service.js";
import {
  SttAutomationService,
  formatSttAutomationForStatus,
} from "../stt/automation-service.js";
import { createPhase3SttProvider } from "../stt/provider-factory.js";
import type { SttProvider } from "../stt/provider.js";
import { backupDatabaseSnapshot } from "../storage/sqlite-backup.js";
import { RETENTION_SWEEP_INTERVAL_MS } from "../settings/defaults.js";

const productRuntime = loadProductRuntimeSettings();
const resolveAppLocale = createAppLocaleResolver({
  getLocale: () => productRuntime.setupStatus.getLocale(),
});
const config = productRuntime.config;
const appSettings = productRuntime.appSettings;
const DIRONG_DISCORD_IMAGE_PATH = fileURLToPath(
  new URL("../assets/dirong/dirong_discord.png", import.meta.url),
);

const database = new DirongDatabase(config.dbPath, config.dbBusyTimeoutMs);
const notionSqlRunner = new SqlRunner(database);
const projectStore = new ProjectStore(notionSqlRunner);
projectStore.backfillDefaultProjectFromLegacySettings({
  settings: productRuntime.localSettings,
});
const ctx = createStorageContext(database, {
  storageRoot: config.dataDir,
  normalizeStoredPaths: true,
});
const store = flattenStorageContext(ctx);
let repairSummary;
try {
  repairSummary = await runStartupRepair(ctx, config);
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error("startup repair failed:", errorMessage);
  store.recordConnectionEvent({
    sessionId: null,
    eventType: "startup_repair_failed",
    level: "error",
    details: { error: errorMessage },
  });
  // D-08: continue boot; repair is a helper, not a critical path.
  repairSummary = {
    oldPartFiles: 0,
    staleWritingChunksRepaired: 0,
    staleWritingChunksFailed: 0,
    missingSttJobsCreated: 0,
    missingAudioJobsFailed: 0,
    expiredLeasesReleased: 0,
    orphanAudioFiles: 0,
  };
}
const sttProviderSelection = createPhase3SttProvider(appSettings.stt);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const producer = new RecordingProducer(client, config, store, {
  localeResolver: resolveAppLocale,
});
// 자동 retention 정리와 Notion 업로드 후 audio 삭제 경로가 매번 최신 보관 설정을
// 읽도록 전용 settingsStore 인스턴스를 둔다(currentRetentionPolicy가 참조).
const retentionSettingsStore = new LocalSettingsStore(
  productRuntime.paths.settingsFile,
);
const aloneFinalize = createAloneFinalizeService();
const sttAutomation = createSttAutomationService(
  sttProviderSelection.provider,
  sttProviderSelection.settings.language,
  sttProviderSelection.settings.timeoutMs,
);
const notionPropertyRuleStore = new NotionCustomPropertyRuleStore(notionSqlRunner);
const notionRegistryStore = new NotionRegistryStore(notionSqlRunner);
const notionMemberRosterStore = new NotionMemberRosterStore(notionSqlRunner);
const getNotionRuntimeSettings = createProductNotionRuntimeSettingsProvider({
  paths: productRuntime.paths,
  projectStore,
});
const setupStatus = createProductSetupStatusSource({
  paths: productRuntime.paths,
  registryStore: notionRegistryStore,
  projectStore,
});
const setupWizard = createProductSetupWizardService({
  paths: productRuntime.paths,
  registryStore: notionRegistryStore,
  projectStore,
});
const aiCleanupProvider = createAiCleanupProvider();
// RELY-01: SIGKILL any orphan claude PIDs on parent exit. Sync handler —
// no await allowed. Quiet on failure inside reapTrackedPids() per D-04;
// the DB writer may already be torn down at this point.
process.on("exit", () => {
  sttProviderSelection.provider.reapTrackedPids?.();
  aiCleanupProvider.reapTrackedPids?.();
});
const aiLifecycle = createAiLifecycleService(aiCleanupProvider);
const aiCleanupAutomation = createAiCleanupAutomationService(
  aiCleanupProvider,
  aiLifecycle,
);
const notionUploadRetention = createNotionUploadRetentionHandler();
const notionDashboard = new NotionDashboardService({
  settings: appSettings.notion,
  getSettings: getNotionRuntimeSettings,
  getProjectId: () => projectStore.getActiveProjectId() ?? DEFAULT_PROJECT_ID,
  database,
  config,
  workerId: `phase5-notion-dashboard-${process.pid}`,
  retention: notionUploadRetention,
  localeResolver: resolveAppLocale,
});
const notionAutomation = createNotionAutomationService(notionSqlRunner);
const retentionAutomation = new RetentionAutomationService({
  database,
  storageRoot: config.dataDir,
  getRetentionPolicy: () => currentRetentionPolicy(),
  intervalMs: RETENTION_SWEEP_INTERVAL_MS,
  isRecording: () => producer.getRuntimeState().isRecording,
  localeResolver: resolveAppLocale,
});
const activeProjectService = new ActiveProjectService({
  projectStore,
  getRecordingRuntimeState: () => producer.getRuntimeState(),
  getNotionAutomationSnapshot: () => notionAutomation.getSnapshot(resolveAppLocale()),
  getAiCleanupAutomationSnapshot: () => aiCleanupAutomation.getSnapshot(resolveAppLocale()),
});
const settingsReset = new SettingsResetService({
  settingsStore: new LocalSettingsStore(productRuntime.paths.settingsFile),
  secretStore: new LocalSecretStore(productRuntime.paths.secretsFile),
  projectStore,
  registryStore: notionRegistryStore,
  memberRosterStore: notionMemberRosterStore,
  customPropertyRuleStore: notionPropertyRuleStore,
  writeStore: new NotionWriteStore(notionSqlRunner),
  setupStatus,
  getRecordingRuntimeState: () => producer.getRuntimeState(),
  getNotionAutomationSnapshot: () => notionAutomation.getSnapshot(resolveAppLocale()),
  getAiCleanupAutomationSnapshot: () => aiCleanupAutomation.getSnapshot(resolveAppLocale()),
  stopNotionAutomation: () => notionAutomation.stop(),
  startNotionAutomation: () => notionAutomation.start(),
  runNotionAutomationOnce: () => notionAutomation.runOnce(),
  stopAiCleanupAutomation: () => aiCleanupAutomation.stop(),
  stopAiLifecycle: () => aiLifecycle.stop(),
  notionDashboard,
});
const dashboard = new DashboardServer(config, store, producer, {
  aiReadiness: aiLifecycle,
  aiCleanupAutomation,
  aloneFinalize,
  notion: notionDashboard,
  notionAutomation,
  projects: {
    listProjects: () => projectStore.listProjects(),
    getActiveProject: () => projectStore.getActiveProject(),
    createDraftProject: async (input = {}) => {
      const reuseEmptyDraft = input.reuseEmptyDraft ?? true;
      const reusable = reuseEmptyDraft
        ? findReusableDraftProject(projectStore.listProjects())
        : null;
      const project = reusable
        ? input.name
          ? projectStore.updateProjectName({
              projectId: reusable.id,
              name: input.name,
            })
          : reusable
        : projectStore.createDraftProject({
            name: input.name,
          });
      const shouldActivate = input.activate ?? true;
      return {
        project,
        reused: Boolean(reusable),
        switchResult: shouldActivate
          ? await activeProjectService.switchActiveProject(project.id)
          : undefined,
      };
    },
    switchActiveProject: (projectId) =>
      activeProjectService.switchActiveProject(projectId),
  },
  setupStatus,
  setupWizard,
  settingsReset,
  sttAutomation,
});
const dashboardUrl = await startDashboardOrExit();
const initialSetupStatus = setupStatus.getSnapshot();
let shutdownPromise: Promise<void> | null = null;
let consoleReadline: ReadlineInterface | null = null;

console.log(formatLocaleText(resolveAppLocale(), "runtimeCli.main.dashboardStarted", {
  url: dashboardUrl,
}));
console.log(formatLocaleText(resolveAppLocale(), "runtimeCli.main.setupStatusApi", {
  url: `${dashboardUrl}api/setup/status`,
}));
const reconciledTotal =
  repairSummary.oldPartFiles +
  repairSummary.staleWritingChunksRepaired +
  repairSummary.staleWritingChunksFailed +
  repairSummary.missingSttJobsCreated +
  repairSummary.missingAudioJobsFailed +
  repairSummary.expiredLeasesReleased +
  repairSummary.orphanAudioFiles;

console.log(`startup repair: ${reconciledTotal} items reconciled`);
if (reconciledTotal > 0) {
  console.log(`  oldPartFiles: ${repairSummary.oldPartFiles}`);
  console.log(`  staleWritingChunksRepaired: ${repairSummary.staleWritingChunksRepaired}`);
  console.log(`  staleWritingChunksFailed: ${repairSummary.staleWritingChunksFailed}`);
  console.log(`  missingSttJobsCreated: ${repairSummary.missingSttJobsCreated}`);
  console.log(`  missingAudioJobsFailed: ${repairSummary.missingAudioJobsFailed}`);
  console.log(`  expiredLeasesReleased: ${repairSummary.expiredLeasesReleased}`);
  console.log(`  orphanAudioFiles: ${repairSummary.orphanAudioFiles}`);
}
if (config.openDashboard) {
  openDashboardUrl(dashboardUrl);
}

if (canStartSttAutomation(initialSetupStatus)) {
  void startSttAutomation();
} else {
  console.log(formatLocaleText(resolveAppLocale(), "runtimeCli.main.sttAutomationSkipped", {
    message: initialSetupStatus.features.stt.message,
  }));
}
if (canStartAiAutomation(initialSetupStatus)) {
  startAiPrepareInBackground();
  startAiCleanupAutomation();
} else {
  console.log(formatLocaleText(resolveAppLocale(), "runtimeCli.main.aiCleanupAutomationSkipped", {
    message: initialSetupStatus.features.ai.message,
  }));
}
startNotionAutomation();
retentionAutomation.start();
console.log(t(resolveAppLocale(), "runtimeCli.main.retentionAutomationStarted"));
if (canStartDiscordRuntime(initialSetupStatus)) {
  startAloneFinalizeService();
} else {
  console.log(formatLocaleText(resolveAppLocale(), "runtimeCli.main.discordLoginSkipped", {
    message: initialSetupStatus.features.discord.message,
  }));
  console.log(initialSetupStatus.features.discord.userAction);
  console.log(t(resolveAppLocale(), "runtimeCli.main.dashboardStillOpen"));
  startConsoleCommands();
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(formatLocaleText(resolveAppLocale(), "runtimeCli.main.botLoginDone", {
    tag: readyClient.user.tag,
  }));
  console.log(t(resolveAppLocale(), "runtimeCli.main.configSummary"), JSON.stringify(redactForJson(snapshotPhase1Config(config)), null, 2));

  if (config.autoRegisterCommands) {
    try {
      await registerCommands();
    } catch (error) {
      printCliError(error, {
        prefix: t(resolveAppLocale(), "runtimeCli.main.slashCommandAutoRegisterFailed"),
      });
    }
  }

  console.log("");
  console.log(t(resolveAppLocale(), "runtimeCli.main.discordCommandsAvailable"));
  console.log(t(resolveAppLocale(), "runtimeCli.main.consoleCommandsAvailable"));
  startConsoleCommands();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }
  if (interaction.commandName !== "dirong") {
    return;
  }

  await handleDirongCommand(interaction);
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  void aloneFinalize.handleVoiceStateUpdate(oldState, newState);
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("unhandledRejection", (error) => {
  printCliError(error, { prefix: t(resolveAppLocale(), "runtimeCli.main.unhandledRejection") });
});

process.on("uncaughtException", (error) => {
  printCliError(error, { prefix: t(resolveAppLocale(), "runtimeCli.main.uncaughtException") });
  void shutdown("uncaughtException").finally(() => process.exit(1));
});

if (canStartDiscordRuntime(initialSetupStatus)) {
  try {
    await client.login(config.discordBotToken);
  } catch (error) {
    printCliError(error);
    await shutdown("login_failed");
    process.exit(1);
  }
}

async function startDashboardOrExit(): Promise<string> {
  try {
    return await dashboard.start();
  } catch (error) {
    printCliError(error, { prefix: t(resolveAppLocale(), "runtimeCli.main.dashboardStartFailed") });
    try {
      await dashboard.stop();
    } catch {
      // Best-effort cleanup before exiting the top-level startup path.
    }
    try {
      store.close();
    } catch {
      // Best-effort cleanup before exiting the top-level startup path.
    }
    process.exit(1);
  }
}

async function registerCommands(): Promise<void> {
  let successCount = 0;
  const guildIds = resolveCommandRegistrationGuildIds();
  if (guildIds.length === 0) {
    console.log(t(resolveAppLocale(), "runtimeCli.main.noActiveProjectGuild"));
    return;
  }
  for (const guildId of guildIds) {
    try {
      const guild = await client.guilds.fetch(guildId);
      await guild.commands.set(phase1GuildCommandPayloads);
      successCount += 1;
      console.log(formatLocaleText(resolveAppLocale(), "runtimeCli.main.guildCommandRegistered", {
        name: guild.name,
        id: guild.id,
      }));
    } catch (error) {
      printCliError(error, {
        prefix: formatLocaleText(resolveAppLocale(), "runtimeCli.main.guildCommandRegisterFailed", {
          guildId,
        }),
      });
    }
  }
  if (successCount === 0) {
    throw new Error(t(resolveAppLocale(), "runtimeCli.main.noSlashCommandRegistered"));
  }
  console.log(t(resolveAppLocale(), "runtimeCli.main.shortCommandsAvailable"));
}

async function handleDirongCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const locale = resolveAppLocale();
  if (!interaction.guildId) {
    await interaction.reply({
      content: t(locale, "discordRuntime.serverOnly"),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const gate = evaluateActiveProjectCommandGate({
    guildId: interaction.guildId,
    legacyGuildIds: config.guildIds,
    activeProject: projectStore.getActiveProject(),
    hasProjectData: projectStore.listProjects().length > 0,
  });
  if (!gate.ok) {
    await interaction.reply({
      content: t(locale, "discordRuntime.guildNotAllowed"),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "start") {
      const guild = await interaction.guild?.fetch();
      if (!guild) {
        throw new Error(t(locale, "runtimeCli.main.guildFetchFailed"));
      }

      const member = await guild.members.fetch(interaction.user.id);
      const voiceChannel = member.voice.channel;
      if (!voiceChannel) {
        await interaction.editReply(
          t(locale, "discordRuntime.noVoiceChannel"),
        );
        return;
      }

      const result = await producer.start({
        guild,
        voiceChannel,
        projectId: gate.projectId,
        textChannelId: interaction.channelId,
        startedByUserId: interaction.user.id,
        startedByDisplayName: displayNameForMember(member),
      });

      await sendPublicNotice(interaction, [
        t(locale, "discordRuntime.startPublicTitle"),
        t(locale, "discordRuntime.privacyAudioLocalDeleteAfterNotion"),
        t(locale, "discordRuntime.textRetentionDefault"),
        t(locale, "discordRuntime.optOut"),
        formatLocaleText(locale, "discordRuntime.startedBy", {
          name: displayNameForMember(member),
        }),
        formatLocaleText(locale, "discordRuntime.sessionId", {
          sessionId: result.sessionId,
        }),
      ].join("\n"), { attachDirongImage: true });

      await interaction.editReply(
        [
          t(locale, "discordRuntime.startConfirmation"),
          formatLocaleText(locale, "discordRuntime.session", {
            sessionId: result.sessionId,
          }),
          formatLocaleText(locale, "discordRuntime.voiceChannel", {
            channel: voiceChannel.name,
          }),
          formatLocaleText(locale, "discordRuntime.dashboard", {
            url: dashboard.getUrl(),
          }),
        ].join("\n"),
      );
      return;
    }

    if (subcommand === "stop") {
      const guild = await interaction.guild?.fetch();
      const member = guild
        ? await guild.members.fetch(interaction.user.id)
        : null;
      const stoppedByDisplayName = member
        ? displayNameForMember(member)
        : interaction.user.globalName ?? interaction.user.username;
      const result = await producer.stop({
        stoppedByUserId: interaction.user.id,
        stoppedByDisplayName,
      });

      await sendPublicNotice(interaction, [
        t(locale, "discordRuntime.stopPublicTitle"),
        formatLocaleText(locale, "discordRuntime.sessionId", {
          sessionId: result.sessionId,
        }),
        formatLocaleText(locale, "discordRuntime.status", {
          status: formatSessionStatus(locale, result.status),
        }),
      ].join("\n"));

      await interaction.editReply(
        [
          t(locale, "discordRuntime.stopConfirmation"),
          formatLocaleText(locale, "discordRuntime.session", {
            sessionId: result.sessionId,
          }),
          formatLocaleText(locale, "discordRuntime.status", {
            status: formatSessionStatus(locale, result.status),
          }),
          formatLocaleText(locale, "discordRuntime.dashboard", {
            url: dashboard.getUrl(),
          }),
        ].join("\n"),
      );
      return;
    }

    if (subcommand === "status") {
      await interaction.editReply(statusTextWithAiReadiness(locale));
      return;
    }

    await interaction.editReply(t(locale, "discordRuntime.unknownSubcommand"));
  } catch (error) {
    await interaction.editReply(toLocalizedErrorMessage(error, locale));
    printCliError(error, { prefix: t(locale, "runtimeCli.main.slashCommandHandleFailed") });
  }
}

function resolveCommandRegistrationGuildIds(): string[] {
  const activeProject = projectStore.getActiveProject();
  if (activeProject) {
    return activeProject.command_enabled === 1 && activeProject.guild_id
      ? [activeProject.guild_id]
      : [];
  }
  return config.guildIds;
}

function startConsoleCommands(): void {
  if (consoleReadline) {
    return;
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  consoleReadline = readline;

  readline.on("line", (line) => {
    const command = line.trim().toLowerCase();
    void handleConsoleCommand(command);
  });
  readline.on("close", () => {
    if (consoleReadline === readline) {
      consoleReadline = null;
    }
  });
}

function stopConsoleCommands(): void {
  const readline = consoleReadline;
  if (!readline) {
    return;
  }

  consoleReadline = null;
  readline.removeAllListeners("line");
  readline.close();
}

async function handleConsoleCommand(command: string): Promise<void> {
  try {
    if (command === "status") {
      console.log(statusTextWithAiReadiness());
      return;
    }

    if (command === "stop") {
      const result = await producer.stop({
        stoppedByUserId: "console",
        stoppedByDisplayName: "console",
      });
      console.log(formatLocaleText(resolveAppLocale(), "runtimeCli.main.recordingStopped", {
        sessionId: result.sessionId,
        status: result.status,
      }));
      return;
    }

    if (command === "exit" || command === "quit") {
      await shutdown("console_exit");
      process.exit(0);
    }

    if (command.length > 0) {
      console.log(t(resolveAppLocale(), "runtimeCli.main.consoleCommandsAvailableShort"));
    }
  } catch (error) {
    printCliError(error);
  }
}

async function shutdown(reason: string): Promise<void> {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    console.log(formatLocaleText(resolveAppLocale(), "runtimeCli.main.shutdownProcessing", {
      reason,
    }));
    stopConsoleCommands();
    await aloneFinalize.stop();
    await producer.shutdown();
    try {
      await sttAutomation.stop();
    } catch (error) {
      printCliError(error, { prefix: t(resolveAppLocale(), "runtimeCli.main.sttAutomationStopFailed") });
    }
    try {
      await aiCleanupAutomation.stop();
    } catch (error) {
      printCliError(error, { prefix: t(resolveAppLocale(), "runtimeCli.main.aiCleanupAutomationStopFailed") });
    }
    try {
      await notionAutomation.stop();
    } catch (error) {
      printCliError(error, { prefix: t(resolveAppLocale(), "runtimeCli.main.notionAutomationStopFailed") });
    }
    try {
      await retentionAutomation.stop();
    } catch (error) {
      printCliError(error, { prefix: t(resolveAppLocale(), "runtimeCli.main.retentionAutomationStopFailed") });
    }
    try {
      await aiLifecycle.stop();
    } catch (error) {
      printCliError(error, { prefix: t(resolveAppLocale(), "runtimeCli.main.aiLifecycleStopFailed") });
    }
    await dashboard.stop();
    client.destroy();
    store.close();
  })();

  return shutdownPromise;
}

function createAloneFinalizeService(): AloneFinalizeService {
  return new AloneFinalizeService({
    enabled: config.aloneFinalizeEnabled,
    graceMs: config.aloneFinalizeGraceMs,
    store,
    producer,
    countNonBotMembers: countNonBotVoiceMembers,
    localeResolver: resolveAppLocale,
  });
}

function createAiCleanupProvider(): ManagedAiCleanupProvider {
  return createAiCleanupProviderFromSettings(appSettings.aiCleanup, {
    // RELY-01 / D-04: stop()-path orphan-reap failure surface. Structured
    // event so the operator sees a non-zero counter in the dashboard.
    onClaudeOrphanKillFailed: ({ pid, errno }) => {
      ctx.writes.recordConnectionEvent({
        sessionId: null,
        eventType: "claude_orphan_kill_failed",
        level: "warn",
        details: { pid, errno },
      });
    },
  });
}

function createSttAutomationService(
  provider: SttProvider,
  language: string | null,
  timeoutMs: number,
): SttAutomationService {
  return new SttAutomationService(store, {
    enabled: true,
    provider,
    pollIntervalMs: 5000,
    batchLimit: 1,
    runner: {
      workerId: `phase3-stt-auto-${provider.providerName}-${process.pid}`,
      leaseMs: config.sttLeaseMs,
      language,
      timeoutMs,
      contextSegments: 2,
    },
    localeResolver: resolveAppLocale,
  });
}

function createAiLifecycleService(
  provider: AiCleanupProvider,
): AiProviderLifecycleService {
  return new AiProviderLifecycleService(
    wrapAiCleanupProviderWithLifecycle(provider),
    {
      prepareTimeoutMs: appSettings.aiCleanup.prepareTimeoutMs,
      localeResolver: resolveAppLocale,
    },
  );
}

function createAiCleanupAutomationService(
  provider: AiCleanupProvider,
  lifecycle: AiProviderLifecycleService,
): AiCleanupAutomationService {
  return new AiCleanupAutomationService(store, {
    enabled: appSettings.aiCleanup.autoCleanupEnabled,
    provider,
    lifecycle,
    pollIntervalMs: appSettings.aiCleanup.autoCleanupPollMs,
    sessionBatchLimit: appSettings.aiCleanup.autoCleanupSessionBatchLimit,
    readinessRetryMs: appSettings.aiCleanup.readinessRetryMs,
    runner: {
      workerId: `phase4-ai-auto-${provider.providerName}-${process.pid}`,
      leaseMs: appSettings.aiCleanup.leaseMs ?? config.sttLeaseMs,
      maxAttempts: appSettings.aiCleanup.maxAttempts,
      maxInputChars: appSettings.aiCleanup.maxInputChars,
      timeoutMs: appSettings.aiCleanup.timeoutMs,
      maxOutputBytes: appSettings.aiCleanup.maxOutputBytes,
      customNotionPropertyPrompt: (context) =>
        buildNotionCustomPropertyPrompt(
          notionPropertyRuleStore.listEnabledRules(
            "meeting",
            context.projectId ?? undefined,
          ),
        ),
      memberRosterPrompt: (context) =>
        buildNotionMemberRosterPrompt(
          notionMemberRosterStore.listLatestForPrompt(
            100,
            context.projectId ?? undefined,
          ),
        ),
      backup: () =>
        backupDatabaseSnapshot(config.dbPath, {
          busyTimeoutMs: config.dbBusyTimeoutMs,
        }),
    },
    localeResolver: resolveAppLocale,
  });
}

function createNotionAutomationService(
  runner: SqlRunner,
): NotionAutomationService {
  const settings = getNotionRuntimeSettings();
  return new NotionAutomationService({
    settings,
    getSettings: getNotionRuntimeSettings,
    client: createNotionClientForSettings(settings),
    getClient: createNotionClientForSettings,
    readModel: new NotionDraftInputReadModel(runner),
    writeStore: new NotionWriteStore(runner),
    pollIntervalMs: settings.autoPollMs,
    batchLimit: 1,
    workerId: `phase5-notion-auto-${process.pid}`,
    leaseMs: settings.leaseMs || config.sttLeaseMs,
    getProjectId: () => projectStore.getActiveProjectId() ?? DEFAULT_PROJECT_ID,
    getAutomaticUploadAfter: (projectId) =>
      projectStore.getUploadScope(projectId)?.automatic_upload_after ?? null,
    registryStore: new NotionRegistryStore(runner),
    memberRosterStore: new NotionMemberRosterStore(runner),
    customPropertyRules: () =>
      notionPropertyRuleStore.listEnabledRules(
        "meeting",
        projectStore.getActiveProjectId() ?? DEFAULT_PROJECT_ID,
      ),
    retention: notionUploadRetention,
    localeResolver: resolveAppLocale,
  });
}

function findReusableDraftProject(
  projects: readonly DirongProjectRow[],
): DirongProjectRow | null {
  return projects.find((project) =>
    project.lifecycle_status === "draft" &&
    project.archived_at === null &&
    project.guild_id === null &&
    project.notion_token_secret_ref === null &&
    project.notion_parent_page_url === null
  ) ?? null;
}

function createNotionClientForSettings(
  settings: NotionRuntimeSettings,
): NotionClient | null {
  return settings.apiKey
    ? createNotionClient({
        apiKey: settings.apiKey,
        apiVersion: settings.apiVersion,
        baseUrl: settings.baseUrl,
        requestTimeoutMs: settings.requestTimeoutMs,
      })
    : null;
}

function createNotionUploadRetentionHandler(): NotionUploadRetentionHandler {
  const policy = currentRetentionPolicy();
  return (result) => {
    if (!result.sessionId) {
      return;
    }
    const plan = buildRetentionDeletionPlan({
      database,
      storageRoot: config.dataDir,
      sessionId: result.sessionId,
      policy,
      reason: "notion-upload-success",
    });
    const execution = executeRetentionDeletionPlan(plan);
    logRetentionExecution(execution);
    if (execution.failed > 0) {
      throw new Error(formatRetentionFailure(execution));
    }
  };
}

function currentRetentionPolicy(): RetentionPolicy {
  // settingsStore에서 매번 다시 읽어야 사용자가 설정 화면에서 바꾼 보관 일수가
  // 자동 정리 스케줄러와 Notion 업로드 후 audio 삭제 경로에 반영된다.
  // 부팅 시점 스냅샷(productRuntime.localSettings)에 고정하면 변경이 무시된다.
  const retention = retentionSettingsStore.read().retention;
  return {
    deleteAudioAfterNotionUpload:
      retention.deleteAudioAfterNotionUpload ??
      DEFAULT_RETENTION_POLICY.deleteAudioAfterNotionUpload,
    textDraftRetentionDays:
      retention.textDraftRetentionDays ??
      DEFAULT_RETENTION_POLICY.textDraftRetentionDays,
  };
}

function logRetentionExecution(
  execution: RetentionDeletionExecutionResult,
): void {
  if (execution.results.length === 0) {
    return;
  }
  for (const result of execution.results) {
    console.log(
      [
        "retention",
        `session=${result.target.sessionId}`,
        `source=${result.target.sourceTable}:${result.target.sourceId}`,
        `kind=${result.target.kind}`,
        `status=${result.status}`,
        `path=${result.target.resolvedPath ?? result.target.path}`,
      ].join(" / "),
    );
  }
}

function formatRetentionFailure(
  execution: RetentionDeletionExecutionResult,
): string {
  return execution.results
    .filter((result) => result.status === "failed")
    .map((result) =>
      [
        `Failed to delete retention file`,
        `session=${result.target.sessionId}`,
        `kind=${result.target.kind}`,
        `path=${result.target.resolvedPath ?? result.target.path}`,
        `error=${result.error ?? "unknown"}`,
      ].join(" / "),
    )
    .join("\n");
}

function startAiPrepareInBackground(): void {
  const snapshot = aiLifecycle.getSnapshot();
  console.log(formatLocaleText(resolveAppLocale(), "runtimeCli.main.aiPreparing", {
    provider: snapshot.provider,
    model: snapshot.model,
  }));
  console.log(t(resolveAppLocale(), "runtimeCli.main.recordingCanStart"));

  void aiLifecycle.startPrepareInBackground().then((readiness) => {
    console.log(formatLocaleText(resolveAppLocale(), "runtimeCli.main.aiStatus", {
      message: readiness.message,
    }));
    if (readiness.userAction) {
      console.log(readiness.userAction);
    }
  });
}

async function startSttAutomation(): Promise<void> {
  const snapshot = sttAutomation.getSnapshot();
  if (!snapshot.enabled) {
    console.log(t(resolveAppLocale(), "runtimeCli.main.sttAutomationDisabled"));
    return;
  }
  const readiness = await sttAutomation.prepare();
  if (readiness.status === "failed") {
    console.log(formatSttAutomationForStatus(readiness, resolveAppLocale()));
    return;
  }
  sttAutomation.start();
  console.log(t(resolveAppLocale(), "runtimeCli.main.sttAutomationStarted"));
}

function startAiCleanupAutomation(): void {
  const snapshot = aiCleanupAutomation.getSnapshot();
  if (!snapshot.enabled) {
    console.log(t(resolveAppLocale(), "runtimeCli.main.aiCleanupAutomationDisabled"));
    return;
  }
  aiCleanupAutomation.start();
  console.log(t(resolveAppLocale(), "runtimeCli.main.aiCleanupAutomationStarted"));
}

function startNotionAutomation(): void {
  const snapshot = notionAutomation.getSnapshot();
  notionAutomation.start();
  if (snapshot.status === "idle") {
    console.log(t(resolveAppLocale(), "runtimeCli.main.notionAutomationStarted"));
    return;
  }
  console.log(formatLocaleText(resolveAppLocale(), "runtimeCli.main.notionAutomationWatchStarted", {
    message: snapshot.message,
  }));
  console.log(t(resolveAppLocale(), "runtimeCli.main.notionSettingsApplyNextTick"));
}

function startAloneFinalizeService(): void {
  if (!config.aloneFinalizeEnabled) {
    console.log(t(resolveAppLocale(), "runtimeCli.main.aloneFinalizeDisabled"));
    return;
  }
  aloneFinalize.start();
  console.log(formatLocaleText(resolveAppLocale(), "runtimeCli.main.aloneFinalizeStarted", {
    graceMs: config.aloneFinalizeGraceMs,
  }));
}

function statusTextWithAiReadiness(locale = resolveAppLocale()): string {
  return [
    store.statusText(producer.getRuntimeState(), dashboard.getUrl(), locale),
    "",
    formatAloneFinalizeForStatus(aloneFinalize.getSnapshot(locale), locale),
    "",
    formatSttAutomationForStatus(sttAutomation.getSnapshot(locale), locale),
    "",
    formatAiReadinessForStatus(aiLifecycle.getSnapshot(locale), locale),
    "",
    formatAiCleanupAutomationForStatus(aiCleanupAutomation.getSnapshot(locale), locale),
    "",
    formatNotionAutomationForStatus(notionAutomation.getSnapshot(locale), locale),
  ].join("\n");
}

async function countNonBotVoiceMembers(
  voiceChannelId: string,
): Promise<AloneFinalizeMemberCountResult> {
  try {
    const runtime = producer.getRuntimeState();
    const guildId = runtime.guildId ?? config.guildId;
    if (!guildId) {
      return {
        ok: false,
        reason: "guild_unavailable",
        technicalDetail: t(resolveAppLocale(), "runtimeCli.main.activeGuildMissingDetail"),
      };
    }
    const guild =
      client.guilds.cache.get(guildId) ??
      await client.guilds.fetch(guildId);
    const channel =
      guild.channels.cache.get(voiceChannelId) ??
      await guild.channels.fetch(voiceChannelId);
    if (!channel || !("members" in channel)) {
      return {
        ok: false,
        reason: "voice_channel_unavailable",
        technicalDetail: formatLocaleText(resolveAppLocale(), "runtimeCli.main.voiceChannelMissingDetail", {
          voiceChannelId,
        }),
      };
    }

    const members = (channel as {
      members?: { size: number; values(): IterableIterator<GuildMember> };
    }).members;
    if (!members || members.size === 0) {
      return {
        ok: false,
        reason: "voice_member_cache_empty",
        technicalDetail: t(resolveAppLocale(), "runtimeCli.main.voiceMemberCacheEmptyDetail"),
      };
    }

    let nonBotMemberCount = 0;
    let botMemberCount = 0;
    for (const member of members.values()) {
      if (member.user.bot) {
        botMemberCount += 1;
      } else {
        nonBotMemberCount += 1;
      }
    }

    return {
      ok: true,
      nonBotMemberCount,
      botMemberCount,
      totalMemberCount: members.size,
      source: "discord_voice_member_cache",
    };
  } catch (error) {
    return {
      ok: false,
      reason: "voice_member_count_failed",
      technicalDetail: JSON.stringify(safeErrorInfo(error)),
    };
  }
}

function displayNameForMember(member: GuildMember): string {
  return member.displayName || member.user.globalName || member.user.username;
}

async function sendPublicNotice(
  interaction: ChatInputCommandInteraction,
  content: string,
  options: { attachDirongImage?: boolean } = {},
): Promise<void> {
  const channel = interaction.channel;
  if (!channel || !("send" in channel) || typeof channel.send !== "function") {
    return;
  }
  const files =
    options.attachDirongImage && existsSync(DIRONG_DISCORD_IMAGE_PATH)
      ? [
          new AttachmentBuilder(DIRONG_DISCORD_IMAGE_PATH, {
            name: "dirong_discord.png",
          }),
        ]
      : undefined;
  await channel.send({ content, ...(files ? { files } : {}) });
}

function openDashboardUrl(url: string): void {
  const command =
    process.platform === "win32"
      ? "cmd"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  const args =
    process.platform === "win32"
      ? ["/c", "start", "", url]
      : [url];

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}
