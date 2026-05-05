import process from "node:process";
import { createInterface } from "node:readline";
import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { loadPhase0Config, snapshotConfig } from "./config.js";
import { guildCommandPayloads } from "./commands.js";
import { Phase0Recorder } from "./recorder.js";
import {
  redactForJson,
  safeErrorInfo,
  toKoreanErrorMessage,
} from "./errors.js";

const config = (() => {
  try {
    return loadPhase0Config({ requireDiscordConfig: true });
  } catch (error) {
    console.error(toKoreanErrorMessage(error));
    console.error(JSON.stringify(safeErrorInfo(error), null, 2));
    process.exit(1);
  }
})();
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const recorder = new Phase0Recorder(client, config);
let shutdownPromise: Promise<void> | null = null;

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`디롱이 Phase 0 봇 로그인 완료: ${readyClient.user.tag}`);
  console.log("설정 요약:", JSON.stringify(redactForJson(snapshotConfig(config)), null, 2));

  if (config.autoRegisterCommands) {
    try {
      await registerCommands();
    } catch (error) {
      console.error("Slash command 자동 등록 실패:", toKoreanErrorMessage(error));
      console.error(JSON.stringify(safeErrorInfo(error), null, 2));
      console.error("콘솔 명령 start/stop/status는 계속 사용할 수 있습니다.");
    }
  }

  console.log("");
  console.log("Discord에서 /dirong-test start 또는 /dirong-test stop을 사용할 수 있습니다.");
  console.log("이 콘솔에서도 start, stop, status, exit 명령을 입력할 수 있습니다.");
  startConsoleCommands();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }
  if (interaction.commandName !== "dirong-test") {
    return;
  }

  await handleDirongTestCommand(interaction);
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("unhandledRejection", (error) => {
  console.error("처리되지 않은 비동기 오류:", toKoreanErrorMessage(error));
  console.error(JSON.stringify(safeErrorInfo(error), null, 2));
});

process.on("uncaughtException", (error) => {
  console.error("치명적인 오류:", toKoreanErrorMessage(error));
  console.error(JSON.stringify(safeErrorInfo(error), null, 2));
  void shutdown("uncaughtException").finally(() => process.exit(1));
});

try {
  await client.login(config.discordBotToken);
} catch (error) {
  console.error(toKoreanErrorMessage(error));
  console.error(JSON.stringify(safeErrorInfo(error), null, 2));
  process.exit(1);
}

async function registerCommands(): Promise<void> {
  const guild = await client.guilds.fetch(config.guildId);
  await guild.commands.set(guildCommandPayloads);
  console.log("Guild slash command 등록 완료: /dirong-test start, stop, status");
}

async function handleDirongTestCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (interaction.guildId !== config.guildId) {
    await interaction.reply({
      content: "이 Phase 0 앱은 .env에 설정된 테스트 서버에서만 사용할 수 있습니다.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "start") {
      const writer = await recorder.start(interaction.user.id);
      await interaction.editReply([
        "디롱이 Phase 0 테스트를 시작했습니다.",
        `세션: ${writer.sessionId}`,
        `저장 폴더: ${writer.toRelative(writer.sessionDir)}`,
      ].join("\n"));
      return;
    }

    if (subcommand === "stop") {
      const writer = await recorder.stop(interaction.user.id);
      await interaction.editReply([
        "디롱이 Phase 0 테스트를 종료했습니다.",
        `세션: ${writer.sessionId}`,
        `결과: ${writer.json.result}`,
        `이유: ${writer.json.resultReason}`,
        `저장 폴더: ${writer.toRelative(writer.sessionDir)}`,
      ].join("\n"));
      return;
    }

    if (subcommand === "status") {
      await interaction.editReply(recorder.statusText());
      return;
    }

    await interaction.editReply("알 수 없는 하위 명령입니다.");
  } catch (error) {
    await interaction.editReply(toKoreanErrorMessage(error));
    console.error("slash command 처리 실패:", JSON.stringify(safeErrorInfo(error), null, 2));
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
    if (command === "start") {
      const writer = await recorder.start("console");
      console.log(`Phase 0 시작: ${writer.sessionId}`);
      console.log(`저장 폴더: ${writer.toRelative(writer.sessionDir)}`);
      return;
    }

    if (command === "stop") {
      const writer = await recorder.stop("console");
      console.log(`Phase 0 종료: ${writer.sessionId}`);
      console.log(`결과: ${writer.json.result}`);
      console.log(`저장 폴더: ${writer.toRelative(writer.sessionDir)}`);
      return;
    }

    if (command === "status") {
      console.log(recorder.statusText());
      return;
    }

    if (command === "exit" || command === "quit") {
      await shutdown("console_exit");
      process.exit(0);
    }

    if (command.length > 0) {
      console.log("사용 가능한 콘솔 명령: start, stop, status, exit");
    }
  } catch (error) {
    console.error(toKoreanErrorMessage(error));
    console.error(JSON.stringify(safeErrorInfo(error), null, 2));
  }
}

async function shutdown(reason: string): Promise<void> {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    console.log(`종료 처리 중: ${reason}`);
    await recorder.shutdown();
    client.destroy();
  })();

  return shutdownPromise;
}
