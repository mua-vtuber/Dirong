import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AloneFinalizeService,
  formatAloneFinalizeForStatus,
  type AloneFinalizeMemberCountResult,
  type AloneFinalizeProducer,
  type AloneFinalizeStopResult,
} from "./alone-finalize-service.js";
import { RecordingProducer } from "./recording-producer.js";
import type { Phase1Config } from "../config.js";
import type { AppLocaleResolver } from "../i18n/app-locale.js";
import type { RecordingRuntimeState } from "../storage/storage-context.js";
import {
  createStorageContext,
  flattenStorageContext,
  type FlatStorageStore,
} from "../storage/storage-context.js";
import { DirongDatabase } from "../storage/sqlite.js";

test("AloneFinalizeService starts grace timer when everyone leaves", async () => {
  const fixture = createFixture();
  try {
    fixture.memberCount = memberCount({ nonBot: 0, bot: 1 });
    const service = fixture.createService({ graceMs: 5000 });
    service.start();

    await service.handleVoiceStateUpdate({ channelId: "voice" }, { channelId: null });

    const snapshot = service.getSnapshot();
    assert.equal(snapshot.status, "countdown");
    assert.equal(snapshot.remainingMs, 5000);
    assert.equal(
      snapshot.display?.title,
      "디롱이가 혼자 남아 자동 종료를 기다리고 있어요",
    );
    assert.match(snapshot.message, /5초 후 자동 종료/);
    assert.deepEqual(fixture.eventTypes(), ["alone_since"]);
    assert.equal(fixture.producer.stopCalls.length, 0);
  } finally {
    fixture.close();
  }
});

test("AloneFinalizeService localizes runtime snapshot with app locale", async () => {
  const fixture = createFixture();
  try {
    fixture.memberCount = memberCount({ nonBot: 0, bot: 1 });
    const service = fixture.createService({
      graceMs: 5000,
      localeResolver: () => "en",
    });
    service.start();

    await service.handleVoiceStateUpdate({ channelId: "voice" }, { channelId: null });

    const snapshot = service.getSnapshot();
    assert.equal(snapshot.message, "Dirong is alone; recording will stop in 5s");
    assert.equal(
      snapshot.userAction,
      "If someone returns during the grace period, automatic stop is cancelled.",
    );
    assert.equal(
      snapshot.display?.title,
      "Dirong is alone and waiting to stop recording",
    );
  } finally {
    fixture.close();
  }
});

test("AloneFinalizeService cancels grace timer when a human returns", async () => {
  const fixture = createFixture();
  try {
    fixture.memberCount = memberCount({ nonBot: 0, bot: 1 });
    const service = fixture.createService({ graceMs: 5000 });
    service.start();
    await service.handleVoiceStateUpdate({ channelId: "voice" }, { channelId: null });

    fixture.memberCount = memberCount({ nonBot: 1, bot: 1 });
    await service.handleVoiceStateUpdate({ channelId: null }, { channelId: "voice" });

    assert.equal(service.getSnapshot().status, "idle");
    assert.deepEqual(fixture.eventTypes(), ["alone_since", "alone_cancelled"]);
    fixture.clock.tick(5000);
    await Promise.resolve();
    assert.equal(fixture.producer.stopCalls.length, 0);
  } finally {
    fixture.close();
  }
});

test("AloneFinalizeService calls producer.stop after grace expires", async () => {
  const fixture = createFixture();
  try {
    fixture.memberCount = memberCount({ nonBot: 0, bot: 1 });
    const service = fixture.createService({ graceMs: 5000 });
    service.start();
    await service.handleVoiceStateUpdate({ channelId: "voice" }, { channelId: null });

    fixture.clock.tick(5000);
    await fixture.producer.waitForStopCall();
    await fixture.producer.lastStopPromise;
    await flushAsync();

    assert.equal(fixture.producer.stopCalls.length, 1);
    assert.deepEqual(fixture.producer.stopCalls[0], {
      stoppedByUserId: "system_alone",
      stoppedByDisplayName: "디롱이 자동 종료",
    });
    assert.equal(service.getSnapshot().status, "finalized");
    assert.deepEqual(fixture.eventTypes(), [
      "alone_since",
      "alone_finalize_triggered",
    ]);
  } finally {
    fixture.close();
  }
});

