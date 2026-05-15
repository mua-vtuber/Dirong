# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-15)

**Core value:** A meeting host can run `/dirong start` in Discord and end up with a clean, validated, locally-owned meeting note (and an optional Notion page) without exporting any audio or transcript outside their machine.
**Current focus:** Phase 2 — Persistent CLI & Recording Reliability — ✓ COMPLETE (3 waves / 6 tasks). Next: Phase 3 — Policy Compliance (POLY-01..03 + LOG-01) — awaiting `/gsd:verify-work 2` then `/gsd:discuss-phase 3` (or `/gsd:transition`).

## Current Position

Phase: 2 of 4 (Persistent CLI & Recording Reliability) — ✓ COMPLETE
Wave: 3 of 3 — ✓ All complete
Plan: T1 + T2 + T3 + T5 + T4 + T6 of 6 done (100%)
Status: Phase 2 success — all 5 ROADMAP criteria simultaneously hold; `npm run build && npm test` green (528/528 pass, 0 skipped, 8.5s); RELY-01 + RELY-02 + RELY-03 + RELY-04 + RELY-05 + TEST-01 satisfied
Last activity: 2026-05-16 — Wave 3 T6 verification gate executed inline (no code changes, pure audit); all 5 ROADMAP grep checks PASS, package.json enumeration audit clean, no sibling test files created.

Progress: [██████████] 100% (T1 + T2 + T3 + T5 + T4 + T6 / 6 tasks) — Phase 2 COMPLETE

## Wave Status (Phase 2)

| Wave | Tasks | Commits | Status |
|------|-------|---------|--------|
| 1 (T1→T2→T3 trio + T5 ∥) | 4 | 3fc9b86, 4f6e8b2, 2a53f23, dd3a29a, 94d2ccb, b0e101a | ✓ Complete |
| 2 (T4 boot repair) | 1 | 1496663, 95d623a | ✓ Complete |
| 3 (T6 verification gate) | 1 | (inline audit, no code commit) | ✓ Complete |

## Wave Status (Phase 1 — archived)

| Wave | Tasks | Commits | Status |
|------|-------|---------|--------|
| 1 (sequential T1.1 → T1.2) | 2 | 119cb29, 473dbcd | ✓ Complete |
| 2 (T2.1) | 1 | b099564, 838381d, a6802bd | ✓ Complete |
| 3 (T3.1 — atomic cutover) | 1 | 6997ccd, e4157e1, 39e3712 | ✓ Complete |
| 4 (T4.1 — verification) | 1 | 00474ea, 0627ff7 | ✓ Complete |

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: — min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Storage Foundation | 0 | — | — |
| 2. Persistent CLI & Recording Reliability | 0 | — | — |
| 3. Policy Compliance | 0 | — | — |
| 4. Dashboard Surface Hygiene | 0 | — | — |

**Recent Trend:**
- Last 5 plans: —
- Trend: — (no plans executed yet)

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Init: Active scope = stability/hardening derived from CONCERNS.md HIGH+selected MEDIUM (no explicit milestone goal supplied to `/gsd:new-project`).
- Init: 4-agent project research phase skipped — domain is well-known and `.planning/codebase/` already documents the actual stack.
- Roadmap: Phases ordered by blast radius — Storage Foundation (Phase 1) precedes everything because STORE-01 splits the 136-edge `SessionStore` god node, which every later phase consumes via the new facades.

### Wave 2 Outcomes (T4 — 2026-05-16)

