import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AiCleanupAutomationSnapshot } from "../ai/cleanup/automation-service.js";
import type { NotionAutomationSnapshot } from "../notion/automation-service.js";
import { SqlRunner } from "../storage/sql-runner.js";
import { DirongDatabase } from "../storage/sqlite.js";
import { ActiveProjectService } from "./active-project-service.js";
import { ProjectStore } from "./project-store.js";

const nowIso = "2026-05-13T00:00:00.000Z";

test("ActiveProjectService switches the active project without restart", async () => {
  const fixture = createFixture();
  try {
    fixture.store.createDraftProject({ id: "project-a", nowIso });
    fixture.store.createReadyProject({ id: "project-b", nowIso });
    fixture.store.setActiveProjectId("project-a", nowIso);

    const service = new ActiveProjectService({
      projectStore: fixture.store,
      now: () => new Date(nowIso),
    });

    const result = await service.switchActiveProject("project-b");

    assert.equal(result.ok, true);
    assert.equal(fixture.store.getActiveProjectId(), "project-b");
    assert.equal(fixture.store.getProjectState()?.switching, 0);
  } finally {
    fixture.close();
  }
});

test("ActiveProjectService blocks unsafe switch targets and runtime conflicts", async () => {
  const fixture = createFixture();
  try {
    fixture.store.createDraftProject({ id: "project-a", nowIso });
    fixture.store.createDraftProject({ id: "project-archived", nowIso });
    fixture.store.createDraftProject({ id: "project-resetting", nowIso });
    fixture.store.archiveProject("project-archived", nowIso);
    fixture.store.markProjectResetting("project-resetting", nowIso);

    assertBlockedReason(
      await new ActiveProjectService({
        projectStore: fixture.store,
        getRecordingRuntimeState: () => ({
          isRecording: true,
          sessionId: "session-1",
          guildId: "guild-1",
          voiceChannelId: "voice-1",
          voiceChannelName: "Voice",
          openChunks: 0,
        }),
      }).switchActiveProject("project-a"),
      "recording_active",
    );

    assertBlockedReason(
      await new ActiveProjectService({
        projectStore: fixture.store,
        getNotionAutomationSnapshot: () => ({
          inFlightDraftIds: ["draft-1"],
        } as NotionAutomationSnapshot),
      }).switchActiveProject("project-a"),
      "notion_upload_in_flight",
    );

    assertBlockedReason(
      await new ActiveProjectService({
        projectStore: fixture.store,
        getAiCleanupAutomationSnapshot: () => ({
          inFlightSessionIds: ["session-1"],
        } as AiCleanupAutomationSnapshot),
      }).switchActiveProject("project-a"),
      "ai_cleanup_in_flight",
    );

    assertBlockedReason(
      await new ActiveProjectService({
        projectStore: fixture.store,
      }).switchActiveProject("project-archived"),
      "project_archived",
    );

    assertBlockedReason(
      await new ActiveProjectService({
        projectStore: fixture.store,
      }).switchActiveProject("project-resetting"),
      "project_resetting",
    );
  } finally {
    fixture.close();
  }
});

test("ActiveProjectService exposes a process-local switching mutex", async () => {
  const fixture = createFixture();
  const deferred = createDeferred<void>();
  try {
    fixture.store.createDraftProject({ id: "project-a", nowIso });
    fixture.store.createDraftProject({ id: "project-b", nowIso });
    const service = new ActiveProjectService({
      projectStore: fixture.store,
      onBeforeActivate: async () => {
        await deferred.promise;
      },
    });

    const first = service.switchActiveProject("project-a");
    const second = await service.switchActiveProject("project-b");

    assert.equal(second.ok, false);
    assert.equal(second.reason, "already_switching");
    assert.equal(fixture.store.getProjectState()?.switching, 1);

    deferred.resolve();
    const firstResult = await first;
    assert.equal(firstResult.ok, true);
    assert.equal(fixture.store.getProjectState()?.switching, 0);
  } finally {
    deferred.resolve();
    fixture.close();
  }
});

function createFixture(): {
  store: ProjectStore;
  close: () => void;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-active-project-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  return {
    store: new ProjectStore(new SqlRunner(database)),
    close: () => {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function assertBlockedReason(
  result: Awaited<ReturnType<ActiveProjectService["switchActiveProject"]>>,
  reason: string,
): void {
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected blocked result");
  }
  assert.equal(result.reason, reason);
}
