import { createWriteStream, existsSync } from "node:fs";
import { rename, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
  ChannelType,
  type Client,
  type GuildMember,
  type VoiceBasedChannel,
} from "discord.js";
import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
  type AudioReceiveStream,
  type DiscordGatewayAdapterCreator,
  type VoiceConnection,
} from "@discordjs/voice";
import * as prism from "prism-media";
import type { Phase0Config } from "./config.js";
import { criticalHealthFailed, runHealthCheck } from "./health.js";
import { sha256File, transcodeToSttSafe, validatePlayable } from "./media.js";
import { extractDaveEvidence } from "./dave.js";
import {
  Phase0SessionWriter,
  type ChunkRecord,
  type Phase0Result,
} from "./session.js";
import { safeErrorInfo, toKoreanErrorMessage } from "./errors.js";

type SpeakerSnapshot = {
  displayName: string;
  isBot: boolean;
};

type ActiveChunk = {
  chunkId: string;
  userId: string;
  displayNameSnapshot: string;
  startedAtMs: number;
  rawPartPath: string;
  rawFinalPath: string;
  baseName: string;
  opusStream: AudioReceiveStream;
  done: Promise<void>;
  requestClose: (reason: string) => void;
};

type ActiveSession = {
  writer: Phase0SessionWriter;
  connection: VoiceConnection;
  channel: VoiceBasedChannel;
  activeChunks: Map<string, ActiveChunk>;
  speakerSnapshots: Map<string, SpeakerSnapshot>;
  chunkCounter: number;
  fatalErrors: number;
  lastDisconnectedAt: number | null;
};

export class Phase0Recorder {
  private active: ActiveSession | null = null;

  constructor(
    private readonly client: Client,
    private readonly config: Phase0Config,
  ) {}

  isActive(): boolean {
    return this.active !== null;
  }

  statusText(): string {
    if (!this.active) {
      return "진행 중인 Phase 0 세션이 없습니다.";
    }

    const { writer, activeChunks } = this.active;
    return [
      `세션 ${writer.sessionId} 진행 중`,
      `저장 폴더: ${writer.toRelative(writer.sessionDir)}`,
      `완료 chunk: ${writer.json.chunks.length}개`,
      `열려 있는 chunk: ${activeChunks.size}개`,
    ].join("\n");
  }

