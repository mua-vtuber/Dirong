import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ChannelType, type Client, type Guild, type VoiceBasedChannel } from "discord.js";
import {
  DEFAULT_SPEAKER_SNAPSHOT_CACHE_LIMIT,
  RecordingProducer,
  upsertSpeakerSnapshot,
  type SpeakerSnapshot,
} from "./recording-producer.js";
import { ChunkFinalizer } from "./chunk-finalizer.js";
import type { Phase1Config } from "../config.js";
import type { HealthReport } from "../health.js";
import type {
  ChunkFinalizerStore,
  RecordingProducerStore,
} from "./storage-port.js";

test("speaker snapshot cache never grows beyond its cap", () => {
  const cache = new Map<string, SpeakerSnapshot>();

  for (let index = 0; index < DEFAULT_SPEAKER_SNAPSHOT_CACHE_LIMIT + 5; index += 1) {
    upsertSpeakerSnapshot(cache, `user-${index}`, {
      displayName: `User ${index}`,
      isBot: false,
    });
  }

  assert.equal(cache.size, DEFAULT_SPEAKER_SNAPSHOT_CACHE_LIMIT);
  assert.equal(cache.has("user-0"), false);
  assert.equal(cache.has(`user-${DEFAULT_SPEAKER_SNAPSHOT_CACHE_LIMIT + 4}`), true);
});

test("speaker snapshot cache refreshes existing entries as most recent", () => {
  const cache = new Map<string, SpeakerSnapshot>();
  upsertSpeakerSnapshot(cache, "a", { displayName: "A", isBot: false }, 2);
  upsertSpeakerSnapshot(cache, "b", { displayName: "B", isBot: false }, 2);
  upsertSpeakerSnapshot(cache, "a", { displayName: "A2", isBot: false }, 2);
  upsertSpeakerSnapshot(cache, "c", { displayName: "C", isBot: false }, 2);

  assert.deepEqual([...cache.keys()], ["a", "c"]);
  assert.equal(cache.get("a")?.displayName, "A2");
});

test("recording start forwards projectId into created session", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "dirong-recording-project-"));
  const createdSessions: Array<Parameters<RecordingProducerStore["createSession"]>[0]> = [];
  const store = createRecordingStoreSpy(createdSessions);
  const producer = new RecordingProducer(
    { user: { id: "bot-user" } } as Client,
    createConfig(dataDir),
    store,
    { runHealthCheck: async () => createCriticalHealthReport() },
  );

  await assert.rejects(
    producer.start({
      guild: {
        id: "guild-active",
        name: "Guild Active",
        voiceAdapterCreator: {},
      } as Guild,
      voiceChannel: {
        id: "voice-1",
        name: "Voice 1",
        type: ChannelType.GuildVoice,
      } as VoiceBasedChannel,
      projectId: "project-a",
      textChannelId: "text-1",
      startedByUserId: "user-1",
      startedByDisplayName: "User One",
    }),
  );

  assert.equal(createdSessions.length, 1);
  assert.equal(createdSessions[0]?.projectId, "project-a");

  rmSync(dataDir, { recursive: true, force: true });
});

