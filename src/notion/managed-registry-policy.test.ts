import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SqlRunner } from "../storage/sql-runner.js";
import { DirongDatabase } from "../storage/sqlite.js";
import {
  blockPartialManagedNotionRegistry,
  hasCompleteManagedNotionUploadRegistry,
} from "./managed-registry-policy.js";
import { NotionRegistryStore } from "./registry-store.js";

test("managed registry policy returns no block for missing registries", () => {
  assert.equal(blockPartialManagedNotionRegistry(null), null);
  assert.equal(hasCompleteManagedNotionUploadRegistry(null), false);
});

test("managed registry policy formats partial registry blocks consistently", () => {
  const fixture = createFixture();
  try {
    fixture.store.upsertManagedDatabase({
      role: "meeting",
      locale: "ko",
      databaseId: "meeting-db",
      dataSourceId: "meeting-ds",
      url: "https://notion.so/meeting",
      name: "회의록",
      createdByDirong: true,
      schemaVersion: "test",
      nowIso: "2026-05-11T00:00:00.000Z",
    });

    const block = blockPartialManagedNotionRegistry(fixture.store, {
      includeDatabases: true,
    });

    assert.ok(block);
    assert.equal(block.message, "Managed Notion registry is incomplete.");
    assert.match(block.userAction, /legacy target/);
    assert.match(block.technicalDetail, /missingSemanticKeys/);
    assert.equal(hasCompleteManagedNotionUploadRegistry(fixture.store), false);
  } finally {
    fixture.close();
  }
});

function createFixture(): {
  store: NotionRegistryStore;
  close: () => void;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-notion-policy-"));
  const database = new DirongDatabase(path.join(dir, "dirong.sqlite"), 1000);
  return {
    store: new NotionRegistryStore(new SqlRunner(database)),
    close: () => {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
