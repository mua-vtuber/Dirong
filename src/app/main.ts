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
import { DashboardServer } from "../dashboard/server.js";
import { phase1GuildCommandPayloads } from "../discord/commands.js";
import {
  redactForJson,
  toKoreanErrorMessage,
} from "../errors.js";
import { printCliError } from "../cli/error-output.js";
import { RecordingProducer } from "../recording/recording-producer.js";
import { runStartupRepair } from "../storage/repair-scan.js";
import { SessionStore } from "../storage/session-store.js";
import { DirongDatabase } from "../storage/sqlite.js";

const config = (() => {
  try {
    return loadPhase1Config({ requireDiscordConfig: true });
  } catch (error) {
    printCliError(error);
    process.exit(1);
  }
})();

const database = new DirongDatabase(config.dbPath, config.dbBusyTimeoutMs);
const store = new SessionStore(database);
const repairSummary = await runStartupRepair(store, config);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const producer = new RecordingProducer(client, config, store);
const dashboard = new DashboardServer(config, store, producer);
const dashboardUrl = await dashboard.start();
let shutdownPromise: Promise<void> | null = null;

console.log("디롱이 Recording + STT dashboard 시작:", dashboardUrl);
console.log("startup repair:", JSON.stringify(repairSummary, null, 2));
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

async function registerCommands(): Promise<void> {
  const guild = await client.guilds.fetch(config.guildId);
  for (const command of phase1GuildCommandPayloads) {
    await guild.commands.create(command);
  }
  console.log("Guild slash command 등록/갱신 완료: /dirong start, stop, status");
}

async function handleDirongCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId || interaction.guildId !== config.guildId) {
    await interaction.reply({
      content: "이 Dirong 앱은 .env에 설정된 서버에서만 사용할 수 있습니다.",
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
      await interaction.editReply(
        store.statusText(producer.getRuntimeState(), dashboard.getUrl()),
      );
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
      console.log(store.statusText(producer.getRuntimeState(), dashboard.getUrl()));
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
    await producer.shutdown();
    await dashboard.stop();
    client.destroy();
    store.close();
  })();

  return shutdownPromise;
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