test("RecordingProducer localizes direct user-facing errors", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "dirong-recording-locale-"));
  const producer = new RecordingProducer(
    { user: { id: "bot-user" } } as Client,
    createConfig(dataDir),
    createRecordingStoreSpy([]),
    { localeResolver: () => "en" },
  );

  try {
    await assert.rejects(
      producer.start({
        guild: {
          id: "guild-active",
          name: "Guild Active",
          voiceAdapterCreator: {},
        } as Guild,
        voiceChannel: {
          id: "stage-1",
          name: "Stage 1",
          type: ChannelType.GuildStageVoice,
        } as VoiceBasedChannel,
        projectId: "project-a",
        textChannelId: "text-1",
        startedByUserId: "user-1",
        startedByDisplayName: "User One",
      }),
      /Stage channels are not supported/,
    );
    await assert.rejects(
      producer.stop({
        stoppedByUserId: "user-1",
        stoppedByDisplayName: "User One",
      }),
      /There is no active recording session/,
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("ChunkFinalizer ignores zero-byte raw chunks without opening repair errors", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dirong-empty-chunk-"));
  try {
    const rawPartPath = path.join(dir, "chunk.part.ogg");
    const rawFinalPath = path.join(dir, "chunk.ogg");
    writeFileSync(rawPartPath, "");

    const ignoredChunks: Array<Parameters<ChunkFinalizerStore["ignoreChunk"]>[0]> = [];
    const repairItems: Array<Parameters<ChunkFinalizerStore["recordRepairItem"]>[0]> = [];
    const connectionEvents: Array<
      Parameters<ChunkFinalizerStore["recordConnectionEvent"]>[0]
    > = [];
    let finalizedRawCount = 0;
    let transcodeFailedCount = 0;
    const store: ChunkFinalizerStore = {
      ignoreChunk(input) {
        ignoredChunks.push(input);
      },
      recordRepairItem(input) {
        repairItems.push(input);
      },
      recordConnectionEvent(input) {
        connectionEvents.push(input);
      },
      finalizeRawChunk() {
        finalizedRawCount += 1;
      },
      markChunkTranscodeFailed() {
        transcodeFailedCount += 1;
      },
      markChunkFailed() {},
      completeChunkTranscodeAndQueueJob() {},
    };
    const finalizer = new ChunkFinalizer(store, {
      sttMaxAttempts: 3,
      sttSafeFormat: "webm",
    });

    await finalizer.finalize(
      {
        sessionId: "session-1",
        sttAudioDir: dir,
        startedAtMs: Date.now() - 10,
        ffmpegPath: "ffmpeg",
      },
      {
        chunkId: "chunk-1",
        userId: "user-1",
        displayNameSnapshot: "User One",
        startedAtMs: 0,
        rawPartPath,
        rawFinalPath,
        baseName: "chunk",
      },
      "after_silence",
      {
        message: "Failed to decrypt: DecryptionFailed(UnencryptedWhenPassthroughDisabled)",
      },
    );

    assert.equal(existsSync(rawPartPath), false);
    assert.equal(existsSync(rawFinalPath), true);
    assert.equal(finalizedRawCount, 0);
    assert.equal(transcodeFailedCount, 0);
    assert.equal(ignoredChunks.length, 1);
    assert.equal(ignoredChunks[0]?.chunkId, "chunk-1");
    assert.equal(ignoredChunks[0]?.rawByteSize, 0);
    assert.equal(ignoredChunks[0]?.reason, "empty raw audio chunk skipped before STT");
    assert.equal(repairItems.length, 1);
    assert.equal(repairItems[0]?.type, "raw_audio_not_playable");
    assert.equal(repairItems[0]?.status, "ignored");
    assert.equal(repairItems[0]?.severity, "info");
    assert.equal(connectionEvents.length, 1);
    assert.equal(connectionEvents[0]?.eventType, "empty_audio_chunk_ignored");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// === Phase 2 RELY-05: 60s force-close branch ===
//
// Drives `executeForceCloseBranch` past its 60s timeout via Node 22 built-in
// mock timers (`t.mock.timers`). The branch was extracted from
// `stopActiveSession` as a byte-equivalent refactor because driving the full
// Discord voice-connection flow would require >100 lines of stubs (per plan
// T5 fallback path / executor advisory A2). Confirms RELY-05 success: when
// the chunk close never completes (opusStream.destroy() is a no-op), the
// store records a `chunk_finalize_timeout` repair item AND fatalErrors > 0.
test("executeForceCloseBranch writes chunk_finalize_timeout repair items when the 60s force-close fails", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const dataDir = mkdtempSync(path.join(tmpdir(), "dirong-recording-force-close-"));
  try {
    const repairItems: Array<Parameters<RecordingProducerStore["recordRepairItem"]>[0]> = [];
    const connectionEvents: Array<
      Parameters<RecordingProducerStore["recordConnectionEvent"]>[0]
    > = [];
    const store = createRecordingStoreSpy([], {
      onRepairItem: (input) => repairItems.push(input),
      onConnectionEvent: (input) => connectionEvents.push(input),
    });

    const producer = new RecordingProducer(
      { user: { id: "bot-user" } } as Client,
      createConfig(dataDir),
      store,
      { localeResolver: () => "en" },
    );

    const sessionId = "meeting_2026_05_16_120000";
    const chunkId = `${sessionId}_000001_user-1`;
    const rawFinalPath = path.join(dataDir, sessionId, "chunks", "000001_user-1.ogg");

    // Fake opus stream whose destroy() is a no-op — simulates the failure
    // mode where Discord's AudioReceiveStream never emits end/close/error.
    const fakeOpusStream = {
      destroy: () => {
        /* no-op: chunk close promise never resolves */
      },
    };

    // Chunk.done is a never-resolving promise — guarantees the 60s
    // waitForChunkPromises timeout elapses.
    const neverResolving = new Promise<void>(() => {
      /* never resolves */
    });

    const activeChunk = {
      chunkId,
      chunkIndex: 1,
      userId: "user-1",
      displayNameSnapshot: "User One",
      startedAtMs: 0,
      rawPartPath: rawFinalPath.replace(/\.ogg$/, ".part.ogg"),
      rawFinalPath,
      baseName: "000001_user-1",
      opusStream: fakeOpusStream,
      done: neverResolving,
      requestClose: () => {
        /* no-op */
      },
    };

    const activeChunks = new Map<string, typeof activeChunk>([
      ["user-1", activeChunk],
    ]);

    const active = {
      sessionId,
      projectId: null,
      sessionDir: path.join(dataDir, sessionId),
      chunksDir: path.join(dataDir, sessionId, "chunks"),
      sttAudioDir: path.join(dataDir, sessionId, "stt-audio"),
      startedAtMs: 0,
      ffmpegPath: "/usr/bin/ffmpeg",
      connection: {} as never,
      guild: {} as never,
      channel: {} as never,
      activeChunks,
      speakerSnapshots: new Map(),
      voiceController: undefined,
      chunkCounter: 1,
      fatalErrors: 0,
      lastDisconnectedAt: null,
    };

    const stoppingChunks = [...activeChunks.values()];

    // Invoke the extracted force-close branch directly.
    const branchPromise = (
      producer as unknown as {
        executeForceCloseBranch: (a: typeof active, s: typeof stoppingChunks) => Promise<void>;
      }
    ).executeForceCloseBranch(active, stoppingChunks);

    // Advance through the 60s force-close timeout. tick() fires the inner
    // setTimeout(..., 60000) synchronously; awaiting branchPromise then
    // drains the microtask queue so the repair-item writes have run.
    t.mock.timers.tick(60_000);
    await branchPromise;

    // RELY-05 primary assertion: chunk_finalize_timeout repair item written.
    const timeoutItems = repairItems.filter(
      (item) => item.type === "chunk_finalize_timeout",
    );
    assert.equal(timeoutItems.length, 1);
    const item = timeoutItems[0];
    assert.equal(item?.sessionId, sessionId);
    assert.equal(item?.chunkId, chunkId);
    assert.equal(item?.path, rawFinalPath);
    assert.equal(item?.severity, "error");

    // RELY-05 ordering assertion: chunk_force_destroy_requested was recorded
    // BEFORE the repair item (the destroy attempt always precedes the
    // forced-close-timeout repair write).
    const forceDestroyIdx = connectionEvents.findIndex(
      (e) => e.eventType === "chunk_force_destroy_requested",
    );
    assert.ok(forceDestroyIdx >= 0, "chunk_force_destroy_requested must be recorded");
    assert.equal(connectionEvents[forceDestroyIdx]?.level, "warn");

    // RELY-05 secondary: helper increments fatalErrors so the caller marks
    // the session as needs_repair.
    assert.equal(active.fatalErrors, 1);
  } finally {
    t.mock.timers.reset();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

type RecordingStoreSpyOptions = {
  onRepairItem?: (input: Parameters<RecordingProducerStore["recordRepairItem"]>[0]) => void;
  onConnectionEvent?: (
    input: Parameters<RecordingProducerStore["recordConnectionEvent"]>[0],
  ) => void;
};

function createRecordingStoreSpy(
  createdSessions: Array<Parameters<RecordingProducerStore["createSession"]>[0]>,
  options: RecordingStoreSpyOptions = {},
): RecordingProducerStore {
  return {
    createSession(input) {
      createdSessions.push(input);
    },
    updateSessionStatus() {},
    stopSession() {},
    getSession() {
      return null;
    },
    recordConnectionEvent(input) {
      options.onConnectionEvent?.(input);
    },
    recordRepairItem(input) {
      options.onRepairItem?.(input);
    },
    upsertSpeaker() {},
    createChunkWriting() {},
    finalizeRawChunk() {},
    ignoreChunk() {},
    markChunkTranscodeFailed() {},
    markChunkFailed() {},
    completeChunkTranscodeAndQueueJob() {},
  };
}

function createCriticalHealthReport(): HealthReport {
  return {
    generatedAt: "2026-05-13T00:00:00.000Z",
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    packageVersions: {},
    ffmpeg: {
      path: null,
      source: "test",
    },
    opusLibrary: null,
    daveLibrary: null,
    aes256GcmAvailable: true,
    discordConfig: {
      botToken: "present",
      clientId: "present",
      guildId: "present",
      voiceChannelId: "missing",
    },
    checks: [
      {
        name: "FFmpeg",
        status: "fail",
        message: "test failure",
      },
    ],
    dependencyReport: "",
  };
}

function createConfig(dataDir: string): Phase1Config {
  return {
    discordBotToken: "token",
    discordClientId: "client",
    guildId: "guild-active",
    guildIds: ["guild-active"],
    dataDir,
    dbPath: ":memory:",
    dbBusyTimeoutMs: 1000,
    silenceMs: 100,
    softRolloverMs: 1000,
    maxChunkMs: 2000,
    sttSafeFormat: "wav",
    sttMaxAttempts: 3,
    sttLeaseMs: 1000,
    partRepairAgeMs: 1000,
    enableDave: false,
    decryptionFailureTolerance: 0,
    debugVoice: false,
    autoRegisterCommands: false,
    dashboardHost: "127.0.0.1",
    dashboardPort: 0,
    openDashboard: false,
    aloneFinalizeEnabled: false,
    aloneFinalizeGraceMs: 1000,
  };
}
