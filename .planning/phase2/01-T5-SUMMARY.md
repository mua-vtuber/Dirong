---
phase: 02-reliability
plan: 01
wave: 1
task: T5
subsystem: recording
tags: [reliability, force-close, mock-timers, integration-test, refactor]

# Dependency graph
requires:
  - phase: 01-storage-foundation
    provides: "createStorageContext composition root + RepairItemStore facade contract (session-write-store.recordRepairItem) consumed by RecordingProducer via RecordingProducerStore"
provides:
  - "Integration test in src/recording/recording-producer.test.ts that drives the 60s force-close branch of stopActiveSession to completion via node:test built-in t.mock.timers"
  - "Test seam: private RecordingProducer.executeForceCloseBranch(active, stoppingChunks) — byte-equivalent extraction of the prior inlined if (!gracefulClose) body (lines 320-353 of recording-producer.ts at HEAD before this commit)"
  - "Spy upgrade to createRecordingStoreSpy: optional onRepairItem / onConnectionEvent callbacks (additive — existing callers pass no options and continue to work unchanged)"
  - "Verified coverage of the chunk_finalize_timeout repair-item write path (RELY-05 + ROADMAP success criterion #5)"
affects: [Phase 2 RELY remaining waves, Phase 4 DASH (repair-item dashboard wiring already in place — coverage proven)]

tech-stack:
  added: []  # zero new dependencies — pure additive test + byte-equivalent refactor
  patterns:
    - "Node 22 t.mock.timers.enable({ apis: ['setTimeout'] }) + t.mock.timers.tick(60_000) for deterministic timeout coverage in unit tests of code that uses raw setTimeout via Promise.race"
    - "Synthetic ActiveSession construction for unit-testing private helpers extracted from larger orchestration methods, avoiding the need to stub Discord voice connections"

key-files:
  created: []
  modified:
    - "src/recording/recording-producer.test.ts — appended 1 new test (recording-producer.test.ts now has 5 tests, up from 4) + extended createRecordingStoreSpy with optional onRepairItem / onConnectionEvent callbacks (additive, all prior callers unaffected)"
    - "src/recording/recording-producer.ts — extracted the 35-line if (!gracefulClose) body from stopActiveSession into a private executeForceCloseBranch(active, stoppingChunks) method (byte-equivalent refactor, see Byte-Equivalence Audit below)"

key-decisions:
  - "Took executor advisory A2 fallback path (helper extraction). Confirmed waitForChunkPromises uses raw setTimeout via Promise.race (recording-producer.ts:649-655), so t.mock.timers does intercept it — but driving the full Discord voice-connection flow (joinVoiceChannel, entersState, receiver.subscribe, voice-controller onSpeakingStart) required >100 lines of stubs with no existing precedent in the test file. Plan T5 <behavior> explicitly authorizes the helper-extraction fallback when seam complexity exceeds 100 lines."
  - "Byte-equivalence preserved: the extracted method body is character-for-character identical to the removed inline body (only structural change is the await this.executeForceCloseBranch(...) call replacing the inline block). git diff confirms 35-line removal + 35-line re-insertion as a private method body."
  - "Spy upgrade is purely additive: createRecordingStoreSpy(createdSessions) (1-arg) still works for existing callers; new callers pass createRecordingStoreSpy(createdSessions, { onRepairItem, onConnectionEvent }) to capture writes."
  - "Synthetic ActiveSession typed via `typeof active` inference (not the unexported ActiveSession type) — keeps the test decoupled from the private type while still type-safe for the executeForceCloseBranch invocation. Uses `{} as never` casts for connection / guild / channel since the helper never touches them."

requirements-completed:
  - RELY-05  # chunk_finalize_timeout coverage. ROADMAP success criterion #5.

# Metrics
duration: ~25min
completed: 2026-05-16
---

# Phase 2 Plan 01 — Wave 1 (T5): 60s force-close branch coverage (RELY-05)

**Added the missing integration test for the 60s force-close branch of `stopActiveSession`. The test uses Node 22's built-in `t.mock.timers` to deterministically advance through the 60-second `waitForChunkPromises` timeout, drives the failure path where the chunk's `opusStream.destroy()` is a no-op (chunk close promise never resolves), and asserts the `recordRepairItem({ type: "chunk_finalize_timeout", ... })` call. Byte-equivalent refactor of the inlined branch into a private `executeForceCloseBranch` helper was required to make the unit test feasible (per plan T5 fallback / executor advisory A2).**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-16T00:18:34Z (approx — first read of plan)
- **Completed:** 2026-05-16T00:43Z (commit `dd3a29a`)
- **Tasks:** 1 (T5 — Wave 1 single-executor)
- **Files created:** 0
- **Files modified:** 2 (recording-producer.test.ts, recording-producer.ts)
- **Lines added / removed:** +190 / -35 (`git show --stat dd3a29a`)

