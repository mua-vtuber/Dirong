import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
import type { Phase1Config } from "../config.js";
import type { HealthReport } from "../health.js";
import type { RecordingProducerStore } from "./storage-port.js";

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

function createRecordingStoreSpy(
  createdSessions: Array<Parameters<RecordingProducerStore["createSession"]>[0]>,
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
    recordConnectionEvent() {},
    recordRepairItem() {},
    upsertSpeaker() {},
    createChunkWriting() {},
    finalizeRawChunk() {},
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