test("AloneFinalizeService treats other bots as alone", async () => {
  const fixture = createFixture();
  try {
    fixture.memberCount = memberCount({ nonBot: 0, bot: 3 });
    const service = fixture.createService({ graceMs: 1 });
    service.start();

    await service.handleVoiceStateUpdate({ channelId: "voice" }, { channelId: null });
    fixture.clock.tick(1);
    await fixture.producer.waitForStopCall();

    assert.equal(fixture.producer.stopCalls.length, 1);
  } finally {
    fixture.close();
  }
});

test("AloneFinalizeService does nothing without an active session", async () => {
  const fixture = createFixture();
  try {
    fixture.producer.runtime = {
      isRecording: false,
      sessionId: null,
      voiceChannelId: null,
      voiceChannelName: null,
      openChunks: 0,
    };
    fixture.memberCount = memberCount({ nonBot: 0, bot: 1 });
    const service = fixture.createService({ graceMs: 1 });
    service.start();

    await service.handleVoiceStateUpdate({ channelId: "voice" }, { channelId: null });
    fixture.clock.tick(1);
    await Promise.resolve();

    assert.equal(fixture.producer.stopCalls.length, 0);
    assert.equal(service.getSnapshot().status, "idle");
    assert.deepEqual(fixture.eventTypes(), []);
  } finally {
    fixture.close();
  }
});

test("AloneFinalizeService skips already stopping or finalized sessions", async () => {
  for (const status of ["stopping", "finalized"] as const) {
    const fixture = createFixture();
    try {
      fixture.store.updateSessionStatus(fixture.sessionId, status);
      fixture.memberCount = memberCount({ nonBot: 0, bot: 1 });
      const service = fixture.createService({ graceMs: 1 });
      service.start();

      await service.handleVoiceStateUpdate({ channelId: "voice" }, { channelId: null });
      fixture.clock.tick(1);
      await Promise.resolve();

      assert.equal(fixture.producer.stopCalls.length, 0);
      assert.equal(service.getSnapshot().status, "skipped");
      assert.deepEqual(fixture.eventTypes(), ["alone_finalize_skipped"]);
    } finally {
      fixture.close();
    }
  }
});

test("Recording stop race returns one in-flight stop result without duplicate stop", async () => {
  const fixture = createFixture();
  try {
    fixture.memberCount = memberCount({ nonBot: 0, bot: 1 });
    fixture.producer.blockStop = true;
    const service = fixture.createService({ graceMs: 1 });
    service.start();

    await service.handleVoiceStateUpdate({ channelId: "voice" }, { channelId: null });
    fixture.clock.tick(1);
    await fixture.producer.waitForStopCall();
    const manualStop = fixture.producer.stop({
      stoppedByUserId: "manual",
      stoppedByDisplayName: "manual",
    });

    fixture.producer.releaseStop();
    const [automaticResult, manualResult] = await Promise.all([
      fixture.producer.lastStopPromise,
      manualStop,
    ]);

    assert.equal(fixture.producer.stopCalls.length, 1);
    assert.equal(automaticResult?.sessionId, fixture.sessionId);
    assert.equal(manualResult.sessionId, fixture.sessionId);
  } finally {
    fixture.close();
  }
});

test("RecordingProducer.stop reuses the in-flight stop promise", async () => {
  const fixture = createFixture();
  try {
    let destroyCalls = 0;
    const producer = new RecordingProducer(
      {} as never,
      {} as Phase1Config,
      fixture.store,
    );
    (producer as unknown as { active: unknown }).active = {
      sessionId: fixture.sessionId,
      sessionDir: fixture.dir,
      chunksDir: path.join(fixture.dir, "chunks"),
      sttAudioDir: path.join(fixture.dir, "stt-audio"),
      startedAtMs: 0,
      ffmpegPath: "",
      connection: {
        destroy: () => {
          destroyCalls += 1;
        },
      },
      guild: {},
      channel: { id: "voice", name: "Voice" },
      activeChunks: new Map(),
      speakerSnapshots: new Map(),
      chunkCounter: 0,
      fatalErrors: 0,
      lastDisconnectedAt: null,
    };

    const first = producer.stop({
      stoppedByUserId: "manual",
      stoppedByDisplayName: "manual",
    });
    const second = producer.stop({
      stoppedByUserId: "system_alone",
      stoppedByDisplayName: "디롱이 자동 종료",
    });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.deepEqual(secondResult, firstResult);
    assert.equal(destroyCalls, 1);
    assert.deepEqual(
      fixture.eventTypes().filter((eventType) => eventType === "stop_requested"),
      ["stop_requested"],
    );
  } finally {
    fixture.close();
  }
});

