import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { RecordingRuntimeState } from "./storage-context.js";
import {
  createStorageContext,
  type StorageContext,
} from "./storage-context.js";
import { DirongDatabase } from "./sqlite.js";
import { SqlRunner } from "./sql-runner.js";
import { ProjectStore } from "../projects/project-store.js";

const DASHBOARD_PROJECT_ID = "proj-dashboard";

test("SessionStore dashboard read model returns current session slices", () => {
  const fixture = createFixture();
  try {
    seedDashboardSession(fixture);
    const runtime: RecordingRuntimeState = {
      isRecording: false,
      sessionId: fixture.sessionId,
      voiceChannelId: null,
      voiceChannelName: null,
      openChunks: 0,
    };

    const state = fixture.ctx.reads.getDashboardState(
      runtime,
      DASHBOARD_PROJECT_ID,
    ) as {
      currentSession?: { id: string };
      speakers?: Array<{ user_id: string }>;
      recentChunks?: Array<{ id: string; stt_job_id: string }>;
      currentSessionChunkStats?: { total: number };
      recentSttJobs?: Array<{ id: string; status: string }>;
      currentSessionQueueStats?: Array<{ status: string; count: number }>;
      queueStats?: Array<{ status: string; count: number }>;
    };

    assert.equal(state.currentSession?.id, fixture.sessionId);
    assert.equal(state.speakers?.[0]?.user_id, "speaker");
    assert.equal(state.recentChunks?.[0]?.id, fixture.chunkId);
    assert.equal(state.recentChunks?.[0]?.stt_job_id, `stt_${fixture.chunkId}`);
    assert.deepEqual(state.currentSessionChunkStats, { total: 1 });
    assert.equal(state.recentSttJobs?.[0]?.status, "queued");
    assert.deepEqual(state.currentSessionQueueStats, [
      { status: "queued", count: 1 },
    ]);
    assert.deepEqual(state.queueStats, [{ status: "queued", count: 1 }]);
  } finally {
    fixture.close();
  }
});

test("SessionStore dashboard read model counts all current-session chunks", () => {
  const fixture = createFixture();
  try {
    seedDashboardSession(fixture);
    for (let index = 2; index <= 75; index += 1) {
      seedQueuedChunk(fixture, index);
    }
    const runtime: RecordingRuntimeState = {
      isRecording: false,
      sessionId: fixture.sessionId,
      voiceChannelId: null,
      voiceChannelName: null,
      openChunks: 0,
    };

    const state = fixture.ctx.reads.getDashboardState(
      runtime,
      DASHBOARD_PROJECT_ID,
    ) as {
      recentChunks?: Array<{ id: string }>;
      currentSessionChunkStats?: { total: number };
    };

    assert.equal(state.recentChunks?.length, 50);
    assert.deepEqual(state.currentSessionChunkStats, { total: 75 });
  } finally {
    fixture.close();
  }
});

test("SessionStore dashboard read model counts all current-session STT jobs", () => {
  const fixture = createFixture();
  try {
    seedDashboardSession(fixture);
    for (let index = 2; index <= 36; index += 1) {
      seedQueuedChunk(fixture, index);
    }
    const runtime: RecordingRuntimeState = {
      isRecording: false,
      sessionId: fixture.sessionId,
      voiceChannelId: null,
      voiceChannelName: null,
      openChunks: 0,
    };

    const state = fixture.ctx.reads.getDashboardState(
      runtime,
      DASHBOARD_PROJECT_ID,
    ) as {
      recentSttJobs?: Array<{ id: string; status: string }>;
      currentSessionQueueStats?: Array<{ status: string; count: number }>;
    };

    assert.equal(state.recentSttJobs?.length, 30);
    assert.deepEqual(state.currentSessionQueueStats, [
      { status: "queued", count: 36 },
    ]);
  } finally {
    fixture.close();
  }
});

