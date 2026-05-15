---
phase: 01-storage-foundation
plan: 01
wave: 3
task: T3.1
subsystem: storage
tags: [sqlite, facade, cutover, refactor]

# Dependency graph
requires:
  - phase: 01-storage-foundation (Wave 2)
    provides: "Role-scoped facades + createStorageContext composition root (T2.1, b099564)"
provides:
  - "Production callers cut over from SessionStore to createStorageContext + dispatch via ctx.writes / ctx.reads / ctx.jobs / ctx.runtime"
  - "flattenStorageContext helper that builds a flat adapter (FlatStorageStore) via .bind() so existing narrow port interfaces (RecordingProducerStore, DashboardStore, SttBatchStore, AiCleanupAutomationStore) keep working without service-side rework"
  - "repair-scan.ts retyped against full StorageContext (advisory A2 resolution; RepairScanStore composite type removed)"
  - "All 12 affected test files cut over; session-purge.test.ts filename preserved (package.json enumerates dist/storage/session-purge.test.js)"
  - "src/storage/session-store.ts deleted (879 lines removed)"
  - "ROADMAP success criterion #1 observably true: grep gate zero hits"
affects: [Phase 1 Wave 4 (T4.1 package.json gate), Phase 2 RELY, Phase 3 POLY, Phase 4 DASH]

tech-stack:
  added: []  # zero new dependencies — pure structural rename + adapter
  patterns:
    - "createStorageContext + flattenStorageContext at every production construction site"
    - "ctx.writes.X / ctx.reads.X / ctx.jobs.X / ctx.runtime.X dispatch in test fixtures that exercise the facade contract directly (storage-internal tests)"
    - "FlatStorageStore type defined via Pick<C, keyof C> per facade so the intersection lists only public members (raw class intersection collapses to never via duplicate private repository slots)"

key-files:
  created: []  # no new files — only modifications + one deletion
  modified:
    - "src/app/main.ts — createStorageContext + flattenStorageContext; pass ctx to runStartupRepair; store.X(...) keeps working via flat adapter"
    - "src/app/ai-cleanup.ts — createStorageContext + flattenStorageContext; let store: FlatStorageStore | null"
    - "src/app/fake-stt.ts — createStorageContext + flattenStorageContext"
    - "src/app/real-stt.ts — createStorageContext + flattenStorageContext"
    - "src/app/repair.ts — createStorageContext + pass ctx to runStartupRepair; ctx.close()"
    - "src/notion/draft-input.ts — type-only import redirect: session-store → storage-context"
    - "src/notion/draft-input-read-model.ts — type-only import redirect: session-store → storage-context"
    - "src/notion/test-fixtures.ts — type-only import redirect: session-store → storage-context"
    - "src/storage/repair-scan.ts — accept (ctx: StorageContext, config) instead of (store: SessionStore, config); dispatch via ctx.writes / ctx.reads / ctx.jobs / ctx.runtime"
    - "src/storage/storage-context.ts — added flattenStorageContext helper + FlatStorageStore type; removed RepairScanStore composite type (advisory A2); cleaned up internal grep-gate comments"
    - "src/storage/path-mapping.ts — comment cleanup (internal grep gate)"
    - "src/storage/runtime-state-store.ts — comment cleanup (internal grep gate)"
    - "src/storage/store-helpers.ts — comment cleanup (internal grep gate)"
    - "src/storage/session-purge.test.ts — switch to createStorageContext + ctx.writes dispatch; FILENAME PRESERVED (Blocker 3)"
    - "src/storage/session-store-paths.test.ts — switch to createStorageContext + ctx.{writes,reads}; FILENAME PRESERVED"
    - "src/storage/session-store-ai-cleanup.test.ts — switch to createStorageContext + ctx.{writes,reads,jobs,runtime}; FILENAME PRESERVED"
    - "src/storage/dashboard-read-model.test.ts — switch to createStorageContext + ctx.{writes,reads}"
    - "src/app/sqlite-backup.test.ts — createStorageContext + flattenStorageContext"
    - "src/dashboard/server.test.ts — SessionStore type-only import → FlatStorageStore"
    - "src/recording/alone-finalize-service.test.ts — createStorageContext + flattenStorageContext; FlatStorageStore type"
    - "src/recording/voice-connection-controller.test.ts — SessionStore type-only import → FlatStorageStore"
    - "src/ai/cleanup/runner.test.ts — createStorageContext + flattenStorageContext; FlatStorageStore type"
    - "src/ai/cleanup/automation-service.test.ts — createStorageContext + flattenStorageContext; FlatStorageStore type"
    - "src/stt/automation-service.test.ts — createStorageContext + flattenStorageContext; FlatStorageStore type"
    - "src/transcript/timeline.test.ts — createStorageContext + flattenStorageContext; FlatStorageStore type"
  deleted:
    - "src/storage/session-store.ts (879 lines)"

