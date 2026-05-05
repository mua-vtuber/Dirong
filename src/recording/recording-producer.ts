import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { rename, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
  ChannelType,
  type Client,
  type Guild,
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
import type { Phase1Config } from "../config.js";
import { extractDaveEvidence } from "../dave.js";
import { safeErrorInfo, toKoreanErrorMessage } from "../errors.js";
import { criticalHealthFailed, runHealthCheck } from "../health.js";
import { sha256File, transcodeToSttSafe, validatePlayable } from "../media.js";
import type {
  RecordingRuntimeState,
  SessionStatus,
  SessionStore,
} from "../storage/session-store.js";

type SpeakerSnapshot = {
  displayName: string;
  isBot: boolean;
};

type ActiveChunk = {
  chunkId: string;
  chunkIndex: number;
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
  sessionId: string;
  sessionDir: string;
  chunksDir: string;
  sttAudioDir: string;
  startedAtMs: number;
  ffmpegPath: string;
  connection: VoiceConnection;
  guild: Guild;
  channel: VoiceBasedChannel;
  activeChunks: Map<string, ActiveChunk>;
  speakerSnapshots: Map<string, SpeakerSnapshot>;
  chunkCounter: number;
  fatalErrors: number;
  lastDisconnectedAt: number | null;
};

export class RecordingProducer {
  private active: ActiveSession | null = null;

  constructor(
    private readonly client: Client,
    private readonly config: Phase1Config,
    private readonly store: SessionStore,
  ) {}

  isActive(): boolean {
    return this.active !== null;
  }

  getRuntimeState(): RecordingRuntimeState {
    return {
      isRecording: this.active !== null,
      sessionId: this.active?.sessionId ?? null,
      voiceChannelId: this.active?.channel.id ?? null,
      voiceChannelName: this.active?.channel.name ?? null,
      openChunks: this.active?.activeChunks.size ?? 0,
    };
  }

  async start(input: {
    guild: Guild;
    voiceChannel: VoiceBasedChannel;
    textChannelId: string | null;
    startedByUserId: string;
    startedByDisplayName: string;
  }): Promise<{ sessionId: string; sessionDir: string }> {
    if (this.active) {
      throw new Error(`이미 녹음 중인 세션이 있습니다: ${this.active.sessionId}`);
    }

    if (input.voiceChannel.type === ChannelType.GuildStageVoice) {
      throw new Error("Stage 채널은 Phase 1 MVP에서 아직 지원하지 않습니다.");
    }

    const health = await runHealthCheck();
    const sessionId = makeSessionId(new Date());
    const sessionDir = await createUniqueSessionDir(this.config.dataDir, sessionId);
    const chunksDir = path.join(sessionDir, "chunks");
    const sttAudioDir = path.join(sessionDir, "stt-audio");
    mkdirSync(chunksDir, { recursive: true });
    mkdirSync(sttAudioDir, { recursive: true });

    this.store.createSession({
      id: path.basename(sessionDir),
      guildId: input.guild.id,
      guildName: input.guild.name,
      textChannelId: input.textChannelId,
      voiceChannelId: input.voiceChannel.id,
      voiceChannelName: input.voiceChannel.name,
      startedByUserId: input.startedByUserId,
      startedByDisplayName: input.startedByDisplayName,
      dataDir: sessionDir,
    });
    const actualSessionId = path.basename(sessionDir);

    this.store.recordConnectionEvent({
      sessionId: actualSessionId,
      eventType: "health_checked",
      details: { checks: health.checks, ffmpeg: health.ffmpeg },
    });

    if (criticalHealthFailed(health) || !health.ffmpeg.path) {
      this.store.stopSession({
        sessionId: actualSessionId,
        stoppedByUserId: "system",
        stoppedByDisplayName: "system",
        status: "failed",
        lastError: "Node/Opus/FFmpeg 필수 의존성 health check 실패",
      });
      throw new Error("필수 의존성 health check 실패. npm run phase1:doctor를 확인해 주세요.");
    }

    this.store.recordConnectionEvent({
      sessionId: actualSessionId,
      eventType: "join_requested",
      details: {
        guildId: input.guild.id,
        voiceChannelId: input.voiceChannel.id,
        voiceChannelName: input.voiceChannel.name,
        startedBy: input.startedByUserId,
        selfDeaf: false,
        selfMute: true,
        daveEncryption: this.config.enableDave,
      },
    });

    const connection = joinVoiceChannel({
      guildId: input.guild.id,
      channelId: input.voiceChannel.id,
      adapterCreator: input.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
      selfDeaf: false,
      selfMute: true,
      debug: this.config.debugVoice,
      daveEncryption: this.config.enableDave,
      decryptionFailureTolerance: this.config.decryptionFailureTolerance,
    });

    const active: ActiveSession = {
      sessionId: actualSessionId,
      sessionDir,
      chunksDir,
      sttAudioDir,
      startedAtMs: Date.now(),
      ffmpegPath: health.ffmpeg.path,
      connection,
      guild: input.guild,
      channel: input.voiceChannel,
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
      this.store.recordConnectionEvent({
        sessionId: active.sessionId,
        eventType: "connection_ready_timeout",
        level: "error",
        details: safeErrorInfo(error),
      });
      connection.destroy();
      this.store.stopSession({
        sessionId: active.sessionId,
        stoppedByUserId: "system",
        stoppedByDisplayName: "system",
        status: "failed",
        lastError: toKoreanErrorMessage(error),
      });
      this.active = null;
      throw error;
    }

    this.store.updateSessionStatus(active.sessionId, "active");
    this.store.recordConnectionEvent({
      sessionId: active.sessionId,
      eventType: "bot_joined_channel",
      details: { channelName: input.voiceChannel.name },
    });

    return { sessionId: active.sessionId, sessionDir };
  }

  async stop(input: {
    stoppedByUserId: string;
    stoppedByDisplayName: string;
  }): Promise<{ sessionId: string; status: SessionStatus; sessionDir: string }> {
    const active = this.active;
    if (!active) {
      throw new Error("진행 중인 Phase 1 녹음 세션이 없습니다.");
    }

    this.store.updateSessionStatus(active.sessionId, "stopping");
    this.store.recordConnectionEvent({
      sessionId: active.sessionId,
      eventType: "stop_requested",
      details: {
        stoppedBy: input.stoppedByUserId,
        openChunks: active.activeChunks.size,
      },
    });

    const stoppingChunks = [...active.activeChunks.values()];
    for (const chunk of stoppingChunks) {
      chunk.requestClose("manual_stop");
    }

    const gracefulClose = await waitForChunkPromises(stoppingChunks, 20000);
    if (!gracefulClose) {
      this.store.recordConnectionEvent({
        sessionId: active.sessionId,
        eventType: "chunk_force_destroy_requested",
        level: "warn",
        details: {
          openChunks: active.activeChunks.size,
          reason: "manual stop chunk close timeout",
        },
      });

      for (const chunk of active.activeChunks.values()) {
        chunk.opusStream.destroy();
      }

      const forcedClose = await waitForChunkPromises(stoppingChunks, 60000);
      if (!forcedClose) {
        active.fatalErrors += 1;
        for (const chunk of active.activeChunks.values()) {
          this.store.recordRepairItem({
            type: "chunk_finalize_timeout",
            sessionId: active.sessionId,
            chunkId: chunk.chunkId,
            path: chunk.rawFinalPath,
            severity: "error",
            details: {
              message: "종료 중 chunk finalize가 제한 시간 안에 끝나지 않았습니다.",
            },
          });
        }
      }
    }

    active.connection.destroy();
    this.store.recordConnectionEvent({
      sessionId: active.sessionId,
      eventType: "bot_left_channel",
    });

    const status: SessionStatus =
      active.fatalErrors > 0 ? "needs_repair" : "finalized";
    this.store.stopSession({
      sessionId: active.sessionId,
      stoppedByUserId: input.stoppedByUserId,
      stoppedByDisplayName: input.stoppedByDisplayName,
      status,
      lastError:
        active.fatalErrors > 0
          ? `voice fatal error ${active.fatalErrors}회 기록됨`
          : null,
    });
    this.active = null;

    return { sessionId: active.sessionId, status, sessionDir: active.sessionDir };
  }

  async shutdown(): Promise<void> {
    if (!this.active) {
      return;
    }

    await this.stop({
      stoppedByUserId: "process_shutdown",
      stoppedByDisplayName: "process_shutdown",
    });
  }

  private attachReceiverEvents(active: ActiveSession): void {
    const { receiver } = active.connection;

    receiver.speaking.on("start", (userId) => {
      this.store.recordConnectionEvent({
        sessionId: active.sessionId,
        eventType: "speaking_start",
        startedAtMs: Date.now() - active.startedAtMs,
        details: { userId },
      });
      void this.openChunkForSpeaker(active, userId);
    });

    receiver.speaking.on("end", (userId) => {
      this.store.recordConnectionEvent({
        sessionId: active.sessionId,
        eventType: "speaking_stop",
        endedAtMs: Date.now() - active.startedAtMs,
        details: { userId },
      });
    });
  }

  private attachConnectionEvents(active: ActiveSession): void {
    active.connection.on("stateChange", (oldState, newState) => {
      const evidence = extractDaveEvidence(newState);
      this.store.recordConnectionEvent({
        sessionId: active.sessionId,
        eventType: "voice_state_change",
        level: evidence.length > 0 ? "info" : "debug",
        startedAtMs: Date.now() - active.startedAtMs,
        details: {
          oldStatus: oldState.status,
          newStatus: newState.status,
          daveEvidence: evidence,
        },
      });

      if (newState.status === VoiceConnectionStatus.Ready) {
        if (active.lastDisconnectedAt !== null) {
          this.store.updateSessionStatus(active.sessionId, "active");
          this.store.recordConnectionEvent({
            sessionId: active.sessionId,
            eventType: "connection_resumed",
            details: { gapMs: Date.now() - active.lastDisconnectedAt },
          });
          active.lastDisconnectedAt = null;
        } else {
          this.store.recordConnectionEvent({
            sessionId: active.sessionId,
            eventType: "connection_ready",
          });
        }
      }

      if (newState.status === VoiceConnectionStatus.Disconnected) {
        active.lastDisconnectedAt = Date.now();
        this.store.updateSessionStatus(active.sessionId, "reconnecting");
        this.store.recordConnectionEvent({
          sessionId: active.sessionId,
          eventType: "connection_disconnected",
          level: "warn",
          details: { reason: "VoiceConnectionStatus.Disconnected" },
        });
      }

      if (
        newState.status === VoiceConnectionStatus.Connecting ||
        newState.status === VoiceConnectionStatus.Signalling
      ) {
        this.store.recordConnectionEvent({
          sessionId: active.sessionId,
          eventType: "connection_reconnecting",
          details: { status: newState.status },
        });
      }
    });

    active.connection.on("debug", (message) => {
      const isDave = /dave|encrypt|decrypt|protocol|session/i.test(message);
      this.store.recordConnectionEvent({
        sessionId: active.sessionId,
        eventType: isDave ? "voice_debug_dave_evidence" : "voice_debug",
        level: isDave ? "info" : "debug",
        details: { message },
      });
    });

    active.connection.on("error", (error) => {
      active.fatalErrors += 1;
      this.store.recordConnectionEvent({
        sessionId: active.sessionId,
        eventType: "voice_connection_error",
        level: "error",
        details: safeErrorInfo(error),
      });
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
      this.store.recordConnectionEvent({
        sessionId: active.sessionId,
        eventType: "chunk_start_skipped",
        details: { userId, reason: "already_open" },
      });
      return;
    }

    const seenAtMs = Date.now() - active.startedAtMs;
    const speaker = await this.resolveSpeakerSnapshot(active, userId);
    this.store.upsertSpeaker({
      sessionId: active.sessionId,
      userId,
      displayNameSnapshot: speaker.displayName,
      isBot: speaker.isBot,
      seenAtMs,
    });

    if (speaker.isBot || userId === this.client.user?.id) {
      this.store.recordConnectionEvent({
        sessionId: active.sessionId,
        eventType: "speaking_skipped_bot",
        details: { userId, displayName: speaker.displayName },
      });
      return;
    }

    active.chunkCounter += 1;
    const chunkIndex = active.chunkCounter;
    const chunkLabel = chunkIndex.toString().padStart(6, "0");
    const chunkId = `${active.sessionId}_${chunkLabel}_${userId}`;
    const baseName = `${chunkLabel}_${userId}`;
    const rawPartPath = path.join(active.chunksDir, `${baseName}.part.ogg`);
    const rawFinalPath = path.join(active.chunksDir, `${baseName}.ogg`);
    const startedAtMs = Date.now() - active.startedAtMs;

    this.store.createChunkWriting({
      chunkId,
      sessionId: active.sessionId,
      chunkIndex,
      userId,
      displayNameSnapshot: speaker.displayName,
      startedAtMs,
      rawAudioPath: rawFinalPath,
    });

    const opusStream = active.connection.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: this.config.silenceMs,
      },
    });

    let closeReason = "after_silence";
    let closeRequested = false;
    let softRolloverDue = false;
    const requestClose = (reason: string): void => {
      if (closeRequested) {
        return;
      }
      closeRequested = true;
      closeReason = reason;
      this.store.recordConnectionEvent({
        sessionId: active.sessionId,
        eventType: "chunk_close_requested",
        details: { chunkId, userId, reason },
      });

      try {
        (opusStream as unknown as { push: (chunk: null) => boolean }).push(null);
      } catch {
        opusStream.destroy();
      }
    };

    const softTimer = setTimeout(() => {
      softRolloverDue = true;
      this.store.recordConnectionEvent({
        sessionId: active.sessionId,
        eventType: "chunk_soft_rollover_due",
        details: {
          chunkId,
          userId,
          softRolloverMs: this.config.softRolloverMs,
          action: "다음 silence에서 닫고 hard cap을 backstop으로 유지합니다.",
        },
      });
    }, this.config.softRolloverMs);

    const hardCapTimer = setTimeout(() => {
      requestClose("hard_cap_ms");
    }, this.config.maxChunkMs);

    opusStream.on("error", (error) => {
      this.store.recordConnectionEvent({
        sessionId: active.sessionId,
        eventType: "audio_receive_stream_error",
        level: "error",
        details: { chunkId, userId, error: safeErrorInfo(error) },
      });
    });

    this.store.recordConnectionEvent({
      sessionId: active.sessionId,
      eventType: "chunk_opened",
      startedAtMs,
      details: {
        chunkId,
        userId,
        displayNameSnapshot: speaker.displayName,
        rawAudioPath: rawFinalPath,
        silenceMs: this.config.silenceMs,
        softRolloverMs: this.config.softRolloverMs,
        maxChunkMs: this.config.maxChunkMs,
      },
    });

    const activeChunk: ActiveChunk = {
      chunkId,
      chunkIndex,
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
      [softTimer, hardCapTimer],
      () =>
        closeReason === "after_silence" && softRolloverDue
          ? "after_silence_after_soft_rollover"
          : closeReason,
    );
  }

  private async pipeAndFinalizeChunk(
    active: ActiveSession,
    chunk: ActiveChunk,
    timers: NodeJS.Timeout[],
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
      pipelineError = safeErrorInfo(error);
      this.store.recordConnectionEvent({
        sessionId: active.sessionId,
        eventType: "chunk_pipeline_error",
        level: "warn",
        details: { chunkId: chunk.chunkId, userId: chunk.userId, error: pipelineError },
      });
    } finally {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      active.activeChunks.delete(chunk.userId);
    }

    try {
      await this.finalizeChunk(active, chunk, getCloseReason(), pipelineError);
    } catch (error) {
      this.store.markChunkFailed({
        chunkId: chunk.chunkId,
        error: safeErrorInfo(error),
      });
      this.store.recordRepairItem({
        type: "chunk_finalize_failed",
        sessionId: active.sessionId,
        chunkId: chunk.chunkId,
        path: chunk.rawFinalPath,
        severity: "error",
        details: safeErrorInfo(error),
      });
      this.store.recordConnectionEvent({
        sessionId: active.sessionId,
        eventType: "chunk_finalize_failed",
        level: "error",
        details: { chunkId: chunk.chunkId, error: safeErrorInfo(error) },
      });
    }
  }

  private async finalizeChunk(
    active: ActiveSession,
    chunk: ActiveChunk,
    closeReason: string,
    pipelineError: unknown,
  ): Promise<void> {
    const endedAtMs = Date.now() - active.startedAtMs;
    const rawExists = existsSync(chunk.rawPartPath) || existsSync(chunk.rawFinalPath);

    if (!rawExists) {
      this.store.markChunkFailed({
        chunkId: chunk.chunkId,
        error: { message: "chunk 파일이 생성되지 않았습니다.", pipelineError },
      });
      this.store.recordRepairItem({
        type: "chunk_audio_missing_after_write",
        sessionId: active.sessionId,
        chunkId: chunk.chunkId,
        path: chunk.rawPartPath,
        severity: "error",
      });
      return;
    }

    if (existsSync(chunk.rawPartPath) && !existsSync(chunk.rawFinalPath)) {
      await rename(chunk.rawPartPath, chunk.rawFinalPath);
    }

    const rawStat = await stat(chunk.rawFinalPath);
    const rawPlayback = await validatePlayable(chunk.rawFinalPath, active.ffmpegPath);
    const rawSha256 = rawStat.size > 0 ? await sha256File(chunk.rawFinalPath) : null;
    const durationMs = Math.max(0, endedAtMs - chunk.startedAtMs);

    this.store.finalizeRawChunk({
      chunkId: chunk.chunkId,
      endedAtMs,
      durationMs,
      rawByteSize: rawStat.size,
      rawSha256,
      closeReason,
      pipelineError,
    });

    if (rawStat.size === 0 || !rawPlayback.ok) {
      this.store.markChunkTranscodeFailed({
        chunkId: chunk.chunkId,
        error: rawPlayback.error ?? "raw audio playback validation failed",
      });
      this.store.recordRepairItem({
        type: "raw_audio_not_playable",
        sessionId: active.sessionId,
        chunkId: chunk.chunkId,
        path: chunk.rawFinalPath,
        severity: "error",
        details: { rawByteSize: rawStat.size, rawPlaybackError: rawPlayback.error },
      });
      return;
    }

    const transcode = await transcodeToSttSafe(
      chunk.rawFinalPath,
      active.sttAudioDir,
      chunk.baseName,
      this.config.sttSafeFormat,
      active.ffmpegPath,
    );

    if (!transcode.playbackChecked || transcode.byteSize === 0) {
      this.store.markChunkTranscodeFailed({
        chunkId: chunk.chunkId,
        error: transcode.error ?? "STT-safe transcode validation failed",
      });
      this.store.recordRepairItem({
        type: "stt_transcode_failed",
        sessionId: active.sessionId,
        chunkId: chunk.chunkId,
        path: transcode.outputPath,
        severity: "error",
        details: {
          format: transcode.format,
          byteSize: transcode.byteSize,
          error: transcode.error,
        },
      });
      return;
    }

    const sttSha256 = await sha256File(transcode.outputPath);
    this.store.completeChunkTranscodeAndQueueJob({
      chunkId: chunk.chunkId,
      sttAudioPath: transcode.outputPath,
      sttAudioFormat: transcode.format,
      sttByteSize: transcode.byteSize,
      sttSha256,
      maxAttempts: this.config.sttMaxAttempts,
    });

    this.store.recordConnectionEvent({
      sessionId: active.sessionId,
      eventType: "chunk_finalized_and_queued",
      endedAtMs,
      details: {
        chunkId: chunk.chunkId,
        userId: chunk.userId,
        displayNameSnapshot: chunk.displayNameSnapshot,
        rawAudioPath: chunk.rawFinalPath,
        rawByteSize: rawStat.size,
        rawSha256,
        sttAudioPath: transcode.outputPath,
        sttAudioFormat: transcode.format,
        sttByteSize: transcode.byteSize,
        sttSha256,
        durationMs,
        closeReason,
      },
    });
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
      const member = await active.guild.members.fetch(userId);
      return this.cacheSpeaker(active, userId, member);
    } catch {
      try {
        const user = await this.client.users.fetch(userId);
        const snapshot = {
          displayName: user.globalName ?? user.username ?? userId,
          isBot: user.bot,
        };
        active.speakerSnapshots.set(userId, snapshot);
        return snapshot;
      } catch (error) {
        this.store.recordConnectionEvent({
          sessionId: active.sessionId,
          eventType: "speaker_lookup_failed",
          level: "warn",
          details: { userId, error: safeErrorInfo(error) },
        });
        const snapshot = { displayName: userId, isBot: false };
        active.speakerSnapshots.set(userId, snapshot);
        return snapshot;
      }
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
}

