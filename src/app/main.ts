import { spawn } from "node:child_process";
import process from "node:process";
import { createInterface } from "node:readline";
import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
} from "discord.js";
import {
  loadPhase1Config,
  snapshotPhase1Config,
} from "../config.js";
import { loadAppSettingsFromEnv } from "../settings/env-settings-loader.js";
import {
  readBooleanEnv,
  readPositiveNumberEnv,
} from "../settings/env-readers.js";
import { ClaudeStreamJsonCliCleanupProvider } from "../ai/cleanup/claude-persistent-cli-provider.js";
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
import { phase1GuildCommandPayloads } from "../discord/commands.js";
import {
  redactForJson,
  safeErrorInfo,
  toKoreanErrorMessage,
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
import { createNotionClient } from "../notion/client.js";
import { NotionDashboardService } from "../notion/dashboard-service.js";
import { NotionDraftInputReadModel } from "../notion/draft-input-read-model.js";
import {
  buildNotionCustomPropertyPrompt,
  NotionCustomPropertyRuleStore,
} from "../notion/property-rules.js";
import { NotionWriteStore } from "../notion/write-store.js";
import { RecordingProducer } from "../recording/recording-producer.js";
import { runStartupRepair } from "../storage/repair-scan.js";
import { SessionStore } from "../storage/session-store.js";
import { SqlRunner } from "../storage/sql-runner.js";
import { DirongDatabase } from "../storage/sqlite.js";
import {
  SttAutomationService,
  formatSttAutomationForStatus,
} from "../stt/automation-service.js";
import { createPhase3SttProvider } from "../stt/provider-factory.js";
import type { SttProvider } from "../stt/provider.js";
import { backupDatabaseSnapshot } from "./sqlite-backup.js";

const config = (() => {
  try {
    return loadPhase1Config({ requireDiscordConfig: true });
  } catch (error) {
    printCliError(error);
    process.exit(1);
  }
})();

const database = new DirongDatabase(config.dbPath, config.dbBusyTimeoutMs);
const store = new SessionStore(database, {
  storageRoot: config.dataDir,
  normalizeStoredPaths: true,
});
const repairSummary = await runStartupRepair(store, config);
const appSettings = loadAppSettingsFromEnv({
  onInvalidBoolean: warnInvalidBooleanEnv,
  onInvalidPositiveInteger: (key, fallback) => {
    warnInvalidNumberEnv(key, fallback);
    return "fallback";
  },
  onInvalidOptionalPositiveInteger: (key) => {
    warnInvalidNumberEnv(key, config.sttLeaseMs);
    return "null";
  },
});
const sttProviderSelection = createPhase3SttProvider(appSettings.stt);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const producer = new RecordingProducer(client, config, store);
const aloneFinalize = createAloneFinalizeService();
const sttAutomation = createSttAutomationService(
  sttProviderSelection.provider,
  sttProviderSelection.settings.language,
  sttProviderSelection.settings.timeoutMs,
);
const notionSqlRunner = new SqlRunner(database);
const notionPropertyRuleStore = new NotionCustomPropertyRuleStore(notionSqlRunner);
const aiCleanupProvider = createAiCleanupProvider();
const aiLifecycle = createAiLifecycleService(aiCleanupProvider);
const aiCleanupAutomation = createAiCleanupAutomationService(
  aiCleanupProvider,
  aiLifecycle,
);
const notionDashboard = new NotionDashboardService({
  settings: appSettings.notion,
  database,
  config,
  workerId: `phase5-notion-dashboard-${process.pid}`,
});
const notionAutomation = createNotionAutomationService(notionSqlRunner);
const dashboard = new DashboardServer(config, store, producer, {
  aiReadiness: aiLifecycle,
  aiCleanupAutomation,
  aloneFinalize,
  notion: notionDashboard,
  notionAutomation,
  sttAutomation,
});
const dashboardUrl = await startDashboardOrExit();
let shutdownPromise: Promise<void> | null = null;

console.log("디롱이 Recording + STT dashboard 시작:", dashboardUrl);
console.log("startup repair:", JSON.stringify(repairSummary, null, 2));
startSttAutomation();
startAiPrepareInBackground();
startAiCleanupAutomation();
startNotionAutomation();
startAloneFinalizeService();
if (config.openDashboard) {
  openDashboardUrl(dashboardUrl);
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`디롱이 봇 로그인 완료: ${readyClient.user.tag}`);
  console.log("설정 요약:", JSON.stringify(redactForJson(snapshotPhase1Config(config)), null, 2));

  if (config.autoRegisterCommands) {
    try {
      await registerCommands();
    } catch (error) {
      printCliError(error, { prefix: "Slash command 자동 등록 실패" });
    }
  }

  console.log("");
  console.log("Discord에서 /dirong start, /dirong stop, /dirong status를 사용할 수 있습니다.");
  console.log("이 콘솔에서는 status, stop, exit 명령을 사용할 수 있습니다.");
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
  printCliError(error, { prefix: "처리되지 않은 비동기 오류" });
});