test("AloneFinalizeService defers while reconnecting", async () => {
  const fixture = createFixture();
  try {
    fixture.store.updateSessionStatus(fixture.sessionId, "reconnecting");
    fixture.memberCount = memberCount({ nonBot: 0, bot: 1 });
    const service = fixture.createService({ graceMs: 1 });
    service.start();

    await service.handleVoiceStateUpdate({ channelId: "voice" }, { channelId: null });
    fixture.clock.tick(1);
    await Promise.resolve();

    assert.equal(fixture.producer.stopCalls.length, 0);
    assert.equal(service.getSnapshot().status, "deferred_reconnecting");
    assert.deepEqual(fixture.eventTypes(), ["alone_deferred_reconnecting"]);
  } finally {
    fixture.close();
  }
});

test("AloneFinalizeService skips when member count is uncertain", async () => {
  const fixture = createFixture();
  try {
    fixture.memberCount = {
      ok: false,
      reason: "voice_member_cache_empty",
      technicalDetail: "cache empty",
    };
    const service = fixture.createService({ graceMs: 1 });
    service.start();

    await service.handleVoiceStateUpdate({ channelId: "voice" }, { channelId: null });
    fixture.clock.tick(1);
    await Promise.resolve();

    assert.equal(fixture.producer.stopCalls.length, 0);
    assert.equal(service.getSnapshot().status, "skipped");
    assert.match(service.getSnapshot().technicalDetail ?? "", /cache empty/);
    assert.deepEqual(fixture.eventTypes(), ["alone_finalize_skipped"]);
  } finally {
    fixture.close();
  }
});

test("formatAloneFinalizeForStatus renders countdown", () => {
  const snapshot = {
    enabled: true,
    status: "countdown" as const,
    checkedAt: "2026-05-06T00:00:00.000Z",
    sessionId: "meeting_1",
    voiceChannelId: "voice",
    aloneSince: "2026-05-06T00:00:00.000Z",
    finalizeAt: "2026-05-06T00:01:30.000Z",
    remainingMs: 90000,
    nonBotMemberCount: 0,
    message: "혼자 남음 감지, 90초 후 자동 종료",
    userAction: null,
    technicalDetail: null,
    warnings: [],
  };

  assert.match(
    formatAloneFinalizeForStatus(snapshot),
    /자동 종료까지: 90초/,
  );
  assert.match(
    formatAloneFinalizeForStatus(snapshot, "en"),
    /Auto stop in: 90s/,
  );
});

type Fixture = {
  dir: string;
  database: DirongDatabase;
  store: FlatStorageStore;
  sessionId: string;
  clock: ManualClock;
  producer: FakeProducer;
  memberCount: AloneFinalizeMemberCountResult;
  createService(input: {
    graceMs: number;
    localeResolver?: AppLocaleResolver;
  }): AloneFinalizeService;
  eventTypes(): string[];
  close(): void;
};

