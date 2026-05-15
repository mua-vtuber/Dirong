---
phase: 02-reliability
plan: 01
wave: 2
task: T4
subsystem: app

tags: [reliability, boot, repair-log, observability, error-handling]

# Dependency graph
requires:
  - phase: 01-storage-foundation
    provides: "SessionStore.recordConnectionEvent delegates to RepairRepository (storage/repair-repository.ts) — accepts { sessionId: string|null, eventType, level, startedAtMs, endedAtMs, details } and persists into connection_events"
  - phase: 02-reliability (this plan, T2/T3 in Wave 1)
    provides: "runStartupRepair(store, config) preserves its sync sequential order + RepairScanSummary shape — no changes to repair-scan.ts in this task"
provides:
  - "Literal boot log line `startup repair: N items reconciled` (replaces the previous JSON.stringify blob) emitted on every boot; ROADMAP success criterion #4 grep gate passes"
  - "Indented per-field breakdown (oldPartFiles / staleWritingChunksRepaired / staleWritingChunksFailed / missingSttJobsCreated / missingAudioJobsFailed / expiredLeasesReleased / orphanAudioFiles) gated by `reconciledTotal > 0` per D-06"
  - "try/catch wrapper around runStartupRepair(store, config) — on throw: console.error + recordConnectionEvent({ eventType: 'startup_repair_failed', level: 'error', sessionId: null, details: { error } }) + empty-summary fallback. Boot continues per D-08 (no process.exit on repair failure)."
affects: [Phase 4 DASH (connection_events startup_repair_failed surfaces in dashboard), operator triage on broken-boot reports]

# Tech tracking
tech-stack:
  added: []  # runtime-only change; no new dependencies; no test files
  patterns:
    - "Boot-time observability: literal-format log line ('startup repair: N items reconciled') + dashboard-side event (connection_events row with eventType='startup_repair_failed') decouples human stdout reading from machine telemetry. Both channels emit on the failure path."
    - "D-08 fail-soft boot: a non-critical-path async step (runStartupRepair) is wrapped in try/catch with an empty-typed-fallback so downstream consumers (the log line itself, future Phase 4 DASH read models) see a well-formed RepairScanSummary instead of an undefined/null carve-out branch."

key-files:
  created: []
  modified:
    - "src/app/main.ts — line 122 `await runStartupRepair(store, config)` rewritten as let + try/catch with empty-summary fallback; line 250 (was 250 before edit, now 281) JSON.stringify(repairSummary) replaced with literal-format console.log + conditional indented breakdown"

key-decisions:
  - "D-05 (unconditional run) preserved — the call site at line 122 still always runs; T4 only changes error handling and log format, not invocation semantics."
  - "D-06 (literal log format) realized as template literal `startup repair: ${reconciledTotal} items reconciled` so the literal substring 'startup repair:' survives any reconciledTotal value (including 0). Indented breakdown is gated on `reconciledTotal > 0` so a clean boot stays single-line."
  - "D-07 (sync sequential order) preserved — no parallelization or re-ordering of repair steps; T4 is purely a wrapper-and-log change."
  - "D-08 (no process.exit on repair failure) realized as console.error + recordConnectionEvent + empty-summary fallback. The empty summary makes the downstream literal log line emit `startup repair: 0 items reconciled` on the failure path (honest reporting — zero items reconciled because repair didn't run to completion)."
  - "Used `level: 'error'` on the recordConnectionEvent (RepairRepository default is 'info'). startup_repair_failed is a real failure, not informational, so it should surface at error level for dashboard severity filtering."

requirements-completed:
  - RELY-04  # boot repair log polish + failure-path dashboard event. ROADMAP success criterion #4.

# Metrics
duration: ~15min
completed: 2026-05-16
---

# Phase 2 Plan 01 — Wave 2 (T4): boot repair log polish (RELY-04)

**Replaced the boot-time `console.log("startup repair:", JSON.stringify(repairSummary, null, 2))` JSON blob with a literal-format line (`startup repair: N items reconciled`) plus a conditional indented per-field breakdown, and wrapped `runStartupRepair(store, config)` in try/catch so a repair failure emits a `console.error` + a `connection_events` row (`eventType: 'startup_repair_failed'`, `level: 'error'`) without aborting boot. Per D-08 there is no `process.exit(1)` on the repair-failure path; the catch installs an all-zero `RepairScanSummary` so the downstream log line still emits as `"startup repair: 0 items reconciled"`.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-16 (worktree spawn)
- **Completed:** 2026-05-16 (commit `1496663`)
- **Tasks:** 1 (T4 — single-file atomic commit)
- **Files created:** 0
- **Files modified:** 1 (src/app/main.ts)
- **Lines added / removed:** +42 / -2

## Accomplishments

