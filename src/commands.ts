import { SlashCommandBuilder } from "discord.js";

export const dirongTestCommand = new SlashCommandBuilder()
  .setName("dirong-test")
  .setDescription("디롱이 Phase 0 Discord 음성 수신 테스트")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("start")
      .setDescription("설정된 음성 채널에 들어가서 Phase 0 녹음 테스트를 시작합니다."),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("stop")
      .setDescription("진행 중인 Phase 0 녹음 테스트를 종료하고 파일을 정리합니다."),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("status")
      .setDescription("현재 Phase 0 테스트 세션 상태를 확인합니다."),
  );

export const guildCommandPayloads = [dirongTestCommand.toJSON()];
