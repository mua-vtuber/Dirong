import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DirongError } from "../../errors.js";
import { SessionStore } from "../../storage/session-store.js";
import { DirongDatabase } from "../../storage/sqlite.js";
import {
  FakeAiCleanupProvider,
  InvalidSchemaAiCleanupProvider,
  MalformedJsonAiCleanupProvider,
  RepairingInvalidSchemaAiCleanupProvider,
} from "./fake-provider.js";
import type {
  AiCleanupProviderInput,
  AiCleanupProviderOptions,
  AiCleanupProviderResetReason,
  AiCleanupProviderResult,
} from "./provider.js";
import { PHASE4_AI_CLEANUP_PROMPT_VERSION } from "./prompts.js";
import { runAiCleanupForSession } from "./runner.js";
import { buildPhase4TimelineInput, sha256Text } from "./timeline-input.js";

test("runAiCleanupForSession dry-run does not change the DB", async () => {
  const fixture = createFinalizedTranscriptFixture();
  try {
    const before = fixture.countAiRows();
    const readOnlyStore = new SessionStore(
      new DirongDatabase(fixture.dbPath, 1000, { readOnly: true }),
    );
    try {
      const result = await runAiCleanupForSession(readOnlyStore, {
        ...baseRunOptions(fixture.sessionId),
        dryRun: true,
        provider: new FakeAiCleanupProvider(),
      });

      assert.equal(result.status, "dry_run");
      assert.equal(result.dbChanged, false);
      assert.equal(result.inputEntryCount, 1);
    } finally {
      readOnlyStore.close();
    }
    assert.deepEqual(fixture.countAiRows(), before);
  } finally {
    fixture.close();
  }
});