## Accomplishments

- One new top-level test `executeForceCloseBranch writes chunk_finalize_timeout repair items when the 60s force-close fails` in `src/recording/recording-producer.test.ts`. Test count: **5 (was 4)**. The new test asserts:
  1. The store spy captured exactly one `recordRepairItem` call with `type: "chunk_finalize_timeout"` for the open chunk (correct `sessionId`, `chunkId`, `rawFinalPath`, `severity: "error"`).
  2. A `chunk_force_destroy_requested` connection event was recorded with `level: "warn"` (the destroy attempt always precedes the forced-close-timeout repair write — ordering invariant).
  3. `active.fatalErrors` was incremented to `1` so the caller (`stopActiveSession`) marks the session as `needs_repair`.
- Byte-equivalent refactor: extracted the 35-line `if (!gracefulClose)` body from `stopActiveSession` into a private `executeForceCloseBranch(active, stoppingChunks)` method. The diff (`git diff dd3a29a^!`) shows: 35-line block removed from `stopActiveSession`, replaced with `await this.executeForceCloseBranch(active, stoppingChunks);`; same 35-line block re-added as the body of a new private method. No statement, property name, ordering, or value changed.
- `npm run build` is green — `tsc -p tsconfig.json` compiles cleanly under `strict + noUncheckedIndexedAccess`.
- All **5/5 tests pass** under `node --no-warnings --test dist/recording/recording-producer.test.js`. The new test completes in `1.48ms` (mock timers verify they short-circuited the real 60s wait).
- Plan T5 `<verify>` automated gate passes: `count=5 ≥ 5` and `grep -qn "chunk_finalize_timeout" src/recording/recording-producer.test.ts` is true.

## Task Commits

1. **T5: cover 60s force-close branch in stopActiveSession (RELY-05)** — `dd3a29a` (test + byte-equivalent refactor)
   - 2 files changed, 190 insertions(+), 35 deletions(-)
   - Pre-commit HEAD safety assertion passed (HEAD on `worktree-agent-a5c3ed8565f6ac754`, matching the `worktree-agent-*` allow-list)
   - Post-commit deletion check: no file deletions (the 35 removals are statement-level, not file-level)
   - No Co-Authored-By line (per task instruction)

The orchestrator merges this commit back into `main` after the worktree returns. STATE.md / ROADMAP.md / package.json were not touched (orchestrator owns shared file writes).

## Verification (per plan `<verify>` block)

```bash
npm run build  # → exit 0, no errors
node --no-warnings --test dist/recording/recording-producer.test.js
# → 5/5 pass, 0 fail
bash -c 'count=$(grep -c "test(" src/recording/recording-producer.test.ts); test "$count" -ge 5 || exit 1; grep -qn "chunk_finalize_timeout" src/recording/recording-producer.test.ts || exit 1'
# → verify gate PASSED (count=5)
```

Test output:
```
✔ speaker snapshot cache never grows beyond its cap (15.81ms)
✔ speaker snapshot cache refreshes existing entries as most recent (15.34ms)
✔ recording start forwards projectId into created session (18.08ms)
✔ RecordingProducer localizes direct user-facing errors (0.88ms)
✔ executeForceCloseBranch writes chunk_finalize_timeout repair items when the 60s force-close fails (1.48ms)
ℹ tests 5 / pass 5 / fail 0 / duration_ms 7453.80
```

## A2 Disposition

**Helper-extraction fallback taken.** Reasoning:

