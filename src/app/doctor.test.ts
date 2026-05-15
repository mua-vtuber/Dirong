import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
import {
  getDirongUserDataPaths,
  resolveDirongUserDataPath,
} from "../settings/dirong-user-data.js";
import { LocalSettingsStore } from "../settings/local-settings-store.js";
import { DEFAULT_SECRET_REFS, LocalSecretStore } from "../settings/local-secret-store.js";

test("doctor tolerates legacy transcript_segments without speech_status", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-doctor-legacy-"));
  try {
    const fixture = createDoctorFixture(dir);
    createLegacyDbWithoutSpeechStatus(fixture.paths.databasePath);
    const doctorPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "doctor.js",
    );

    const result = spawnSync(process.execPath, ["--no-warnings", doctorPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: fixture.env,
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
    const rawToken = "ntn_doctor_default_should_not_be_printed";
    const fixture = createDoctorFixture(dir, { notionToken: rawToken });
    createManagedNotionRegistryDb(fixture.paths.databasePath);
    const doctorPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "doctor.js",
    );

    const result = spawnSync(process.execPath, ["--no-warnings", doctorPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 5_000,
      env: fixture.env,
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

test("doctor prints English output when app locale is English", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-doctor-en-"));
  try {
    const fixture = createDoctorFixture(dir, { locale: "en" });
    createManagedNotionRegistryDb(fixture.paths.databasePath);
    const doctorPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "doctor.js",
    );

    const result = spawnSync(process.execPath, ["--no-warnings", doctorPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 5_000,
      env: fixture.env,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Dirong Recording \+ STT doctor results/);
    assert.match(result.stdout, /Created at:/);
    assert.match(
      result.stdout,
      /remote checks call the Notion API only with --notion-remote/,
    );
    assert.match(result.stdout, /This doctor is read-only/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor --notion-remote reports missing product token without env fallback", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-doctor-notion-remote-"));
  try {
    const fixture = createDoctorFixture(dir, {
      envOverrides: {
        NOTION_API_KEY: "env-notion-token-must-not-be-used",
      },
    });
    createManagedNotionRegistryDb(fixture.paths.databasePath);
    const doctorPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "doctor.js",
    );

    const result = spawnSync(
      process.execPath,
      ["--no-warnings", doctorPath, "--notion-remote"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 10_000,
        env: fixture.env,
      },
    );

    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /\[Notion remote managed schema\]/);
    assert.match(result.stdout, /Notion 연결 토큰이 저장되지 않아 remote check/);
    assert.doesNotMatch(result.stderr + result.stdout, /env-notion-token-must-not-be-used/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createDoctorFixture(
  dir: string,
  options: {
    notionToken?: string;
    locale?: "ko" | "en";
    envOverrides?: Record<string, string>;
  } = {},
): {
  env: NodeJS.ProcessEnv;
  paths: ReturnType<typeof getDirongUserDataPaths>;
} {
  const env = {
    ...process.env,
    LOCALAPPDATA: dir,
    APPDATA: dir,
    XDG_DATA_HOME: dir,
    ...options.envOverrides,
  };
  const root = resolveDirongUserDataPath({
    env,
    platform: process.platform,
  });
  const paths = getDirongUserDataPaths(root);
  const settingsStore = new LocalSettingsStore(paths.settingsFile);
  const secretStore = new LocalSecretStore(paths.secretsFile);

  settingsStore.write({
    schemaVersion: 1,
    app: { locale: options.locale ?? "ko" },
    discord: {},
    stt: {
      provider: "openai",
      openAiApiKeySecretRef: DEFAULT_SECRET_REFS.openAiApiKey,
    },
    ai: {},
    notion: options.notionToken
      ? {
          tokenSecretRef: DEFAULT_SECRET_REFS.notionToken,
          parentPageUrl:
            "https://www.notion.so/workspace/Dirong-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        }
      : {},
    recording: { aloneFinalizeEnabled: true, aloneFinalizeGraceMs: 90000 },
    retention: { deleteAudioAfterNotionUpload: true, textDraftRetentionDays: 30 },
  });
  secretStore.set(DEFAULT_SECRET_REFS.openAiApiKey, "doctor-test-openai-key");
  if (options.notionToken) {
    secretStore.set(DEFAULT_SECRET_REFS.notionToken, options.notionToken);
  }
  mkdirSync(paths.sessionsDir, { recursive: true });

  return { env, paths };
}

function createLegacyDbWithoutSpeechStatus(dbPath: string): void {
  mkdirSync(path.dirname(dbPath), { recursive: true });
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
  mkdirSync(path.dirname(dbPath), { recursive: true });
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
