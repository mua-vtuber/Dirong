---
phase: 2
plan: 01-persistent-cli-recording-reliability
wave: 1
tasks: [T1, T2, T3]
subsystem: ai-cleanup
tags: [RELY-01, RELY-02, RELY-03, TEST-01]
commits:
  - 3fc9b86 (T1 — RELY-02)
  - 4f6e8b2 (T2 — RELY-01 + TEST-01)
  - 2a53f23 (T3 — RELY-03 + TEST-01)
key-files:
  modified:
    - src/ai/cleanup/claude-persistent-cli-provider.ts
    - src/ai/cleanup/claude-persistent-cli-provider.test.ts
    - src/ai/cleanup/provider-lifecycle.ts
    - src/ai/cleanup/provider-lifecycle-service.ts
    - src/app/main.ts
metrics:
  tests_before: 517
  tests_after: 527
  new_tests_in_target_file: 10 (4 → 14)
  npm_test_exit_code: 0
---

# Phase 2 Wave 1 (T1 + T2 + T3): Persistent CLI Lifecycle Hardening Summary

Three atomic commits land RELY-01 (orphan-PID tracking), RELY-02 (abort-listener reorder), RELY-03 (safeguard interval), and TEST-01 (assertion coverage) on `ClaudeStreamJsonCliCleanupProvider` plus its service owner. All work confined to the provider file + its test file + `provider-lifecycle.ts` + `provider-lifecycle-service.ts` + `src/app/main.ts`.

## What was built

### T1 — RELY-02: abort-listener reorder (3fc9b86)
- In `generate()`, the `options.signal.addEventListener("abort", ...)` registration now runs BEFORE any `await this.killSession()` call.
- The listener body is `() => { this.session?.kill(); }` (optional chain) so it tolerates being fired when `this.session` is still `null` (pre-spawn window).
- A duplicate `signal.aborted` re-check + listener cleanup runs immediately after `addEventListener` to close the abort-during-addListener race.
- 3 new tests:
  1. Static-source assertion — `addEventListener("abort"` position-in-source < `await this.killSession()` position-in-source inside the `generate()` body.
  2. Synthetic `controller.abort()` before `generate()` — rejects with `/cancelled before it started/` and no unhandled rejection.
  3. Pre-construction abort listener body invoked against a `null` session — no throw.

### T2 — RELY-01 + TEST-01: trackedPids + reaper + main.ts wiring (4f6e8b2)
- New `private readonly trackedPids = new Set<number>()` field on `ClaudeStreamJsonCliCleanupProvider`.
- `generate()` now calls `session.start()` immediately after constructing the session (idempotent per `claude-persistent-smoke.ts:204-206`) so `session.pid` is non-null synchronously; the PID is then added to `trackedPids`.
- `killSession()` captures the PID before nulling `this.session` and removes it from `trackedPids` after `killAndWait` resolves.
- New public method `reapTrackedPids(): void` — synchronous, iterates `trackedPids`, calls `process.kill(pid, "SIGKILL")` inside `try { } catch { /* quiet */ }`, clears the set. This is the `process.on('exit')` handler per D-04.
- `stop()` augmented with a loud second-pass reaper: any PID still in `trackedPids` after `killSession()` is SIGKILLed and on failure the new `onOrphanKillFailed?({ pid, errno })` callback fires (so `main.ts` can route to `recordConnectionEvent`).
- `src/app/main.ts`:
  - `createAiCleanupProvider` return type narrowed from `AiCleanupProvider` to `ClaudeStreamJsonCliCleanupProvider` so `reapTrackedPids()` is reachable at the call site without runtime casts.
  - `onOrphanKillFailed` wired to `ctx.writes.recordConnectionEvent({ sessionId: null, eventType: "claude_orphan_kill_failed", level: "warn", details: { pid, errno } })`.
  - `process.on("exit", () => aiCleanupProvider.reapTrackedPids());` registered ONCE next to provider construction.
- 4 new tests: PID tracked-and-cleared on success, PID tracked-and-cleared on abort (TEST-01 primary assertion), `reapTrackedPids` SIGKILLs every tracked PID, `reapTrackedPids` swallows ESRCH without throwing.