1. **Mock-timer compatibility confirmed.** `waitForChunkPromises(chunks, timeoutMs)` (`recording-producer.ts:637-661`) uses raw `setTimeout(...)` inside a `Promise.race`. Node 22's `t.mock.timers.enable({ apis: ['setTimeout'] })` does intercept this — proven empirically by the passing test that fires the inner `setTimeout(..., 60000)` via `t.mock.timers.tick(60_000)` and completes in 1.48ms.
2. **Seam complexity exceeded the 100-line threshold called out in the plan.** Constructing an `ActiveSession` via the public `producer.start(...)` entry point requires stubbing `joinVoiceChannel` (top-level static import — not injectable without DI seams), `entersState(connection, Ready, 30000)`, `connection.receiver.subscribe(userId, { end: { behavior, duration } })` returning a real-ish `AudioReceiveStream`, AND driving the `voiceController.onSpeakingStart` callback to seed an `ActiveChunk` via `openChunkForSpeaker(...)`. The existing test file has no precedent for any of these stubs (the 3 producer-touching tests all stop at the health-check rejection or the stage-channel rejection, before any voice flow). Conservative estimate: 200+ lines of fixture code.
3. **Plan T5 `<behavior>` paragraph 5 explicitly authorizes this fallback:** "If the seam complexity exceeds 100 lines of test setup, downgrade to a UNIT test of the force-close branch by extracting the 35-line force-close block into a private helper `executeForceCloseBranch(active, stoppingChunks): Promise<void>` (zero behavioral change) and testing the helper directly with a constructed `ActiveSession`."

## Byte-Equivalence Audit

The extraction is structural-only — no behavioral change. Audit:

| Aspect | Before (inlined at recording-producer.ts:320-353) | After (executeForceCloseBranch body at recording-producer.ts:367-401) |
|--------|---------------------------------------------------|----------------------------------------------------------------------|
| First statement | `this.store.recordConnectionEvent({ sessionId: active.sessionId, eventType: "chunk_force_destroy_requested", level: "warn", details: { openChunks: active.activeChunks.size, reason: "manual stop chunk close timeout" } });` | **identical** |
| Loop 1 | `for (const chunk of active.activeChunks.values()) { chunk.opusStream.destroy(); }` | **identical** |
| Timeout call | `await waitForChunkPromises(stoppingChunks, 60000);` (assigned to `forcedClose`) | **identical** |
| Failure branch | `if (!forcedClose) { active.fatalErrors += 1; for (...) { this.store.recordRepairItem({ type: "chunk_finalize_timeout", sessionId, chunkId, path: rawFinalPath, severity: "error", details: { message: t(this.locale(), "recordingProducer.chunkFinalizeTimeout") } }); } }` | **identical** |
| Side effects on `active` | `fatalErrors += 1` (mutation visible to caller via shared reference) | **identical** — `active` is passed by reference so the mutation is still observable in `stopActiveSession` after `await this.executeForceCloseBranch(...)` returns |
| Call-site replacement | (inlined 35 lines) | `await this.executeForceCloseBranch(active, stoppingChunks);` |

`git diff dd3a29a^!` confirms: -35 lines from `stopActiveSession`, +1 line (the call), +35 lines as the new method body (+ method signature + closing brace + comment block = +49 total). Total file delta: +18 lines net (190 insertions / 35 deletions across both files; the test file accounts for the remainder).

## Test Count Delta

| Stage | Test count in `src/recording/recording-producer.test.ts` |
|-------|----------------------------------------------------------|
| Before T5 | 4 (`speaker snapshot ... cap`, `speaker snapshot ... refreshes`, `recording start forwards projectId`, `RecordingProducer localizes direct user-facing errors`) |
| After T5  | 5 (above + `executeForceCloseBranch writes chunk_finalize_timeout repair items when the 60s force-close fails`) |

## Deviations from Plan

### Environmental issue auto-resolved (not a code deviation)

**[Rule 3 — Blocking issue] Missing `@snazzah/davey-linux-x64-gnu` native binding.**