function makeSessionId(date: Date): string {
  const pad = (value: number): string => value.toString().padStart(2, "0");
  return [
    "meeting_",
    date.getFullYear(),
    "_",
    pad(date.getMonth() + 1),
    "_",
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

async function createUniqueSessionDir(
  dataDir: string,
  baseSessionId: string,
): Promise<string> {
  mkdirSync(dataDir, { recursive: true });

  for (let suffix = 0; suffix < 100; suffix += 1) {
    const sessionId =
      suffix === 0 ? baseSessionId : `${baseSessionId}_${suffix.toString().padStart(2, "0")}`;
    const sessionDir = path.join(dataDir, sessionId);
    if (!existsSync(sessionDir)) {
      return sessionDir;
    }
  }

  throw new Error("새 session directory 이름을 만들지 못했습니다.");
}

async function waitForChunkPromises(
  chunks: ActiveChunk[],
  timeoutMs: number,
): Promise<boolean> {
  if (chunks.length === 0) {
    return true;
  }

  let timedOut = false;
  let timer: NodeJS.Timeout | null = null;
  await Promise.race([
    Promise.allSettled(chunks.map((chunk) => chunk.done)),
    new Promise((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve(null);
      }, timeoutMs);
    }),
  ]);
  if (timer) {
    clearTimeout(timer);
  }

  return !timedOut;
}