function createFixture(): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-alone-finalize-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  const ctx = createStorageContext(database);
  const store = flattenStorageContext(ctx);
  const sessionId = "meeting_alone_finalize_test";
  store.createSession({
    id: sessionId,
    guildId: "guild",
    guildName: "Guild",
    textChannelId: "text",
    voiceChannelId: "voice",
    voiceChannelName: "Voice",
    startedByUserId: "starter",
    startedByDisplayName: "Taniar",
    dataDir: dir,
  });
  store.updateSessionStatus(sessionId, "active");
  const clock = new ManualClock(Date.UTC(2026, 4, 6, 0, 0, 0));
  const producer = new FakeProducer(store, sessionId, dir);
  const fixture: Fixture = {
    dir,
    database,
    store,
    sessionId,
    clock,
    producer,
    memberCount: memberCount({ nonBot: 1, bot: 1 }),
    createService: (input) =>
      new AloneFinalizeService({
        enabled: true,
        graceMs: input.graceMs,
        store,
        producer,
        countNonBotMembers: async () => fixture.memberCount,
        now: () => clock.nowMs,
        setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
        clearTimeout: (timer) => clock.clearTimeout(timer),
        localeResolver: input.localeResolver,
      }),
    eventTypes: () =>
      database.db.prepare(
        "SELECT event_type FROM connection_events ORDER BY id ASC",
      ).all().map((row) => (row as { event_type: string }).event_type),
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return fixture;
}

function memberCount(input: {
  nonBot: number;
  bot: number;
}): AloneFinalizeMemberCountResult {
  return {
    ok: true,
    nonBotMemberCount: input.nonBot,
    botMemberCount: input.bot,
    totalMemberCount: input.nonBot + input.bot,
  };
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

class FakeProducer implements AloneFinalizeProducer {
  runtime: RecordingRuntimeState;
  stopCalls: Array<{
    stoppedByUserId: string;
    stoppedByDisplayName: string;
  }> = [];
  blockStop = false;
  lastStopPromise: Promise<AloneFinalizeStopResult> | null = null;
  private stopPromise: Promise<AloneFinalizeStopResult> | null = null;
  private stopResolver: (() => void) | null = null;
  private stopCallWaiter: (() => void) | null = null;

  constructor(
    private readonly store: FlatStorageStore,
    private readonly sessionId: string,
    private readonly sessionDir: string,
  ) {
    this.runtime = {
      isRecording: true,
      sessionId,
      voiceChannelId: "voice",
      voiceChannelName: "Voice",
      openChunks: 0,
    };
  }

  getRuntimeState(): RecordingRuntimeState {
    return { ...this.runtime };
  }

  async stop(input: {
    stoppedByUserId: string;
    stoppedByDisplayName: string;
  }): Promise<AloneFinalizeStopResult> {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    this.stopCalls.push(input);
    this.store.updateSessionStatus(this.sessionId, "stopping");
    const promise: Promise<AloneFinalizeStopResult> = (async (): Promise<AloneFinalizeStopResult> => {
      if (this.blockStop) {
        await new Promise<void>((resolve) => {
          this.stopResolver = resolve;
        });
      }
      this.store.stopSession({
        sessionId: this.sessionId,
        stoppedByUserId: input.stoppedByUserId,
        stoppedByDisplayName: input.stoppedByDisplayName,
        status: "finalized",
      });
      this.runtime = {
        isRecording: false,
        sessionId: null,
        voiceChannelId: null,
        voiceChannelName: null,
        openChunks: 0,
      };
      return {
        sessionId: this.sessionId,
        status: "finalized",
        sessionDir: this.sessionDir,
      };
    })().finally(() => {
      this.stopPromise = null;
      this.stopResolver = null;
    });
    this.stopPromise = promise;
    this.lastStopPromise = promise;
    this.stopCallWaiter?.();
    return promise;
  }

  waitForStopCall(): Promise<void> {
    if (this.stopCalls.length > 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.stopCallWaiter = resolve;
    });
  }

  releaseStop(): void {
    this.blockStop = false;
    this.stopResolver?.();
  }
}

class ManualClock {
  private nextId = 1;
  private readonly timers = new Map<number, { dueMs: number; callback: () => void }>();

  constructor(public nowMs: number) {}

  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { dueMs: this.nowMs + delayMs, callback });
    return {
      unref: () => undefined,
      [Symbol.toPrimitive]: () => id,
    } as unknown as ReturnType<typeof setTimeout>;
  }

  clearTimeout(timer: ReturnType<typeof setTimeout>): void {
    this.timers.delete(Number(timer));
  }

  tick(ms: number): void {
    this.nowMs += ms;
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.dueMs <= this.nowMs)
      .sort((a, b) => a[1].dueMs - b[1].dueMs);
    for (const [id, timer] of due) {
      this.timers.delete(id);
      timer.callback();
    }
  }
}