process.on("uncaughtException", (error) => {
  printCliError(error, { prefix: "치명적인 오류" });
  void shutdown("uncaughtException").finally(() => process.exit(1));
});

try {
  await client.login(config.discordBotToken);
} catch (error) {
  printCliError(error);
  await shutdown("login_failed");
  process.exit(1);
}

async function startDashboardOrExit(): Promise<string> {
  try {
    return await dashboard.start();
  } catch (error) {
    printCliError(error, { prefix: "Dashboard 시작 실패" });
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
  for (const guildId of config.guildIds) {
    try {
      const guild = await client.guilds.fetch(guildId);
      await guild.commands.set(phase1GuildCommandPayloads);
      successCount += 1;
      console.log(`Guild slash command 등록/갱신 완료: ${guild.name} (${guild.id})`);
    } catch (error) {
      printCliError(error, { prefix: `Slash command 등록 실패 (${guildId})` });
    }
  }
  if (successCount === 0) {
    throw new Error("설정된 Discord 서버에 slash command를 등록하지 못했습니다.");
  }
  console.log("사용 가능 명령: /dirong start, stop, status");
}

async function handleDirongCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "Dirong은 Discord 서버 안에서만 사용할 수 있습니다.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!config.guildIds.includes(interaction.guildId)) {
    await interaction.reply({
      content: "이 Dirong 앱은 .env의 DISCORD_GUILD_IDS 또는 DISCORD_GUILD_ID에 설정된 서버에서만 사용할 수 있습니다.",
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
        throw new Error("Discord 서버 정보를 가져오지 못했습니다.");
      }

      const member = await guild.members.fetch(interaction.user.id);
      const voiceChannel = member.voice.channel;
      if (!voiceChannel) {
        await interaction.editReply(
          "먼저 녹음할 Discord 음성 채널에 들어간 뒤 /dirong start를 실행해 주세요.",
        );
        return;
      }

      const result = await producer.start({
        guild,
        voiceChannel,
        textChannelId: interaction.channelId,
        startedByUserId: interaction.user.id,
        startedByDisplayName: displayNameForMember(member),
      });

      await sendPublicNotice(interaction, [
        "디롱이가 이 음성 채널 녹음을 시작했습니다.",
        "녹음 내용은 STT, AI 요약, Notion 회의록 작성에 사용될 수 있습니다.",
        "참여를 원하지 않으면 음성 채널에서 나가 주세요.",
        `시작자: ${displayNameForMember(member)}`,
        `세션 ID: ${result.sessionId}`,
      ].join("\n"));

      await interaction.editReply(
        [
          "녹음을 시작했습니다.",
          `세션: ${result.sessionId}`,
          `음성 채널: ${voiceChannel.name}`,
          `Dashboard: ${dashboard.getUrl()}`,
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
        "디롱이가 녹음을 종료했습니다.",
        `세션 ID: ${result.sessionId}`,
        `상태: ${result.status}`,
      ].join("\n"));

      await interaction.editReply(
        [
          "녹음을 종료했습니다.",
          `세션: ${result.sessionId}`,
          `상태: ${result.status}`,
          `Dashboard: ${dashboard.getUrl()}`,
        ].join("\n"),
      );
      return;
    }

    if (subcommand === "status") {
      await interaction.editReply(statusTextWithAiReadiness());
      return;
    }

    await interaction.editReply("알 수 없는 하위 명령입니다.");
  } catch (error) {
    await interaction.editReply(toKoreanErrorMessage(error));
    printCliError(error, { prefix: "slash command 처리 실패" });
  }
}

