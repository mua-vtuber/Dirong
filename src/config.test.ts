import assert from "node:assert/strict";
import test from "node:test";
import {
  loadPhase1Config,
  readDiscordGuildIdsFromEnv,
} from "./config.js";
import { MissingRequiredConfigError } from "./errors.js";

test("readDiscordGuildIdsFromEnv reads multiple guild IDs with legacy fallback", () => {
  assert.deepEqual(
    readDiscordGuildIdsFromEnv({
      DISCORD_GUILD_IDS: "guild-a, guild-b\nguild-c",
      DISCORD_GUILD_ID: "guild-b",
    } as NodeJS.ProcessEnv),
    ["guild-a", "guild-b", "guild-c"],
  );
});

test("loadPhase1Config accepts DISCORD_GUILD_IDS for multi-server use", () => {
  withDiscordEnv(
    {
      DISCORD_BOT_TOKEN: "token",
      DISCORD_CLIENT_ID: "client",
      DISCORD_GUILD_IDS: "guild-a guild-b",
      DISCORD_GUILD_ID: "",
    },
    () => {
      const config = loadPhase1Config({ requireDiscordConfig: true });

      assert.equal(config.guildId, "guild-a");
      assert.deepEqual(config.guildIds, ["guild-a", "guild-b"]);
    },
  );
});

test("loadPhase1Config still accepts legacy DISCORD_GUILD_ID", () => {
  withDiscordEnv(
    {
      DISCORD_BOT_TOKEN: "token",
      DISCORD_CLIENT_ID: "client",
      DISCORD_GUILD_IDS: "",
      DISCORD_GUILD_ID: "legacy-guild",
    },
    () => {
      const config = loadPhase1Config({ requireDiscordConfig: true });

      assert.equal(config.guildId, "legacy-guild");
      assert.deepEqual(config.guildIds, ["legacy-guild"]);
    },
  );
});

test("loadPhase1Config requires at least one guild ID for the main app", () => {
  withDiscordEnv(
    {
      DISCORD_BOT_TOKEN: "token",
      DISCORD_CLIENT_ID: "client",
      DISCORD_GUILD_IDS: "",
      DISCORD_GUILD_ID: "",
    },
    () => {
      assert.throws(
        () => loadPhase1Config({ requireDiscordConfig: true }),
        (error) =>
          error instanceof MissingRequiredConfigError &&
          error.missingKeys.includes("DISCORD_GUILD_IDS or DISCORD_GUILD_ID"),
      );
    },
  );
});

function withDiscordEnv(
  values: Record<string, string>,
  callback: () => void,
): void {
  const keys = [
    "DISCORD_BOT_TOKEN",
    "DISCORD_CLIENT_ID",
    "DISCORD_GUILD_IDS",
    "DISCORD_GUILD_ID",
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    for (const key of keys) {
      process.env[key] = values[key] ?? "";
    }
    callback();
  } finally {
    for (const key of keys) {
      const previousValue = previous.get(key);
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
  }
}
