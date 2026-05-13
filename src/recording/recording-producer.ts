import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
  ChannelType,
  type Client,
  type Guild,
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
import { safeErrorInfo, toKoreanErrorMessage } from "../errors.js";
import { criticalHealthFailed, runHealthCheck } from "../health.js";
import type {
  RecordingRuntimeState,
  SessionStatus,
  SessionStore,
} from "../storage/session-store.js";
import { ChunkFinalizer } from "./chunk-finalizer.js";
import {
  SpeakerChunkManager,
  type SpeakerSnapshot,
} from "./speaker-chunk-manager.js";
import { VoiceConnectionController } from "./voice-connection-controller.js";

export {
  DEFAULT_SPEAKER_SNAPSHOT_CACHE_LIMIT,
  upsertSpeakerSnapshot,
  type SpeakerSnapshot,
} from "./speaker-chunk-manager.js";

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
  voiceController?: VoiceConnectionController;
  chunkCounter: number;
  fatalErrors: number;
  lastDisconnectedAt: number | null;
};

export type RecordingStopResult = {
  sessionId: string;
  status: SessionStatus;
  sessionDir: string;
};

export class RecordingProducer {
  private active: ActiveSession | null = null;
  private readonly chunkFinalizer: ChunkFinalizer;
  private readonly speakerChunks: SpeakerChunkManager;
  private stopPromise: Promise<RecordingStopResult> | null = null;

  constructor(
    private readonly client: Client,
    private readonly config: Phase1Config,
    private readonly store: SessionStore,
  ) {
    this.chunkFinalizer = new ChunkFinalizer(store, {
      sttMaxAttempts: config.sttMaxAttempts,
      sttSafeFormat: config.sttSafeFormat,
    });
    this.speakerChunks = new SpeakerChunkManager(client, store);
  }

  isActive(): boolean {
    return this.active !== null;
  }

  getRuntimeState(): RecordingRuntimeState {
    return {
      isRecording: this.active !== null,
      sessionId: this.active?.sessionId ?? null,
      guildId: this.active?.guild.id ?? null,
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
      throw new Error("Stage 채널은 현재 Dirong 녹음 앱에서 아직 지원하지 않습니다.");
    }

    const health = await runHealthCheck({ config: this.config });
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
      throw new Error("필수 의존성 health check 실패. npm run doctor를 확인해 주세요.");
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
      voiceController: new VoiceConnectionController(this.store),
      chunkCounter: 0,
      fatalErrors: 0,
      lastDisconnectedAt: null,
    };

    this.active = active;
    active.voiceController?.attach(active, {
      onSpeakingStart: (userId) => {
        void this.openChunkForSpeaker(active, userId);
      },
    });

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
      active.voiceController?.detach();
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
  }): Promise<RecordingStopResult> {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    const active = this.active;
    if (!active) {
      throw new Error("진행 중인 녹음 세션이 없습니다.");
    }

    this.stopPromise = this.stopActiveSession(active, input).finally(() => {
      this.stopPromise = null;
    });
    return this.stopPromise;
  }

  private async stopActiveSession(
    active: ActiveSession,
    input: {
      stoppedByUserId: string;
      stoppedByDisplayName: string;
    },
  ): Promise<RecordingStopResult> {
    this.store.updateSessionStatus(active.sessionId, "stopping");
    this.store.recordConnectionEvent({
      sessionId: active.sessionId,
      eventType: "stop_requested",
      details: {
        stoppedBy: input.stoppedByUserId,
        openChunks: active.activeChunks.size,
      },
    });
    active.voiceController?.detach();

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
    const speaker = await this.speakerChunks.resolveSpeakerSnapshot(active, userId);
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
      await this.chunkFinalizer.finalize(
        active,
        chunk,
        getCloseReason(),
        pipelineError,
      );
    } catch (error) {
      this.chunkFinalizer.recordFailure({
        sessionId: active.sessionId,
        chunkId: chunk.chunkId,
        rawFinalPath: chunk.rawFinalPath,
        error,
      });
    }
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
