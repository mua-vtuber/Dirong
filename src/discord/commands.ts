import { SlashCommandBuilder } from "discord.js";

export const dirongCommand = new SlashCommandBuilder()
  .setName("dirong")
  .setDescription("Dirong recording and STT pipeline")
  .setDescriptionLocalizations({
    ko: "디롱이 녹음과 STT pipeline",
  })
  .addSubcommand((subcommand) =>
    subcommand
      .setName("start")
      .setDescription("Start recording in your current voice channel.")
      .setDescriptionLocalizations({
        ko: "현재 들어가 있는 음성 채널에서 녹음을 시작합니다.",
      }),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("stop")
      .setDescription("Stop the current recording and close open chunks.")
      .setDescriptionLocalizations({
        ko: "진행 중인 녹음을 종료하고 열린 chunk를 정리합니다.",
      }),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("status")
      .setDescription("Check recording, chunk, STT queue, and repair status.")
      .setDescriptionLocalizations({
        ko: "현재 녹음, chunk, STT queue, repair 상태를 확인합니다.",
      }),
  );

export const phase1GuildCommandPayloads = [dirongCommand.toJSON()];