function startConsoleCommands(): void {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  readline.on("line", (line) => {
    const command = line.trim().toLowerCase();
    void handleConsoleCommand(command);
  });
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
      console.log(`녹음 종료: ${result.sessionId} (${result.status})`);
      return;
    }

    if (command === "exit" || command === "quit") {
      await shutdown("console_exit");
      process.exit(0);
    }

    if (command.length > 0) {
      console.log("사용 가능한 콘솔 명령: status, stop, exit");
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
    console.log(`종료 처리 중: ${reason}`);
    await aloneFinalize.stop();
    await producer.shutdown();
    try {
      await sttAutomation.stop();
    } catch (error) {
      printCliError(error, { prefix: "STT 자동화 종료 실패" });
    }
    try {
      await aiCleanupAutomation.stop();
    } catch (error) {
      printCliError(error, { prefix: "AI cleanup 자동화 종료 실패" });
    }
    try {
      await notionAutomation.stop();
    } catch (error) {
      printCliError(error, { prefix: "Notion 자동 업로드 종료 실패" });
    }
    try {
      await aiLifecycle.stop();
    } catch (error) {
      printCliError(error, { prefix: "AI lifecycle 종료 실패" });
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
  });
}

function createAiCleanupProvider(): AiCleanupProvider {
  return new ClaudeStreamJsonCliCleanupProvider({
    command: appSettings.aiCleanup.claudeCommand,
    model: appSettings.aiCleanup.claudeModel,
  });
}

function createSttAutomationService(
  provider: SttProvider,
  language: string | null,
  timeoutMs: number,
): SttAutomationService {
  return new SttAutomationService(store, {
    enabled: readBooleanEnvWithWarning("PHASE3_STT_AUTO_ENABLED", true),
    provider,
    pollIntervalMs: readPositiveEnvNumber("PHASE3_STT_AUTO_POLL_MS", 5000),
    batchLimit: readPositiveEnvNumber("PHASE3_STT_AUTO_BATCH_LIMIT", 1),
    runner: {
      workerId: `phase3-stt-auto-${provider.providerName}-${process.pid}`,
      leaseMs: readPositiveEnvNumber("PHASE3_STT_LEASE_MS", config.sttLeaseMs),
      language,
      timeoutMs,
      contextSegments: readPositiveEnvNumber("PHASE3_STT_CONTEXT_SEGMENTS", 2),
    },
  });
}

function createAiLifecycleService(
  provider: AiCleanupProvider,
): AiProviderLifecycleService {
  return new AiProviderLifecycleService(
    wrapAiCleanupProviderWithLifecycle(provider),
    {
      prepareTimeoutMs: appSettings.aiCleanup.prepareTimeoutMs,
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
      customNotionPropertyPrompt: () =>
        buildNotionCustomPropertyPrompt(notionPropertyRuleStore.listEnabledRules()),
      backup: () =>
        backupDatabaseSnapshot(config.dbPath, {
          busyTimeoutMs: config.dbBusyTimeoutMs,
        }),
    },
  });
}

function createNotionAutomationService(
  runner: SqlRunner,
): NotionAutomationService {
  const settings = appSettings.notion;
  const notionClient = settings.apiKey
    ? createNotionClient({
        apiKey: settings.apiKey,
        apiVersion: settings.apiVersion,
        baseUrl: settings.baseUrl,
      })
    : null;
  return new NotionAutomationService({
    settings,
    client: notionClient,
    readModel: new NotionDraftInputReadModel(runner),
    writeStore: new NotionWriteStore(runner),
    pollIntervalMs: settings.autoPollMs,
    batchLimit: 1,
    workerId: `phase5-notion-auto-${process.pid}`,
    leaseMs: settings.leaseMs || config.sttLeaseMs,
    customPropertyRules: () => notionPropertyRuleStore.listEnabledRules(),
  });
}

function startAiPrepareInBackground(): void {
  const snapshot = aiLifecycle.getSnapshot();
  console.log(`AI 준비 중: ${snapshot.provider} / ${snapshot.model}`);
  console.log("녹음은 바로 시작할 수 있습니다.");

  void aiLifecycle.startPrepareInBackground().then((readiness) => {
    console.log(`AI 상태: ${readiness.message}`);
    if (readiness.userAction) {
      console.log(readiness.userAction);
    }
  });
}

