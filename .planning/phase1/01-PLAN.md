---
phase: 01-storage-foundation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/storage/sql-runner.ts
  - src/storage/migrations.ts
  - src/storage/migrations.test.ts
  - src/storage/migrations-test-helpers.ts
  - src/storage/schema-consistency.test.ts
  - src/storage/sqlite.ts
  - src/storage/repair-scan.ts
  - src/storage/session-store.ts
  - src/storage/session-write-store.ts
  - src/storage/session-read-store.ts
  - src/storage/job-queue-store.ts
  - src/storage/runtime-state-store.ts
  - src/storage/storage-context.ts
  - src/storage/path-mapping.ts
  - src/storage/store-helpers.ts
  - src/storage/storage-context.test.ts
  - src/storage/session-write-store.test.ts
  - src/storage/session-read-store.test.ts
  - src/storage/job-queue-store.test.ts
  - src/storage/runtime-state-store.test.ts
  - src/storage/session-store-paths.test.ts
  - src/storage/session-store-ai-cleanup.test.ts
  - src/storage/session-purge.test.ts
  - src/storage/dashboard-read-model.test.ts
  - src/app/main.ts
  - src/app/ai-cleanup.ts
  - src/app/fake-stt.ts
  - src/app/real-stt.ts
  - src/app/repair.ts
  - src/app/sqlite-backup.test.ts
  - src/notion/draft-input.ts
  - src/notion/draft-input-read-model.ts
  - src/notion/test-fixtures.ts
  - src/recording/alone-finalize-service.test.ts
  - src/recording/voice-connection-controller.test.ts
  - src/stt/automation-service.test.ts
  - src/ai/cleanup/runner.test.ts
  - src/ai/cleanup/automation-service.test.ts
  - src/dashboard/server.test.ts
  - src/transcript/timeline.test.ts
  - package.json
autonomous: true
requirements:
  - STORE-01
  - STORE-02
  - STORE-03
  - TEST-02

must_haves:
  truths:
    - "No production `*.ts` file outside `src/storage/` imports from `./session-store` or `../**/session-store` — verified by the grep success-criterion in ROADMAP.md."
    - "Every numbered migration runs inside a single `SqlRunner.transaction()` call. The runner's transaction wrapper is `SqlRunner.transaction<T>()`, not a parallel `db.exec(\"BEGIN IMMEDIATE\")` body."
    - "If `db.exec` throws between two SQL fragments inside any migration's `apply(db)`, the `dirong_migrations` ledger has no row for that migration and `PRAGMA table_info` for every touched table matches the pre-migration snapshot. The next `applySchemaMigrations` call re-runs the failed migration cleanly."
    - "Each numbered migration applied twice into a fresh DB produces identical schema (`PRAGMA table_info` + `PRAGMA index_list`) on both runs."
    - "`npm run build && npm test` exits 0; every new `*.test.ts` added by this plan has its compiled `dist/.../*.test.js` path enumerated in `package.json#scripts.test`."
  artifacts:
    - path: "src/storage/session-write-store.ts"
      provides: "SessionWriteStore facade — session lifecycle writes, chunk writes, repair-item writes, STT job completion writes."
      min_lines: 80
    - path: "src/storage/session-read-store.ts"
      provides: "SessionReadStore facade — dashboard / status-text / ai-cleanup-terminal read models, session/chunk/transcript reads."
      min_lines: 60
    - path: "src/storage/job-queue-store.ts"
      provides: "JobQueueStore facade — STT and AI-cleanup job queue operations (claim/release/complete/block/retry)."
      min_lines: 60
    - path: "src/storage/runtime-state-store.ts"
      provides: "RuntimeStateStore facade — recording-runtime state, AI-cleanup terminal lease repair, normalize-stored-paths startup pass."
      min_lines: 40
    - path: "src/storage/storage-context.ts"
      provides: "createStorageContext(database, options) composition root that returns { writes, reads, jobs, runtime } facade bundle. Sole construction surface for callers."
      min_lines: 30
      exports: ["createStorageContext", "StorageContext"]
    - path: "src/storage/migrations.ts"
      provides: "applySchemaMigrations now uses SqlRunner.transaction<T>() per the STORE-02 lock; no direct db.exec(\"BEGIN IMMEDIATE\") in the migration runner."
      contains: "sqlRunner.transaction"
    - path: "src/storage/migrations.test.ts"
      provides: "Per CONTEXT.md Lock (extend, do not displace), TEST-02 (mid-step migration crash recovery via fault-injecting DatabaseSync wrapper) AND STORE-03 (per-migration twice-and-diff schema idempotency self-test) live as new top-level test cases here. Existing test cases are NOT refactored."
      contains: "is idempotent"
    - path: "src/storage/migrations-test-helpers.ts"
      provides: "Non-`*.test.ts` helpers consumed only by `migrations.test.ts`: `runMigrationTwiceAndDiffSchema`, `snapshotSchema`, `FaultInjectingDatabaseSync`, `createTmpDirongDatabase`. Not enumerated in `package.json#scripts.test` because it is not a runnable test file."
      min_lines: 60
    - path: "src/storage/repair-scan.ts"
      provides: "Type-only `import type { SessionStore }` is replaced with the facade types it actually exercises (`SessionWriteStore` for writes, `SessionReadStore` for reads, or a composite `RepairScanStore` intersection type). Function signatures updated accordingly."
      contains: "from \"./storage-context.js\""
    - path: "package.json"
      provides: "scripts.test enumerates dist paths for every new *.test.js produced by this plan (the five new facade tests). The two new in-file test cases (TEST-02 + STORE-03) live inside dist/storage/migrations.test.js, which is already enumerated."
      contains: "session-write-store.test.js"
  key_links:
    - from: "src/app/main.ts"
      to: "src/storage/storage-context.ts"
      via: "import { createStorageContext } from \"../storage/storage-context.js\""
      pattern: "createStorageContext"
    - from: "src/storage/migrations.ts"
      to: "src/storage/sql-runner.ts"
      via: "applySchemaMigrations now accepts SqlRunner and wraps each migration via sqlRunner.transaction(() => { migration.apply(db); insertLedgerRow(); })"
      pattern: "sqlRunner.transaction"
    - from: "src/storage/sqlite.ts"
      to: "src/storage/migrations.ts"
      via: "DirongDatabase constructor calls applySchemaMigrations(new SqlRunner(this)) — signature change must propagate to BOTH test callsites (migrations.test.ts:119-120 and schema-consistency.test.ts:30,33)"
      pattern: "applySchemaMigrations"
    - from: "src/storage/migrations.test.ts"
      to: "src/storage/migrations-test-helpers.ts"
      via: "import { runMigrationTwiceAndDiffSchema, FaultInjectingDatabaseSync, snapshotSchema, createTmpDirongDatabase } from \"./migrations-test-helpers.js\""
      pattern: "from \"./migrations-test-helpers.js\""
    - from: "src/storage/repair-scan.ts"
      to: "src/storage/storage-context.ts (or facade types)"
      via: "import type { SessionWriteStore, SessionReadStore } from \"./storage-context.js\" (or the appropriate composite type)"
      pattern: "from \"./storage-context.js\""
---

<objective>
Phase 1 — Storage Foundation. Decompose the 879-line `SessionStore` god node into role-scoped facades sharing one `SqlRunner` per `DirongDatabase`, route the migration runner through `SqlRunner.transaction<T>()` (the STORE-02 lock), and prove migration atomicity + idempotency by extending `migrations.test.ts` with two new top-level test cases (STORE-03 + TEST-02), per the CONTEXT.md Lock that requires new migration tests to LIVE in `migrations.test.ts` ("extend, do not displace").

Purpose: The storage layer is the single largest blast radius in the codebase (`SessionStore` = 136 graph edges, `DirongDatabase` = 127, `SqlRunner` = 113 — the top three project-owned hubs per `graphify-out/GRAPH_REPORT.md`). Every later phase (Phase 2 RELY, Phase 3 POLY, Phase 4 DASH) consumes storage interfaces; landing the new facades and the migration atomicity guarantee before they ride on the surface eliminates rework. After this phase, the four ROADMAP success criteria all hold true and `grep -r "from .*session-store" src/ --include="*.ts" | grep -v "^src/storage/" | grep -v test` returns zero hits.

Output: Four new facade modules + a composition root + helper extractions, with all 8 production callers and 11 test callers cut over from `SessionStore` to the appropriate facade. `applySchemaMigrations` routed through `SqlRunner.transaction<T>()` per the STORE-02 lock — both the production callsite (`sqlite.ts:51`) AND the two test callsites (`migrations.test.ts:119-120`, `schema-consistency.test.ts:30,33`) updated. `repair-scan.ts` type imports redirected. New STORE-03 + TEST-02 test bodies added to `migrations.test.ts` per Lock; helper machinery factored into `migrations-test-helpers.ts` (non-test file, not enumerated in `package.json#scripts.test`).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phase1/01-CONTEXT.md
@.planning/codebase/STRUCTURE.md
@.planning/codebase/ARCHITECTURE.md
@.planning/codebase/CONVENTIONS.md
@.planning/codebase/TESTING.md
@.planning/codebase/CONCERNS.md
@graphify-out/GRAPH_REPORT.md

# Production source — read these before editing
@src/storage/session-store.ts
@src/storage/sql-runner.ts
@src/storage/sqlite.ts
@src/storage/migrations.ts
@src/storage/migrations.test.ts
@src/storage/schema-consistency.test.ts
@src/storage/repair-scan.ts
@src/storage/session-purge.test.ts

<interfaces>
<!-- Key contracts the executor needs. Extracted from current source so the executor does not have to re-read the full files for every task. -->