test("runAiCleanupForSession with fake provider creates job and draft", async () => {
  const fixture = createFinalizedTranscriptFixture();
  try {
    const result = await runAiCleanupForSession(fixture.store, {
      ...baseRunOptions(fixture.sessionId),
      provider: new FakeAiCleanupProvider(),
      backup: () => ["backup.sqlite"],
    });

    assert.equal(result.status, "done");
    assert.equal(result.job?.status, "done");
    assert.equal(result.draft?.schema_version, "dirong.meeting_notes_draft.v1");
    assert.deepEqual(fixture.countAiRows(), {
      jobs: 1,
      drafts: 1,
      attempts: 1,
    });
    assert.ok(result.draft?.json_path && existsSync(result.draft.json_path));
    assert.ok(result.draft?.markdown_path && existsSync(result.draft.markdown_path));
    const draftJson = JSON.parse(readFileSync(result.draft.json_path, "utf8")) as {
      markdown?: unknown;
      meetingTitle?: { text?: unknown };
    };
    const draftMarkdown = readFileSync(result.draft.markdown_path, "utf8");
    assert.equal("markdown" in draftJson, false);
    assert.equal(draftJson.meetingTitle?.text, result.draft.title);
    assert.equal(result.draft.draft_json.includes('"markdown"'), false);
    assert.match(draftMarkdown, /^## 요약$/m);
    assert.match(draftMarkdown, /^## 주요 주제$/m);
    assert.equal(result.draft.markdown, draftMarkdown.trimEnd());
  } finally {
    fixture.close();
  }
});

test("runAiCleanupForSession creates English draft artifacts when locale is en", async () => {
  const fixture = createFinalizedTranscriptFixture();
  try {
    const baseTimelineInput = buildPhase4TimelineInput(fixture.store, {
      sessionId: fixture.sessionId,
    });
    const result = await runAiCleanupForSession(fixture.store, {
      ...baseRunOptions(fixture.sessionId),
      locale: "en",
      provider: new FakeAiCleanupProvider(),
      backup: () => [],
    });

    assert.equal(result.status, "done");
    assert.notEqual(result.inputHash, baseTimelineInput.inputHash);
    const draftJson = JSON.parse(readFileSync(result.draft?.json_path ?? "", "utf8")) as {
      language?: unknown;
      meetingTitle?: { text?: unknown };
    };
    const draftMarkdown = readFileSync(result.draft?.markdown_path ?? "", "utf8");
    const prompt = readFileSync(result.job?.prompt_path ?? "", "utf8");
    assert.equal(draftJson.language, "en");
    assert.match(String(draftJson.meetingTitle?.text), /^Meeting notes draft:/);
    assert.match(draftMarkdown, /^## Summary$/m);
    assert.match(draftMarkdown, /^## Key Topics$/m);
    assert.match(prompt, /language must be exactly "en"/);
  } finally {
    fixture.close();
  }
});

test("runAiCleanupForSession includes roster prompt in prompt artifact and input hash", async () => {
  const fixture = createFinalizedTranscriptFixture();
  try {
    const baseTimelineInput = buildPhase4TimelineInput(fixture.store, {
      sessionId: fixture.sessionId,
    });
    const result = await runAiCleanupForSession(fixture.store, {
      ...baseRunOptions(fixture.sessionId),
      provider: new FakeAiCleanupProvider(),
      memberRosterPrompt: () =>
        [
          "Known member roles for assignment hints:",
          "- Taniar: roles=UI; organization=Product",
        ].join("\n"),
      backup: () => [],
    });
    const prompt = readFileSync(result.job?.prompt_path ?? "", "utf8");

    assert.equal(result.status, "done");
    assert.notEqual(result.inputHash, baseTimelineInput.inputHash);
    assert.match(prompt, /Member roster assignment hints/);
    assert.match(prompt, /Taniar: roles=UI/);
    assert.doesNotMatch(prompt, /page-id|ntn_/);
  } finally {
    fixture.close();
  }
});

test("runAiCleanupForSession resets provider after a completed session", async () => {
  const fixture = createFinalizedTranscriptFixture();
  const provider = new ResetCountingFakeAiCleanupProvider();
  try {
    const result = await runAiCleanupForSession(fixture.store, {
      ...baseRunOptions(fixture.sessionId),
      provider,
      backup: () => [],
    });

    assert.equal(result.status, "done");
    assert.deepEqual(provider.resetReasons, ["success"]);
  } finally {
    fixture.close();
  }
});

test("runAiCleanupForSession blocks fake-only timeline by default without provider call", async () => {
  const fixture = createFinalizedTranscriptFixture({
    text: "[FAKE STT] 테스트 전사용 transcript입니다.",
    source: "fake",
    provider: "dirong-fake-stt",
    model: "fake-v1",
  });
  const provider = new CountingFakeAiCleanupProvider();
  try {
    const result = await runAiCleanupForSession(fixture.store, {
      ...baseRunOptions(fixture.sessionId),
      provider,
      backup: () => [],
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.job?.status, "blocked");
    assert.equal(result.job?.failure_kind, "empty_timeline");
    assert.equal(result.inputEntryCount, 0);
    assert.equal(provider.preflightCalls, 0);
    assert.equal(provider.generateCalls, 0);
    assert.match(result.error ?? "", /실제 STT 발화/);
    assert.match(result.error ?? "", /--include-fake-stt/);
  } finally {
    fixture.close();
  }
});

test("runAiCleanupForSession can include fake STT for explicit smoke tests", async () => {
  const fixture = createFinalizedTranscriptFixture({
    text: "[FAKE STT] 테스트 전사용 transcript입니다.",
    source: "fake",
    provider: "dirong-fake-stt",
    model: "fake-v1",
  });
  try {
    const result = await runAiCleanupForSession(fixture.store, {
      ...baseRunOptions(fixture.sessionId),
      provider: new FakeAiCleanupProvider(),
      includeFakeStt: true,
      backup: () => [],
    });

    assert.equal(result.status, "done");
    assert.equal(result.inputEntryCount, 1);
    assert.equal(result.draft?.provider, "fake");
  } finally {
    fixture.close();
  }
});

test("runAiCleanupForSession blocks fake STT include for non-fake providers", async () => {
  const fixture = createFinalizedTranscriptFixture({
    text: "[FAKE STT] 테스트 전사용 transcript입니다.",
    source: "fake",
    provider: "dirong-fake-stt",
    model: "fake-v1",
  });
  const provider = new CountingNonFakeAiCleanupProvider();
  try {
    const result = await runAiCleanupForSession(fixture.store, {
      ...baseRunOptions(fixture.sessionId),
      provider,
      includeFakeStt: true,
      backup: () => [],
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.job?.status, "blocked");
    assert.equal(result.job?.failure_kind, "unsafe_input");
    assert.equal(result.inputEntryCount, 1);
    assert.equal(provider.preflightCalls, 0);
    assert.equal(provider.generateCalls, 0);
    assert.match(result.error ?? "", /fake STT/);
    assert.match(result.error ?? "", /실제 AI cleanup provider/);
  } finally {
    fixture.close();
  }
});

test("runAiCleanupForSession prompt version bump does not collide with legacy job id", async () => {
  const fixture = createFinalizedTranscriptFixture();
  try {
    const timelineInput = buildPhase4TimelineInput(fixture.store, {
      sessionId: fixture.sessionId,
    });
    const legacyJobId = makeLegacyAiCleanupJobId({
      sessionId: fixture.sessionId,
      provider: "fake",
      model: "fake-meeting-notes-v1",
      inputHash: timelineInput.inputHash,
    });
    fixture.store.getOrCreateAiCleanupJob({
      id: legacyJobId,
      sessionId: fixture.sessionId,
      provider: "fake",
      model: "fake-meeting-notes-v1",
      command: null,
      promptVersion: "phase4-ai-cleanup-v1",
      inputContractVersion: timelineInput.timeline.contractVersion,
      inputHash: timelineInput.inputHash,
      inputEntryCount: timelineInput.timeline.entries.length,
      inputTimelineJsonPath: null,
      inputTimelineMarkdownPath: null,
      maxAttempts: 3,
    });

    const result = await runAiCleanupForSession(fixture.store, {
      ...baseRunOptions(fixture.sessionId),
      provider: new FakeAiCleanupProvider(),
      backup: () => [],
    });

    assert.equal(result.status, "done");
    assert.notEqual(result.job?.id, legacyJobId);
    assert.deepEqual(fixture.countAiRows(), {
      jobs: 2,
      drafts: 1,
      attempts: 1,
    });
  } finally {
    fixture.close();
  }
});

test("runAiCleanupForSession already_done returns the draft for the completed job", async () => {
  const fixture = createFinalizedTranscriptFixture();
  try {
    const firstProvider = new ModelNamedFakeAiCleanupProvider("fake-model-a");
    const secondProvider = new ModelNamedFakeAiCleanupProvider("fake-model-b");
    const first = await runAiCleanupForSession(fixture.store, {
      ...baseRunOptions(fixture.sessionId),
      provider: firstProvider,
      backup: () => [],
    });
    const second = await runAiCleanupForSession(fixture.store, {
      ...baseRunOptions(fixture.sessionId),
      provider: secondProvider,
      backup: () => [],
    });

    assert.equal(first.status, "done");
    assert.equal(second.status, "done");
    assert.notEqual(first.draft?.id, second.draft?.id);

    const repeat = await runAiCleanupForSession(fixture.store, {
      ...baseRunOptions(fixture.sessionId),
      provider: firstProvider,
      backup: () => [],
    });

    assert.equal(repeat.status, "already_done");
    assert.equal(repeat.draft?.ai_cleanup_job_id, first.job?.id);
    assert.equal(repeat.draft?.model, "fake-model-a");
  } finally {
    fixture.close();
  }
});

test("runAiCleanupForSession backup failure leaves existing job attempts unchanged", async () => {
  const fixture = createFinalizedTranscriptFixture();
  try {
    const timelineInput = buildPhase4TimelineInput(fixture.store, {
      sessionId: fixture.sessionId,
    });
    fixture.store.getOrCreateAiCleanupJob({
      id: "preexisting_ai_job",
      sessionId: fixture.sessionId,
      provider: "fake",
      model: "fake-meeting-notes-v1",
      command: null,
      promptVersion: PHASE4_AI_CLEANUP_PROMPT_VERSION,
      inputContractVersion: timelineInput.timeline.contractVersion,
      inputHash: timelineInput.inputHash,
      inputEntryCount: timelineInput.timeline.entries.length,
      inputTimelineJsonPath: null,
      inputTimelineMarkdownPath: null,
      maxAttempts: 3,
    });

    assert.equal(fixture.readAiAttempts(), 0);
    await assert.rejects(
      () =>
        runAiCleanupForSession(fixture.store, {
          ...baseRunOptions(fixture.sessionId),
          provider: new FakeAiCleanupProvider(),
          backup: () => {
            throw new DirongError("TEST_BACKUP_FAILED", "backup failed");
          },
        }),
      /backup failed/,
    );
    assert.equal(fixture.readAiAttempts(), 0);
  } finally {
    fixture.close();
  }
});

test("runAiCleanupForSession marks malformed JSON as failed when max attempts is 1", async () => {
  const fixture = createFinalizedTranscriptFixture();
  try {
    const result = await runAiCleanupForSession(fixture.store, {
      ...baseRunOptions(fixture.sessionId),
      provider: new MalformedJsonAiCleanupProvider(),
      maxAttempts: 1,
      backup: () => [],
    });

    assert.equal(result.status, "failed");
    assert.equal(result.job?.status, "failed");
    assert.equal(result.job?.failure_kind, "malformed_json");
    assert.equal(fixture.countAiRows().drafts, 0);
    assert.ok(result.job?.raw_output_path && existsSync(result.job.raw_output_path));
  } finally {
    fixture.close();
  }
});

test("runAiCleanupForSession completes when schema repair succeeds", async () => {
  const fixture = createFinalizedTranscriptFixture();
  try {
    const result = await runAiCleanupForSession(fixture.store, {
      ...baseRunOptions(fixture.sessionId),
      provider: new RepairingInvalidSchemaAiCleanupProvider(),
      maxAttempts: 1,
      backup: () => [],
    });

    assert.equal(result.status, "done");
    assert.equal(result.job?.status, "done");
    assert.equal(result.draft?.schema_version, "dirong.meeting_notes_draft.v1");
    assert.equal(fixture.countAiRows().drafts, 1);
    assert.ok(result.draft?.raw_output_path.includes("raw.repair."));
    assert.ok(result.draft?.raw_output_path && existsSync(result.draft.raw_output_path));
  } finally {
    fixture.close();
  }
});

test("runAiCleanupForSession resets the provider before schema repair", async () => {
  const fixture = createFinalizedTranscriptFixture();
  const provider = new ResetAwareRepairingInvalidSchemaAiCleanupProvider();
  try {
    const result = await runAiCleanupForSession(fixture.store, {
      ...baseRunOptions(fixture.sessionId),
      provider,
      maxAttempts: 1,
      backup: () => [],
    });

    assert.equal(result.status, "done");
    assert.deepEqual(provider.resetReasons, [
      "before_repair",
      "request_success",
    ]);
  } finally {
    fixture.close();
  }
});

test("runAiCleanupForSession marks schema invalid output as failed after repair fails", async () => {
  const fixture = createFinalizedTranscriptFixture();
  try {
    const result = await runAiCleanupForSession(fixture.store, {
      ...baseRunOptions(fixture.sessionId),
      provider: new InvalidSchemaAiCleanupProvider(),
      maxAttempts: 1,
      backup: () => [],
    });

    assert.equal(result.status, "failed");
    assert.equal(result.job?.status, "failed");
    assert.equal(result.job?.failure_kind, "schema_invalid");
    assert.equal(fixture.countAiRows().drafts, 0);
    assert.match(result.error ?? "", /repair/);
  } finally {
    fixture.close();
  }
});

function baseRunOptions(sessionId: string) {
  return {
    sessionId,
    dryRun: false,
    workerId: "ai-cleanup-test",
    leaseMs: 60000,
    maxAttempts: 3,
    maxInputChars: 120000,
    timeoutMs: 1000,
    maxOutputBytes: 1024 * 1024,
  };
}

function createFinalizedTranscriptFixture(input: {
  text?: string;
  source?: string;
  provider?: string;
  model?: string;
} = {}): {
  dir: string;
  dbPath: string;
  store: SessionStore;
  sessionId: string;
  close: () => void;
  countAiRows: () => { jobs: number; drafts: number; attempts: number };
  readAiAttempts: () => number;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-ai-cleanup-"));
  const dbPath = path.join(dir, "dirong.sqlite");
  const database = new DirongDatabase(dbPath, 1000);
  const store = new SessionStore(database);
  const sessionId = "meeting_ai_cleanup_test";
  const chunkId = `${sessionId}_000001_speaker`;

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
  store.upsertSpeaker({
    sessionId,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    isBot: false,
    seenAtMs: 0,
  });
  store.createChunkWriting({
    chunkId,
    sessionId,
    chunkIndex: 1,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    startedAtMs: 1000,
    rawAudioPath: path.join(dir, "chunk.ogg"),
  });
  store.finalizeRawChunk({
    chunkId,
    endedAtMs: 2000,
    durationMs: 1000,
    rawByteSize: 10,
    rawSha256: "raw",
    closeReason: "test",
    pipelineError: null,
  });
  store.completeChunkTranscodeAndQueueJob({
    chunkId,
    sttAudioPath: path.join(dir, "chunk.webm"),
    sttAudioFormat: "webm",
    sttByteSize: 10,
    sttSha256: "stt",
    maxAttempts: 3,
  });

  const sttJob = store.claimNextSttJob({
    workerId: "ai-cleanup-fixture",
    leaseMs: 60000,
    sessionId,
  });
  assert.ok(sttJob);
  store.completeSttJob({
    job: sttJob,
    text: input.text ?? "제가 금요일까지 회의록을 정리할게요.",
    source: input.source ?? "real",
    provider: input.provider ?? "local-whisper",
    model: input.model ?? "small",
    inputAudioSha256: "stt",
  });
  store.stopSession({
    sessionId,
    stoppedByUserId: "starter",
    stoppedByDisplayName: "Taniar",
    status: "finalized",
  });

  return {
    dir,
    dbPath,
    store,
    sessionId,
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
    countAiRows: () => {
      const row = database.db.prepare(
        `SELECT
           (SELECT COUNT(*) FROM ai_cleanup_jobs) AS jobs,
           (SELECT COUNT(*) FROM meeting_notes_drafts) AS drafts,
           COALESCE((SELECT SUM(attempts) FROM ai_cleanup_jobs), 0) AS attempts`,
      ).get() as { jobs: number; drafts: number; attempts: number };
      return {
        jobs: row.jobs,
        drafts: row.drafts,
        attempts: row.attempts,
      };
    },
    readAiAttempts: () => {
      const row = database.db.prepare(
        "SELECT COALESCE(SUM(attempts), 0) AS attempts FROM ai_cleanup_jobs",
      ).get() as { attempts: number };
      return row.attempts;
    },
  };
}

class ModelNamedFakeAiCleanupProvider extends FakeAiCleanupProvider {
  override readonly modelName: string;

  constructor(modelName: string) {
    super();
    this.modelName = modelName;
  }
}

class CountingFakeAiCleanupProvider extends FakeAiCleanupProvider {
  preflightCalls = 0;
  generateCalls = 0;

  override async preflight(): Promise<void> {
    this.preflightCalls += 1;
  }

  override async generate(
    input: AiCleanupProviderInput,
    options: AiCleanupProviderOptions,
  ): Promise<AiCleanupProviderResult> {
    this.generateCalls += 1;
    return super.generate(input, options);
  }
}

class CountingNonFakeAiCleanupProvider extends CountingFakeAiCleanupProvider {
  override readonly providerName = "claude-cli";
}

class ResetCountingFakeAiCleanupProvider extends FakeAiCleanupProvider {
  readonly resetReasons: string[] = [];

  async resetAfterRequest(reason: "success" | "failure" | "timeout"): Promise<void> {
    this.resetReasons.push(reason);
  }
}

class ResetAwareRepairingInvalidSchemaAiCleanupProvider extends RepairingInvalidSchemaAiCleanupProvider {
  readonly resetReasons: AiCleanupProviderResetReason[] = [];

  async resetSession(reason: AiCleanupProviderResetReason): Promise<void> {
    this.resetReasons.push(reason);
  }
}

function makeLegacyAiCleanupJobId(input: {
  sessionId: string;
  provider: string;
  model: string;
  inputHash: string;
}): string {
  const stable = sha256Text(
    `${input.sessionId}\n${input.provider}\n${input.model}\n${input.inputHash}`,
  ).slice(0, 16);
  return `ai_${sanitizePathPart(input.sessionId).slice(0, 48)}_${stable}`;
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 80) || "unknown";
}