- Atomic commit `1496663` on `worktree-agent-a4d9d3d3b23055f27` (merged via `95d623a`); SUMMARY `.planning/phase2/01-T4-SUMMARY.md` committed in `18a2e05`.
- `src/app/main.ts` repair log line replaced — `JSON.stringify(repairSummary, null, 2)` blob → literal `"startup repair: ${reconciledTotal} items reconciled"` (with indented 7-field breakdown when `reconciledTotal > 0`) per D-06.
- `runStartupRepair(ctx, config)` wrapped in `try/catch`: failure path emits `console.error("startup repair failed:", errorMessage)` + `store.recordConnectionEvent({ sessionId: null, eventType: "startup_repair_failed", level: "error", details: { error: errorMessage } })` and falls through to an empty `RepairScanSummary` so boot continues per D-08. Zero `process.exit(1)` added on the repair-failure path.
- **A5 final disposition (signature correction by executor):** Planner brief used `{ kind, occurredAt, payload }` but the actual `recordConnectionEvent` signature is `{ sessionId, eventType, level?, startedAtMs?, endedAtMs?, details? }` (defined in `src/storage/repair-repository.ts:15-22`, delegated from `SessionWriteStore`). Executor verified against 4 neighboring callers (`voice-connection-controller.ts`) and used `eventType: "startup_repair_failed"` + `level: "error"` + `details: { error }`. **Lesson:** for Phase 3+ planner briefs, always read the actual signature before composing example call shapes.
- **Merge friction:** T4 worktree was branched from `f8623a4` (pre-Phase-2-planning), so it lacked Wave 1's `process.on('exit')` hook and `provider` hoist. The merge produced 1 conflict at `main.ts:125-152` (try/catch region). Resolved manually: kept HEAD's `const store = flattenStorageContext(ctx)` line, took T4's try/catch structure, fixed `runStartupRepair(store, …)` → `runStartupRepair(ctx, …)` (T4 worktree had used the stale signature). Documented in merge commit `95d623a` body.
- ROADMAP success criterion #4 grep gate: `startup repair:` = 1, `JSON.stringify(repairSummary` = 0, `startup_repair_failed` = 1. PASS.
- Test count unchanged at 528 (T4 modifies runtime only, no test additions). `npm run build && npm test` exit 0 (8.49s).

### Wave 1 Outcomes (T1+T2+T3 trio + T5 — 2026-05-15/16)

**Trio commits (worktree `worktree-agent-a8fe6ad1c808c26f1`, merged via `27a4d5b`):**
- `3fc9b86` — T1 RELY-02: abort-listener reordering (line index of `addEventListener('abort')` < first `await this.killSession()` inside `generate()`)
- `4f6e8b2` — T2 RELY-01: `trackedPids: Set<number>` + `reapTrackedPids()` + `onOrphanKillFailed?` callback + `process.on('exit')` wiring in `main.ts` + 4 new tests
- `2a53f23` — T3 RELY-03: `forceKillIfStale(now, threshold)` on provider + service-owned `setInterval` (`Math.max(5_000, timeoutMs/4)`) with `.unref()` + 3 new tests

**T5 commit (worktree `worktree-agent-a5c3ed8565f6ac754`, merged via `0fc6c0a`):**
- `dd3a29a` — T5 RELY-05: 60s force-close branch covered by new integration test using `t.mock.timers`; **executor took plan A2 fallback** — extracted 35-line `executeForceCloseBranch` helper from `recording-producer.ts:319-356` (byte-equivalent refactor) because seeding a real `ActiveSession` through `producer.start(...)` would have required >100 lines of Discord voice stubs. The fallback is authorized in plan T5 `<behavior>`.

**Plan-checker advisory dispositions:**
- A5 RESOLVED: `recordConnectionEvent` accepts `sessionId: string | null` (both `SessionWriteStore` and `RepairRepository` surfaces). Structured-event path used directly in `main.ts`. **No `console.error` fallback, no Phase 3 POLY follow-up needed.**
- A4 RESOLVED: T1 sub-test (b) — static-source ordering assertion adopted as canonical; deferred-promise harness skipped per plan-checker authorization.
- A2 RESOLVED: T5 helper-extraction fallback taken (see above).

**Executor deviations (auto-fixed, documented in SUMMARYs):**
1. T3 also touched `src/ai/cleanup/provider-lifecycle.ts` (not in declared `<files>`) to forward `forceKillIfStale` through `wrapAiCleanupProviderWithLifecycle` — preserves runtime narrowing for non-CLI providers.
2. T2 narrowed `createAiCleanupProvider` return type in `main.ts` from `AiCleanupProvider` to `ClaudeStreamJsonCliCleanupProvider` so `reapTrackedPids()` is reachable without a runtime cast.
3. T1 reworded a comment containing literal `await this.killSession()` substring (false-match risk in the static-source line-index test).
4. T5 worktree-path-safety incident: first 2 Edits hit the main repo via absolute path; reverted via `git checkout --` and re-applied via relative paths inside the worktree.
5. T5 transient environmental: `@snazzah/davey-linux-x64-gnu` missing → resolved with `npm install --no-save @snazzah/davey-linux-x64-gnu` (same carry-forward from STATE.md commit `27152f9`).