From `src/storage/sql-runner.ts` (already exists — STORE-01 facades + STORE-02 runner BOTH consume this; do NOT invent a parallel wrapper):
```
export class SqlRunner {
  constructor(private readonly database: DirongDatabase);
  transaction<T>(fn: () => T): T;                                  // delegates to DirongDatabase.transaction (BEGIN IMMEDIATE / COMMIT / ROLLBACK)
  run(sql: string, ...params: SqlValue[]): number;
  get<T>(sql: string, ...params: SqlValue[]): T | null;
  all<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T[];
}
```

From `src/storage/sqlite.ts`:
```
export class DirongDatabase {
  readonly db: DatabaseSync;
  constructor(dbPath: string, busyTimeoutMs: number, options?: { readOnly?: boolean; migrationBackup?: false | { targetPath?: string } });
  transaction<T>(fn: () => T): T;     // db.exec("BEGIN IMMEDIATE;") / "COMMIT;" / "ROLLBACK;"
  close(): void;
}
```

From `src/storage/migrations.ts` (current state — note the runner ALREADY wraps each migration in BEGIN IMMEDIATE/COMMIT via raw db.exec; the STORE-02 lock requires routing through SqlRunner.transaction<T>() instead):
```
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[];        // 12 migrations, ids "001_..." .. "012_remove_default_members_custom_rule"
export function listPendingSchemaMigrationIds(db: DatabaseSync): string[];
export function applySchemaMigrations(db: DatabaseSync): void;     // SIGNATURE WILL CHANGE — accept SqlRunner

// Ledger table (already exists, created by ensureMigrationTable):
//   CREATE TABLE IF NOT EXISTS dirong_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
```

EXISTING `applySchemaMigrations` callsites that the signature change MUST update (exhaustive — confirmed by `grep -rn "applySchemaMigrations" src/`, excluding `graphify-out/cache/` AST nodes):
```
src/storage/sqlite.ts:51                       // production — DirongDatabase constructor
src/storage/migrations.test.ts:119,120          // test — passes `database.db` (DirongDatabase in scope)
src/storage/schema-consistency.test.ts:30,33   // test — passes raw `DatabaseSync` instances (NOT wrapped in DirongDatabase)
```

From `src/storage/session-store.ts` (the surface to decompose — partition is locked in CONTEXT.md):
```
class SessionStore {
  constructor(database: DirongDatabase, options?: { storageRoot?: string | null; normalizeStoredPaths?: boolean });
  close(): void;

  // —— SessionWriteStore surface ——
  createSession(input);  updateSessionStatus(sessionId, status, lastError?);
  stopSession(input);    upsertSpeaker(input);
  createChunkWriting(input);  finalizeRawChunk(input);
  completeChunkTranscodeAndQueueJob(input);  markChunkTranscodeFailed(input);  markChunkFailed(input);
  recordConnectionEvent(input);  recordRepairItem(input);
  completeSttJob(input);  completeFakeSttJob(input);  markSttJobMissingAudio(job);
  failProcessingSttJob(input);
  completeAiCleanupJob(input);

  // —— SessionReadStore surface ——
  getSession(sessionId);  getLatestSession();
  listFinalizedSessionsForAiCleanupAutomation(input);
  getChunk(chunkId);  listChunksMissingSttJob();  listWritingChunks();
  listRecentTranscriptSegments(sessionId, limit);
  listTranscriptTimelineSegments(input);  listRecentTranscriptTextForSpeaker(input);
  hasChunkAudioPath(filePath);  getAudioPathForChunk(chunkId, kind);
  getAiCleanupSttTerminalSnapshot(sessionId);
  getMeetingNotesDraftByJobId(jobId);  getLatestMeetingNotesDraft(sessionId);
  listRecentAiCleanupJobs(sessionId, limit);
  getAiCleanupJob(jobId);  getAiCleanupJobByIdentity(input);
  listQueuedSttJobs(input);
  getDashboardState(runtime);  statusText(runtime, dashboardUrl, locale?);

  // —— JobQueueStore surface ——
  claimNextSttJob(input);  queueExistingSttJobForChunk(chunkId, maxAttempts);
  failJobsWithMissingAudio();
  getOrCreateAiCleanupJob(input);  claimAiCleanupJob(input);
  updateAiCleanupJobArtifacts(input);  blockAiCleanupJob(input);
  retryAiCleanupJob(input);  failProcessingAiCleanupJob(input);

  // —— RuntimeStateStore surface ——
  releaseExpiredProcessingLeases(nowIso?);
  releaseExpiredAiCleanupLeases(nowIso?);
  repairExpiredAiCleanupProcessingJobs(nowIso?);
  // (constructor option `normalizeStoredPaths: true` triggers a one-shot normalize sweep — owned by RuntimeStateStore once split)
}
```

EXHAUSTIVE list of files importing `SessionStore` (confirmed by `grep -rln "from.*session-store" src/`, excluding `graphify-out/cache/`):

Production (8 files — caught by ROADMAP grep gate):
```
src/app/main.ts                          // long-running runtime — wires every facade
src/app/ai-cleanup.ts                    // phase4 CLI
src/app/fake-stt.ts                      // phase2 dev CLI
src/app/real-stt.ts                      // phase3 CLI
src/app/repair.ts                        // npm run repair
src/notion/draft-input.ts                // type-only re-export of TranscriptSegmentRow et al
src/notion/draft-input-read-model.ts     // type-only re-export
src/notion/test-fixtures.ts              // type-only `import type { TranscriptSegmentRow } ...`
```

Storage-internal (NOT caught by ROADMAP grep gate but MUST be updated for `npm run build` to pass):
```
src/storage/repair-scan.ts               // ★ Blocker 2 — `import type { SessionStore }`; type-only but TS still resolves
```

Tests (excluded by `grep -v test` gate, but MUST compile against the new facade APIs):
```
src/ai/cleanup/automation-service.test.ts  src/ai/cleanup/runner.test.ts
src/app/sqlite-backup.test.ts              src/dashboard/server.test.ts
src/recording/alone-finalize-service.test.ts  src/recording/voice-connection-controller.test.ts
src/stt/automation-service.test.ts         src/transcript/timeline.test.ts
src/storage/session-store-paths.test.ts    src/storage/session-store-ai-cleanup.test.ts
src/storage/dashboard-read-model.test.ts
src/storage/session-purge.test.ts          // ★ Blocker 3 — enumerated as dist/storage/session-purge.test.js in package.json#scripts.test
```

Repository seams already exist and are reused as-is — facades wrap them, do not reinvent:
```
src/storage/session-repository.ts  chunk-repository.ts  transcript-repository.ts
src/storage/stt-job-queue.ts       ai-cleanup-job-queue.ts
src/storage/meeting-notes-draft-repository.ts  repair-repository.ts
src/storage/dashboard-read-model.ts  status-text-read-model.ts  ai-cleanup-terminal-read-model.ts
src/storage/path-resolver.ts
```
</interfaces>
</context>

<strategy>

**Sequencing rationale.** Migration atomicity (T1.1) and the migration test extensions (T1.2) ship FIRST as a single Wave 1, because: (a) they touch `migrations.ts` + `migrations.test.ts` + `schema-consistency.test.ts` + new helper file — zero overlap with the SessionStore decomposition file set, so they parallelize cleanly with Wave 2; (b) the STORE-02 lock requires routing through `SqlRunner.transaction<T>()`, which is a focused behavioral change confined to `applySchemaMigrations` plus its three callsites; (c) the new tests pin the contract before any decomposition starts touching shared seams. STORE-01 (Wave 2 + Wave 3) goes second because its blast radius is higher and benefits from a stable migration runner underneath. Wave 2 introduces the four facades + composition root + their unit tests as new files (zero overwrite of the existing `SessionStore`). Wave 3 cuts callers over and removes `SessionStore` once the grep gate is green. The final wave (Wave 4) is the package.json + `npm run build && npm test` verification gate.

**Risk callouts.** (1) **Cutover atomicity.** CONTEXT.md offers leaf-first vs big-bang as Claude's discretion. Choosing **big-bang within Wave 3 as one task** because the surface is small (8 production files + `repair-scan.ts` + 12 test files) and a half-cut state breaks the type checker mid-task — leaf-first would extend Phase 1 unnecessarily. Wave 3 is one task that produces one atomic commit. (2) **Migration runner signature change.** `applySchemaMigrations` is called from THREE places: production `DirongDatabase.constructor` (`sqlite.ts:51` — easy: construct `new SqlRunner(this)` and pass), test `migrations.test.ts:119-120` (easy: `DirongDatabase` already in scope, construct `new SqlRunner(database)`), and test `schema-consistency.test.ts:30,33` (TRICKY: tests pass raw `DatabaseSync` instances created via `new DatabaseSync(path.join(...))`, NOT wrapped in `DirongDatabase`). Resolution for `schema-consistency.test.ts`: the test must wrap each `DatabaseSync` in a minimal `DirongDatabase`-shaped object whose only requirement is the `transaction<T>()` method (because that's all `SqlRunner.transaction` delegates to). Cleanest concrete fix: add a test-only static helper `SqlRunner.fromDatabaseSync(db: DatabaseSync): SqlRunner` that internally wraps the bare `DatabaseSync` in a tiny `{ db, transaction(fn) { db.exec("BEGIN IMMEDIATE;"); try { const r = fn(); db.exec("COMMIT;"); return r; } catch (e) { db.exec("ROLLBACK;"); throw e; } } }` adapter. Document the helper as test-only with a comment. (3) **`noUncheckedIndexedAccess` strict mode.** Facade method signatures often return `T | null`; the new facades preserve every existing return shape exactly to avoid forcing call-site narrowing changes. (4) **package.json drift.** Five new facade `*.test.ts` files (per T2.1) — the Wave 4 verifier task explicitly diffs the test list and runs `npm test` end-to-end. NOTE: The two new migration test cases (TEST-02 + STORE-03) live INSIDE `migrations.test.ts` per CONTEXT.md Lock (a) — they are NOT new files, so they need no new `package.json` enumeration. (5) **Type-only re-exports from `session-store.ts`.** Three `notion/*.ts` files import row types via `from "../storage/session-store.js"`; pointing them at `src/storage/storage-context.ts` (which re-exports the same types per T2.1) eliminates the grep-gate hit. (6) **`repair-scan.ts` type imports.** `import type { SessionStore }` at line 6 is used in five function signatures (lines 9, 34, 70, 184, 233, 302). T3.1 redirects to the facade types — `repair-scan.ts` exercises a mix of writes (recording repair items, status updates) and reads (listing chunks/sessions/jobs); the cleanest typing is a composite intersection `RepairScanStore = SessionWriteStore & SessionReadStore & RuntimeStateStore` exported from `storage-context.ts`. Callers already pass a full `StorageContext` — `repair-scan.ts` accepts `(ctx: StorageContext, config: Phase1Config)` and dispatches internally.