key-decisions:
  - "Added flattenStorageContext helper to storage-context.ts. Rationale: existing narrow port interfaces (RecordingProducerStore, DashboardStore, SttBatchStore, AiCleanupAutomationStore, AloneFinalizeStore, ChunkFinalizerStore, etc.) were authored against the legacy SessionStore flat surface — they require flat methods like getSession / createSession / claimNextSttJob rather than the nested ctx.reads.getSession(...) shape. Passing the raw ctx to a service constructor would not type-check. The flat adapter is structural-only (.bind() preserves this; no behavior change). Documented in storage-context.ts as a transitional helper to be removed when narrow ports are updated (a future plan — POLY)."
  - "Defined FlatStorageStore via Pick<SessionWriteStore, keyof SessionWriteStore> & Pick<SessionReadStore, keyof SessionReadStore> & ... — NOT raw class intersection. The raw intersection collapses to never because each facade has its own private readonly aiCleanupJobs / chunks / etc. repository slots, and TypeScript treats those as incompatible private members across the intersection. Pick<C, keyof C> strips private/protected members because keyof only enumerates public properties."
  - "Honored executor advisory A2: removed the RepairScanStore composite type from storage-context.ts. The original Wave 2 definition (SessionWriteStore & SessionReadStore & RuntimeStateStore) would not have compiled in repair-scan.ts because repair-scan.ts also consumes JobQueueStore methods (failJobsWithMissingAudio at the now-line ctx.jobs.failJobsWithMissingAudio() and queueExistingSttJobForChunk at the queueExisting line). repair-scan.ts now accepts the full StorageContext and dispatches via ctx.writes / ctx.reads / ctx.jobs / ctx.runtime as appropriate."
  - "Preserved session-purge.test.ts FILENAME (Blocker 3). package.json#scripts.test enumerates dist/storage/session-purge.test.js — renaming would silently break CI. Updated import + fixture field type + dispatch internally only."
  - "Kept storage-internal test filenames (session-store-paths.test.ts, session-store-ai-cleanup.test.ts) — the plan explicitly excludes them from the internal grep gate ('| grep -v session-store-paths\\|session-store-ai-cleanup')."
  - "Comment-only edits in path-mapping.ts / runtime-state-store.ts / store-helpers.ts / storage-context.ts to satisfy the internal grep gate's strict reading ('zero hits' even in comments). The originals named 'session-store.ts lines N-M' as references; replaced with 'the legacy SessionStore (pre-Wave-2 source, now deleted)' phrasing."

requirements-completed:
  - STORE-01  # CUTOVER step now complete. Wave 4 (T4.1) enumerates the 5 new facade test files in package.json and runs the final phase-wide npm test gate.

# Metrics
duration: 64min
completed: 2026-05-15
---

# Phase 1 Plan 01 — Wave 3 (T3.1): Atomic cutover from SessionStore → StorageContext

**Cut every production and test caller from the legacy 879-line SessionStore to the role-scoped facades behind createStorageContext, retyped repair-scan.ts against StorageContext per advisory A2, removed the misleading RepairScanStore composite, and deleted session-store.ts — one atomic commit, BYTE-IDENTICAL behavior, ROADMAP grep gate green, 495/495 tests pass.**

## Performance

- **Duration:** 64 min (includes rebase onto main to pull Wave 1/2 work, plus iterative type-check loops to nail the FlatStorageStore intersection design)
- **Started:** 2026-05-15
- **Completed:** 2026-05-15
- **Tasks:** 1 (T3.1 only — Wave 1/2 already on main; Wave 4 is the next run)
- **Files modified:** 25 (5 production + 3 Notion type-imports + 1 storage-internal (repair-scan) + 4 storage comment cleanups + 12 tests)
- **Files deleted:** 1 (session-store.ts, 879 lines)
- **Lines added:** 362
- **Lines removed:** 1080 (commit `6997ccd`)

## Accomplishments

### (1) Production callers (8 files) — done