  async start(startedBy: string): Promise<Phase0SessionWriter> {
    if (this.active) {
      throw new Error(`이미 Phase 0 세션이 진행 중입니다: ${this.active.writer.sessionId}`);
    }

    const health = await runHealthCheck();
    const writer = new Phase0SessionWriter(this.config, health);
    writer.event("health_checked", "의존성 health check를 저장했습니다.", {
      checks: health.checks,
    });

    if (criticalHealthFailed(health)) {
      writer.finalize(
        "fail",
        "Node/Opus/FFmpeg 중 필수 의존성 health check가 실패했습니다.",
      );
      throw new Error("필수 의존성 health check 실패. npm run phase0:doctor를 확인해 주세요.");
    }

    const guild = await this.client.guilds.fetch(this.config.guildId);
    const channel = await guild.channels.fetch(this.config.voiceChannelId);
    if (!channel || !channel.isVoiceBased() || channel.type === ChannelType.GuildStageVoice) {
      writer.finalize("fail", "설정된 채널이 일반 Discord 음성 채널이 아닙니다.");
      throw new Error("설정된 DISCORD_VOICE_CHANNEL_ID가 일반 음성 채널이 아닙니다.");
    }

    writer.event("join_requested", "봇이 설정된 음성 채널 입장을 시도합니다.", {
      guildId: this.config.guildId,
      voiceChannelId: this.config.voiceChannelId,
      startedBy,
      selfDeaf: false,
      selfMute: true,
      daveEncryption: this.config.enableDave,
    });

    const connection = joinVoiceChannel({
      guildId: this.config.guildId,
      channelId: this.config.voiceChannelId,
      adapterCreator: guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
      selfDeaf: false,
      selfMute: true,
      debug: this.config.debugVoice,
      daveEncryption: this.config.enableDave,
      decryptionFailureTolerance: this.config.decryptionFailureTolerance,
    });

    const active: ActiveSession = {
      writer,
      connection,
      channel,
      activeChunks: new Map(),
      speakerSnapshots: new Map(),
      chunkCounter: 0,
      fatalErrors: 0,
      lastDisconnectedAt: null,
    };

    this.active = active;
    this.attachConnectionEvents(active);
    this.attachReceiverEvents(active);

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30000);
    } catch (error) {
      active.fatalErrors += 1;
      writer.event(
        "connection_ready_timeout",
        "음성 연결이 Ready 상태가 되지 못했습니다.",
        safeErrorInfo(error),
        "error",
      );
      connection.destroy();
      writer.finalize("fail", toKoreanErrorMessage(error));
      this.active = null;
      throw error;
    }

    writer.event("bot_joined_channel", "봇이 음성 채널에 입장했습니다.", {
      channelName: channel.name,
    });

    return writer;
  }

  async stop(stoppedBy: string): Promise<Phase0SessionWriter> {
    const active = this.active;
    if (!active) {
      throw new Error("진행 중인 Phase 0 세션이 없습니다.");
    }

    active.writer.event("stop_requested", "Phase 0 세션 종료 요청을 받았습니다.", {
      stoppedBy,
      openChunks: active.activeChunks.size,
    });

    for (const chunk of active.activeChunks.values()) {
      chunk.requestClose("manual_stop");
    }

    await Promise.race([
      Promise.allSettled([...active.activeChunks.values()].map((chunk) => chunk.done)),
      new Promise((resolve) => setTimeout(resolve, 10000)),
    ]);

    active.connection.destroy();
    active.writer.event("bot_left_channel", "봇이 음성 채널에서 나갔습니다.");

    const { result, reason } = this.decideResult(active);
    active.writer.finalize(result, reason);
    this.active = null;

    return active.writer;
  }

  async shutdown(): Promise<void> {
    if (!this.active) {
      return;
    }

    await this.stop("process_shutdown");
  }

  private attachReceiverEvents(active: ActiveSession): void {
    const { receiver } = active.connection;

    receiver.speaking.on("start", (userId) => {
      active.writer.event("speaking_start", "사용자 speaking start 감지", {
        userId,
      });
      void this.openChunkForSpeaker(active, userId);
    });

    receiver.speaking.on("end", (userId) => {
      active.writer.event("speaking_stop", "사용자 speaking stop 감지", {
        userId,
      });
    });
  }

  private attachConnectionEvents(active: ActiveSession): void {
    active.connection.on("stateChange", (oldState, newState) => {
      const evidence = extractDaveEvidence(newState);
      active.writer.event("voice_state_change", "음성 연결 상태 변경", {
        oldStatus: oldState.status,
        newStatus: newState.status,
        daveEvidence: evidence,
      });

      if (evidence.length > 0) {
        active.writer.addDaveEvidence({
          at: new Date().toISOString(),
          source: "voice_state_change",
          evidence,
        });
      }

      if (newState.status === VoiceConnectionStatus.Ready) {
        if (active.lastDisconnectedAt !== null) {
          active.writer.event("connection_resumed", "음성 연결이 다시 Ready 상태가 되었습니다.", {
            gapMs: Date.now() - active.lastDisconnectedAt,
          });
          active.lastDisconnectedAt = null;
        } else {
          active.writer.event("connection_ready", "음성 연결이 Ready 상태가 되었습니다.");
        }
      }

      if (newState.status === VoiceConnectionStatus.Disconnected) {
        active.lastDisconnectedAt = Date.now();
        active.writer.event("connection_disconnected", "음성 연결이 끊겼습니다.", {
          reason: "VoiceConnectionStatus.Disconnected",
        }, "warn");
      }

      if (
        newState.status === VoiceConnectionStatus.Connecting ||
        newState.status === VoiceConnectionStatus.Signalling
      ) {
        active.writer.event("connection_reconnecting", "음성 연결 준비/재연결 상태입니다.", {
          status: newState.status,
        });
      }
    });

    active.connection.on("debug", (message) => {
      const level = /dave|encrypt|decrypt|protocol|session/i.test(message)
        ? "info"
        : "debug";
      active.writer.event("voice_debug", "voice debug message", { message }, level);

      if (/dave|protocol|encrypt|decrypt|session/i.test(message)) {
        active.writer.addDaveEvidence({
          at: new Date().toISOString(),
          source: "voice_debug",
          message,
        });
      }
    });

    active.connection.on("error", (error) => {
      active.fatalErrors += 1;
      active.writer.event(
        "voice_connection_error",
        "음성 연결 오류가 발생했습니다.",
        safeErrorInfo(error),
        "error",
      );
    });
  }

  private async openChunkForSpeaker(
    active: ActiveSession,
    userId: string,
  ): Promise<void> {
    if (!this.active || this.active !== active) {
      return;
    }

    if (active.activeChunks.has(userId)) {
      active.writer.event("chunk_start_skipped", "이미 이 사용자의 chunk가 열려 있습니다.", {
        userId,
      });
      return;
    }

    const speaker = await this.resolveSpeakerSnapshot(active, userId);
    if (speaker.isBot || userId === this.client.user?.id) {
      active.writer.event("speaking_skipped_bot", "봇/self 음성은 녹음하지 않습니다.", {
        userId,
        displayName: speaker.displayName,
      });
      return;
    }

    active.chunkCounter += 1;
    const chunkId = active.chunkCounter.toString().padStart(6, "0");
    const baseName = `${chunkId}_${userId}`;
    const rawPartPath = path.join(active.writer.chunksDir, `${baseName}.part.ogg`);
    const rawFinalPath = path.join(active.writer.chunksDir, `${baseName}.ogg`);
    const startedAtMs = Date.now() - active.writer.startedMs;

    const opusStream = active.connection.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: this.config.silenceMs,
      },
    });

    let closeReason = "after_silence";
    let closeRequested = false;
    const requestClose = (reason: string): void => {
      if (closeRequested) {
        return;
      }
      closeRequested = true;
      closeReason = reason;
      active.writer.event("chunk_close_requested", "chunk 닫기를 요청했습니다.", {
        chunkId,
        userId,
        reason,
      });

      try {
        (opusStream as unknown as { push: (chunk: null) => boolean }).push(null);
      } catch {
        opusStream.destroy();
      }
    };

    const hardCapTimer = setTimeout(() => {
      requestClose("max_chunk_ms");
    }, this.config.maxChunkMs);

    opusStream.on("error", (error) => {
      active.writer.event(
        "audio_receive_stream_error",
        "사용자 audio receive stream 오류",
        {
          chunkId,
          userId,
          error: safeErrorInfo(error),
        },
        "error",
      );
    });

    active.writer.event("chunk_opened", "사용자별 오디오 chunk를 열었습니다.", {
      chunkId,
      userId,
      displayNameSnapshot: speaker.displayName,
      rawAudioPath: active.writer.toRelative(rawFinalPath),
      silenceMs: this.config.silenceMs,
      maxChunkMs: this.config.maxChunkMs,
    });

    const activeChunk: ActiveChunk = {
      chunkId,
      userId,
      displayNameSnapshot: speaker.displayName,
      startedAtMs,
      rawPartPath,
      rawFinalPath,
      baseName,
      opusStream,
      done: Promise.resolve(),
      requestClose,
    };
    active.activeChunks.set(userId, activeChunk);
    activeChunk.done = this.pipeAndFinalizeChunk(
      active,
      activeChunk,
      hardCapTimer,
      () => closeReason,
    );
  }

  private async pipeAndFinalizeChunk(
    active: ActiveSession,
    chunk: ActiveChunk,
    hardCapTimer: NodeJS.Timeout,
    getCloseReason: () => string,
  ): Promise<void> {
    let pipelineError: unknown = null;

    try {
      await pipeline(
        chunk.opusStream,
        new prism.opus.OggLogicalBitstream({
          opusHead: new prism.opus.OpusHead({
            channelCount: 2,
            sampleRate: 48000,
          }),
          pageSizeControl: {
            maxPackets: 10,
          },
        }),
        createWriteStream(chunk.rawPartPath),
      );
    } catch (error) {
      pipelineError = error;
      active.writer.event(
        "chunk_pipeline_error",
        "chunk 파이프라인 오류가 발생했습니다. 가능한 경우 파일을 회수합니다.",
        {
          chunkId: chunk.chunkId,
          userId: chunk.userId,
          error: safeErrorInfo(error),
        },
        "warn",
      );
    } finally {
      clearTimeout(hardCapTimer);
      active.activeChunks.delete(chunk.userId);
    }

    await this.finalizeChunk(active, chunk, getCloseReason(), pipelineError);
  }

  private async finalizeChunk(
    active: ActiveSession,
    chunk: ActiveChunk,
    closeReason: string,
    pipelineError: unknown,
  ): Promise<void> {
    const endedAtMs = Date.now() - active.writer.startedMs;
    const rawExists = existsSync(chunk.rawPartPath) || existsSync(chunk.rawFinalPath);

    if (!rawExists) {
      active.writer.event("chunk_failed", "chunk 파일이 생성되지 않았습니다.", {
        chunkId: chunk.chunkId,
        userId: chunk.userId,
        pipelineError: pipelineError ? safeErrorInfo(pipelineError) : null,
      }, "error");
      return;
    }

    if (existsSync(chunk.rawPartPath) && !existsSync(chunk.rawFinalPath)) {
      await rename(chunk.rawPartPath, chunk.rawFinalPath);
    }

    const rawStat = await stat(chunk.rawFinalPath);
    const rawPlayback = await validatePlayable(
      chunk.rawFinalPath,
      active.writer.json.ffmpegPath ?? "ffmpeg",
    );
    const rawSha256 = rawStat.size > 0 ? await sha256File(chunk.rawFinalPath) : null;

    let sttAudioPath: string | null = null;
    let sttAudioFormat: ChunkRecord["sttAudioFormat"] = null;
    let sttByteSize = 0;
    let playbackChecked = rawPlayback.ok;
    let transcodeStatus: ChunkRecord["transcodeStatus"] = "skipped";
    let transcodeError: string | null = null;

    if (rawStat.size > 0 && active.writer.json.ffmpegPath) {
      const transcode = await transcodeToSttSafe(
        chunk.rawFinalPath,
        active.writer.sttSafeDir,
        chunk.baseName,
        this.config.sttSafeFormat,
        active.writer.json.ffmpegPath,
      );
      sttAudioPath = active.writer.toRelative(transcode.outputPath);
      sttAudioFormat = transcode.format;
      sttByteSize = transcode.byteSize;
      playbackChecked = rawPlayback.ok && transcode.playbackChecked;
      transcodeStatus = transcode.playbackChecked ? "done" : "failed";
      transcodeError = transcode.error ?? null;

      active.writer.event(
        transcodeStatus === "done" ? "chunk_transcoded" : "chunk_transcode_failed",
        transcodeStatus === "done"
          ? "STT-safe 오디오 변환을 완료했습니다."
          : "STT-safe 오디오 변환에 실패했습니다.",
        {
          chunkId: chunk.chunkId,
          userId: chunk.userId,
          sttAudioPath,
          sttAudioFormat,
          sttByteSize,
          transcodeError,
        },
        transcodeStatus === "done" ? "info" : "warn",
      );
    }

    const record: ChunkRecord = {
      chunkId: chunk.chunkId,
      userId: chunk.userId,
      displayNameSnapshot: chunk.displayNameSnapshot,
      startedAtMs: chunk.startedAtMs,
      endedAtMs,
      rawAudioPath: active.writer.toRelative(chunk.rawFinalPath) ?? chunk.rawFinalPath,
      rawAudioFormat: "ogg-opus",
      sttAudioPath,
      sttAudioFormat,
      byteSize: rawStat.size,
      sttByteSize,
      durationMs: Math.max(0, endedAtMs - chunk.startedAtMs),
      sha256: rawSha256,
      playbackChecked,
      transcodeStatus,
      transcodeError,
      finalizedReason: closeReason,
    };

    active.writer.addChunk(record);
    active.writer.event(
      "chunk_finalized",
      "사용자별 오디오 chunk를 완료했습니다.",
      {
        ...record,
        rawPlayable: rawPlayback.ok,
        rawPlaybackError: rawPlayback.error ?? null,
        pipelineError: pipelineError ? safeErrorInfo(pipelineError) : null,
      },
      playbackChecked && rawStat.size > 0 ? "info" : "warn",
    );
  }

  private async resolveSpeakerSnapshot(
    active: ActiveSession,
    userId: string,
  ): Promise<SpeakerSnapshot> {
    const cached = active.speakerSnapshots.get(userId);
    if (cached) {
      return cached;
    }

    const memberFromChannel = active.channel.members.get(userId);
    if (memberFromChannel) {
      return this.cacheSpeaker(active, userId, memberFromChannel);
    }

    try {
      const user = await this.client.users.fetch(userId);
      const snapshot = {
        displayName: user.globalName ?? user.username ?? userId,
        isBot: user.bot,
      };
      active.speakerSnapshots.set(userId, snapshot);
      return snapshot;
    } catch (error) {
      active.writer.event(
        "speaker_lookup_failed",
        "사용자 표시 이름 조회에 실패해 userId를 이름으로 사용합니다.",
        { userId, error: safeErrorInfo(error) },
        "warn",
      );
      const snapshot = { displayName: userId, isBot: false };
      active.speakerSnapshots.set(userId, snapshot);
      return snapshot;
    }
  }

  private cacheSpeaker(
    active: ActiveSession,
    userId: string,
    member: GuildMember,
  ): SpeakerSnapshot {
    const snapshot = {
      displayName: member.displayName || member.user.globalName || member.user.username,
      isBot: member.user.bot,
    };
    active.speakerSnapshots.set(userId, snapshot);
    return snapshot;
  }

  private decideResult(active: ActiveSession): {
    result: Phase0Result;
    reason: string;
  } {
    const chunks = active.writer.json.chunks;
    if (active.fatalErrors > 0) {
      return {
        result: "fail",
        reason: `음성 연결 fatal error가 ${active.fatalErrors}회 기록되었습니다. events.jsonl을 확인해 주세요.`,
      };
    }

    if (chunks.length === 0) {
      return {
        result: "inconclusive",
        reason: "세션은 종료되었지만 사람 사용자 음성 chunk가 생성되지 않았습니다. T1 join/leave 검증에는 충분하지만 녹음 가능 여부는 아직 수동 확인이 필요합니다.",
      };
    }

    const badChunks = chunks.filter(
      (chunk) => chunk.byteSize === 0 || !chunk.playbackChecked,
    );
    if (badChunks.length > 0) {
      return {
        result: "fail",
        reason: `${badChunks.length}개 chunk가 0바이트이거나 ffmpeg 재생 검증에 실패했습니다.`,
      };
    }

    return {
      result: "pass",
      reason: "완료된 모든 chunk가 0바이트가 아니며 ffmpeg 재생 검증을 통과했습니다. 실제 음성 내용은 사람이 직접 재생해 확인해야 합니다.",
    };
  }
}
