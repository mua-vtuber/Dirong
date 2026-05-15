import assert from "node:assert/strict";
import test from "node:test";
import type { Phase1Config } from "./config.js";
import { runHealthCheck } from "./health.js";
import {
  DEFAULT_DASHBOARD_SETTINGS,
  DEFAULT_RECORDING_SETTINGS,
} from "./settings/defaults.js";

test("runHealthCheck reports product Discord config without process env fallback", async () => {
  const previousToken = process.env.DISCORD_BOT_TOKEN;
  const previousClientId = process.env.DISCORD_CLIENT_ID;
  const previousGuildIds = process.env.DISCORD_GUILD_IDS;
  try {
    process.env.DISCORD_BOT_TOKEN = "env-token-must-not-be-used";
    process.env.DISCORD_CLIENT_ID = "env-client-must-not-be-used";
    process.env.DISCORD_GUILD_IDS = "env-guild-must-not-be-used";

    const report = await runHealthCheck({
      config: makeConfig({
        discordBotToken: "",
        discordClientId: "",
        guildIds: [],
      }),
    });

    assert.deepEqual(report.discordConfig, {
      botToken: "missing",
      clientId: "missing",
      guildId: "missing",
      voiceChannelId: "missing",
    });
    assert.doesNotMatch(JSON.stringify(report.checks), /\.env/);
  } finally {
    restoreEnv("DISCORD_BOT_TOKEN", previousToken);
    restoreEnv("DISCORD_CLIENT_ID", previousClientId);
    restoreEnv("DISCORD_GUILD_IDS", previousGuildIds);
  }
});

test("runHealthCheck localizes user-facing check messages", async () => {
  const report = await runHealthCheck({
    config: makeConfig({
      discordBotToken: "",
      discordClientId: "",
      guildIds: [],
    }),
    locale: "en",
  });

  const botToken = report.checks.find(
    (check) => check.name === "Discord bot token",
  );
  assert.equal(botToken?.message, "Not configured yet.");
  assert.equal(
    botToken?.action,
    "Save the value in the dashboard setup wizard.",
  );

  const node = report.checks.find((check) => check.name === "Node.js");
  assert.match(node?.message ?? "", /^Node\.js v?\d+\.\d+\.\d+ is available$/);
});

function makeConfig(
  overrides: Partial<Pick<
    Phase1Config,
    "discordBotToken" | "discordClientId" | "guildIds"
  >>,
): Phase1Config {
  const guildIds = overrides.guildIds ?? ["guild-1"];
  return {
    discordBotToken: overrides.discordBotToken ?? "token",
    discordClientId: overrides.discordClientId ?? "client",
    guildId: guildIds[0] ?? "",
    guildIds,
    dataDir: "data/sessions",
    dbPath: "data/sessions/dirong.sqlite",
    dbBusyTimeoutMs: DEFAULT_RECORDING_SETTINGS.dbBusyTimeoutMs,
    silenceMs: DEFAULT_RECORDING_SETTINGS.silenceMs,
    softRolloverMs: DEFAULT_RECORDING_SETTINGS.softRolloverMs,
    maxChunkMs: DEFAULT_RECORDING_SETTINGS.maxChunkMs,
    sttSafeFormat: DEFAULT_RECORDING_SETTINGS.sttSafeFormat,
    sttMaxAttempts: DEFAULT_RECORDING_SETTINGS.sttMaxAttempts,
    sttLeaseMs: DEFAULT_RECORDING_SETTINGS.sttLeaseMs,
    partRepairAgeMs: DEFAULT_RECORDING_SETTINGS.partRepairAgeMs,
    enableDave: DEFAULT_RECORDING_SETTINGS.enableDave,
    decryptionFailureTolerance:
      DEFAULT_RECORDING_SETTINGS.decryptionFailureTolerance,
    debugVoice: DEFAULT_RECORDING_SETTINGS.productDebugVoice,
    autoRegisterCommands: guildIds.length > 0,
    dashboardHost: DEFAULT_DASHBOARD_SETTINGS.host,
    dashboardPort: DEFAULT_DASHBOARD_SETTINGS.port,
    openDashboard: DEFAULT_DASHBOARD_SETTINGS.openDashboard,
    aloneFinalizeEnabled: DEFAULT_RECORDING_SETTINGS.productAloneFinalizeEnabled,
    aloneFinalizeGraceMs: DEFAULT_RECORDING_SETTINGS.aloneFinalizeGraceMs,
  };
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