| File                       | Change                                                                                                                                             |
|----------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|
| `src/app/main.ts`          | `new SessionStore(...)` → `createStorageContext(...)` + `flattenStorageContext(ctx)`; `runStartupRepair(ctx, config)`; `store.statusText / store.close` keep working via flat adapter |
| `src/app/ai-cleanup.ts`    | `let store: SessionStore \| null` → `let store: FlatStorageStore \| null`; constructs both `ctx` and `store`                                       |
| `src/app/fake-stt.ts`      | Same construction pattern                                                                                                                          |
| `src/app/real-stt.ts`      | Same construction pattern                                                                                                                          |
| `src/app/repair.ts`        | `createStorageContext(...)`; `runStartupRepair(ctx, config)`; `ctx.close()`                                                                        |
| `src/notion/draft-input.ts`            | Type-only import redirect                                                                                                              |
| `src/notion/draft-input-read-model.ts` | Type-only import redirect                                                                                                              |
| `src/notion/test-fixtures.ts`          | Type-only import redirect                                                                                                              |

### (2) `src/storage/repair-scan.ts` — Advisory A2 applied

- All function signatures changed from `(store: SessionStore, ...)` to `(ctx: StorageContext, ...)`.
- Internal dispatch: `store.recordRepairItem(...)` → `ctx.writes.recordRepairItem(...)`; `store.listWritingChunks()` → `ctx.reads.listWritingChunks()`; `store.failJobsWithMissingAudio()` → `ctx.jobs.failJobsWithMissingAudio()`; `store.releaseExpiredProcessingLeases()` → `ctx.runtime.releaseExpiredProcessingLeases()`; etc.
- `RepairScanStore` composite type **dropped** from `storage-context.ts` (advisory A2 resolution: "in T2.1, drop the RepairScanStore export… Don't ship a misleading dead type").

### (3) Test callers (12 files) — done

Three storage-internal "session-store-*" test files **kept their filenames** per plan instruction:
- `session-purge.test.ts` (Blocker 3 — enumerated in `package.json#scripts.test`)
- `session-store-paths.test.ts`
- `session-store-ai-cleanup.test.ts`

Two patterns used in test rewrites:

**Pattern A (facade-direct dispatch)** — storage-internal tests that exercise the facade contract directly:
- `session-purge.test.ts`, `session-store-paths.test.ts`, `session-store-ai-cleanup.test.ts`, `dashboard-read-model.test.ts`
- Fixture field renamed `store: SessionStore` → `ctx: StorageContext`; call sites switched to `ctx.writes.X(...)` / `ctx.reads.X(...)` / `ctx.jobs.X(...)` / `ctx.runtime.X(...)` per the plan's dispatch table.

**Pattern B (flat adapter)** — tests that pass `store` to a service constructor or to a runner that accepts a narrow port:
- `sqlite-backup.test.ts`, `transcript/timeline.test.ts`, `alone-finalize-service.test.ts`, `stt/automation-service.test.ts`, `ai/cleanup/runner.test.ts`, `ai/cleanup/automation-service.test.ts`, `dashboard/server.test.ts`, `voice-connection-controller.test.ts`
- Fixture constructs `ctx = createStorageContext(...)` plus `store = flattenStorageContext(ctx)`; the service/runner receives `store` (now typed `FlatStorageStore`) unchanged.

### (4) `src/storage/session-store.ts` — deleted

Verified via `git rm`. Deletion staged in the same atomic commit.

### (5) Grep gates — both GREEN

```
production grep gate: 0 hits
internal grep gate:   0 hits
```

### (6) Silent-fallback rule — no violations

`git diff | grep -E "^\+.*\?\? (null|\[\]|\{\})"` returned ZERO matches. Every `if (!row) throw …` pattern was already preserved verbatim by Wave 2; Wave 3 did not introduce any new `??` defaults.

## Verification (per plan `<verify>` block)

```bash
npm run build  # → exit 0
npm test       # → 495 pass, 0 fail
bash -c 'count=$(grep -r "from .*session-store" src/ --include="*.ts" | grep -v "^src/storage/" | grep -v test | wc -l); test "$count" -eq 0 && echo PASS'   # → PASS
bash -c 'internal=$(grep -rn "session-store" src/storage/ --include="*.ts" | grep -v "session-store-paths\|session-store-ai-cleanup" | wc -l); test "$internal" -eq 0 && echo PASS'   # → PASS
```

Full test summary:
```
ℹ tests 495
ℹ suites 0
ℹ pass 495
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 9682.031847
```

