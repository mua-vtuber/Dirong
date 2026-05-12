import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { NOTION_MANAGED_SCHEMA_VERSION } from "../notion/managed-schema.js";
import { NotionRegistryStore } from "../notion/registry-store.js";
import { KOREAN_NOTION_SCHEMA_PRESET } from "../notion/schema-presets.js";
import { DirongDatabase } from "../storage/sqlite.js";
import { SqlRunner } from "../storage/sql-runner.js";

test("doctor tolerates legacy transcript_segments without speech_status", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-doctor-legacy-"));
  try {
    const dbPath = path.join(dir, "dirong.sqlite");
    createLegacyDbWithoutSpeechStatus(dbPath);
    const doctorPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "doctor.js",
    );

    const result = spawnSync(process.execPath, ["--no-warnings", doctorPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PHASE1_DB_PATH: dbPath,
        PHASE3_STT_PROVIDER: "openai",
        OPENAI_API_KEY: "doctor-test-key",
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /transcript segments:/);
    assert.doesNotMatch(result.stderr + result.stdout, /no such column/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor prints local Notion managed registry summary without remote API", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-doctor-notion-local-"));
  try {
    const dbPath = path.join(dir, "dirong.sqlite");
    createManagedNotionRegistryDb(dbPath);
    const doctorPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "doctor.js",
    );
    const rawToken = "ntn_doctor_default_should_not_be_printed";

    const result = spawnSync(process.execPath, ["--no-warnings", doctorPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 5_000,
      env: {
        ...process.env,
        PHASE1_DB_PATH: dbPath,
        PHASE3_STT_PROVIDER: "openai",
        OPENAI_API_KEY: "doctor-test-key",
        NOTION_API_KEY: rawToken,
        NOTION_BASE_URL: "http://127.0.0.1:9",
        NOTION_REQUEST_TIMEOUT_MS: "50",
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /\[Notion managed registry\]/);
    assert.match(result.stdout, /registry: ready, DB=3\/3, mappings=25\/25/);
    assert.match(result.stdout, /remote check는 --notion-remote 옵션/);
    assert.doesNotMatch(result.stderr + result.stdout, new RegExp(rawToken));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor --notion-remote does not leak raw token when remote check fails", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-doctor-notion-remote-"));
  try {
    const dbPath = path.join(dir, "dirong.sqlite");
    createManagedNotionRegistryDb(dbPath);
    const doctorPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "doctor.js",
    );
    const rawToken = "ntn_doctor_remote_should_not_be_printed";

    const result = spawnSync(
      process.execPath,
      ["--no-warnings", doctorPath, "--notion-remote"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          PHASE1_DB_PATH: dbPath,
          PHASE3_STT_PROVIDER: "openai",
          OPENAI_API_KEY: "doctor-test-key",
          NOTION_API_KEY: rawToken,
          NOTION_BASE_URL: "http://127.0.0.1:9",
          NOTION_REQUEST_TIMEOUT_MS: "50",
        },
      },
    );

    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /\[Notion remote managed schema\]/);
    assert.match(result.stdout, /status=failed|Notion remote check/);
    assert.doesNotMatch(result.stderr + result.stdout, new RegExp(rawToken));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createLegacyDbWithoutSpeechStatus(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL
);

CREATE TABLE stt_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL
);

CREATE TABLE transcript_segments (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL
);

CREATE TABLE repair_items (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL
);
`);
  } finally {
    db.close();
  }
}

function createManagedNotionRegistryDb(dbPath: string): void {
  const database = new DirongDatabase(dbPath, 1_000);
  try {
    const store = new NotionRegistryStore(new SqlRunner(database));
    seedManagedNotionRegistry(store);
    database.db.prepare(
      `INSERT INTO repair_items (
         dedupe_key, session_id, item_type, status, severity, path,
         chunk_id, stt_job_id, details_json, created_at, updated_at
       ) VALUES (?, NULL, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)`,
    ).run(
      "notion_managed_schema:meeting",
      "notion_managed_schema",
      "repaired",
      "info",
      JSON.stringify({
        role: "meeting",
        status: "healthy",
        operations: [],
      }),
      "2026-05-12T00:00:00.000Z",
      "2026-05-12T00:00:00.000Z",
    );
  } finally {
    database.close();
  }
}

function seedManagedNotionRegistry(store: NotionRegistryStore): void {
  const nowIso = "2026-05-12T00:00:00.000Z";
  store.saveWorkspaceSettings({
    locale: "ko",
    parentPageUrl: "https://www.notion.so/workspace/Dirong-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    parentPageId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    nowIso,
  });
  for (const role of ["meeting", "member", "task"] as const) {
    store.upsertManagedDatabase({
      role,
      locale: "ko",
      databaseId: `${role}-db`,
      dataSourceId: `${role}-ds`,
      url: `https://notion.so/${role}`,
      name: KOREAN_NOTION_SCHEMA_PRESET.databases[role].name,
      createdByDirong: true,
      schemaVersion: NOTION_MANAGED_SCHEMA_VERSION,
      nowIso,
    });
    for (const property of KOREAN_NOTION_SCHEMA_PRESET.databases[role].properties) {
      store.upsertPropertyMapping({
        databaseRole: role,
        semanticKey: property.key,
        propertyName: property.name,
        propertyId: `prop-${property.key.replaceAll(".", "-")}`,
        propertyType: property.type,
        locked: property.locked,
        sourceKind: property.type === "rollup" ? "rollup" : "system",
        nowIso,
      });
    }
  }
}