### T3 — RELY-03 + TEST-01: safeguard interval (2a53f23)
- Added `private generateStartedAt: number | null` and `private currentTimeoutMs: number | null` to the provider. Assigned at the top of `generate()` (alongside the existing `const startedAt = Date.now();`) and cleared in `finally` after `killSession`.
- New public method `forceKillIfStale(now: number = Date.now()): boolean` — pure, idempotent. Returns `true` iff `generateStartedAt`, `currentTimeoutMs`, and `session` are all non-null AND `now - generateStartedAt > currentTimeoutMs * 2`. On true, calls `session.kill("SIGKILL")`.
- `AiProviderLifecycleService` now owns the `private safeguardInterval: NodeJS.Timeout | null` field. Started in `startPrepareInBackground()` when the wrapped provider exposes `forceKillIfStale` (runtime guard `hasForceKillIfStale(provider)`). Period = `Math.max(5_000, Math.floor(prepareTimeoutMs / 4))`. The interval is `.unref()`d so it never blocks process exit. Cleared in `stop()` BEFORE `await this.provider.stop(...)`.
- `wrapAiCleanupProviderWithLifecycle` was extended to forward `forceKillIfStale` from the underlying `AiCleanupProvider` onto the wrapper `AiMeetingNotesProvider` adapter, but only when the underlying actually has it. This keeps the runtime narrowing meaningful for non-CLI providers (e.g. future API providers without subprocess lifetimes).
- 3 new tests: stale → SIGKILL + return true, boundary (`now - startedAt === timeoutMs * 2`) → return false, null session → return false.

## Deviations from plan

1. **T3 touched `src/ai/cleanup/provider-lifecycle.ts`** (the adapter file), which was NOT in T3's declared `<files>` list. The plan's `<strategy>` callout (8) acknowledges this tradeoff and explicitly chose "runtime-check via `'forceKillIfStale' in this.provider`" — but the adapter wraps the concrete provider into the broader `AiMeetingNotesProvider` interface and strips the method. Forwarding `forceKillIfStale` on the adapter when the underlying provider has it preserves the runtime narrowing for non-CLI providers (where it stays absent) and is the smallest blast radius. Rule 3 (auto-fix blocking issue).
2. **T2 narrowed `createAiCleanupProvider` return type** from `AiCleanupProvider` to `ClaudeStreamJsonCliCleanupProvider` in `main.ts`. The plan's `<read_first>` told me to "locate and document the variable name" but did not flag the typing constraint. Narrowing the return type is the minimal change that gives `main.ts` access to `reapTrackedPids()` without an unsafe cast at the registration site. Rule 3.
3. **T1 reworded a comment inside `generate()`** that originally contained the literal phrase `await this.killSession()` because the static-source ordering test's `indexOf("await this.killSession()")` matched the comment instead of the actual call. Test stayed lighter than a full AST parse this way. Rule 1.

## Advisory dispositions

- **A5 (recordConnectionEvent sessionId nullability):** `sessionId: string | null` is already accepted on both `SessionWriteStore.recordConnectionEvent` (`src/storage/session-write-store.ts:177`) and `RepairRepository.recordConnectionEvent` (`src/storage/repair-repository.ts:16`). The structured-event path was used directly — NO `console.error` fallback was needed, NO Phase 3 POLY follow-up required.
- **A4 (deferred-promise harness for T1 abort-mid-generate):** The deferred-promise harness was NOT used. The static-source ordering assertion (test #5 in the file) is the canonical RELY-02 check; the supplementary "tolerates abort before generate() starts" + "listener body no-ops on null session" tests cover the behavioral contract without timing flake. Plan-checker A4 explicitly authorized this fallback ("if flaky, prefer the static check") — chosen up-front, not as recovery.

## Test count

| | Before | After | Delta |
|---|---|---|---|
| `claude-persistent-cli-provider.test.js` | 4 | 14 | +10 |
| Full `npm test` suite | 517 | 527 | +10 |

`npm test` exit code: **0** (all 527 tests pass).

## Acceptance criteria checklist

- T1: `addEventListener("abort"` precedes `await this.killSession()` in `generate()` source — verified by the static-source test.
- T1: listener body uses `this.session?.kill()` optional chain — verified by regex assertion in the same test.
- T2: `(provider as any).trackedPids.size === 0` after successful generate AND aborted generate — verified.
- T2: `reapTrackedPids` SIGKILLs every tracked PID AND swallows ESRCH — verified by `process.kill` monkey-patch tests.
- T2: `process.on("exit"` + `reapTrackedPids` present in `src/app/main.ts` — verified via grep.
- T3: `forceKillIfStale` returns `true` iff stale strictly past `timeoutMs * 2` — boundary test passes.
- T3: `AiProviderLifecycleService.stop()` calls `clearInterval` BEFORE `await this.provider.stop(...)` — verified by reading the source.
- T3: interval is `.unref()`d — verified via grep.

## Self-Check: PASSED

- All three commits exist in `git log`: 3fc9b86, 4f6e8b2, 2a53f23.
- All claimed files exist and were modified by the listed commits.
- `npm test` exits 0 with 527 passing tests.