Notable test groups that all passed:
- 22/22 facade unit tests (Wave 2 — confirmed still green after dispatch rewrite of co-located fixture)
- 4/4 `StorageContext stores/normalizes/statusText` tests (`session-store-paths.test.ts` after rewrite)
- 5/5 `getAiCleanupSttTerminalSnapshot / repairExpiredAiCleanupProcessingJobs / listFinalizedSessionsForAiCleanupAutomation` tests (`session-store-ai-cleanup.test.ts`)
- 3/3 `purgeSessions / previewSessionPurge` tests (`session-purge.test.ts`, Blocker 3)
- 12/12 migration idempotency tests (Wave 1's STORE-03/TEST-02 — unchanged)
- All STT / AI cleanup / Notion / dashboard / recording test groups (flat adapter pattern works for narrow ports)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Added `flattenStorageContext` helper to bridge facade-shaped `StorageContext` and the existing narrow port interfaces.**

- **Found during:** First post-cutover `tsc` run on `src/app/main.ts`.
- **Issue:** Production caller construction sites like `new DashboardServer(config, store, producer, ...)`, `new SttAutomationService(store, {...})`, `new AiCleanupAutomationService(store, {...})`, `new AloneFinalizeService({store, ...})`, etc. pass `store` to service constructors. The receiving services are typed against narrow port interfaces (`DashboardStore`, `SttBatchStore`, `AiCleanupAutomationStore`, `AloneFinalizeStore`, etc.) defined in their respective `storage-port.ts` files. Those narrow ports were authored against the legacy `SessionStore` flat surface — they require flat methods like `getSession` / `createSession` / `claimNextSttJob` rather than the nested `ctx.reads.getSession(...)` shape produced by `createStorageContext`. Passing the raw `ctx` value (whose useful methods live under `ctx.writes` / `ctx.reads` / `ctx.jobs` / `ctx.runtime`) would not type-check.
- **Fix:** Added `flattenStorageContext(ctx)` to `src/storage/storage-context.ts`. Returns a `FlatStorageStore` object whose 47 methods are `.bind(facade)` references to the corresponding facade methods, plus `close` and `database`. `.bind()` preserves `this` and the full original signature (including the `nowIso = isoNow()` defaults on the lease-repair methods). Each production caller now constructs `const ctx = createStorageContext(...)` AND `const store = flattenStorageContext(ctx)`; `ctx` flows into `runStartupRepair(ctx, config)` (which dispatches via facades per advisory A2), and `store` flows into every narrow-port-typed service constructor. No behavior change — `.bind()` is a pure delegation.
- **Files modified:** `src/storage/storage-context.ts` (added `FlatStorageStore` type + `flattenStorageContext` function, ~95 lines).
- **Type-design note:** First attempt typed `FlatStorageStore` as `SessionWriteStore & SessionReadStore & JobQueueStore & RuntimeStateStore & { close, database }`. `tsc` rejected with "The intersection 'FlatStorageStore' was reduced to 'never' because property 'aiCleanupJobs' exists in multiple constituents and is private in some" — each facade has its own `private readonly aiCleanupJobs` repository slot, and TypeScript treats those private members as incompatible across the intersection. Solved by defining `FlatStorageStore` via `Pick<SessionWriteStore, keyof SessionWriteStore> & Pick<SessionReadStore, keyof SessionReadStore> & ...` — `keyof C` only enumerates **public** properties on a class, so the Pick strips private/protected members and the intersection survives.
- **Why this is Rule 3 not a plan-scope expansion:** The plan's `<action>` block step (1) instructs "Replace each method call: Write methods → `ctx.writes.<method>(...)`, …". That guidance fits direct method calls. It does NOT address the case of a value being **passed** to a service whose narrow port signature predates the facade split. Without the flat adapter, the cutover cannot compile, blocking task completion. Rule 3 ("auto-fix blocking issues") applies. The helper is documented as transitional ("until narrow ports are updated — POLY") and adds zero behavior.
- **Future cleanup signal:** A POLY-* task should update each `storage-port.ts` narrow port to accept facade-typed inputs (e.g. `RecordingProducerStore` becomes a union of facade-slice types, or accepts `StorageContext` directly), at which point `flattenStorageContext` can be deleted. This is out of Phase 1 scope.

**2. [Rule 3 — Blocking issue] Comment-only edits to satisfy the internal grep gate's strict "zero hits" reading.**

- **Found during:** Running the verify block's internal gate (`grep -rn "session-store" src/storage/ --include="*.ts" | grep -v "session-store-paths\|session-store-ai-cleanup"`).
- **Issue:** Four files (`storage-context.ts`, `path-mapping.ts`, `runtime-state-store.ts`, `store-helpers.ts`) contained doc comments that named `session-store.ts` as a historical-source reference ("byte-identical to session-store.ts lines 712-761", "extracted from session-store.ts (lines 866-872)", etc.). Strict reading of the gate counts these as hits.
- **Fix:** Replaced the line-number references with prose ("the legacy SessionStore (pre-Wave-2 source, now deleted)" / "from the legacy SessionStore lines 712-761"-style → "BYTE-IDENTICAL from the legacy SessionStore"). No behavior change; no API change; comments preserve their documentation value.
- **Files modified:** Four files listed above.

### Worktree process notes (not code deviations)

- The worktree spawned at an old HEAD (`f8623a4`) that predated Waves 1 and 2. Recovered with `git rebase main` (fast-forward + cherry-pick) before starting any T3.1 work. After rebase the worktree HEAD was at `27152f9` with all Wave 1/2 facades and `storage-context.ts` already present.
- All Edit/Write/Bash calls used the worktree's absolute path (`/mnt/d/Taniar/Documents/Git/discord_record_bot/.claude/worktrees/agent-a9e5b6fd2d3467764/...`). No worktree-path-safety incidents (the Wave-2 process note about the bug informed my discipline).
- Pre-commit HEAD safety assertion ran clean: HEAD on `worktree-agent-a9e5b6fd2d3467764`, no protected-branch drift.
- Post-commit deletion check confirmed only one deletion (`src/storage/session-store.ts`) — intentional, documented.

## Plan Compliance

| Constraint from objective                                                       | Status |
|---------------------------------------------------------------------------------|--------|
| 8 production callers updated (5 app/* + 3 notion/*)                             | ✔ |
| `repair-scan.ts` retyped against `StorageContext` (advisory A2)                 | ✔ |
| `RepairScanStore` composite dropped from `storage-context.ts`                   | ✔ |
| 12 test callers cut over                                                        | ✔ (4 facade-direct + 8 flat-adapter) |
| `session-purge.test.ts` filename preserved                                      | ✔ (Blocker 3) |
| `session-store.ts` deleted                                                      | ✔ (879 lines, staged via `git rm`) |
| ROADMAP grep gate (production scope) returns zero hits                          | ✔ |
| Internal grep gate (`src/storage/` minus path/ai-cleanup test names) zero hits  | ✔ (after comment cleanup) |
| `npm run build && npm test` exits 0 with no skipped tests                       | ✔ (495/495 pass) |
| No silent fallbacks (`?? null`, `?? []`, `?? {}`) introduced                    | ✔ (grep on diff returned zero matches) |
| Single atomic commit                                                            | ✔ (`6997ccd`) |
| `.planning/STATE.md` NOT modified                                               | ✔ (orchestrator owns shared file writes) |
| `.planning/ROADMAP.md` NOT modified                                             | ✔ |
| No `Co-Authored-By: Claude` line in commit message                              | ✔ (verified `git log --pretty=full -1`) |

## Wave Status

| Wave | Task | Status   | Commit(s) |
|------|------|----------|-----------|
| 1    | T1.1 | done     | `119cb29` (on `main`) |
| 1    | T1.2 | done     | `473dbcd` (on `main`) |
| 1    | (state mark) | done | `eeb2715` (on `main`) |
| 2    | T2.1 | done     | `b099564` + `838381d` + `c408032` + `a6802bd` + `f3a92b9` + `27152f9` (on `main`) |
| 3    | T3.1 | done     | `6997ccd` (on `worktree-agent-a9e5b6fd2d3467764`) — **this wave** |
| 4    | T4.1 | pending  | (next run, package.json + final npm test gate) |

## Self-Check: PASSED

- `src/storage/session-store.ts` MISSING (verified `[ ! -f ... ] && echo MISSING`) — expected deletion.
- `src/storage/storage-context.ts` FOUND — flattenStorageContext + FlatStorageStore present.
- `src/storage/repair-scan.ts` FOUND — accepts `(ctx: StorageContext, ...)`.
- `src/storage/session-purge.test.ts` FOUND — filename preserved.
- Commit `6997ccd` FOUND on `worktree-agent-a9e5b6fd2d3467764` (verified `git log --oneline -1`).
- `npm run build` exit code: 0.
- `npm test` summary: 495 pass / 0 fail / 0 cancelled / 0 skipped.
- ROADMAP grep gate (production): 0 hits.
- Internal grep gate: 0 hits.