- ROADMAP success criterion #4 satisfied: the literal substring `"startup repair:"` survives in `src/app/main.ts` on the success path (line 281), and is grep-detectable; the previous JSON.stringify blob is gone (`grep -c 'JSON.stringify(repairSummary' src/app/main.ts` returns 0).
- Failure-path dashboard wiring: a `startup_repair_failed` row lands in `connection_events` via `store.recordConnectionEvent({...})` when `runStartupRepair` throws. Phase 4 DASH read models can surface this row without further wiring on the app side.
- Boot continues on repair failure (D-08 honored): no new `process.exit(1)` introduced in T4. The catch block emits stdout + dashboard event, then installs an empty-typed summary so the subsequent log code path and any downstream consumers see a well-formed `RepairScanSummary`.
- Operator-readable single-line success case: when `reconciledTotal === 0` (clean boot — the common case), the log is exactly one line, no JSON blob noise. When there is real work to report, the indented breakdown lists each field's count.

## Task Commits

1. **T4: replace JSON repair-log with literal line + try/catch wrapper** — `1496663` (feat)

_No plan-metadata commit — this is a single-task worktree handoff to the orchestrator, which owns the `.planning/STATE.md` and `.planning/ROADMAP.md` updates and any merge-commit metadata._

## Files Created/Modified

- `src/app/main.ts` (modified, +42 / -2):
  - **Line 122 area** — rewrote `const repairSummary = await runStartupRepair(store, config);` as a `let` + try/catch. Catch block: `console.error("startup repair failed:", errorMessage)` + `store.recordConnectionEvent({ sessionId: null, eventType: "startup_repair_failed", level: "error", details: { error: errorMessage } })` + empty-typed `RepairScanSummary` fallback (all seven fields set to 0).
  - **Line 250 → 281 area** — replaced `console.log("startup repair:", JSON.stringify(repairSummary, null, 2));` with `const reconciledTotal = (sum of all 7 fields)` followed by `console.log(`startup repair: ${reconciledTotal} items reconciled`)` and a guarded `if (reconciledTotal > 0)` block emitting 7 indented `  fieldName: N` lines.

## Decisions Made

See `key-decisions` in the frontmatter. Summary:
- **D-05 / D-06 / D-07 / D-08 all preserved** as locked in `.planning/phase2/01-CONTEXT.md` — T4 does not relitigate any of them.
- **`level: 'error'` on the failed event** is an executor choice (the brief did not specify a level). Rationale: `recordConnectionEvent` defaults to `'info'` (RepairRepository:30), but `startup_repair_failed` is a real failure that warrants surfacing in dashboard severity filters at error level.

## A5 (recordConnectionEvent signature) — final verification

The orchestrator brief asserted "Advisory A5 RESOLVED. `recordConnectionEvent` accepts `sessionId: string | null`. Use `sessionId: null` directly … No `console.error` fallback needed." and instructed me to use a call shape with `kind`, `occurredAt`, `payload`. **The brief's field names were wrong.** Verified ground-truth signature at `src/storage/repair-repository.ts:15-22` (and the recording-side port at `src/recording/storage-port.ts:7-16`):

```ts
recordConnectionEvent(input: {
  sessionId: string | null;
  eventType: string;            // NOT "kind"
  level?: "debug" | "info" | "warn" | "error";
  startedAtMs?: number | null;  // numeric ms-since-session-start, NOT ISO "occurredAt"
  endedAtMs?: number | null;
  details?: unknown;            // NOT "payload"
}): void
```

I also confirmed call-shape conventions by sampling neighbouring production callers (`src/recording/voice-connection-controller.ts:38-129`): they consistently use `eventType: "<snake_case_name>"` and `details: { ... }`. My T4 call follows the same convention. There is no separate `session-write-store.ts` file as the brief suggested — `SessionStore.recordConnectionEvent` (`src/storage/session-store.ts:275-283`) is a thin pass-through that delegates to `RepairRepository.recordConnectionEvent`.

I also confirmed the `console.error` is still appropriate as a complementary channel (NOT a fallback): stdout is for the human watching the terminal, the `connection_events` row is for the dashboard. Both fire on the failure path. The brief saying "No `console.error` fallback needed" was wrong, and the locked decision D-08 ("failure: continue boot, no `process.exit`") does not preclude `console.error` — it only forbids exiting. I kept the `console.error`.

## Final grep gate output (4 patterns)

```text
grep -c "startup repair:" src/app/main.ts            → 1   (must be ≥1 — PASS)
grep -c "JSON.stringify(repairSummary" src/app/main.ts → 0   (must be 0 — PASS)
grep -c "startup_repair_failed" src/app/main.ts      → 1   (must be ≥1 — PASS)
grep -c "process.exit(1)" src/app/main.ts            → 3   (brief literal: 0 — see deviation #1)
```

Lines for gate 4 (all pre-existing, all unrelated to repair path):
- `363:  void shutdown("uncaughtException").finally(() => process.exit(1));` — uncaughtException handler
- `372:    process.exit(1);` — `startDashboardOrExit()` failure path
- `391:    process.exit(1);` — `client.login()` (Discord auth) failure path

## Test count delta

```text
npm test → tests 482  pass 482  fail 0  (duration_ms ≈ 8375)
```

