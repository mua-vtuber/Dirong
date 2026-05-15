---
phase: 01-storage-foundation
plan: 01
wave: 2
task: T2.1
subsystem: storage
tags: [sqlite, facade, composition-root, refactor, tdd]

# Dependency graph
requires:
  - phase: 01-storage-foundation (Wave 1)
    provides: "SqlRunner.transaction<T>() routing (T1.1, 119cb29) and STORE-03 / TEST-02 migration tests (T1.2, 473dbcd)"
provides:
  - "Four role-scoped storage facades (SessionWriteStore, SessionReadStore, JobQueueStore, RuntimeStateStore) decomposing the 879-line SessionStore god node"
  - "createStorageContext composition root threading ONE SqlRunner + ONE StoragePathResolver across all four facades (CONTEXT.md lock)"
  - "RepairScanStore composite intersection type for Wave 3's repair-scan.ts redirect"
  - "Re-exported row types from storage-context.ts matching SessionStore's existing re-export list line-for-line"
  - "Five co-located *.test.ts files validating the facade contract (one positive path per method group)"
  - "Pure additive — session-store.ts is UNCHANGED; package.json is UNCHANGED. Wave 3 deletes session-store.ts; Wave 4 enumerates the 5 new test files."
affects: [Phase 1 Wave 3 (T3.1 big-bang cutover), Phase 1 Wave 4 (T4.1 package.json + npm test gate), Phase 2 RELY, Phase 3 POLY, Phase 4 DASH]

tech-stack:
  added: []  # zero new dependencies — pure structural refactor
  patterns:
    - "Role-scoped facades sharing one SqlRunner per DirongDatabase (CONTEXT.md lock)"
    - "Composition root via createStorageContext factory — production caller never instantiates facades directly"
    - "Pure-function extraction of path-mapping helpers with preserved overload chains (path-mapping.ts)"

key-files:
  created:
    - "src/storage/path-mapping.ts — five pure mapXxxRow free functions extracted from session-store.ts:771-851 with preserved overload chains"
    - "src/storage/store-helpers.ts — isoNow() + sha256Text() shared across facades"
    - "src/storage/session-write-store.ts — WRITE facade (session/chunk/repair/STT-completion/AI-completion writes)"
    - "src/storage/session-read-store.ts — READ facade (session/chunk/transcript reads + 3 read-models)"
    - "src/storage/job-queue-store.ts — STT + AI-cleanup queue operations"
    - "src/storage/runtime-state-store.ts — lease repair + normalize-stored-paths sweep"
    - "src/storage/storage-context.ts — createStorageContext composition root; re-exports row types; defines RepairScanStore composite type"
    - "src/storage/session-write-store.test.ts — 5 positive cases per WRITE method group"
    - "src/storage/session-read-store.test.ts — 5 positive cases per READ method group"
    - "src/storage/job-queue-store.test.ts — 5 positive cases per queue method group"
    - "src/storage/runtime-state-store.test.ts — 4 positive cases (3 lease-repair + 1 normalize sweep)"
    - "src/storage/storage-context.test.ts — 3 cases (facade bundle wiring, cross-facade shared SqlRunner observability, normalizeStoredPaths-at-construction sweep)"
  modified: []  # zero modifications — pure additive wave

key-decisions:
  - "RepairScanStore composite type IS exported (per Wave 2 plan contract). Executor advisory A2 flagged it as dead code because repair-scan.ts also consumes JobQueueStore methods; Wave 3 owns that resolution decision, not Wave 2. Honoring the contract."
  - "RuntimeStateStore.normalizeStoredPaths() uses database.transaction(() => ...) — NOT sql.transaction(...) — to keep behavior BYTE-IDENTICAL with the original SessionStore.normalizeStoredPaths body (session-store.ts:736)."
  - "Path-mapping extracted as free functions taking (row, resolveStoredPath) rather than a class — composable and testable in isolation; overload chains preserved so non-null inputs continue to type-narrow to non-null outputs under noUncheckedIndexedAccess."
  - "Tests use real DirongDatabase against tmp file (TESTING.md mandate: never mock node:sqlite). Each test seeds session_speakers before any createChunkWriting call to satisfy the (session_id, user_id) composite FK on chunks."

