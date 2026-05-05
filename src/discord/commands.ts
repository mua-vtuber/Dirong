import { SlashCommandBuilder } from "discord.js";

export const dirongCommand = new SlashCommandBuilder()
  .setName("dirong")
  .setDescription("디롱이 Phase 1 녹음 producer")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("start")
      .setDescription("현재 들어가 있는 음성 채널에서 녹음을 시작합니다."),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("stop")
      .setDescription("진행 중인 녹음을 종료하고 열린 chunk를 정리합니다."),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("status")
      .setDescription("현재 녹음, chunk, STT queue, repair 상태를 확인합니다."),
  );

export const phase1GuildCommandPayloads = [dirongCommand.toJSON()];