**Test count:** 517 (Phase 1 baseline) → 528 (Wave 1 complete) — 10 new trio tests + 1 new T5 test. All pass; 0 skipped. `npm run build && npm test` exit 0 (8.66s).

**Pre-merge friction recovery (orchestrator playbook reused from Phase 1):** stash CRLF noise → merge trio worktree → merge T5 worktree → stash pop produced 4 UU conflicts on trio-touched files → `git checkout --ours` + add → `git reset HEAD` for stash-applied non-conflicted noise → drop stash.

### Wave 3 Outcomes (T6 — 2026-05-16) — Phase 2 close-out

- T6 ran INLINE (no worktree, no code changes) — pure audit task.
- `npm run build && npm test` green: 528/528 tests pass, 0 skipped, 8.54s.
- All 5 ROADMAP Phase 2 success criteria simultaneously hold:
  1. ✔ SC1 — `trackedPids` in provider; `reapTrackedPids` + `process.on("exit")` wired in `main.ts`.
  2. ✔ SC2 — `addEventListener("abort", ...)` line index < first `await this.killSession()` inside `generate()` (verified statically + behaviorally by T1's tests).
  3. ✔ SC3 — `forceKillIfStale` on provider; `safeguardInterval` + `clearInterval` in service.
  4. ✔ SC4 — literal `"startup repair: N items reconciled"` in main.ts; `JSON.stringify(repairSummary` = 0; `startup_repair_failed` event wired.
  5. ✔ SC5 — `chunk_finalize_timeout` assertion in `recording-producer.test.ts`.
- package.json audit: both touched test files (`claude-persistent-cli-provider.test.js`, `recording-producer.test.js`) already enumerated since Phase 1; zero new test files created (TEST-01 extended existing).
- T6 SUMMARY committed in next commit; no source code commits (audit-only task per plan T6 `<action>`).

### Pending Todos

- **Phase 2 verification — entry gate.** `/gsd:verify-work 2` to run UAT. Phase 2 is a backend reliability hardening with no UI changes; UAT will likely be a snapshot-style verification similar to Phase 1's (cold-start smoke, persistent CLI lifecycle, recording producer force-close path).
- **Phase 3 (Policy Compliance — POLY-01/02/03 + LOG-01) — next.** Forward dependency from Phase 1 already satisfied (StorageContext threading). After Phase 2 UAT passes, run `/gsd:discuss-phase 3` or `/gsd:transition`.
- **POLY follow-up (Phase 3):** update narrow ports (`RecordingProducerStore`, `DashboardStore`, `SttBatchStore`, `AiCleanupAutomationStore`) to accept facade-typed inputs, then delete `flattenStorageContext` + `FlatStorageStore` from `storage-context.ts`.
- **Hygiene follow-up (deferred):** `dist/storage/job-retry-policy.test.js` is a pre-existing test file (commit `524ccf5`, pre-Phase-1) not enumerated in `package.json#scripts.test`. Out of scope for Phase 1/2; a future audit task should enumerate it or formally deprecate it.

### Wave 4 Outcomes (T4.1 — 2026-05-15) — Phase 1 close-out

- Atomic commit `00474ea`: appended 5 new facade test paths to `package.json#scripts.test` (space-separated, single line preserved):
  - `dist/storage/session-write-store.test.js`
  - `dist/storage/session-read-store.test.js`
  - `dist/storage/job-queue-store.test.js`
  - `dist/storage/runtime-state-store.test.js`
  - `dist/storage/storage-context.test.js`
- Forbidden-entry check PASS: `migration-idempotency`, `migration-crash-recovery`, `migrations-test-helpers` confirmed absent from `package.json` (STORE-03 + TEST-02 live inside `migrations.test.ts` per CONTEXT.md Lock; helpers are non-test).
- Final test gate: `npm run build && npm test` exits 0 with **517/517 tests pass, 0 fail, 0 skipped, 0 cancelled** (8.9s). The jump from 495 → 517 reflects the 22 new facade tests created in Wave 2 now being discovered via the updated `scripts.test` enumeration.
- All 4 ROADMAP Phase 1 success criteria simultaneously hold:
  1. ✔ `grep -r "from .*session-store" src/ --include="*.ts" | grep -v "^src/storage/" | grep -v test` returns 0 hits.
  2. ✔ TEST-02 (mid-step migration crash recovery) passes inside `dist/storage/migrations.test.js`.
  3. ✔ STORE-03 (per-migration twice-and-diff idempotency) — all 12 migrations pass inside `dist/storage/migrations.test.js`.
  4. ✔ `npm run build && npm test` exits 0; no skipped tests; every new facade test file enumerated.
- Worktree note: executor's worktree branch was created from a stale base; recovered via `git reset --hard main` at startup (zero unique commits lost). Single atomic commit produced.
- Merge commit `0627ff7` on `main`. Post-merge verification re-run by orchestrator: build + test both exit 0.

### Wave 3 Outcomes (T3.1 — 2026-05-15)

- Atomic cutover commit `6997ccd`: 25 files modified + `src/storage/session-store.ts` (879 lines) deleted; 362 insertions / 1080 deletions.
- 8 production callers updated: `src/app/{main,ai-cleanup,fake-stt,real-stt,repair}.ts` swapped from `new SessionStore(...)` to `createStorageContext(...)`; method calls dispatched to `ctx.writes` / `ctx.reads` / `ctx.jobs` / `ctx.runtime`.
- 3 Notion files (`draft-input.ts`, `draft-input-read-model.ts`, `test-fixtures.ts`) had type-only `from "../storage/session-store.js"` imports redirected to `"../storage/storage-context.js"` (T2.1 re-exports the row types line-for-line).
- `src/storage/repair-scan.ts` (Blocker 2) now accepts `StorageContext` and dispatches internally — per executor advisory A2, the `RepairScanStore` composite type was DROPPED from `storage-context.ts` because `repair-scan.ts` also consumes `JobQueueStore` methods (`failJobsWithMissingAudio`, `queueExistingSttJobForChunk`); the composite would not have compiled.
- 12 test files cut over (4 storage-internal + 8 cross-module); `session-purge.test.ts` filename preserved per Blocker 3 (it stays enumerated as `dist/storage/session-purge.test.js` in `package.json#scripts.test`).
- 4 storage source files had doc comments rephrased to drop literal `session-store.ts` references (passes the strict internal grep gate `grep -rn "session-store" src/storage/ --include="*.ts" | grep -v "session-store-paths\|session-store-ai-cleanup"` returning zero).
- ROADMAP success criterion #1 grep gate: `grep -r "from .*session-store" src/ --include="*.ts" | grep -v "^src/storage/" | grep -v test` returns ZERO hits.
- `npm run build && npm test` green (495/495 tests pass, 0 fail, 0 skipped, 9.34s).
- **Executor deviation (transitional helper, logged in `01-T3_1-SUMMARY.md`):** Added `flattenStorageContext(ctx)` + `FlatStorageStore` type to `storage-context.ts`. Required because existing narrow-port interfaces (`RecordingProducerStore`, `DashboardStore`, `SttBatchStore`, `AiCleanupAutomationStore`, etc.) expect flat method surfaces; passing raw `ctx` to those service constructors would not type-check. The helper is `.bind()`-based (zero behavior change) and the type is defined via `Pick<C, keyof C>` per facade so private repository slots are stripped. `FlatStorageStore` is documented as transitional — a POLY-* follow-up task will update each narrow port to accept facade-typed inputs and delete this helper.
- **Orchestrator merge friction (process note, not a code deviation):** The main working tree carries ~221 pre-existing files with CRLF↔LF line-ending noise from Windows-side editing (known env state per Wave 2 SUMMARY). The merge initially aborted because those noise files would have been "overwritten by merge"; orchestrator stashed the noise (`wave3-pre-merge-line-ending-noise`), merged cleanly, resolved 20 stash-pop conflicts in favor of merge HEAD (`--ours`), unstaged the stash-applied non-conflicting noise via `git reset HEAD` to restore pre-merge user state, and dropped the stash. Merge commit `39e3712` is clean and atomic; the line-ending noise remains as pre-existing untracked user state, identical to its post-Wave-2 condition.

### Wave 2 Outcomes (T2.1 — 2026-05-15)

- 7 new production files in `src/storage/`: `path-mapping.ts`, `store-helpers.ts`, `session-write-store.ts`, `session-read-store.ts`, `job-queue-store.ts`, `runtime-state-store.ts`, `storage-context.ts` — plus `rows.ts` (executor-introduced row-type extraction module that `storage-context.ts` re-exports; not in the original plan file list but consistent with CONVENTIONS.md and unblocks Wave 3's `repair-scan.ts` type redirect).
- 5 co-located `*.test.ts` files, all pass under `node --test`: 22/22 facade tests; post-merge gate against Wave-1 migration tests is 49/49 green.
- All four facades share ONE `SqlRunner` per `DirongDatabase` (CONTEXT.md lock verified by `storage-context.test.ts`).
- `src/storage/session-store.ts` is byte-identical to its pre-Wave-2 state (Wave 3 deletes it).
- `package.json` is unchanged (Wave 4 enumerates the new tests).
- `repair-scan.ts` is unchanged (Wave 3 redirects its type imports).
- Executor deviation logged in `01-T2_1-SUMMARY.md`: 11 initial test failures from missing `upsertSpeaker` before `createChunkWriting` (composite FK on `chunks(session_id, user_id) → session_speakers`); auto-fixed in-place before the atomic commit.
- Post-merge LSP follow-up: 2 unused-locals diagnostics (`AiCleanupFailureKind` import in `session-write-store.ts`; `normalizeCtx` binding in `runtime-state-store.test.ts`) — fixed in 838381d before the merge to main.

### Blockers/Concerns

None active. The previously-flagged `@snazzah/davey` native-binding gap was resolved on 2026-05-15 by installing the platform-specific napi-rs binary package (the host `node_modules` had only `@snazzah/davey-win32-x64-msvc` because `npm install` had been run from the Windows side; WSL needs `@snazzah/davey-linux-x64-gnu`). Full suite now reports zero pre-existing failures — Wave 4's `npm test` gate will run against a clean baseline.

**Forward dependency note:** Phases 2, 3, and 4 nominally depend on Phase 1 (so refactors land against the new facades), but POLY/DASH/LOG work could be unblocked early if Phase 1 over-runs — revisit at Phase 1 transition.

**Environment note (carry-forward):** `node_modules/@snazzah/` must contain BOTH platform binaries when developing across Windows and WSL on the same checkout. Re-running `npm install` from whichever side has the missing binary is the canonical fix — do NOT `npm rebuild`, the package ships prebuilt and has no source to recompile.

**Environment note 2 (added 2026-05-16 from Phase 2 UAT investigation):** `node-crc` shares the same cross-platform native-binding pain point as `@snazzah/davey`. The recording producer's chunk-CRC step loads `node_modules/node-crc/build/Release/crc.node`; if a WSL-side `npm install` overwrites that with a Linux ELF binary, the Windows-side bot will throw `ERR_DLOPEN_FAILED: ... is not a valid Win32 application` on the first chunk finalize attempt — causing chunks to stay stuck at `status='writing'`, downstream STT/AI cleanup fails by cascade, and dashboard playback bars are not rendered (because `appendSignedAudioUrlsToDashboardState` requires `status !== 'writing'`). **Recovery:** run `npm install` (or `npm rebuild node-crc`) on the side that's missing the correct binary. Same pattern as `@snazzah/davey`. Long-term mitigation: maintain platform-isolated `node_modules/`, or document this in CONTRIBUTING when v1 ships.

## Deferred Items

Items acknowledged and carried forward (v2 scope, see REQUIREMENTS.md):

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| MOD | MOD-01..04 (oversized module splits) | Deferred to v2 | 2026-05-15 init |
| HARD2 | HARD2-01 (secret-leak sentinel test), HARD2-02 (CONVENTIONS.md runChild rule) | Deferred to v2 | 2026-05-15 init |

## Session Continuity

Last session: 2026-05-15 (init)
Stopped at: Roadmap created; awaiting `/gsd:plan-phase 1` to begin Phase 1 planning.
Resume file: None