function startSttAutomation(): void {
  const snapshot = sttAutomation.getSnapshot();
  if (!snapshot.enabled) {
    console.log("STT 자동 실행이 꺼져 있습니다. 수동 Phase 3 STT CLI는 계속 사용할 수 있습니다.");
    return;
  }
  sttAutomation.start();
  console.log("STT 자동 실행 대기 시작: queued STT job을 처리합니다.");
}

function startAiCleanupAutomation(): void {
  const snapshot = aiCleanupAutomation.getSnapshot();
  if (!snapshot.enabled) {
    console.log("AI cleanup 자동 실행이 꺼져 있습니다. 수동 Phase 4 CLI는 계속 사용할 수 있습니다.");
    return;
  }
  aiCleanupAutomation.start();
  console.log("AI cleanup 자동 실행 대기 시작: finalized 세션과 STT 완료를 기다립니다.");
}

function startNotionAutomation(): void {
  const snapshot = notionAutomation.getSnapshot();
  if (snapshot.status !== "idle") {
    console.log(`Notion 자동 업로드 대기 안 함: ${snapshot.message}`);
    return;
  }
  notionAutomation.start();
  console.log("Notion 자동 업로드 대기 시작: completed valid draft를 기다립니다.");
}

function startAloneFinalizeService(): void {
  if (!config.aloneFinalizeEnabled) {
    console.log("혼자 남음 자동 종료가 꺼져 있습니다. DIRONG_ALONE_FINALIZE_ENABLED=true로 켤 수 있습니다.");
    return;
  }
  aloneFinalize.start();
  console.log(`혼자 남음 자동 종료 대기 시작: non-bot 0명 상태가 ${config.aloneFinalizeGraceMs}ms 지속되면 finalize합니다.`);
}

function statusTextWithAiReadiness(): string {
  return [
    store.statusText(producer.getRuntimeState(), dashboard.getUrl()),
    "",
    formatAloneFinalizeForStatus(aloneFinalize.getSnapshot()),
    "",
    formatSttAutomationForStatus(sttAutomation.getSnapshot()),
    "",
    formatAiReadinessForStatus(aiLifecycle.getSnapshot()),
    "",
    formatAiCleanupAutomationForStatus(aiCleanupAutomation.getSnapshot()),
    "",
    formatNotionAutomationForStatus(notionAutomation.getSnapshot()),
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
        technicalDetail: "활성 녹음 세션의 Discord 서버 ID를 확인하지 못했습니다.",
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
        technicalDetail: `voice channel을 찾지 못했습니다: ${voiceChannelId}`,
      };
    }

    const members = (channel as {
      members?: { size: number; values(): IterableIterator<GuildMember> };
    }).members;
    if (!members || members.size === 0) {
      return {
        ok: false,
        reason: "voice_member_cache_empty",
        technicalDetail: "Discord voice member cache가 비어 있어 자동 종료하지 않았습니다.",
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

function readPositiveEnvNumber(key: string, fallback: number): number {
  try {
    return readPositiveNumberEnv(process.env, key, fallback, {
      integer: true,
      invalidMessage: `${key} 값은 1 이상의 정수여야 합니다.`,
    });
  } catch {
    warnInvalidNumberEnv(key, fallback);
    return fallback;
  }
}

function readBooleanEnvWithWarning(key: string, fallback: boolean): boolean {
  return readBooleanEnv(process.env, key, fallback, {
    onInvalid: () => warnInvalidBooleanEnv(key, fallback),
  });
}

function warnInvalidBooleanEnv(key: string, fallback: boolean): void {
  console.warn(`${key} 값이 올바르지 않아 기본값 ${fallback ? "true" : "false"}를 사용합니다.`);
}

function warnInvalidNumberEnv(key: string, fallback: number): void {
  console.warn(`${key} 값이 올바르지 않아 기본값 ${fallback}를 사용합니다.`);
}

function displayNameForMember(member: GuildMember): string {
  return member.displayName || member.user.globalName || member.user.username;
}

async function sendPublicNotice(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  const channel = interaction.channel;
  if (!channel || !("send" in channel) || typeof channel.send !== "function") {
    return;
  }
  await channel.send({ content });
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
