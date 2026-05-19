import { SlashCommandBuilder } from "discord.js";
import { t } from "../i18n/catalog.js";

export const dirongCommand = new SlashCommandBuilder()
  .setName("dirong")
  .setDescription("Dirong recording and STT pipeline")
  .setDescriptionLocalizations({
    ko: t("ko", "runtimeCli.discordCommands.description"),
  })
  .addSubcommand((subcommand) =>
    subcommand
      .setName("start")
      .setDescription("Start recording in your current voice channel.")
      .setDescriptionLocalizations({
        ko: t("ko", "runtimeCli.discordCommands.start"),
      }),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("stop")
      .setDescription("Stop the current recording and close open chunks.")
      .setDescriptionLocalizations({
        ko: t("ko", "runtimeCli.discordCommands.stop"),
      }),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("status")
      .setDescription("Check recording, chunk, STT queue, and repair status.")
      .setDescriptionLocalizations({
        ko: t("ko", "runtimeCli.discordCommands.status"),
      }),
  );

export const phase1GuildCommandPayloads = [dirongCommand.toJSON()];