patterns-established:
  - "Facade construction: constructor(sql: SqlRunner, paths: StoragePathResolver[, database?: DirongDatabase])"
  - "Composition root: createStorageContext(database, options?) returns { writes, reads, jobs, runtime, database, close }"
  - "Test fixture: makeFixture() → mkdtempSync + new DirongDatabase + createStorageContext + try/finally close + rmSync"

requirements-completed:
  - STORE-01-CREATION  # CREATE step of STORE-01. Wave 3 cuts callers and deletes session-store.ts (the CUTOVER step), Wave 4 enumerates tests (the GATE step). The full STORE-01 plus STORE-02, STORE-03, TEST-02 close out at end of Wave 4.

# Metrics
duration: 33min
completed: 2026-05-15
---

# Phase 1 Plan 01 — Wave 2 (T2.1): Role-scoped facades + StorageContext composition root

**Decomposed the 879-line SessionStore god node into four role-scoped facades sharing one SqlRunner per DirongDatabase, behind a single `createStorageContext` composition root — pure additive, byte-identical method bodies, ready for Wave 3 cutover.**

## Performance

- **Duration:** 33 min
- **Started:** 2026-05-15T08:39:11Z
- **Completed:** 2026-05-15T09:11:55Z
- **Tasks:** 1 (T2.1 only — Wave 1 already shipped; Waves 3 & 4 are subsequent runs)
- **Files created:** 12 (7 production + 5 co-located tests)
- **Files modified:** 0
- **Lines added:** 2,405 (commit `b099564`)

## Accomplishments

- Seven new production files in `src/storage/` (path-mapping, store-helpers, session-write-store, session-read-store, job-queue-store, runtime-state-store, storage-context).
- Five co-located `*.test.ts` files; **all 22 tests pass** under `node --no-warnings --test dist/storage/{session-write,session-read,job-queue,runtime-state,storage-context}-store.test.js` (storage-context test file name follows the same pattern but without the "-store" suffix).
- `npm run build` is green — `tsc -p tsconfig.json` compiles cleanly under `strict + noUncheckedIndexedAccess`.
- `src/storage/session-store.ts` is **byte-identical** to its Wave-1 HEAD state (`git diff src/storage/session-store.ts` is empty). Wave 3 will delete it.
- `package.json` is **byte-identical** (`git diff package.json` is empty). Wave 4 will enumerate the 5 new test paths.
- Zero production caller was touched. Zero existing test was touched. Pure new-file wave.

## Task Commits

1. **T2.1: facades + StorageContext composition root** — `b099564` (refactor)
   - 12 files changed, 2,405 insertions(+), 0 deletions(-)
   - Pre-commit HEAD safety assertion passed (HEAD on `worktree-agent-a74154c3a450f2ba6`, not a protected ref)
   - cwd-drift assertion passed (sentinel-verified)

This is a wave-scoped summary. Wave 3 (T3.1) and Wave 4 (T4.1) will produce their own summaries (`01-T3_1-SUMMARY.md`, `01-T4_1-SUMMARY.md`) so they do not clobber this one. The orchestrator merges this commit back into `main` after the worktree returns.

## Files Created (12 total)

### Production (7)