No tests added, no tests removed, no test files modified. The brief mentioned "528+ tests" — the actual baseline is 482, but the contract was "unchanged", which is satisfied. No drift in `package.json#scripts.test`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Brief vs. ground-truth mismatch] `recordConnectionEvent` call-shape adjustment**
- **Found during:** Step 2 (try/catch wrap)
- **Issue:** The orchestrator brief instructed me to call `recordConnectionEvent({ sessionId, kind, occurredAt, payload })` on a `ctx.writes` object, and to look up the signature in a file named `src/storage/session-write-store.ts`. That file does not exist in the repository. The actual signature lives in `src/storage/repair-repository.ts:15-22` and uses different field names: `eventType` (not `kind`), `level` (no equivalent in the brief), `startedAtMs`/`endedAtMs` numeric (no `occurredAt` ISO), `details` (not `payload`). The call site in main.ts already had `store` (a `SessionStore`) directly accessible — not a `ctx.writes` facade.
- **Fix:** Used the correct signature and the existing `store` variable directly: `store.recordConnectionEvent({ sessionId: null, eventType: "startup_repair_failed", level: "error", details: { error: errorMessage } })`. Verified call-shape conventions against neighboring production callers (voice-connection-controller.ts). Built and tested; no regressions.
- **Files modified:** `src/app/main.ts` (only the T4 edit region — no scope creep)
- **Verification:** `npm run build` clean (TypeScript signature accepted), all 482 tests pass.
- **Committed in:** `1496663` (T4 atomic commit)

**2. [Rule 4 — see note, NOT applied] Pre-existing `process.exit(1)` calls left in place**
- **Found during:** Step 4 (grep gate verification)
- **Issue:** The brief's grep gate `grep -c "process.exit(1)" src/app/main.ts # must be 0 (D-08)` does not match the file's reality. There are 3 pre-existing `process.exit(1)` calls (lines 363, 372, 391) for the `uncaughtException` handler, the dashboard-start failure path, and the Discord-login failure path. None of them are on the repair-failure path.
- **Decision:** Did **NOT** remove the pre-existing `process.exit(1)` calls. Rule 4 (architectural changes require user input) applies — those exits implement intentional fail-fast semantics for unrelated subsystems, and removing them would change boot behavior outside the RELY-04 scope. The **D-08 intent** ("repair failure does not call `process.exit(1)`") is satisfied by my edit (lines 122-145 of the post-edit file contain no `process.exit`).
- **Files modified:** none (deliberate non-change)
- **Verification:** Manual inspection of the try/catch block confirms no `process.exit` is reachable from `runStartupRepair` throwing.
- **Suggested follow-up:** If the gate as written is the intended contract, the brief should be re-scoped to say `grep -c "process.exit(1)" within lines 100-150 of src/app/main.ts # must be 0` (or similar localization). As written, the gate over-specifies and conflicts with pre-existing unrelated behavior.

---

**Total deviations:** 1 auto-fix (Rule 1, call-shape correction) + 1 non-change documented (gate literal over-specified vs. D-08 intent).
**Impact on plan:** None on outcome. The implementation realizes D-05/D-06/D-07/D-08 as intended and satisfies the ROADMAP success criterion. The deviation documents are forensic — they record that the brief's field names and exit-count gate did not match the ground truth so future executors do not chase the same red herrings.

## Issues Encountered

- **`.planning/` not present in the worktree.** This worktree branch (`worktree-agent-a4d9d3d3b23055f27`) contains only `src/`, `scripts/`, and `.github/` at HEAD. The orchestrator brief told me to write `.planning/phase2/01-T4-SUMMARY.md`. Resolved by writing directly into the **main repo's** `.planning/phase2/` (outside the worktree). The orchestrator-pattern handles `.planning/` itself — agents only write SUMMARY content; the orchestrator owns commit + STATE.md + ROADMAP.md updates.
- **Wave 1 changes (T2's `process.on('exit')` hook and `provider` hoist) not present on this worktree's HEAD.** The orchestrator brief asserted they were "already on main HEAD". They are not. This did not affect T4 because T4's edits are in different regions of `main.ts` and do not depend on the Wave 1 work. No action taken; left for the orchestrator's merge to reconcile.

## User Setup Required

None — runtime-only change. No new env vars, no new config keys, no new dependencies.

## Next Phase Readiness

- **RELY-04 closed.** Boot log polish and failure-path dashboard event both land in this commit.
- **Wave 2 sibling tasks:** can proceed independently — T4 only touches `src/app/main.ts` in two surgical regions (lines 122 area and the log line below dashboard URL). No other file modified, no API surface changed.
- **Phase 4 DASH note:** when DASH read models query `connection_events` for `eventType = 'startup_repair_failed'`, those rows now exist with `level = 'error'` and `details = { error: <message> }`. No further wiring needed on the producer side.

---
*Phase: 02-reliability*
*Plan: 01 / Wave 2 / T4*
*Completed: 2026-05-16*
*Commit: `1496663` on branch `worktree-agent-a4d9d3d3b23055f27`*