test("SessionStore dashboard read model returns latest Notion write without secrets", () => {
  const fixture = createFixture();
  try {
    seedDashboardSession(fixture);
    seedNotionWrite(fixture);
    const runtime: RecordingRuntimeState = {
      isRecording: false,
      sessionId: fixture.sessionId,
      voiceChannelId: null,
      voiceChannelName: null,
      openChunks: 0,
    };

    const state = fixture.ctx.reads.getDashboardState(
      runtime,
      DASHBOARD_PROJECT_ID,
    ) as {
      latestNotionWrite?: {
        id: string;
        status: string;
        notion_page_url: string;
        last_error: string | null;
      };
    };
    const serialized = JSON.stringify(state);

    assert.equal(state.latestNotionWrite?.id, "notion-write-dashboard");
    assert.equal(state.latestNotionWrite?.status, "done");
    assert.equal(
      state.latestNotionWrite?.notion_page_url,
      "https://notion.so/page",
    );
    assert.doesNotMatch(serialized, /ntn_/);
  } finally {
    fixture.close();
  }
});

type DashboardFixture = {
  dir: string;
  database: DirongDatabase;
  ctx: StorageContext;
  sessionId: string;
  chunkId: string;
  close: () => void;
};

function createFixture(): DashboardFixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-dashboard-read-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  const ctx = createStorageContext(database);
  const sessionId = "meeting_dashboard_read";
  const chunkId = `${sessionId}_000001_speaker`;
  return {
    dir,
    database,
    ctx,
    sessionId,
    chunkId,
    close: () => {
      ctx.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function seedDashboardSession(fixture: DashboardFixture): void {
  const projects = new ProjectStore(new SqlRunner(fixture.database));
  projects.createReadyProject({
    id: DASHBOARD_PROJECT_ID,
    name: "Dashboard Project",
  });
  fixture.ctx.writes.createSession({
    id: fixture.sessionId,
    projectId: DASHBOARD_PROJECT_ID,
    guildId: "guild",
    guildName: "Guild",
    textChannelId: "text",
    voiceChannelId: "voice",
    voiceChannelName: "Voice",
    startedByUserId: "starter",
    startedByDisplayName: "Taniar",
    dataDir: fixture.dir,
  });
  fixture.ctx.writes.upsertSpeaker({
    sessionId: fixture.sessionId,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    isBot: false,
    seenAtMs: 0,
  });
  fixture.ctx.writes.createChunkWriting({
    chunkId: fixture.chunkId,
    sessionId: fixture.sessionId,
    chunkIndex: 1,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    startedAtMs: 0,
    rawAudioPath: path.join(fixture.dir, "chunk.ogg"),
  });
  fixture.ctx.writes.finalizeRawChunk({
    chunkId: fixture.chunkId,
    endedAtMs: 1000,
    durationMs: 1000,
    rawByteSize: 10,
    rawSha256: "raw-sha",
    closeReason: "test",
    pipelineError: null,
  });
  fixture.ctx.writes.completeChunkTranscodeAndQueueJob({
    chunkId: fixture.chunkId,
    sttAudioPath: path.join(fixture.dir, "chunk.webm"),
    sttAudioFormat: "webm",
    sttByteSize: 10,
    sttSha256: "stt-sha",
    maxAttempts: 3,
  });
}

function seedQueuedChunk(fixture: DashboardFixture, chunkIndex: number): void {
  const chunkId = `${fixture.sessionId}_${String(chunkIndex).padStart(6, "0")}_speaker`;
  fixture.ctx.writes.createChunkWriting({
    chunkId,
    sessionId: fixture.sessionId,
    chunkIndex,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    startedAtMs: chunkIndex * 1000,
    rawAudioPath: path.join(fixture.dir, `${chunkId}.ogg`),
  });
  fixture.ctx.writes.finalizeRawChunk({
    chunkId,
    endedAtMs: chunkIndex * 1000 + 1000,
    durationMs: 1000,
    rawByteSize: 10,
    rawSha256: `raw-sha-${chunkIndex}`,
    closeReason: "test",
    pipelineError: null,
  });
  fixture.ctx.writes.completeChunkTranscodeAndQueueJob({
    chunkId,
    sttAudioPath: path.join(fixture.dir, `${chunkId}.webm`),
    sttAudioFormat: "webm",
    sttByteSize: 10,
    sttSha256: `stt-sha-${chunkIndex}`,
    maxAttempts: 3,
  });
}

function seedNotionWrite(fixture: DashboardFixture): void {
  const now = "2026-05-07T00:00:00.000Z";
  fixture.database.db
    .prepare(
      `INSERT INTO ai_cleanup_jobs (
         id, session_id, status, attempts, max_attempts, locked_by,
         locked_until, next_attempt_at, provider, model, command,
         prompt_version, input_contract_version, input_hash, input_entry_count,
         input_timeline_json_path, input_timeline_markdown_path, prompt_path,
         raw_output_path, stderr_path, parsed_json_path, markdown_path,
         output_hash, failure_kind, last_error, created_at, updated_at
       ) VALUES (
         'ai-dashboard', ?, 'done', 1, 3, NULL, NULL, ?, 'fake', 'model',
         NULL, 'prompt-v1', 'timeline-v1', 'input-hash-dashboard', 1,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'output-hash',
         NULL, NULL, ?, ?
       )`,
    )
    .run(fixture.sessionId, now, now, now);
  fixture.database.db
    .prepare(
      `INSERT INTO meeting_notes_drafts (
         id, session_id, ai_cleanup_job_id, schema_version, language, title,
         summary_text, draft_json, markdown, json_path, markdown_path,
         raw_output_path, provider, model, prompt_version, input_hash,
         output_hash, validation_status, created_at, updated_at
       ) VALUES (
         'draft-dashboard', ?, 'ai-dashboard', 'v1', 'ko', '회의록', '요약',
         '{}', '# 회의록', 'draft.json', 'draft.md', 'raw.txt', 'fake',
         'model', 'prompt-v1', 'input-hash', 'output-hash', 'valid', ?, ?
       )`,
    )
    .run(fixture.sessionId, now, now);
  fixture.database.db
    .prepare(
      `INSERT INTO notion_writes (
         id, session_id, draft_id, target_type, target_id, target_url,
         notion_page_id, notion_page_url, content_hash, status,
         status_message, attempts, max_attempts, next_attempt_at, last_error,
         created_at, updated_at
       ) VALUES (
         'notion-write-dashboard', ?, 'draft-dashboard', 'data_source',
         'target-dashboard', 'https://notion.so/db', 'page-dashboard',
         'https://notion.so/page', 'hash-dashboard', 'done',
         'complete', 1, 3, ?, NULL, ?, ?
       )`,
    )
    .run(fixture.sessionId, now, now, now);
}

type ProjectScopeFixture = {
  dir: string;
  database: DirongDatabase;
  ctx: StorageContext;
  close: () => void;
};

function createProjectScopeFixture(): ProjectScopeFixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-dashboard-scope-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  const ctx = createStorageContext(database);
  return {
    dir,
    database,
    ctx,
    close: () => {
      ctx.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Seed one project with: a session, a chunk that produces a queued stt_job, and
// a repair item bound to that session. Returns the session id.
function seedProjectWithData(
  fixture: ProjectScopeFixture,
  projects: ProjectStore,
  projectId: string,
): string {
  projects.createReadyProject({ id: projectId, name: projectId });
  const sessionId = `sess-${projectId}`;
  const chunkId = `${sessionId}_000001_speaker`;
  fixture.ctx.writes.createSession({
    id: sessionId,
    projectId,
    guildId: `guild-${projectId}`,
    guildName: null,
    textChannelId: null,
    voiceChannelId: `voice-${projectId}`,
    voiceChannelName: null,
    startedByUserId: "starter",
    startedByDisplayName: "Taniar",
    dataDir: fixture.dir,
  });
  fixture.ctx.writes.upsertSpeaker({
    sessionId,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    isBot: false,
    seenAtMs: 0,
  });
  fixture.ctx.writes.createChunkWriting({
    chunkId,
    sessionId,
    chunkIndex: 1,
    userId: "speaker",
    displayNameSnapshot: "Taniar",
    startedAtMs: 0,
    rawAudioPath: path.join(fixture.dir, `${chunkId}.ogg`),
  });
  fixture.ctx.writes.finalizeRawChunk({
    chunkId,
    endedAtMs: 1000,
    durationMs: 1000,
    rawByteSize: 10,
    rawSha256: "raw-sha",
    closeReason: "test",
    pipelineError: null,
  });
  fixture.ctx.writes.completeChunkTranscodeAndQueueJob({
    chunkId,
    sttAudioPath: path.join(fixture.dir, `${chunkId}.webm`),
    sttAudioFormat: "webm",
    sttByteSize: 10,
    sttSha256: "stt-sha",
    maxAttempts: 3,
  });
  fixture.ctx.writes.recordRepairItem({
    type: "chunk_missing_audio",
    status: "open",
    severity: "warn",
    sessionId,
    chunkId,
  });
  return sessionId;
}

type ScopedDashboardState = {
  currentSession: { id: string; project_id: string | null } | null;
  recentSttJobs: Array<{ id: string; session_id: string }>;
  recentRepairItems: Array<{ id: number; session_id: string | null }>;
  queueStats: Array<{ status: string; count: number }>;
  currentSessionQueueStats: Array<{ status: string; count: number }>;
  currentSessionChunkStats: { total: number };
  recentChunks: unknown[];
  recentConnectionEvents: Array<{
    session_id: string | null;
    event_type: string;
  }>;
  speakers: unknown[];
  latestMeetingNotesDraft: unknown | null;
  latestNotionWrite: unknown | null;
};

const NO_RUNTIME_SESSION: RecordingRuntimeState = {
  isRecording: false,
  sessionId: null,
  voiceChannelId: null,
  voiceChannelName: null,
  openChunks: 0,
};

test("dashboard read model scopes panels to the active project only", () => {
  const fixture = createProjectScopeFixture();
  try {
    const projects = new ProjectStore(new SqlRunner(fixture.database));
    const sessionA = seedProjectWithData(fixture, projects, "proj-a");
    seedProjectWithData(fixture, projects, "proj-b");

    const state = fixture.ctx.reads.getDashboardState(
      NO_RUNTIME_SESSION,
      "proj-a",
    ) as ScopedDashboardState;

    // currentSession is project A's latest session, never B's, never global.
    assert.equal(state.currentSession?.id, sessionA);

    // Every stt_job / repair item belongs to project A's session only.
    assert.equal(state.recentSttJobs.length, 1);
    assert.equal(state.recentSttJobs[0]?.session_id, sessionA);
    assert.equal(state.recentRepairItems.length, 1);
    assert.equal(state.recentRepairItems[0]?.session_id, sessionA);

    // queueStats counts only project A's one queued job (not 2 across A + B).
    assert.deepEqual(state.queueStats, [{ status: "queued", count: 1 }]);
    assert.deepEqual(state.currentSessionQueueStats, [
      { status: "queued", count: 1 },
    ]);
    assert.deepEqual(state.currentSessionChunkStats, { total: 1 });
  } finally {
    fixture.close();
  }
});

test("dashboard read model excludes orphan repair items from every project", () => {
  const fixture = createProjectScopeFixture();
  try {
    const projects = new ProjectStore(new SqlRunner(fixture.database));
    seedProjectWithData(fixture, projects, "proj-a");
    // Orphan repair item: no session (session_id stays null). It belongs to no
    // project and must not surface under any active project.
    fixture.ctx.writes.recordRepairItem({
      type: "startup_repair_failed",
      status: "open",
      severity: "error",
      sessionId: null,
    });

    const state = fixture.ctx.reads.getDashboardState(
      NO_RUNTIME_SESSION,
      "proj-a",
    ) as ScopedDashboardState;

    // The orphan is excluded by the INNER JOIN; only A's session-bound item shows.
    assert.equal(state.recentRepairItems.length, 1);
    assert.equal(state.recentRepairItems[0]?.session_id, "sess-proj-a");
    assert.ok(
      state.recentRepairItems.every((item) => item.session_id !== null),
      "no orphan (session_id=null) repair item leaks into a project view",
    );
  } finally {
    fixture.close();
  }
});

test("dashboard read model scopes connection events to the active project's session", () => {
  const fixture = createProjectScopeFixture();
  try {
    const projects = new ProjectStore(new SqlRunner(fixture.database));
    const sessionA = seedProjectWithData(fixture, projects, "proj-a");
    const sessionB = seedProjectWithData(fixture, projects, "proj-b");
    // A connection event bound to each project's session.
    fixture.ctx.writes.recordConnectionEvent({
      sessionId: sessionA,
      eventType: "voice_connected",
    });
    fixture.ctx.writes.recordConnectionEvent({
      sessionId: sessionB,
      eventType: "voice_connected",
    });

    const state = fixture.ctx.reads.getDashboardState(
      NO_RUNTIME_SESSION,
      "proj-a",
    ) as ScopedDashboardState;

    // Project A's session event surfaces; project B's never leaks in.
    assert.equal(state.recentConnectionEvents.length, 1);
    assert.equal(state.recentConnectionEvents[0]?.session_id, sessionA);
    assert.equal(state.recentConnectionEvents[0]?.event_type, "voice_connected");
    assert.ok(
      state.recentConnectionEvents.every(
        (event) => event.session_id === sessionA,
      ),
      "no other project's connection event leaks into a project view",
    );
  } finally {
    fixture.close();
  }
});

test("dashboard read model excludes orphan connection events from every project", () => {
  const fixture = createProjectScopeFixture();
  try {
    const projects = new ProjectStore(new SqlRunner(fixture.database));
    const sessionA = seedProjectWithData(fixture, projects, "proj-a");
    // A real session-bound connection event for project A.
    fixture.ctx.writes.recordConnectionEvent({
      sessionId: sessionA,
      eventType: "voice_connected",
    });
    // Orphan system event: no session (session_id stays null), e.g. a startup
    // repair failure. It belongs to no project and must not surface under any
    // active project's connection-events panel.
    fixture.ctx.writes.recordConnectionEvent({
      sessionId: null,
      eventType: "startup_repair_failed",
      level: "error",
    });

    const state = fixture.ctx.reads.getDashboardState(
      NO_RUNTIME_SESSION,
      "proj-a",
    ) as ScopedDashboardState;

    // Only A's session-bound event shows; the orphan is excluded by the
    // strict session-scope filter (session_id = ? never matches NULL).
    assert.equal(state.recentConnectionEvents.length, 1);
    assert.equal(state.recentConnectionEvents[0]?.session_id, sessionA);
    assert.equal(state.recentConnectionEvents[0]?.event_type, "voice_connected");
    assert.ok(
      state.recentConnectionEvents.every((event) => event.session_id !== null),
      "no orphan (session_id=null) connection event leaks into a project view",
    );
  } finally {
    fixture.close();
  }
});

test("dashboard read model returns empty state when no active project", () => {
  const fixture = createProjectScopeFixture();
  try {
    const projects = new ProjectStore(new SqlRunner(fixture.database));
    // Seed real data for a project, then ask with activeProjectId = null.
    seedProjectWithData(fixture, projects, "proj-a");

    const state = fixture.ctx.reads.getDashboardState(
      NO_RUNTIME_SESSION,
      null,
    ) as ScopedDashboardState;

    // No global fallback: every project-scoped panel is empty / null.
    assert.equal(state.currentSession, null);
    assert.deepEqual(state.recentSttJobs, []);
    assert.deepEqual(state.recentRepairItems, []);
    assert.deepEqual(state.queueStats, []);
    assert.deepEqual(state.currentSessionQueueStats, []);
    assert.deepEqual(state.currentSessionChunkStats, { total: 0 });
    assert.deepEqual(state.recentChunks, []);
    assert.deepEqual(state.recentConnectionEvents, []);
    assert.deepEqual(state.speakers, []);
    assert.equal(state.latestMeetingNotesDraft, null);
    assert.equal(state.latestNotionWrite, null);
  } finally {
    fixture.close();
  }
});