- `src/storage/path-mapping.ts` — pure free functions `mapSessionRow`, `mapChunkRow`, `mapSttJobRow`, `mapAiCleanupJobRow`, `mapMeetingNotesDraftRow`. Extracted verbatim from `session-store.ts:771-851`. Overload chains preserved so non-null inputs continue to narrow to non-null outputs under `noUncheckedIndexedAccess`.
- `src/storage/store-helpers.ts` — `isoNow()` and `sha256Text(value)`. Extracted verbatim from `session-store.ts:866-872`.
- `src/storage/session-write-store.ts` — WRITE facade. Constructor `(sql, paths)`. Method bodies extracted verbatim from SessionStore. WRITE-internal reads (`chunks.get` for FK validation, `aiCleanupJobs.get` for completion guard) stay inside the facade because they are write-preconditions, not read-surface methods.
- `src/storage/session-read-store.ts` — READ facade. Constructor `(sql, paths, database)`. Includes the three read-models (`dashboard`, `status-text`, `ai-cleanup-terminal`) and raw session/chunk/transcript/job/draft reads. Takes `DirongDatabase` for the dashboard read model's ad-hoc SELECTs (pure reads, no transactions).
- `src/storage/job-queue-store.ts` — JOB-QUEUE facade. Constructor `(sql, paths)`. STT queue ops (`claimNext`, `queueExisting`, `failJobsWithMissingAudio`) and full AI-cleanup queue lifecycle (`getOrCreate`, `claim`, `updateArtifacts`, `block`, `retry`, `failProcessing`).
- `src/storage/runtime-state-store.ts` — RUNTIME facade. Constructor `(sql, paths, database)`. Lease-repair methods (`releaseExpiredProcessingLeases`, `releaseExpiredAiCleanupLeases`, `repairExpiredAiCleanupProcessingJobs`) plus `normalizeStoredPaths()` startup sweep using `database.transaction(...)` (NOT `sql.transaction(...)`) per BYTE-IDENTICAL preservation contract.
- `src/storage/storage-context.ts` — composition root. Exports `createStorageContext(database, options?)`, `type StorageContext`, `type RepairScanStore = SessionWriteStore & SessionReadStore & RuntimeStateStore`, and re-exports the full row-type list line-for-line from `session-store.ts:37-53`.

### Tests (5)

- `src/storage/session-write-store.test.ts` — 5 cases: session lifecycle / chunk-lifecycle-with-transcode / recordRepairItem / completeSttJob / completeAiCleanupJob.
- `src/storage/session-read-store.test.ts` — 6 cases: get/getLatest, chunk reads, transcript segments via completeSttJob, AI-cleanup-job reads, composite read-models (dashboard + statusText).
- `src/storage/job-queue-store.test.ts` — 5 cases: STT claim, queueExisting, failJobsWithMissingAudio, AI cleanup full lifecycle (getOrCreate+claim+block), retryAiCleanupJob.
- `src/storage/runtime-state-store.test.ts` — 4 cases: STT lease release, AI-cleanup lease release, AI-cleanup repair (requeued/failed summary), normalizeStoredPaths absolute→relative rewrite.
- `src/storage/storage-context.test.ts` — 3 cases: facade-bundle wiring assertion, cross-facade shared-SqlRunner observability (writes through `writes` visible via `reads`), `normalizeStoredPaths: true` triggers the sweep at construction.

## Verification (per plan `<verify>` block)

```bash
npm run build  # → exit 0, no errors
node --no-warnings --test \
  dist/storage/session-write-store.test.js \
  dist/storage/session-read-store.test.js \
  dist/storage/job-queue-store.test.js \
  dist/storage/runtime-state-store.test.js \
  dist/storage/storage-context.test.js
# → 22 pass, 0 fail
```