**Parallelism.** `config.parallelization=true`. Wave 1 (T1.1, T1.2) — T1.1 must commit BEFORE T1.2 because T1.2 extends `migrations.test.ts` and depends on the new `applySchemaMigrations(SqlRunner)` signature for its new test bodies. So Wave 1 is internally sequential (T1.1 → T1.2). Wave 2 (T2.1) is one task that creates 7 new files + 5 new test files; Wave 3 (T3.1) is one task that updates 8 production callers + `repair-scan.ts` + 12 test callers + removes `session-store.ts`; Wave 4 (T4.1) is the verification + package.json gate (sequential by definition — observes everything before).

### Lock fidelity (CONTEXT.md `<decisions>` STORE-03 + TEST-02)

The CONTEXT.md Lock states:
> "The self-test lives in `src/storage/migrations.test.ts` (existing, 1,624 lines — extend, do not displace). Add new test cases; do not refactor existing ones in this phase."
> "[TEST-02] The test lives in `src/storage/migrations.test.ts`."

This plan **honors the Lock (resolution (a))**: STORE-03 + TEST-02 test bodies are added as new top-level `test(...)` cases at the end of `migrations.test.ts`. Helper machinery (`runMigrationTwiceAndDiffSchema`, `FaultInjectingDatabaseSync`, `snapshotSchema`, `createTmpDirongDatabase`) is extracted to `src/storage/migrations-test-helpers.ts` — a NON-`*.test.ts` file imported only by `migrations.test.ts`. This keeps `migrations.test.ts` focused on `test(...)` declarations while satisfying the Lock that the test cases themselves live in that file. The helper file is NOT enumerated in `package.json#scripts.test` (it is not a runnable test). The previous plan revision that proposed sibling files `migration-idempotency.test.ts` + `migration-crash-recovery.test.ts` was a Lock contradiction and is removed.

</strategy>

<tasks>

