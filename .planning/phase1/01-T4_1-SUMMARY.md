---
phase: 1
plan: 01
task: T4.1
subsystem: storage
tags: [storage, package-json, verification-gate, phase-1-completion]
requires: [T2.1, T3.1]
provides: [phase-1-success-criteria-met]
affects: [package.json#scripts.test]
key-files:
  modified:
    - package.json
duration: ~3 min (no rebuilds beyond the two canonical ones — pre-edit verification + post-edit verification)
completed: 2026-05-15
---

# Phase 1 Plan 01 Task T4.1: package.json enumeration + final phase verification gate

Wired the 5 new facade test files (created in Wave 2 T2.1) into `package.json#scripts.test` so `npm test` discovers them under `node --test`, then ran the canonical Phase 1 verification gate. All 9 success criteria in `<success_criteria>` hold simultaneously. Phase 1 (Storage Foundation) is complete.

## What was done

### (1) package.json#scripts.test — appended 5 new dist paths

Diff (single-line list, appended after `dist/transcript/timeline.test.js`, before the closing `"`):

```
+ dist/storage/session-write-store.test.js
+ dist/storage/session-read-store.test.js
+ dist/storage/job-queue-store.test.js
+ dist/storage/runtime-state-store.test.js
+ dist/storage/storage-context.test.js
```

Existing 7 storage entries unchanged (the source files were renamed-source-not-file in T3.1):
- `dist/storage/session-store-paths.test.js`
- `dist/storage/session-store-ai-cleanup.test.js`
- `dist/storage/session-purge.test.js`
- `dist/storage/migrations.test.js`
- `dist/storage/schema-consistency.test.js`
- `dist/storage/dashboard-read-model.test.js`
- `dist/storage/file-retention.test.js`

### (2) Pre-edit dist proof — every new path resolves to a real file

After `npm run build`, `ls dist/storage/*.test.js` listed:

```
dist/storage/dashboard-read-model.test.js
dist/storage/file-retention.test.js
dist/storage/job-queue-store.test.js
dist/storage/job-retry-policy.test.js
dist/storage/migrations.test.js
dist/storage/runtime-state-store.test.js
dist/storage/schema-consistency.test.js
dist/storage/session-purge.test.js
dist/storage/session-read-store.test.js
dist/storage/session-store-ai-cleanup.test.js
dist/storage/session-store-paths.test.js
dist/storage/session-write-store.test.js
dist/storage/storage-context.test.js
```

Each of the 5 paths CLAUDE.md "no hardcoding" demanded resolves to a real file. The 3 forbidden paths (`migration-idempotency.test.js`, `migration-crash-recovery.test.js`, `migrations-test-helpers.js`) do not exist on disk and are correctly absent from the enumeration — consistent with CONTEXT.md Lock resolution (a): TEST-02 + STORE-03 live INSIDE `migrations.test.ts`, and `migrations-test-helpers.ts` is a non-test helper.

### (3) Final `npm run build && npm test` result

```
ℹ tests 517
ℹ suites 0
ℹ pass 517
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 9130.048494
```

**ROADMAP success criterion #4 ✔** — exit 0, NO skipped tests, every new facade test path enumerated.

### (4) Canonical T4.1 automated gate (verbatim from `<verify><automated>`)

```
REQUIRED ENTRIES: PASS         (all 5 new facade paths present)
FORBIDDEN ENTRIES: PASS        (none of migration-idempotency / migration-crash-recovery / migrations-test-helpers present)
SESSION-STORE IMPORT GREP: PASS (count=0)
```

## ROADMAP Phase 1 success criteria — all 4 simultaneously hold

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | `grep -r "from .*session-store" src/ --include="*.ts" \| grep -v "^src/storage/" \| grep -v test` → zero hits | ✔ | grep count = 0 |
| 2 | TEST-02 mid-step crash-recovery test passes | ✔ | Lives inside `dist/storage/migrations.test.js`; ran green in the 517-test sweep |
| 3 | STORE-03 per-migration idempotency self-test passes | ✔ | Lives inside `dist/storage/migrations.test.js`; ran green |
| 4 | `npm run build && npm test` passes with no skipped tests; new facade test files enumerated | ✔ | 517/517 pass, 0 skip; all 5 new paths present |

## Plan-level `<success_criteria>` (items 1–9) — verification

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | session-store import grep returns 0 | ✔ | `count=0` |
| 2 | TEST-02 passes inside `migrations.test.js` | ✔ | Sweep green, grep confirms `TEST-02` token present in source |
| 3 | STORE-03 idempotency passes | ✔ | Sweep green, grep confirms `STORE-03` token present |
| 4 | `npm run build && npm test` exit 0, no skips | ✔ | 517/0/0 |
| 5 | `src/storage/session-store.ts` no longer exists | ✔ | `ls` → no such file (removed in T3.1) |
| 6 | `src/storage/migrations.ts` contains no raw `BEGIN IMMEDIATE` literal | ✔ | `grep -c` → 0 |
| 7 | Four facades + `createStorageContext` exported under `src/storage/` | ✔ | 5 files exporting the required surface |
| 8 | `src/storage/repair-scan.ts` accepts `StorageContext`; no `SessionStore` import | ✔ | `grep -c 'SessionStore'` → 0; imports `StorageContext` from `./storage-context.js` |
| 9 | `session-purge.test.ts` uses `createStorageContext`, still enumerated as `session-purge.test.js` | ✔ | `grep -c 'createStorageContext'` → 2; path present in `scripts.test` (carried unchanged) |

All 9 success criteria hold simultaneously. **Phase 1 is COMPLETE.**

## Decisions made

- **No reformatting of the single-line `scripts.test` value.** Plan explicitly forbids splitting the list. Appended the 5 tokens space-separated before the closing `"`. The diff is byte-minimal: one single-line addition of 5 paths.
- **Did not enumerate `dist/storage/job-retry-policy.test.js`** even though `ls dist/storage/*.test.js` revealed it. It is a pre-existing test file (created in commit `524ccf5 refactor: deduplicate shared helpers`, predating Phase 1) and is NOT a "new facade test file produced by this plan". Adding it would expand scope beyond T4.1's contract. See "Deferred Issues" below.

## Deviations from plan

None on the production path. Plan executed exactly as written.

Minor pre-task hygiene: the worktree branch was created from a stale base predating Wave 1/2/3. Recovered via `git reset --hard main` to pick up the Wave 1+2+3 commits. No uncommitted work was destroyed (worktree had zero commits beyond its stale base). This is a worktree-bootstrap detail, not a deviation from the plan's content.

## Auth gates

None — task is purely a file edit + verification run.

## Deferred Issues (out-of-scope discoveries)

1. **`dist/storage/job-retry-policy.test.js` is silently un-run.**
   - **Found during:** `ls dist/storage/*.test.js` inventory in step (2).
   - **Source:** `src/storage/job-retry-policy.test.ts`, created in commit `524ccf5` (pre-Phase-1).
   - **Impact:** The compiled test file exists in `dist/storage/` but is NOT in `package.json#scripts.test`. `node --test` therefore skips it. This is exactly the failure mode TESTING.md warns about, but it is a CARRY-FORWARD issue from before Phase 1 — not caused by anything in this plan, and not in T4.1's contract.
   - **Why not fixed here:** Per CLAUDE.md SCOPE BOUNDARY, only fix issues DIRECTLY caused by the current task's changes. Fixing this would silently expand T4.1's atomic commit to cover a pre-existing test gap, conflating "Wave 4 verification gate" with "general scripts.test audit".
   - **Recommended follow-up:** Carve a Phase 2 (or earlier) task to audit `package.json#scripts.test` against `ls dist/**/*.test.js` for completeness across the whole tree. Likely catches more orphaned tests than just `job-retry-policy`. The TEST-* requirement set in REQUIREMENTS.md is the natural home.

2. **~221 CRLF↔LF noisy files on the main working tree.** Documented in the orchestrator briefing as carry-forward from Wave 2 + 3 Windows-side editing. Inside the worktree this is benign (each commit lands the LF version). Resolution belongs to the user's local environment (.gitattributes / editor settings), not to a code task.

## Known Stubs

None. This task adds no rendering code, no UI, no data sources.

## Threat surface scan

No new surface introduced. The edit is to a build-script enumeration only — no new endpoints, auth paths, file access patterns, or schema changes.

## Self-Check

- ✔ `.planning/phase1/01-T4_1-SUMMARY.md` exists (this file).
- ✔ `package.json` modified; diff matches the 5-token append.
- ✔ `npm test` count 517/0/0/0/0.
- ✔ All 4 ROADMAP success criteria checked.
- ✔ All 9 plan-level success criteria checked.

## Phase 1 Completion footer

**Phase 1 (Storage Foundation) is COMPLETE.**

- Wave 1: T1.1 (SqlRunner-routed migrations) + T1.2 (STORE-03 + TEST-02 inside `migrations.test.ts`)
- Wave 2: T2.1 (4 facades + `StorageContext` + `path-mapping.ts` + `store-helpers.ts` + 5 facade tests)
- Wave 3: T3.1 (atomic big-bang cutover; `session-store.ts` deleted; `repair-scan.ts` re-typed to `StorageContext`; 12 test callsites swapped)
- Wave 4: T4.1 (this task — enumeration + final verification gate)

Requirements satisfied: STORE-01, STORE-02, STORE-03, TEST-02. Ready for `gsd-plan-checker` / verifier and orchestrator transition to Phase 2.