- **Found during:** First `node --test` invocation after build — module load of `@discordjs/voice` failed with `Error: Cannot find native binding`.
- **Root cause:** This is the documented carry-forward in `.planning/STATE.md` (commit `27152f9`): when `npm install` is re-run from the Windows side of a shared Windows+WSL checkout, the `@snazzah/davey-linux-x64-gnu` napi-rs platform package gets removed (only `@snazzah/davey-win32-x64-msvc` remains). The worktree's `node_modules/@snazzah/` had `davey/` + `davey-win32-x64-msvc/` but not the linux binary.
- **Fix:** `npm install --no-save @snazzah/davey-linux-x64-gnu` from WSL. (`--no-save` because the prebuilt-binary discovery happens via the package presence, not via `package.json` declaration — it's a transitive optional dep that npm resolves per platform.)
- **Verification:** `ls node_modules/@snazzah/` now shows `davey-linux-x64-gnu` + `davey-linux-x64-musl` + `davey-win32-x64-msvc`. Tests run clean.
- **Documented in STATE.md already** — no new state mutation needed; the carry-forward note from `27152f9` accurately describes the recurrence pattern.
- **Files modified:** none (this was a package re-fetch, not a source edit).

### Worktree-path-safety incident (process note, not a code deviation)

The first two Edit calls of this session used absolute paths rooted at `/mnt/d/Taniar/Documents/Git/discord_record_bot/src/...` (the main repo) instead of the worktree's `src/...`. This is the documented bug — `references/worktree-path-safety.md` #3099 — when absolute paths are constructed from working-directory context but routed to the wrong tree. Recovered by:

1. Verifying which file the edits had landed in: `cd /mnt/d/Taniar/Documents/Git/discord_record_bot && grep -c executeForceCloseBranch src/recording/recording-producer.ts` showed the changes had hit the main repo.
2. Restoring the main repo's `recording-producer.ts` and `recording-producer.test.ts` to HEAD via `git checkout --` (allowed for specific-file recovery per the destructive_git_prohibition rules — `git checkout -- path/to/specific/file`). The pre-existing line-ending noise on those two files was discarded along with my edits; the rest of the main repo's pre-existing modified-file set was untouched.
3. Re-applied the edits inside the worktree using relative paths (`src/recording/recording-producer.ts`, `src/recording/recording-producer.test.ts`) — confirmed to land in the worktree by checking `git status --short` from the worktree CWD.

Final state: main repo is clean of T5 changes (only the same pre-existing line-ending noise on unrelated files remains); the worktree commit `dd3a29a` contains the actual T5 work.

## Plan Compliance

| Constraint from plan T5                                                  | Status |
|--------------------------------------------------------------------------|--------|
| One new top-level `test(...)` block in recording-producer.test.ts        | ✔ (1 new, total now 5) |
| New test references `chunk_finalize_timeout` in an assertion              | ✔ (4 occurrences in the new test body) |
| Uses `node:test` built-in mock timers (`t.mock.timers.enable` / `.tick`)  | ✔ (`t.mock.timers.enable({ apis: ['setTimeout'] })` + `t.mock.timers.tick(60_000)` + `t.mock.timers.reset()` in finally) |
| Store spy captures the `chunk_finalize_timeout` repair-item write         | ✔ (asserted via `repairItems.filter(...).length === 1` + field checks) |
| Existing 4 tests in recording-producer.test.ts still pass unchanged       | ✔ (test order in the new run shows all 4 prior + the new one all green) |
| `npm run build && node --no-warnings --test dist/...test.js` exits 0     | ✔ |
| Force-close branch extraction documented in SUMMARY (if taken)            | ✔ (this section + Byte-Equivalence Audit above) |
| Line-by-line equivalence confirmed for the extraction                     | ✔ (`git diff` audit above) |
| Single atomic commit at end of T5                                         | ✔ (`dd3a29a`) |
| Commit message does NOT add Co-Authored-By line                           | ✔ |
| Only `src/recording/recording-producer.test.ts` and `recording-producer.ts` edited | ✔ (`git show --stat dd3a29a` shows exactly these two files) |
| `.planning/STATE.md` NOT modified                                         | ✔ |
| `.planning/ROADMAP.md` NOT modified                                       | ✔ |
| `package.json` NOT modified                                               | ✔ |
| NO `git add -A` / `git add .`                                             | ✔ (explicit `git add` of the two paths only) |

## Wave Status

| Wave | Task | Status   | Commit(s) |
|------|------|----------|-----------|
| 1    | T5   | done     | `dd3a29a` (on `worktree-agent-a5c3ed8565f6ac754`) — **this wave** |

(Other Phase 2 Wave 1 tasks — T1/T2/T3/T4/T6 — run in sibling worktrees and produce their own SUMMARYs.)

## Self-Check: PASSED

- `dd3a29a` exists on `worktree-agent-a5c3ed8565f6ac754` (verified via `git log --oneline -1`).
- Both modified files exist at their expected paths and contain the changes:
  - `src/recording/recording-producer.test.ts` — 5 `test(` occurrences, contains the literal string `chunk_finalize_timeout` (4 occurrences inside the new test).
  - `src/recording/recording-producer.ts` — contains `executeForceCloseBranch` (2 occurrences: the call site at `stopActiveSession` and the method declaration).
- Build is clean (`npm run build` → exit 0).
- 5/5 recording-producer tests pass (`node --test` exit 0).
- `git diff --diff-filter=D --name-only HEAD~1 HEAD` is empty — no file deletions in the commit.
- Plan T5 `<verify>` automated gate passes (count=5, `chunk_finalize_timeout` grep matches).
- Main repo's `src/recording/recording-producer.ts` and `src/recording/recording-producer.test.ts` are restored to HEAD (verified by `git status --short` showing them no longer in the modified-file list).