<task type="auto" tdd="true">
  <name>T1.1: Route applySchemaMigrations through SqlRunner.transaction&lt;T&gt;() (production + 2 test callsites)</name>
  <files>src/storage/sql-runner.ts, src/storage/migrations.ts, src/storage/sqlite.ts, src/storage/migrations.test.ts, src/storage/schema-consistency.test.ts</files>
  <behavior>
    - Test 1 (existing `migrations.test.ts` "applySchemaMigrations is idempotent" at line 114): MUST continue to pass after the signature swap.
    - Test 2 (existing `schema-consistency.test.ts` "fresh schema and migration-only schema keep critical Notion tables aligned" at line 24): MUST continue to pass after the signature swap.
    - Test 3 (existing `migrations.test.ts` `EXPECTED_MIGRATION_IDS` assertion): unchanged, still green.
    - Behavior: `applySchemaMigrations` accepts a `SqlRunner` (not a raw `DatabaseSync`) and wraps each migration body in `sqlRunner.transaction(() => { migration.apply(db); insertLedgerRow(now); })`. The previously inline `db.exec("BEGIN IMMEDIATE;")` / `db.exec("COMMIT;")` / `db.exec("ROLLBACK;")` block at lines 90-100 is removed — the rollback path is now owned by `DirongDatabase.transaction` (which already does `db.exec("ROLLBACK;")` on throw, see `sqlite.ts:65-68`).
    - Behavior: `DirongDatabase` constructor (`sqlite.ts:29-57`) constructs a single `SqlRunner` instance after `PRAGMA journal_mode = WAL` + `SCHEMA_SQL` and passes it to `applySchemaMigrations(sqlRunner)`. The `SqlRunner` instance is NOT exposed as a public `DirongDatabase` field — it is constructed locally for the migration call. Production `SessionStore`/facades continue to construct their own `SqlRunner(database)` (current pattern, preserved).
    - Behavior: `listPendingSchemaMigrationIds(db: DatabaseSync)` keeps its `DatabaseSync` parameter (read-only, no transaction needed) — only `applySchemaMigrations` changes.
    - Behavior: The ledger table name `dirong_migrations` is unchanged. `ensureMigrationTable(db)` is unchanged.
    - Behavior: `SqlRunner` gains TWO new accessors: (a) `get db(): DatabaseSync` for the migration runner's `ensureMigrationTable` + `listPendingSchemaMigrationIds` (which need raw DDL outside transactions); (b) `static fromDatabaseSync(db: DatabaseSync): SqlRunner` for tests that operate on a bare `DatabaseSync` not wrapped in `DirongDatabase` — internally wraps the bare `DatabaseSync` in a minimal adapter exposing `db` + `transaction<T>(fn)` (the adapter does `db.exec("BEGIN IMMEDIATE;") / COMMIT; / ROLLBACK;` mirroring `DirongDatabase.transaction`).
  </behavior>
  <action>
    Edit `src/storage/sql-runner.ts`:
    1. Add `get db(): DatabaseSync { return this.database.db; }` — single-line accessor with a one-line comment: `// migration runner needs the raw DatabaseSync for PRAGMA / DDL outside transactions; do not use elsewhere.`
    2. Add a static factory `static fromDatabaseSync(database: DatabaseSync): SqlRunner` that constructs a private adapter `{ db: database, transaction<T>(fn: () => T): T { database.exec("BEGIN IMMEDIATE;"); try { const result = fn(); database.exec("COMMIT;"); return result; } catch (e) { database.exec("ROLLBACK;"); throw e; } } }` and passes it to the existing `SqlRunner` constructor (the constructor takes `DirongDatabase` but only consumes `.db` and `.transaction`, so a structurally-typed adapter satisfies it — adjust the constructor parameter type to a structural type alias `type SqlRunnerHost = { readonly db: DatabaseSync; transaction<T>(fn: () => T): T }` if TypeScript's nominal typing rejects the adapter; `DirongDatabase` already satisfies that shape). Document as test-only with a one-line comment: `// test-only: wraps a bare DatabaseSync (e.g. in schema-consistency.test.ts where DirongDatabase is not in use); production code MUST construct via new SqlRunner(dirongDatabase).`

    Edit `src/storage/migrations.ts`:
    1. Import `SqlRunner` from `./sql-runner.js`.
    2. Change `applySchemaMigrations` signature to `(sqlRunner: SqlRunner)`.
    3. Inside, hoist `const db = sqlRunner.db;` once at the top.
    4. Replace `ensureMigrationTable(db)` and `listPendingSchemaMigrationIds(db)` calls — they continue to take the raw `DatabaseSync` reachable via `sqlRunner.db`.
    5. Replace the per-migration `db.exec("BEGIN IMMEDIATE;") / try / db.exec("COMMIT;") / catch / db.exec("ROLLBACK;")` block (lines 90-100) with a single `sqlRunner.transaction(() => { migration.apply(db); db.prepare("INSERT INTO dirong_migrations (id, applied_at) VALUES (?, ?);").run(migration.id, new Date().toISOString()); });`. Remove the catch+rethrow — `DirongDatabase.transaction` (and the test adapter) already handle ROLLBACK on throw and re-throw the original error.

    Edit `src/storage/sqlite.ts`:
    1. Add `import { SqlRunner } from "./sql-runner.js";` at the top.
    2. In the constructor, after `this.db.exec(SCHEMA_SQL);` and BEFORE `applySchemaMigrations(...)` (currently line 50→51), construct `const sqlRunner = new SqlRunner(this);` and replace `applySchemaMigrations(this.db);` with `applySchemaMigrations(sqlRunner);`. The `sqlRunner` instance is local to the constructor — not stored on the class — so existing consumers who do `new SqlRunner(database)` themselves are unaffected.

    Edit `src/storage/migrations.test.ts` (Blocker 1 — fix existing callsites):
    1. Lines 119-120: replace `applySchemaMigrations(database.db);` (twice) with `applySchemaMigrations(new SqlRunner(database));` (twice). Add `import { SqlRunner } from "./sql-runner.js";` to the imports block at the top of the file.

    Edit `src/storage/schema-consistency.test.ts` (Blocker 1 — fix existing callsites with bare `DatabaseSync`):
    1. Add `import { SqlRunner } from "./sql-runner.js";` to the imports block.
    2. Line 30: replace `applySchemaMigrations(fresh);` with `applySchemaMigrations(SqlRunner.fromDatabaseSync(fresh));`.
    3. Line 33: replace `applySchemaMigrations(migrated);` with `applySchemaMigrations(SqlRunner.fromDatabaseSync(migrated));`.

    Implements STORE-02 (lock: "migration runner uses the same primitive — do NOT invent a parallel transaction wrapper"). The pre-existing `db.exec("BEGIN IMMEDIATE")` block in the runner WAS a parallel wrapper — this task removes it and routes through `SqlRunner.transaction()` for both production and test paths.
  </action>
  <verify>
    <automated>npm run build &amp;&amp; node --no-warnings --test dist/storage/migrations.test.js dist/storage/schema-consistency.test.js</automated>
  </verify>
  <done>
    `migrations.ts` no longer contains the literal string `db.exec("BEGIN IMMEDIATE;")` — the migration runner's transaction is owned by `SqlRunner.transaction()`. `applySchemaMigrations` signature is `(sqlRunner: SqlRunner)`. `DirongDatabase` constructor calls it with a freshly-constructed `SqlRunner`. Both `migrations.test.ts:119-120` and `schema-consistency.test.ts:30,33` callsites updated. `dist/storage/migrations.test.js` and `dist/storage/schema-consistency.test.js` both pass.
  </done>
</task>

<task type="auto" tdd="true">
  <name>T1.2: Extend migrations.test.ts with STORE-03 + TEST-02 (per CONTEXT.md Lock — extend, do not displace)</name>
  <files>src/storage/migrations.test.ts, src/storage/migrations-test-helpers.ts</files>
  <behavior>
    - Per CONTEXT.md `<decisions>` Lock: BOTH new test bodies (STORE-03 idempotency self-test + TEST-02 fault-injection crash-recovery) live inside `src/storage/migrations.test.ts` as new top-level `test(...)` cases appended at the end of the file. Existing tests are NOT refactored, displaced, or modified beyond the T1.1 callsite swap.
    - Helper machinery is extracted to `src/storage/migrations-test-helpers.ts` (non-`*.test.ts` file) so `migrations.test.ts` stays focused on test declarations. The helper file is NOT a runnable test and MUST NOT be enumerated in `package.json#scripts.test`.

    **STORE-03 test cases (per-migration idempotency):**
    - For every entry in `SCHEMA_MIGRATIONS`: declare one `test(\`migration ${migration.id} is idempotent (schema deepEquals after second apply)\`, () => { ... })` block. Tests are GENERATED by iterating the array (NOT hand-listed), so adding a future migration auto-extends coverage.
    - Helper `runMigrationTwiceAndDiffSchema(migrationId)` (in `migrations-test-helpers.ts`): builds a fresh tmp `DirongDatabase`, snapshots schema via `snapshotSchema(db.db)` returning `{ tables: { [tableName]: { columns: PRAGMA table_info, indexes: PRAGMA index_list } } }` deterministically sorted, re-invokes `migration.apply(db.db)` directly bypassing the ledger guard, snapshots again, returns `{ before, after }`.
    - Per CONTEXT.md note: a migration that mutates rows without an idempotency guard may legitimately differ on second run on DATA. Catch this by ONLY asserting schema deepEqual — do NOT assert row counts. If a migration genuinely fails the schema-deepEqual on second run, the test SHOULD fail loudly (that bug is the finding).

    **TEST-02 test case (mid-step migration crash recovery):**
    - Single `test("applySchemaMigrations rolls back mid-step crash and re-applies cleanly on next run", () => { ... })` block.
    - Pick migration `010_project_foundation` (multi-step body, exec + prepare calls per `migrations.ts:271-326`). Wrap the underlying `DatabaseSync` in `FaultInjectingDatabaseSync` (helper, in `migrations-test-helpers.ts`) which counts `exec` invocations and throws `new Error("injected fault: db.exec call #N")` on the chosen Nth call (chosen to land BETWEEN two `exec` calls inside the chosen migration's body — read `migrations.ts:271-326` once and document N in a code comment).
    - Apply migration chain up to (but not including) the chosen migration via the standard runner. Snapshot schema. Construct a `SqlRunner` over the fault-injecting wrapper via `SqlRunner.fromDatabaseSync(faultInjectingDb)`. Call `applySchemaMigrations(faultInjectingSqlRunner)`. Assert it throws `/injected fault/`. Snapshot again. Assert ALL of:
      a) `SELECT id FROM dirong_migrations WHERE id = '010_project_foundation'` returns no row.
      b) `assert.deepEqual(schemaAfter, schemaBefore)` — schema BYTE-IDENTICAL.
      c) Remove fault injection (re-construct `SqlRunner` over the unwrapped `DatabaseSync` via `new SqlRunner(database)`); call `applySchemaMigrations(sqlRunner)` again; assert no throw; assert ledger now contains the row; assert schema matches a freshly-built control DB.
    - Fallback: if `010_project_foundation` proves to have only one exec inside its body, fall back to `005_notion_relation_target_pages` (also multi-step per migrations.ts).
  </behavior>
  <action>
    Create `src/storage/migrations-test-helpers.ts` (NEW non-test file). Exports (named, no defaults per CONVENTIONS.md):
    1. `createTmpDirongDatabase(): { database: DirongDatabase; dbPath: string; tmpDir: string; close(): void }` — uses `mkdtempSync(path.join(os.tmpdir(), "dirong-migrate-"))` for the per-test temp dir, `close()` calls `database.close()` then `rmSync(tmpDir, { recursive: true, force: true })`. (Real file path required because `DirongDatabase` writes a `.bak.sqlite` snapshot for non-empty DBs and uses WAL.)
    2. `snapshotSchema(db: DatabaseSync): { tables: Record<string, { columns: unknown[]; indexes: unknown[] }> }` — enumerates `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`, runs `PRAGMA table_info(<table>)` and `PRAGMA index_list(<table>)` for each, returns deterministically sorted shape. Filter out `sqlite_*` internal tables.
    3. `runMigrationTwiceAndDiffSchema(migrationId: string): { before: ReturnType<typeof snapshotSchema>; after: ReturnType<typeof snapshotSchema> }` — implements the STORE-03 inner loop as described in `<behavior>`. Builds tmp `DirongDatabase`, finds the migration in `SCHEMA_MIGRATIONS`, snapshots, re-applies `migration.apply(db.db)` directly, snapshots, closes, returns the two snapshots. Caller asserts deepEqual.
    4. `class FaultInjectingDatabaseSync` — wrapper class holding a real `DatabaseSync`. Exposes the same surface that `SqlRunner.fromDatabaseSync` consumes: `readonly db: this`, `exec(sql: string): void`, `prepare(sql: string): Statement`, `close(): void`. Constructor takes `(realDb: DatabaseSync, throwOnNthExec: number)`. Maintains `private execCallCount = 0`. `exec(sql)` increments count; if `count === throwOnNthExec` throws `new Error("injected fault: db.exec call #" + count)`; else delegates to `realDb.exec(sql)`. `prepare` and `close` delegate unconditionally.

    Edit `src/storage/migrations.test.ts` (APPEND ONLY — do not modify existing tests beyond the T1.1 callsite swap):
    1. Add to the imports block at the top: `import { runMigrationTwiceAndDiffSchema, FaultInjectingDatabaseSync, snapshotSchema, createTmpDirongDatabase } from "./migrations-test-helpers.js";` and `import { SqlRunner } from "./sql-runner.js";` (already added by T1.1).
    2. After all existing tests, append a comment marker `// === STORE-03: per-migration idempotency self-test (CONTEXT.md Lock: extend, do not displace) ===`.
    3. Append a `for (const migration of SCHEMA_MIGRATIONS) { test(\`migration ${migration.id} is idempotent (schema deepEquals after second apply)\`, () => { const { before, after } = runMigrationTwiceAndDiffSchema(migration.id); assert.deepEqual(after, before); }); }` loop. (Top-level `for` outside any `test()` is the pattern for parameterized `node:test` cases — confirmed valid for `node --test`.)
    4. Append a comment marker `// === TEST-02: mid-step migration crash-recovery (CONTEXT.md Lock: extend, do not displace) ===`.
    5. Append the single TEST-02 `test(...)` block per `<behavior>` step. Inside: create tmp `DirongDatabase`, apply chain up to (not including) `010_project_foundation` (or fallback `005_notion_relation_target_pages`), snapshot schema, construct `FaultInjectingDatabaseSync` with chosen N, construct `SqlRunner.fromDatabaseSync(faultInjectingDb)`, `assert.throws(() => applySchemaMigrations(faultInjectingSqlRunner), /injected fault/)`, snapshot, assert deepEqual, assert ledger row absent via `database.db.prepare("SELECT id FROM dirong_migrations WHERE id = ?").get("010_project_foundation")` returning `undefined`, then re-construct `SqlRunner` over the unwrapped `DatabaseSync`, call `applySchemaMigrations(sqlRunner)`, assert no throw, assert ledger row now present, assert schema matches control. `try { ... } finally { close(); }`.

    Constraint: do NOT create `src/storage/migration-idempotency.test.ts` or `src/storage/migration-crash-recovery.test.ts`. The previous plan revision proposed those — they are removed in this revision because the CONTEXT.md Lock requires the new test bodies to live IN `migrations.test.ts`.

    Implements STORE-03 + TEST-02.
  </action>
  <verify>
    <automated>npm run build &amp;&amp; node --no-warnings --test dist/storage/migrations.test.js</automated>
  </verify>
  <done>
    `migrations.test.ts` contains 12+ new `test(...)` cases (one per `SCHEMA_MIGRATIONS` entry for STORE-03) plus one new `test(...)` for TEST-02. `migrations-test-helpers.ts` exists with the four exports. Existing tests in `migrations.test.ts` are unchanged (apart from the two T1.1 callsite swaps at lines 119-120). `dist/storage/migrations.test.js` runs all tests and passes (or surfaces a real migration bug verbatim for follow-up — do NOT silently fix the migration body in this task; STORE-03's contract is "verifiable as idempotent", and a failing assertion IS the verification).
  </done>
</task>

<task type="auto" tdd="true">
  <name>T2.1: Create role-scoped facades + StorageContext composition root</name>
  <files>src/storage/session-write-store.ts, src/storage/session-read-store.ts, src/storage/job-queue-store.ts, src/storage/runtime-state-store.ts, src/storage/storage-context.ts, src/storage/path-mapping.ts, src/storage/store-helpers.ts, src/storage/session-write-store.test.ts, src/storage/session-read-store.test.ts, src/storage/job-queue-store.test.ts, src/storage/runtime-state-store.test.ts, src/storage/storage-context.test.ts</files>
  <behavior>
    - `SessionWriteStore` exposes the WRITE surface enumerated in the `<interfaces>` block: session lifecycle writes, chunk writes, repair-item writes, STT-job-completion writes, AI-cleanup-job-completion writes. Method signatures are byte-identical to the corresponding `SessionStore` methods (input shapes, return types, throw contracts) — this is a NAMING / SCOPING refactor, NOT a behavioral change.
    - `SessionReadStore` exposes the READ surface: session/chunk/transcript reads, all three read-models (`dashboard-read-model`, `status-text-read-model`, `ai-cleanup-terminal-read-model`), draft + AI-cleanup-job reads.
    - `JobQueueStore` exposes the JOB-QUEUE surface: STT job claim/queue/fail-missing-audio, AI-cleanup job get-or-create / claim / artifacts / block / retry / fail-processing.
    - `RuntimeStateStore` exposes the RUNTIME / REPAIR surface: `releaseExpiredProcessingLeases`, `releaseExpiredAiCleanupLeases`, `repairExpiredAiCleanupProcessingJobs`, and the one-shot `normalizeStoredPaths()` startup pass currently triggered by `SessionStore` constructor option.
    - All four facades take `(sql: SqlRunner, paths: StoragePathResolver, options?)` in their constructors (RuntimeStateStore additionally takes `(database: DirongDatabase)` for the `database.transaction(() => ...)` call inside `normalizeStoredPaths`). `StorageContext` constructs ONE `SqlRunner` and one `StoragePathResolver` and threads them — all four facades share the SAME `SqlRunner` instance per CONTEXT.md lock.
    - `createStorageContext(database: DirongDatabase, options?: { storageRoot?: string | null; normalizeStoredPaths?: boolean }): StorageContext` returns `{ writes, reads, jobs, runtime, database, close }` where `close()` closes the underlying database. Used as the SOLE construction surface from `src/app/main.ts` and the phase CLIs. Exports a composite intersection type `RepairScanStore = SessionWriteStore & SessionReadStore & RuntimeStateStore` for use by `repair-scan.ts` (consumed by T3.1).
    - Path normalization (`mapSessionRow` / `mapChunkRow` / `mapSttJobRow` / `mapAiCleanupJobRow` / `mapMeetingNotesDraftRow` private helpers in `SessionStore`, lines 771-851) MUST be preserved exactly — extracted into `path-mapping.ts` as pure free functions taking `(row, resolveStoredPath)` parameters with overload chains preserved.
    - `isoNow()` and `sha256Text()` helpers (currently file-local in `SessionStore` lines 866-872) extracted into `store-helpers.ts` to avoid duplication across facades.
    - Each facade has a co-located `*-test.ts` file asserting the behavior CONTRACT (one positive case per method group). Tests use real `DirongDatabase` against a tmp file (per TESTING.md convention — never mock `node:sqlite`). `storage-context.test.ts` asserts cross-facade composition: writes through `writes` are observable via `reads` (proves the shared `SqlRunner`).
    - `SessionStore` (the existing class) is NOT modified or deleted in this task — Wave 3 deletes it. This task adds new files only and updates ZERO existing files. (Pure additive — no risk of breaking existing tests.)
  </behavior>
  <action>
    Create `src/storage/path-mapping.ts` first: extract the five private `mapXxxRow` methods from `SessionStore` (lines 771-851) as pure free functions. Each takes `(row, resolveStoredPath: (p: string | null) => string | null)`. Preserve the overload chains as overloaded function signatures (TypeScript supports overloads on free functions).

    Create `src/storage/store-helpers.ts`: export `isoNow(): string` and `sha256Text(value: string): string` (copy from `session-store.ts` lines 866-872 verbatim).

    Create `src/storage/session-write-store.ts`:
    - `export class SessionWriteStore { constructor(sql: SqlRunner, paths: StoragePathResolver) { ... initialize SessionRepository, ChunkRepository, SttJobQueue, AiCleanupJobQueue, MeetingNotesDraftRepository, RepairRepository, TranscriptRepository as needed for writes } }`
    - Move the WRITE-classified method bodies from `SessionStore` into this class verbatim. Use the exact same method signatures. Import `isoNow` / `sha256Text` from `./store-helpers.js`.
    - `repositoryOptions` shape (the `{ now, resolveStoredPath, toStoredPath }` triple) is constructed in the constructor against the injected `paths`.

    Create `src/storage/session-read-store.ts`, `src/storage/job-queue-store.ts`, `src/storage/runtime-state-store.ts` following the same pattern. `RuntimeStateStore` constructor takes `(sql: SqlRunner, paths: StoragePathResolver, database: DirongDatabase)` and exposes a `normalizeStoredPaths(): void` method that wraps the existing `SessionStore.normalizeStoredPaths` body using `database.transaction(() => ...)`.

    Per CONVENTIONS.md: named exports only, no default exports, no barrel files, `kebab-case.ts` filenames, `.js` extension in import paths.

    Create `src/storage/storage-context.ts`:
    ```
    export type StorageContext = {
      writes: SessionWriteStore;
      reads: SessionReadStore;
      jobs: JobQueueStore;
      runtime: RuntimeStateStore;
      database: DirongDatabase;   // exposed for callers that legitimately need .transaction (e.g. composite reads); discouraged
      close(): void;
    };
    export type RepairScanStore = SessionWriteStore & SessionReadStore & RuntimeStateStore;   // composite type for src/storage/repair-scan.ts
    export function createStorageContext(database: DirongDatabase, options?: { storageRoot?: string | null; normalizeStoredPaths?: boolean }): StorageContext;
    ```
    Implementation: construct `paths = createStoragePathResolver(options?.storageRoot)`, `sql = new SqlRunner(database)`, instantiate the four facades sharing `(sql, paths)` (and `database` for runtime), run `runtime.normalizeStoredPaths()` if `options?.normalizeStoredPaths === true && paths.storageRoot`, return the bundle. `close()` calls `database.close()`.

    Re-export shared row types from `storage-context.ts` so consumers can `import type { SessionRow, ChunkRow, ... } from "../storage/storage-context.js"` (replacing the `from "../storage/session-store.js"` type-import pattern in three Notion files). Re-export list: `AiCleanupFailureKind, AiCleanupJobRow, AiCleanupJobStatus, AiCleanupLeaseRepairSummary, AiCleanupSttTerminalSnapshot, ChunkRow, ChunkStatus, MeetingNotesDraftRow, RecordingRuntimeState, RepairScanSummary, SessionRow, SessionStatus, SpeechStatus, SttJobRow, TranscriptSegmentRow` — match the existing `SessionStore` re-export list line-for-line.

    Create the five `*.test.ts` files using the existing `src/storage/migrations.test.ts` as a style reference. Each test:
    - Builds a tmp `DirongDatabase` + `createStorageContext`.
    - Exercises the facade's primary behavior (one positive path per method group).
    - Closes + rmSyncs in `finally`.
    - Uses `assert.deepEqual` / `assert.equal` only.

    `storage-context.test.ts`: asserts (a) `createStorageContext` returns all four facades + `database` + `close`; (b) a write through `writes` is observable via `reads` (proves the shared `SqlRunner`); (c) `normalizeStoredPaths: true` triggers the runtime-state-store sweep.

    Implements STORE-01 (CREATION step — Wave 3 will cut callers over and delete `SessionStore`).
  </action>
  <verify>
    <automated>npm run build &amp;&amp; node --no-warnings --test dist/storage/session-write-store.test.js dist/storage/session-read-store.test.js dist/storage/job-queue-store.test.js dist/storage/runtime-state-store.test.js dist/storage/storage-context.test.js</automated>
  </verify>
  <done>
    Five new production files (`session-write-store.ts`, `session-read-store.ts`, `job-queue-store.ts`, `runtime-state-store.ts`, `storage-context.ts`) plus `path-mapping.ts` and `store-helpers.ts` exist and compile under `tsc -p tsconfig.json` with `noUncheckedIndexedAccess`. Five new co-located `*.test.ts` files exist and pass. `storage-context.ts` exports the `RepairScanStore` composite type for T3.1's `repair-scan.ts` redirect. `SessionStore` is unchanged — Wave 3 deletes it.
  </done>
</task>

<task type="auto">
  <name>T3.1: Cut all callers (production + storage-internal + tests) from SessionStore to StorageContext + delete SessionStore</name>
  <files>src/app/main.ts, src/app/ai-cleanup.ts, src/app/fake-stt.ts, src/app/real-stt.ts, src/app/repair.ts, src/app/sqlite-backup.test.ts, src/notion/draft-input.ts, src/notion/draft-input-read-model.ts, src/notion/test-fixtures.ts, src/recording/alone-finalize-service.test.ts, src/recording/voice-connection-controller.test.ts, src/stt/automation-service.test.ts, src/ai/cleanup/runner.test.ts, src/ai/cleanup/automation-service.test.ts, src/dashboard/server.test.ts, src/transcript/timeline.test.ts, src/storage/repair-scan.ts, src/storage/session-purge.test.ts, src/storage/session-store-paths.test.ts, src/storage/session-store-ai-cleanup.test.ts, src/storage/dashboard-read-model.test.ts, src/storage/session-store.ts</files>
  <action>
    Big-bang cutover (one atomic commit). Order WITHIN the task:

    (1) Production callers of `SessionStore` (8 files — caught by ROADMAP grep gate) — replace `import { SessionStore } from "../storage/session-store.js"` with `import { createStorageContext, type StorageContext } from "../storage/storage-context.js"`. Replace `new SessionStore(database, options)` constructions with `createStorageContext(database, options)`. Replace each method call:
        - Write methods (`createSession`, `stopSession`, `recordRepairItem`, `completeSttJob`, `completeAiCleanupJob`, etc.) → `ctx.writes.<method>(...)`.
        - Read methods (`getSession`, `listFinalizedSessionsForAiCleanupAutomation`, `getDashboardState`, `statusText`, etc.) → `ctx.reads.<method>(...)`.
        - Job-queue methods (`claimNextSttJob`, `getOrCreateAiCleanupJob`, `claimAiCleanupJob`, `blockAiCleanupJob`, etc.) → `ctx.jobs.<method>(...)`.
        - Runtime methods (`releaseExpiredProcessingLeases`, `repairExpiredAiCleanupProcessingJobs`) → `ctx.runtime.<method>(...)`.
        - `store.close()` → `ctx.close()`.
        - `store.database` (used by `dashboard-read-model.ts` indirectly via the read model functions) → `ctx.database` (preserved on the bundle for this exact case).

    (2) Notion type-only imports (3 files: `draft-input.ts`, `draft-input-read-model.ts`, `test-fixtures.ts`): replace `from "../storage/session-store.js"` with `from "../storage/storage-context.js"` (which re-exports the same row types per T2.1).

    (3) **Blocker 2 — `src/storage/repair-scan.ts`** (storage-internal — TS compiler enforces even though grep gate excludes):
        - Line 6: replace `import type { SessionStore } from "./session-store.js";` with `import type { RepairScanStore } from "./storage-context.js";` (the composite intersection type exported from `storage-context.ts` per T2.1).
        - Lines 9, 34, 70, 184, 233, 302: replace each `store: SessionStore` parameter type annotation with `store: RepairScanStore`. The signatures `runStartupRepair`, `scanOldPartFiles`, three other functions per the grep above.
        - Verify the function bodies compile — every method call inside `repair-scan.ts` against `store` must exist on `RepairScanStore` (= `SessionWriteStore & SessionReadStore & RuntimeStateStore`). If a method is consumed that lives on `JobQueueStore` instead (e.g. `claimAiCleanupJob` would be on jobs), broaden `RepairScanStore` to include `JobQueueStore` or accept the full `StorageContext` instead. Decide based on the actual method calls in `repair-scan.ts` after reading it.
        - Callers of `runStartupRepair` (in `src/app/main.ts` and `src/app/repair.ts` per the dependency tree) pass `ctx.writes` AND `ctx.reads` AND `ctx.runtime` — but the cleanest call shape is to pass the whole `ctx` object and have `runStartupRepair` accept `(ctx: StorageContext, config)`. Pick this approach (simplest call site, no manual intersection construction) — change `repair-scan.ts` signatures to `(ctx: StorageContext, ...)` instead of `(store: RepairScanStore, ...)`. Inside `repair-scan.ts`, dispatch via `ctx.writes.<method>` / `ctx.reads.<method>` / `ctx.runtime.<method>` / `ctx.jobs.<method>` as appropriate.

    (4) Test callers (12 files including the four `src/storage/*.test.ts` files that test the removed `SessionStore` directly):
        - `src/storage/session-store-paths.test.ts` → keep filename, switch to `createStorageContext` + `ctx.runtime.normalizeStoredPaths()` for the path-normalization assertions.
        - `src/storage/session-store-ai-cleanup.test.ts` → keep filename, switch to `createStorageContext` + `ctx.writes.completeAiCleanupJob(...)` / `ctx.reads.getMeetingNotesDraftByJobId(...)` etc.
        - `src/storage/dashboard-read-model.test.ts` → already imports `SessionStore` for fixture setup; switch to `createStorageContext` + `ctx.reads.getDashboardState(...)`.
        - **Blocker 3 — `src/storage/session-purge.test.ts`** (line 13 imports `SessionStore`; line 107 has `store: SessionStore` field; line 115 has `new SessionStore(database, ...)`): keep filename (already enumerated as `dist/storage/session-purge.test.js` in `package.json#scripts.test:14` — DO NOT rename, that would silently break CI), update the import to `createStorageContext` / `StorageContext`, change the fixture's `store` field type to `StorageContext`, replace the `new SessionStore(...)` construction with `createStorageContext(...)`, and update every `store.<method>(...)` call to the appropriate facade routing per the mapping table in step (1).
        - All other test files (`src/ai/cleanup/automation-service.test.ts`, `src/ai/cleanup/runner.test.ts`, `src/app/sqlite-backup.test.ts`, `src/dashboard/server.test.ts`, `src/recording/alone-finalize-service.test.ts`, `src/recording/voice-connection-controller.test.ts`, `src/stt/automation-service.test.ts`, `src/transcript/timeline.test.ts`): replace `new SessionStore(database, opts)` with `createStorageContext(database, opts)` and method calls per the same mapping above.

    (5) Delete `src/storage/session-store.ts`. Confirm the success-criterion grep is green: `grep -r "from .*session-store" src/ --include="*.ts" | grep -v "^src/storage/" | grep -v test` returns ZERO hits. Storage-internal hits are excluded by the gate, but `repair-scan.ts` is updated in step (3) so even the unfiltered grep should return zero.

    (6) Per CLAUDE.md "no silent fallbacks": every facade method that previously threw a `DirongError` (or generic `Error`) preserves that throw — do NOT introduce `?? null` or `?? []` defaults during the rename. Search for `?? null`, `?? []`, `?? {}` introductions in the diff; reject any that did not exist in the original `SessionStore` body.

    Constraint: this task touches ZERO behavior. Method bodies were already moved in T2.1 — Wave 3 is purely "rename the import + the receiver name". `npm run build && npm test` MUST pass at the end of this task with no skipped tests. Existing `package.json#scripts.test` entries that point to renamed-source-but-same-filename test files (the four `dist/storage/session-{store-paths,store-ai-cleanup,purge}.test.js` paths) continue to map correctly because none of those files were renamed.

    Implements STORE-01 (CUTOVER step) and satisfies ROADMAP success criterion #1.
  </action>
  <verify>
    <automated>npm run build &amp;&amp; npm test &amp;&amp; bash -c 'count=$(grep -r "from .*session-store" src/ --include="*.ts" | grep -v "^src/storage/" | grep -v test | wc -l); test "$count" -eq 0 || { echo "FAIL: $count session-store imports remain in production grep gate"; exit 1; } &amp;&amp; internal=$(grep -rn "session-store" src/storage/ --include="*.ts" | grep -v "session-store-paths\|session-store-ai-cleanup" | wc -l); test "$internal" -eq 0 || { echo "FAIL: $internal session-store references remain inside src/storage/ (should be zero after deletion)"; exit 1; }'</automated>
  </verify>
  <done>
    `src/storage/session-store.ts` is deleted. Zero production files outside `src/storage/` import from `session-store`. `src/storage/repair-scan.ts` accepts `StorageContext` and dispatches to facades. `src/storage/session-purge.test.ts` constructs `createStorageContext` instead of `new SessionStore`. All callers route through `createStorageContext` and consume `ctx.writes` / `ctx.reads` / `ctx.jobs` / `ctx.runtime`. `npm run build && npm test` passes with no skipped tests. Success criterion #1 from ROADMAP.md is observably true.
  </done>
</task>

<task type="auto">
  <name>T4.1: Wire new facade test files into package.json + final phase verification</name>
  <files>package.json</files>
  <action>
    Append the compiled `dist/.../*.test.js` paths for every NEW test file produced by this plan to `package.json#scripts.test` (single-line space-separated list — do NOT reformat the line; append before the closing `"`):

    - `dist/storage/session-write-store.test.js` (T2.1)
    - `dist/storage/session-read-store.test.js` (T2.1)
    - `dist/storage/job-queue-store.test.js` (T2.1)
    - `dist/storage/runtime-state-store.test.js` (T2.1)
    - `dist/storage/storage-context.test.js` (T2.1)

    DO NOT add entries for migration-idempotency or migration-crash-recovery — per CONTEXT.md Lock (resolution (a) chosen in `<strategy>`), those test bodies live INSIDE `migrations.test.ts`, which is already enumerated as `dist/storage/migrations.test.js` in `package.json#scripts.test:14`. Adding sibling entries would point to non-existent files.

    DO NOT add an entry for `dist/storage/migrations-test-helpers.js` — it is a non-test helper file, not runnable by `node --test`.

    Existing entries `dist/storage/session-store-paths.test.js`, `dist/storage/session-store-ai-cleanup.test.js`, `dist/storage/session-purge.test.js`, `dist/storage/migrations.test.js`, `dist/storage/schema-consistency.test.js`, `dist/storage/dashboard-read-model.test.js`, `dist/storage/file-retention.test.js` REMAIN (the source files were not renamed in T3.1 — only their imports were swapped).

    Then run the canonical phase verification: `npm run build && npm test`. ALL tests must pass. ALL four ROADMAP success criteria must hold:
    1. `grep -r "from .*session-store" src/ --include="*.ts" | grep -v "^src/storage/" | grep -v test` → zero hits.
    2. The TEST-02 test case inside `dist/storage/migrations.test.js` passes (mid-step crash recovery).
    3. The STORE-03 per-migration idempotency test cases inside `dist/storage/migrations.test.js` all pass.
    4. `npm run build && npm test` passes with no skipped tests; new test files are listed in `package.json#scripts.test`.

    If any test file from this plan is missing from the `scripts.test` enumeration, CI silently skips it (per TESTING.md warning) — that is a Phase 1 failure. Verify by counting: every new facade test file path created by Task T2.1 must appear in the script.

    Per CLAUDE.md "no hardcoding": do NOT append paths that don't correspond to a real test file on disk. Verify each path resolves to a file in `dist/storage/` after build.
  </action>
  <verify>
    <automated>npm run build &amp;&amp; npm test &amp;&amp; bash -c 'for f in session-write-store session-read-store job-queue-store runtime-state-store storage-context; do grep -q "dist/storage/$f.test.js" package.json || { echo "FAIL: $f.test.js missing from package.json"; exit 1; }; done &amp;&amp; for forbidden in migration-idempotency migration-crash-recovery migrations-test-helpers; do if grep -q "dist/storage/$forbidden" package.json; then echo "FAIL: $forbidden should NOT be enumerated (Lock resolution (a): tests live inside migrations.test.ts; helpers are non-test)"; exit 1; fi; done &amp;&amp; count=$(grep -r "from .*session-store" src/ --include="*.ts" | grep -v "^src/storage/" | grep -v test | wc -l); test "$count" -eq 0 || { echo "FAIL: $count session-store imports remain"; exit 1; }'</automated>
  </verify>
  <done>
    `package.json#scripts.test` enumerates every new facade test file produced by T2.1 (5 entries). It does NOT enumerate sibling migration test files (per Lock resolution (a)). It does NOT enumerate the helper file. `npm run build && npm test` exits 0 with no skipped tests. All four ROADMAP Phase 1 success criteria hold. The migration crash-recovery test (TEST-02) and idempotency tests (STORE-03) all run inside `npm test` because they live in `migrations.test.ts`. Phase 1 ready for plan-checker / verifier.
  </done>
</task>

</tasks>

<wave_plan>

**Wave 1 — Migration Atomicity + Tests (sequential within wave: T1.1 → T1.2):**
- T1.1 (`src/storage/sql-runner.ts` + `migrations.ts` + `sqlite.ts` + `migrations.test.ts:119-120` + `schema-consistency.test.ts:30,33`): Route runner through `SqlRunner.transaction<T>()`; update both production AND test callsites of the changed signature (Blocker 1).
- T1.2 (`src/storage/migrations.test.ts` APPEND ONLY + new `migrations-test-helpers.ts`): Add STORE-03 + TEST-02 test bodies as new top-level `test(...)` cases inside `migrations.test.ts` per CONTEXT.md Lock (Blocker 4 resolution (a)). Helpers extracted to non-test file.

**Gate to advance to Wave 2:** Both Wave 1 tasks committed. `node --test dist/storage/migrations.test.js dist/storage/schema-consistency.test.js` passes. (T1.2 may legitimately surface a real migration bug — if so, that bug is logged in the SUMMARY and Phase 1 either fixes it inline OR carves a follow-up task BEFORE Wave 4. Wave 2 / Wave 3 do NOT block on that fix because they touch zero migration logic.)

**Wave 2 — Facade Creation (purely additive, no overwrite):**
- T2.1 (seven new production files + five new test files in `src/storage/`): Create `SessionWriteStore`, `SessionReadStore`, `JobQueueStore`, `RuntimeStateStore`, `StorageContext` (which exports `RepairScanStore` composite type for T3.1), `path-mapping.ts`, `store-helpers.ts`, plus their unit tests.

**Gate to advance to Wave 3:** All five new facade test files pass. `npm run build` succeeds.

**Wave 3 — Cutover + SessionStore Deletion (one atomic commit):**
- T3.1 (8 production files + `repair-scan.ts` (Blocker 2) + 12 test files including `session-purge.test.ts` (Blocker 3) + delete `session-store.ts`): Big-bang import + receiver rename. Grep gate verified GREEN inside the task's `<verify>` block. `repair-scan.ts` accepts `StorageContext` and dispatches to facades.

**Gate to advance to Wave 4:** `npm run build && npm test` passes. ROADMAP success criterion #1 grep returns zero hits. Internal `src/storage/` no longer references `session-store` (apart from the two surviving renamed-source test files).

**Wave 4 — Verification Gate:**
- T4.1 (`package.json`): Enumerate the 5 new facade test paths. Run final `npm run build && npm test`. Confirms ALL FOUR ROADMAP success criteria hold simultaneously. Explicit forbidden-entry check for the now-removed sibling test paths and the helper file.

**Gate to mark phase complete:** All four ROADMAP success criteria observably TRUE. `gsd-plan-checker` can run.

</wave_plan>

<verification>

| Phase Success Criterion (from ROADMAP.md Phase 1) | Satisfied By Task(s) |
|----|----|
| #1: `grep -r "from .*session-store" src/ --include="*.ts" \| grep -v "^src/storage/" \| grep -v test` returns zero hits | T2.1 (creates the replacement surface) + T3.1 (cuts callers, redirects `repair-scan.ts`, renames `session-purge.test.ts`'s SessionStore use, deletes `session-store.ts`) — verified inside T3.1 `<automated>` and again in T4.1 `<automated>` |
| #2: Fault-injection test demonstrates mid-step crash leaves DB in pre-migration state (schema hash matches; ledger has no row) | T1.2 (TEST-02 case appended to `migrations.test.ts` with `FaultInjectingDatabaseSync` from `migrations-test-helpers.ts`) — verified via T1.2 `<automated>` and ridden in T4.1's `npm test` |
| #3: Per-migration self-test runs every numbered step twice in a fresh DB and asserts identical schema | T1.2 (STORE-03 generated `for` loop appended to `migrations.test.ts`, one `test(...)` per `SCHEMA_MIGRATIONS` entry, calling `runMigrationTwiceAndDiffSchema` from helpers) — verified via T1.2 `<automated>` and ridden in T4.1's `npm test` |
| #4: `npm run build && npm test` passes with no skipped tests; new test files listed in `package.json#scripts.test` | T4.1 — verified via T4.1 `<automated>` (which checks both `npm test` exit code AND that every new facade test file appears in the script AND that the forbidden sibling/helper entries are absent) |

| Requirement (from REQUIREMENTS.md) | Satisfied By Task(s) |
|----|----|
| STORE-01 (split `SessionStore`, no production caller imports it) | T2.1 (creates facades + `RepairScanStore` composite type) + T3.1 (cuts production callers, redirects `repair-scan.ts`, redirects test callers including `session-purge.test.ts`, deletes `SessionStore`) |
| STORE-02 (each migration in single `BEGIN IMMEDIATE / COMMIT` via `SqlRunner.transaction<T>()`) | T1.1 (routes runner through `SqlRunner.transaction()`; updates production + 2 test callsites) — proven by T1.2's TEST-02 (rollback on throw) |
| STORE-03 (each migration step verifiably idempotent) | T1.2 (per-migration twice-and-diff self-test inside `migrations.test.ts` per Lock) |
| TEST-02 (mid-step migration crash recovery simulated) | T1.2 (fault-injecting `DatabaseSync` wrapper inside `migrations.test.ts` per Lock; asserts ledger absence + schema unchanged + clean re-apply) |

100% coverage: 4/4 success criteria, 4/4 requirements.

</verification>

<success_criteria>

Phase 1 is COMPLETE when ALL of the following hold simultaneously after T4.1 `<automated>` exits 0:

1. `grep -r "from .*session-store" src/ --include="*.ts" | grep -v "^src/storage/" | grep -v test` returns ZERO hits. (ROADMAP success criterion #1.)
2. The TEST-02 test case inside `dist/storage/migrations.test.js` passes — fault-injection scenario asserts no ledger row, schema unchanged, clean re-apply. (ROADMAP success criterion #2 / TEST-02.)
3. The STORE-03 per-migration idempotency loop inside `dist/storage/migrations.test.js` passes — every numbered migration twice-applied yields identical `PRAGMA table_info` + `PRAGMA index_list`. (ROADMAP success criterion #3 / STORE-03.)
4. `npm run build && npm test` exits 0 with NO skipped tests. Every new facade `*.test.ts` file is enumerated in `package.json#scripts.test`. (ROADMAP success criterion #4.)
5. `src/storage/session-store.ts` no longer exists.
6. `src/storage/migrations.ts` does NOT contain the literal `db.exec("BEGIN IMMEDIATE;")` — the migration runner is owned by `SqlRunner.transaction<T>()`. (STORE-02 lock.)
7. The four facades (`SessionWriteStore`, `SessionReadStore`, `JobQueueStore`, `RuntimeStateStore`) and `createStorageContext` exist as named exports under `src/storage/`. (CONTEXT.md decision lock.)
8. `src/storage/repair-scan.ts` accepts `StorageContext` (or `RepairScanStore`) — no `SessionStore` import remains anywhere in the project.
9. `src/storage/session-purge.test.ts` constructs `createStorageContext` (not `new SessionStore`) and continues to be enumerated as `dist/storage/session-purge.test.js` in `package.json#scripts.test`.

</success_criteria>

<risk_register>

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R1 | `applySchemaMigrations` signature change breaks callers besides `DirongDatabase.constructor` | RESOLVED — exhaustive callsite inventory in `<interfaces>` block lists all THREE callsites (production `sqlite.ts:51`, tests `migrations.test.ts:119-120` and `schema-consistency.test.ts:30,33`) | T1.1 `<files>` includes all three files explicitly. T1.1 `<action>` has separate sub-steps for each callsite. T1.1 `<verify>` runs both affected test files. |
| R2 | T1.2 surfaces a real existing rollback or idempotency bug in one of the 12 migrations | Medium — exactly the bugs the tests are designed to find | Surface verbatim in the executor SUMMARY. Do NOT silently fix the migration body inside T1.2 — the test's job is to PROVE the contract. If a bug is found, plan-checker / verifier carves a follow-up task BEFORE Wave 4 closes. The phase exit criterion is "tests pass" — a real bug means `npm test` will fail Wave 4 until fixed. |
| R3 | Big-bang cutover in T3.1 breaks compilation mid-task because `noUncheckedIndexedAccess` interacts badly with the four-facade surface | Medium | Method signatures on facades are byte-identical to current `SessionStore` (T2.1 lock). Cutover is rename-only at call sites — no return-type changes. If `tsc` errors appear, they indicate a T2.1 contract drift; revert the facade method signature to match `SessionStore`'s exactly. |
| R4 | New facade test files added in T2.1 are forgotten in `package.json#scripts.test` and silently skip in CI | High (TESTING.md warns explicitly) | T4.1 has an explicit grep gate verifying every new facade test file's compiled path appears in `scripts.test`, AND a forbidden-entry check for the sibling migration test paths (which were removed in this revision) and for the non-test helper file. Wave 4 will fail loudly if any are missing or wrongly added. |
| R5 | `path-mapping.ts` extraction loses one of the five private map functions or the `mapXxxRow` overload chain | Low-Medium | T2.1's done criterion requires the five facade test files pass. Each test exercises a method that returns one of the mapped row types; a broken map returns wrong-shape rows and the test fails. The overload chain is preserved by extracting as overloaded function signatures (TypeScript supports overloads on free functions). |
| R6 | `repair-scan.ts` consumes a `SessionStore` method that doesn't naturally fit any single facade (Blocker 2 resolution risk) | Low-Medium — only surfaces during T3.1 step (3) | T3.1 step (3) instructs the executor to read `repair-scan.ts` first and decide between `RepairScanStore` (= writes & reads & runtime intersection, exported by T2.1) versus accepting the full `StorageContext`. The recommended path is `StorageContext` (simplest call site); `RepairScanStore` is documented as a fallback. Either path keeps `repair-scan.ts` compiling. |
| R7 | `session-purge.test.ts` (Blocker 3) renaming would silently break CI because `dist/storage/session-purge.test.js` is enumerated in `package.json#scripts.test:14` | RESOLVED — T3.1 step (4) explicitly says "keep filename, do not rename" | T3.1 only swaps the import + receiver name inside the file. Filename and the `package.json` entry are unchanged. T4.1 verification confirms `npm test` discovers the test. |

</risk_register>

<threat_model>

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| disk → DirongDatabase | Local SQLite file (single-machine trust per local-first constraint); migrations may run against an existing DB containing historical data |
| migration runner → SCHEMA_MIGRATIONS array | Migrations are own-code; no third-party migration bodies. SQL is string-concatenated in TS but uses prepared statements for parameterized writes |
| package.json devDependencies → npm install | No new dependencies introduced by this phase; phase scope is structural-only |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-01 | Tampering | Mid-step migration crash leaves DB in half-applied state (orphan tables, partial ALTER), enabling future `db.exec` to behave unpredictably | mitigate | T1.1 routes runner through `SqlRunner.transaction<T>()` (= `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` per `sqlite.ts:60-68`). T1.2's TEST-02 case inside `migrations.test.ts` proves the rollback contract via fault-injection. The pre-existing automatic `backupOpenDatabaseSnapshot` in `DirongDatabase` constructor (`sqlite.ts:39`) provides a defense-in-depth backup before any migration runs. |
| T-01-02 | Repudiation | Migration ledger (`dirong_migrations`) records `applied_at` timestamp; if the INSERT lands but the migration body crashes, the runner records "applied" without the actual schema change | mitigate | T1.1's `sqlRunner.transaction(() => { migration.apply(db); insertLedger(); })` puts both the body AND the ledger insert in one atomic block. Either both commit or both roll back — proven by T1.2's TEST-02 assertion that the failed-migration ledger row is ABSENT after the throw. |
| T-01-03 | Information Disclosure | Facade decomposition could accidentally widen the read surface (e.g. `SessionReadStore` exposing a method that previously was private to `SessionStore`) | accept | T2.1 explicitly preserves method signatures byte-for-byte; no NEW public methods are introduced. The facade boundary NARROWS the surface per facade (each consumer sees only `ctx.writes` / `ctx.reads` etc.) — strictly tighter than current `SessionStore` exposure. Risk is theoretical only. |
| T-01-04 | Denial of Service | `BEGIN IMMEDIATE` acquires a reserved write lock; if a concurrent reader holds the DB during boot-time migration the runner could block for `busy_timeout` (configurable per `Phase1Config.dbBusyTimeoutMs`) | accept | Local-first single-process model — only the long-running `main.ts` opens the DB at boot. CLI tools open separately and may collide ONLY if invoked concurrently by the operator. `busy_timeout` PRAGMA already handles this (`sqlite.ts:30`). No code change needed. |
| T-01-05 | Elevation of Privilege | None — facade decomposition is pure-internal; no new external surface, no new auth path, no new subprocess | accept | N/A |
| T-01-SC | Tampering | npm install of new dependencies introduces supply-chain risk | accept | This phase introduces ZERO new dependencies (`package.json` change is limited to `scripts.test` enumeration; no `dependencies` / `devDependencies` mutation). No package legitimacy gate is needed. RESEARCH.md `## Package Legitimacy Audit` is not required because no installs are performed. |

</threat_model>

<scope_fence>

Per `01-CONTEXT.md` `<scope_fence>`, Phase 1 will NOT touch:

- Files outside `src/storage/`, `src/app/main.ts` (composition wiring only), `src/app/{ai-cleanup,fake-stt,real-stt,repair}.ts` (caller cutover only), `src/notion/{draft-input,draft-input-read-model,test-fixtures}.ts` (type-only import redirect), `src/{recording,stt,ai/cleanup,dashboard,transcript}/*.test.ts` (test caller cutover only), and `package.json` (test enumeration). Any other file edit is scope creep — surface to user before proceeding.
- Behavioral changes to existing migrations. STORE-02 wraps the runner; T1.1 does NOT re-author migration bodies. T1.2 OBSERVES migration behavior; if it surfaces a real bug, surface it for follow-up — do NOT silently fix in this phase.
- New schema additions. The ledger table `dirong_migrations` already exists (created by `ensureMigrationTable` in `migrations.ts:104-110`); no new schema work is needed for STORE-02.
- Notion / Discord / STT / AI-cleanup / dashboard / recording code paths beyond the import redirect. Phases 2/3/4 cover those.
- Performance tuning. CONCERNS.md "Performance — concentrated SQL execution" is addressed by atomicity (STORE-02), not by index/query optimisation.
- `i18n/catalog.ts`, `setup/wizard-service.ts`, `notion/dashboard-service.ts`, `settings/product-settings.ts`, `app/main.ts` size-splits — deferred to v2 MOD-01..04.
- Replacing SQLite, adding `--dry-run` migration mode, refactoring existing storage tests for style.

</scope_fence>

<output>
After all four tasks complete, write `.planning/phases/01-storage-foundation/01-01-SUMMARY.md` per `@$HOME/.claude/get-shit-done/templates/summary.md`. SUMMARY MUST record:
- Whether T1.2 surfaced any real existing migration bug (if so, log under "Issues Found" with migration ID + repro).
- Final list of facade test files added to `package.json#scripts.test` (5 entries: session-write-store, session-read-store, job-queue-store, runtime-state-store, storage-context).
- Confirmation that NO sibling migration-* test files exist (Lock resolution (a) honored).
- Confirmation grep output: `grep -r "from .*session-store" src/ --include="*.ts" | grep -v "^src/storage/" | grep -v test` returned zero hits.
- Confirmation `repair-scan.ts` and `session-purge.test.ts` no longer reference `SessionStore`.
- Context cost actually consumed per task vs. plan estimate (10-30% target).
</output>

<executor_advisories>
Surfaced by `gsd-plan-checker` on revision 2 (`PLAN APPROVED WITH CONCERNS`). Non-blocking, but the executor MUST honor these at code time:

### A1 (T1.2) — Fault-injection N must skip the adapter's BEGIN and COMMIT

When `SqlRunner.fromDatabaseSync(faultInjectingDb)` is constructed, the adapter calls `faultInjectingDb.exec("BEGIN IMMEDIATE;")` first, then runs `migration.apply(db)` (which issues K body `exec` calls), then `faultInjectingDb.exec("COMMIT;")`. Counting on the fault-injecting wrapper:

- exec call **#1** = adapter `BEGIN IMMEDIATE`
- exec calls **#2 .. (K+1)** = migration body
- exec call **#(K+2)** = adapter `COMMIT`

Choose `N` strictly inside `[2, K+1]` so the throw lands BETWEEN two body exec calls (rollback exercises the contract). Document the chosen `N`, the chosen migration's body exec count `K`, and the offset reasoning in a code comment in `migrations.test.ts` so a future migration body change is caught:

```ts
// fault N=4: migration "010_project_foundation" body has K=6 exec calls (#2..#7);
// adapter BEGIN is exec #1, adapter COMMIT is exec #8. N=4 lands between body exec #3 and #4.
```

### A2 (T2.1 + T3.1) — `RepairScanStore` composite is dead code; use `StorageContext` instead

`storage-context.ts` (T2.1) defines `RepairScanStore = SessionWriteStore & SessionReadStore & RuntimeStateStore` — but `repair-scan.ts` actually consumes `JobQueueStore` methods too (`failJobsWithMissingAudio` line 27, `queueExistingSttJobForChunk` line 197). The composite as written would not compile when T3.1 redirects.

T3.1 step (3) already chooses `StorageContext` (full bundle) as the recommended target signature. Therefore: in T2.1, **drop the `RepairScanStore` export** from `storage-context.ts`. Don't ship a misleading dead type. If a future caller wants a narrower bundle, it can compose `Pick<StorageContext, ...>` at the call site.

### A3 (T3.1) — `repair-scan.ts` has no co-located test

Phase scope locks "extend, do not displace" for tests, so we are NOT adding `repair-scan.test.ts` in this phase. The cutover relies on `tsc` to catch typos in facade dispatch (`ctx.writes.X` vs `ctx.reads.X`). This is acceptable because all facade methods are typed — but if T4.1 surfaces any runtime issue traceable to `repair-scan.ts`, log it in SUMMARY.md under "Follow-up" for a deferred test-coverage task.

</executor_advisories>
