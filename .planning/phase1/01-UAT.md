---
status: complete
phase: 01-storage-foundation
source:
  - .planning/phase1/01-T2_1-SUMMARY.md
  - .planning/phase1/01-T3_1-SUMMARY.md
  - .planning/phase1/01-T4_1-SUMMARY.md
started: 2026-05-15T13:00:00Z
updated: 2026-05-15T13:15:00Z
---

## Phase 1 nature

Phase 1 is a **pure backend structural refactor** — no user-facing UI/CLI behavior change. STORE-01 decomposed the `SessionStore` god node into 4 role-scoped facades sharing one `SqlRunner` per `DirongDatabase`; STORE-02 routed the migration runner through `SqlRunner.transaction<T>()`; STORE-03 + TEST-02 added per-migration idempotency + mid-step crash-recovery tests. All deliverables are observable through automated gates (build, test, grep, file presence), not through UI flows. The UAT therefore runs the automated gates as a snapshot and asks the user to confirm correctness, rather than walking through user-flow steps that have no UI surface.

## Current Test

[testing complete]

## Tests

### 1. Cold Start Build
expected: `npm run build` exits 0; `tsc -p tsconfig.json` completes; `dashboard` asset copy runs.
result: pass
evidence: BUILD_EXIT=0; no TypeScript errors; build invoked at 2026-05-15T13:00:00Z (orchestrator post-merge run).

### 2. Full Test Suite Green
expected: `npm test` exits 0 with 517/517 pass, 0 fail, 0 skipped, 0 cancelled.
result: pass
evidence: `tests 517 / suites 0 / pass 517 / fail 0 / cancelled 0 / skipped 0 / todo 0 / duration_ms ~9000`. Up from 495 (Wave 3) because Wave 4 enumerated the 5 new facade test files in `package.json#scripts.test` — the 22 new facade tests now run.

### 3. ROADMAP Success Criterion #1 — production grep gate
expected: `grep -r "from .*session-store" src/ --include="*.ts" | grep -v "^src/storage/" | grep -v test` returns 0 hits.
result: pass
evidence: PROD_GREP_HITS=0.

### 4. ROADMAP Success Criterion #2 — TEST-02 (mid-step migration crash recovery)
expected: `applySchemaMigrations rolls back mid-step crash and re-applies cleanly on next run` passes inside `dist/storage/migrations.test.js`.
result: pass
evidence: `✔ applySchemaMigrations rolls back mid-step crash and re-applies cleanly on next run (180.80ms)` — fault-injection asserts ledger row absent + schema unchanged + clean re-apply.

### 5. ROADMAP Success Criterion #3 — STORE-03 (per-migration idempotency)
expected: Every entry in `SCHEMA_MIGRATIONS` runs twice and produces identical schema (`PRAGMA table_info` + `PRAGMA index_list`).
result: pass
evidence: 12/12 migrations pass — all of `001_transcript_segments_speech_status` … `012_remove_default_members_custom_rule` log `✔ migration X is idempotent (schema deepEquals after second apply)`.

### 6. ROADMAP Success Criterion #4 — package.json enumeration
expected: 5 new facade test paths present; 3 forbidden paths absent.
result: pass
evidence: present = `dist/storage/{session-write-store,session-read-store,job-queue-store,runtime-state-store,storage-context}.test.js` (all 5); absent = `migration-idempotency`, `migration-crash-recovery`, `migrations-test-helpers` (all 3 — confirmed by `grep -q` returning non-zero for each).

### 7. STORE-02 Lock — migration runner uses SqlRunner.transaction<T>()
expected: `src/storage/migrations.ts` contains 0 occurrences of the literal `db.exec("BEGIN IMMEDIATE`; transaction wrapping is owned by `SqlRunner.transaction()`.
result: pass
evidence: `grep -c 'db.exec("BEGIN IMMEDIATE' src/storage/migrations.ts` returns 0.

### 8. Cold-start runtime smoke — `node dist/app/doctor.js`
expected: Compiled entry-point loads with the new facades wired through `createStorageContext`; the doctor CLI reports the environment status without import errors.
result: pass
evidence: `DOCTOR_EXIT=0`. CLI runs, reports missing Discord token as expected (env not configured in this run), advises `npm run repair`. The import chain — `src/app/doctor.ts` → `createStorageContext` → 4 facades + 1 `SqlRunner` — loads cleanly. No `Cannot find module './session-store.js'` errors.

### 9. Final acceptance
expected: User confirms no regression observed outside this UAT scope.
result: pass
evidence: User report (2026-05-15): "윈도우에서 배치파일을 열어봤고 자동으로 모듈을 설치하는것으로 확인됨. 녹음진행까지는 하지않았지만 정상적으로 켜졌음." Windows-side `Dirong Start.bat` triggered automatic dependency install and the app booted cleanly. The Phase 1 contract (storage facade wire-up does not break import chains or boot flow) is observed live. Recording flow (Phase 2 RELY scope) was not exercised in this UAT — by design.

## Summary

total: 9
passed: 9
issues: 0
pending: 0
skipped: 0

## Gaps

[none yet]

## Follow-ups (out of scope for this UAT — already logged in STATE.md)

- POLY (Phase 3): update narrow ports (`RecordingProducerStore`, `DashboardStore`, `SttBatchStore`, `AiCleanupAutomationStore`) to accept facade-typed inputs, then delete the transitional `flattenStorageContext` + `FlatStorageStore` from `storage-context.ts`.
- Hygiene: `dist/storage/job-retry-policy.test.js` is a pre-existing test (commit `524ccf5`, pre-Phase-1) not enumerated in `package.json#scripts.test`. Future audit task.