Full output (post-fix):
```
ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 850.242889
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Test bug] Missing `upsertSpeaker` calls before `createChunkWriting`.**

- **Found during:** Initial test run after move-files-to-worktree.
- **Issue:** First test run produced 11 failures with `ERR_SQLITE_ERROR: FOREIGN KEY constraint failed`. Root cause: the `chunks` table has a composite FK on `(session_id, user_id) REFERENCES session_speakers(session_id, user_id)`, and the seed helpers I wrote called `createSession → createChunkWriting` without an intervening `upsertSpeaker`.
- **Fix:** Added `ctx.writes.upsertSpeaker({ sessionId, userId, displayNameSnapshot, isBot: false, seenAtMs: 0 })` between `createSession` and `createChunkWriting` in every seed block across the four test files that exercise chunks (write, read, job-queue, runtime, storage-context). Mirrors the pattern in `session-store-paths.test.ts:36-44`.
- **Files modified:** `src/storage/session-write-store.test.ts`, `src/storage/session-read-store.test.ts`, `src/storage/job-queue-store.test.ts`, `src/storage/runtime-state-store.test.ts`, `src/storage/storage-context.test.ts` (all in the same commit `b099564` — the failures were caught BEFORE commit, fixed in-place, then committed).
- **Verification:** All 22 tests pass after the fix.

### Worktree-path-safety incident (process note, not a code deviation)

The Write tool initially routed all 12 absolute paths to the **main repo working tree** at `/mnt/d/Taniar/Documents/Git/discord_record_bot/src/storage/` instead of the worktree at `/mnt/d/Taniar/Documents/Git/discord_record_bot/.claude/worktrees/agent-a74154c3a450f2ba6/src/storage/`. This is the documented bug (`references/worktree-path-safety.md` #3099). Recovered by `mv`-ing all 12 untracked files from the main repo path into the worktree path before staging — the main repo's working tree is now clean of T2.1 files (the unrelated `M` modifications in main were pre-existing user state, not mine). Going forward inside this worktree, all Edit/Write calls have used the canonical worktree absolute path.

## Plan Compliance

| Constraint from objective                              | Status |
|--------------------------------------------------------|--------|
| `src/storage/session-store.ts` UNCHANGED               | ✔ (`git diff src/storage/session-store.ts` empty) |
| `package.json` UNCHANGED                               | ✔ (`git diff package.json` empty) |
| No consumer of `SessionStore` modified                 | ✔ (only new files in `src/storage/`) |
| `src/storage/repair-scan.ts` UNCHANGED                 | ✔ (not in commit) |
| Named exports only, no default, no barrel files        | ✔ |
| `kebab-case.ts` filenames                              | ✔ |
| `.js` extension in import paths                        | ✔ |
| All four facades share ONE `SqlRunner`                 | ✔ (constructed in `createStorageContext`, threaded through; verified by storage-context test case (b)) |
| Path normalization preserved exactly                   | ✔ (path-mapping.ts is verbatim extraction with overload chains) |
| Real `DirongDatabase` against tmp file in tests        | ✔ (no `node:sqlite` mocks) |
| Strict-mode `noUncheckedIndexedAccess` compatible      | ✔ (`tsc` clean) |
| NO mock/stub data on production paths                  | ✔ (facades only wrap real repositories) |
| NO silent fallbacks that mask missing data             | ✔ (all `if (!row) throw` patterns preserved verbatim from SessionStore) |
| Single atomic commit at end of T2.1                    | ✔ (`b099564`) |
| SUMMARY filename `01-T2_1-SUMMARY.md` (wave-scoped)    | ✔ (this file) |
| `.planning/STATE.md` NOT modified                      | ✔ (orchestrator owns shared file writes) |
| `.planning/ROADMAP.md` NOT modified                    | ✔ |

## Wave Status

| Wave | Task | Status   | Commit(s) |
|------|------|----------|-----------|
| 1    | T1.1 | done     | `119cb29` (on `main`, pre-worktree) |
| 1    | T1.2 | done     | `473dbcd` (on `main`, pre-worktree) |
| 1    | (state mark) | done | `eeb2715` (on `main`, pre-worktree) |
| 2    | T2.1 | done     | `b099564` (on `worktree-agent-a74154c3a450f2ba6`) — **this wave** |
| 3    | T3.1 | pending  | (next run) |
| 4    | T4.1 | pending  | (final run, package.json + full `npm test` gate) |

## Self-Check: PASSED

- All 12 created files exist at their expected paths (verified via `git show --stat b099564`).
- Commit `b099564` exists on `worktree-agent-a74154c3a450f2ba6` (verified via `git log --oneline`).
- Build is clean (`npm run build` → exit 0).
- 22/22 facade tests pass (`node --test` exit 0).
- `session-store.ts` unchanged (`git diff` empty).
- `package.json` unchanged (`git diff` empty).
