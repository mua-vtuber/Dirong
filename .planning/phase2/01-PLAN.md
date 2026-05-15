---
phase: 02-persistent-cli-recording-reliability
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ai/cleanup/claude-persistent-cli-provider.ts
  - src/ai/cleanup/claude-persistent-cli-provider.test.ts
  - src/ai/cleanup/provider-lifecycle-service.ts
  - src/app/main.ts
  - src/recording/recording-producer.test.ts
  - package.json
autonomous: true
requirements:
  - RELY-01
  - RELY-02
  - RELY-03
  - RELY-04
  - RELY-05
  - TEST-01

must_haves:
  truths:
    - "Aborting `claude` mid-`generate()` (synthetic `AbortController.abort()`) leaves zero entries in `provider.trackedPids` and the fake spawn's `.killCalls` array includes a SIGKILL after the abort."
    - "The abort listener in `ClaudeStreamJsonCliCleanupProvider.generate()` is registered BEFORE any `await this.killSession()`. A test that aborts the signal between `addListener` and the first internal `await` observes the listener firing — proving listener registration precedes `killSession`."
    - "A persistent-CLI session whose synthetic clock satisfies `now - startedAt > timeoutMs * 2` is force-killed by the safeguard interval without operator intervention; the fake spawn's `.killCalls` array contains SIGKILL within one interval tick."
    - "On boot with `repair_items` containing `kind = 'chunk_finalize_timeout'`, `src/app/main.ts` emits the single line `\"startup repair: N items reconciled\"` to stdout (replacing the current `JSON.stringify(..., null, 2)` blob) AND `runStartupRepair` has been invoked unconditionally before the dashboard accepts connections."
    - "An integration test in `src/recording/recording-producer.test.ts` drives `stopActiveSession` past the 20s graceful close and through the 60s force-close branch by injecting a fake `AudioReceiveStream` whose `destroy()` is a no-op; the test asserts that `chunk_finalize_timeout` repair items are written via the store spy."
    - "On a `runStartupRepair` throw, boot continues (no `process.exit(1)`); the failure is surfaced as `recordConnectionEvent({ kind: 'startup_repair_failed', error })` plus a plain `console.error` line."
  artifacts:
    - path: "src/ai/cleanup/claude-persistent-cli-provider.ts"
      provides: "ClaudeStreamJsonCliCleanupProvider with `private readonly trackedPids = new Set<number>()`, abort-listener-first ordering in generate(), reorderable safeguard interval owned by AiProviderLifecycleService via a new public hook (`registerLifecycleSafeguard` / `unregisterLifecycleSafeguard`) OR a provider-local `startSafeguard(timeoutMs)` / `stopSafeguard()` pair; SIGKILL via `process.kill(pid, 'SIGKILL')` on `stop()` + `process.on('exit')`."
      contains: "trackedPids"
    - path: "src/ai/cleanup/claude-persistent-cli-provider.test.ts"
      provides: "TEST-01: abort-during-generate leaves zero tracked PIDs; abort-listener ordering proof; safeguard-interval force-kill at `now - startedAt > timeoutMs * 2`; existing 9 tests in this file unchanged."
      contains: "trackedPids"
    - path: "src/ai/cleanup/provider-lifecycle-service.ts"
      provides: "Service owns the safeguard `setInterval` lifecycle (per RELY-03 ownership decision); `stop()` clears the interval before delegating to `provider.stop(...)`."
      contains: "safeguardInterval"
    - path: "src/app/main.ts"
      provides: "Repair log line replaced with literal `\"startup repair: N items reconciled\"` (+ indented breakdown when N>0); `runStartupRepair` wrapped in try/catch that logs `startup_repair_failed` connection event + `console.error` AND continues boot; `process.on('exit', ...)` hook invokes the orphan-PID reaper on the ClaudeStreamJsonCliCleanupProvider instance."
      contains: "startup repair:"
    - path: "src/recording/recording-producer.test.ts"
      provides: "New integration test: stopActiveSession past 20s graceful → 60s force-close via no-op opusStream.destroy fake; asserts recordRepairItem({ type: 'chunk_finalize_timeout', ... }) was called via store spy. Existing 4 tests unchanged."
      contains: "chunk_finalize_timeout"
    - path: "package.json"
      provides: "scripts.test already enumerates dist/ai/cleanup/claude-persistent-cli-provider.test.js and dist/recording/recording-producer.test.js. No new files are added by this plan, so no enumeration drift is expected. T6 verifies."
      contains: "claude-persistent-cli-provider.test.js"
  key_links:
    - from: "src/ai/cleanup/claude-persistent-cli-provider.ts"
      to: "session PID (this.session.pid via ClaudePersistentSmokeSession)"
      via: "trackedPids.add(session.pid) on spawn; trackedPids.delete(pid) on killSession completion or session exit"
      pattern: "trackedPids\\.(add|delete)"
    - from: "src/app/main.ts"
      to: "ClaudeStreamJsonCliCleanupProvider.reapTrackedPids() (or equivalent public hook returning the live Set)"
      via: "process.on('exit', () => provider.reapTrackedPids())"
      pattern: "process\\.on\\(['\"]exit['\"]"
    - from: "src/ai/cleanup/provider-lifecycle-service.ts"
      to: "safeguard setInterval"
      via: "service constructor starts the interval (or provider.registerLifecycleSafeguard); service.stop() clears it before provider.stop()"
      pattern: "setInterval|clearInterval"
    - from: "src/app/main.ts"
      to: "runStartupRepair(ctx, config)"
      via: "try { const repairSummary = await runStartupRepair(ctx, config); console.log('startup repair: ${N} items reconciled'); } catch (error) { ... continue ... }"
      pattern: "startup repair:"
---

<objective>
Phase 2 — Persistent CLI & Recording Reliability. Land six hardening changes against the recording → AI cleanup pipeline: (RELY-01) track every spawned `claude` PID in a per-provider `Set<number>` and SIGKILL anything alive on `provider.stop()` + `process.on('exit')`; (RELY-02) reorder `generate()` so the abort listener registers BEFORE any `await this.killSession()` and `spawn`; (RELY-03) install a safeguard `setInterval` (owned by `AiProviderLifecycleService`) that force-kills any persistent-CLI session where `Date.now() - startedAt > timeoutMs * 2`; (RELY-04) replace the JSON-blob repair log at `src/app/main.ts:254` with the literal `"startup repair: N items reconciled"` line and wrap `runStartupRepair` in a try/catch that logs `startup_repair_failed` and continues boot; (RELY-05) extend `recording-producer.test.ts` with one new integration test that drives the 60s force-close branch via a no-op `opusStream.destroy()` fake; (TEST-01) cover the three new lifecycle behaviors with new top-level `test(...)` cases appended to the existing `claude-persistent-cli-provider.test.ts` (which is already enumerated in `package.json#scripts.test`).

Purpose: CONCERNS.md flags two production failure shapes that operators have encountered: orphan `claude` PIDs accumulating after aborted runs (Activity Monitor / Task Manager visible memory pressure; the dashboard cannot see them because the provider drops the handle) and a Windows FD-leak that strands `chunk_finalize_timeout` repair items requiring manual `npm run repair` invocation. This phase removes both. The force-close test (RELY-05) backfills coverage on a 60-line branch that has been live for the whole project but has never been exercised by a test — the next behavioral edit to `stopActiveSession` would otherwise be flying blind.

Output: One atomic commit per task (wave-internal sequencing — see `<wave_plan>`). Zero new files. Zero new dependencies. All edits are additive against existing files except the repair-log line in `main.ts` (replaced) and the `generate()` body ordering in `claude-persistent-cli-provider.ts` (reordered). `npm run build && npm test` exits 0 with no skipped tests.
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
@.planning/phase2/01-CONTEXT.md
@.planning/phase1/01-CONTEXT.md
@.planning/codebase/CONVENTIONS.md
@.planning/codebase/TESTING.md
@.planning/codebase/ARCHITECTURE.md
@.planning/codebase/CONCERNS.md
@graphify-out/GRAPH_REPORT.md

# Production source — read these before editing
@src/ai/cleanup/claude-persistent-cli-provider.ts
@src/ai/cleanup/claude-persistent-cli-provider.test.ts
@src/ai/cleanup/claude-persistent-smoke.ts
@src/ai/cleanup/provider-lifecycle-service.ts
@src/recording/recording-producer.ts
@src/recording/recording-producer.test.ts
@src/storage/repair-scan.ts
@src/app/main.ts

<interfaces>
<!-- Key contracts the executor needs. Extracted from current source so the executor does not have to re-read full files for every task. -->

From `src/ai/cleanup/claude-persistent-cli-provider.ts` (current state, BEFORE this phase):
```
export type ClaudeStreamJsonCliCleanupProviderOptions = {
  command?: string;
  model?: string | null;
  spawnProcess?: ClaudePersistentSmokeSpawn;   // injection seam — TEST-01 uses this without touching real claude binary
  versionRunner?: CommandExitRunner;
};

export class ClaudeStreamJsonCliCleanupProvider implements AiCleanupProvider {
  readonly providerName = "claude-cli";
  readonly modelName: string;
  // ... readiness flags ...

  private readonly command: string;
  private readonly spawnProcess?: ClaudePersistentSmokeSpawn;
  private readonly versionRunner: CommandExitRunner;
  private session: ClaudePersistentSmokeSession | null = null;

  async preflight(): Promise<void>;
  async generate(_input: AiCleanupProviderInput, options: AiCleanupProviderOptions): Promise<AiCleanupProviderResult>;
  async resetSession(_reason): Promise<void>;
  async resetAfterRequest(_reason): Promise<void>;
  async stop(): Promise<void>;

  private async killSession(): Promise<void>;
  private renderCommandDisplay(extraArgs: string[]): string;
}
```

Current `generate()` body order (lines 91-160, surface where RELY-01 + RELY-02 land):
```
async generate(_input, options) {
  if (options.signal?.aborted) { throw ... "cancelled before it started" }

  const startedAt = Date.now();             // ← also seed safeguard tracking from this
  const extraArgs = buildPersistentCleanupExtraArgs(options);
  let abortListener: (() => void) | null = null;
  try {
    await this.killSession();               // ← (B) BEFORE listener in current code
    const session = new ClaudePersistentSmokeSession({...});   // ← (C) spawn happens lazily via session.request → session.start
    this.session = session;

    abortListener = () => { session.kill(); };
    options.signal?.addEventListener("abort", abortListener, { once: true });   // ← (A) AFTER spawn in current code — RELY-02 target
    if (options.signal?.aborted) { throw ... "cancelled before it started" }

    const turn = await session.request(...);
    if (options.signal?.aborted) { throw ... "cancelled" }
    return { ... };
  } finally {
    if (abortListener) options.signal?.removeEventListener("abort", abortListener);
    await this.killSession();
  }
}
```

Target order per CONTEXT.md D-02 / RELY-02:
```
async generate(_input, options) {
  if (options.signal?.aborted) { throw ... }

  const startedAt = Date.now();
  const extraArgs = buildPersistentCleanupExtraArgs(options);

  // (A) Register listener FIRST — but listener body must tolerate `this.session === null`.
  let abortListener: (() => void) | null = null;
  abortListener = () => {
    // session may be null if abort fires before construction completes
    this.session?.kill();
  };
  options.signal?.addEventListener("abort", abortListener, { once: true });
  if (options.signal?.aborted) { throw ... "cancelled before it started" }

  try {
    // (B) kill any prior session
    await this.killSession();

    // (C) construct + assign new session — listener now has a non-null target
    const session = new ClaudePersistentSmokeSession({...});
    this.session = session;

    // (D) trackedPids.add — happens after session creation but before request, see RELY-01 note below
    //     PID is observable via session.pid AFTER session.start() — request() calls start() internally.

    if (options.signal?.aborted) { throw ... "cancelled before it started" }

    const turn = await session.request(...);
    // ...
    return { ... };
  } finally {
    if (abortListener) options.signal?.removeEventListener("abort", abortListener);
    await this.killSession();
  }
}
```

From `src/ai/cleanup/claude-persistent-smoke.ts` (the lifecycle surface the provider drives):
```
export class ClaudePersistentSmokeSession {
  readonly spawnedCommand: string;
  readonly spawnedArgs: string[];
  readonly timeoutMs: number;

  constructor(options: ClaudePersistentSmokeSessionOptions);

  get pid(): number | null;                  // ← null until start() spawns; PID source for trackedPids
  isAlive(): boolean;
  kill(signal: NodeJS.Signals = "SIGTERM"): boolean;       // hint: SIGTERM with 1s upgrade-to-SIGKILL fallback (lines 443-456)
  async killAndWait(timeoutMs = 1_000): Promise<ClaudePersistentSmokeKillResult>;
  start(): void;
  async request(prompt: string, options?: {...}): Promise<ClaudePersistentSmokeTurnResult>;
}
```

From `src/ai/cleanup/provider-lifecycle-service.ts` (current state):
```
export class AiProviderLifecycleService {
  private readonly prepareAbortController = new AbortController();
  private preparePromise: Promise<...> | null = null;
  private snapshot: AiProviderRuntimeReadinessSnapshot;
  private stopped = false;

  constructor(
    private readonly provider: AiMeetingNotesProvider,
    private readonly options: AiProviderLifecycleServiceOptions,    // includes prepareTimeoutMs
  );

  startPrepareInBackground(): Promise<...>;
  getSnapshot(locale?): ...;
  async stop(): Promise<void> {
    this.stopped = true;
    this.prepareAbortController.abort();
    await this.provider.stop({ timeoutMs: this.options.prepareTimeoutMs });
    this.snapshot = this.sanitizeSnapshot(this.provider.getReadiness());
  }
}
```
NOTE: `provider` is typed as the broader `AiMeetingNotesProvider` (not `ClaudeStreamJsonCliCleanupProvider`). The safeguard hook must therefore be exposed on the broader interface — OR the safeguard interval can live on the provider itself and the service merely calls a public `startSafeguard()` / `stopSafeguard()` pair that no-ops for non-CLI providers.

From `src/storage/repair-scan.ts`:
```
export async function runStartupRepair(
  ctx: StorageContext,
  config: Phase1Config,
): Promise<RepairScanSummary>;

// RepairScanSummary (from src/storage/rows.ts) — 7 numeric fields:
//   oldPartFiles, staleWritingChunksRepaired, staleWritingChunksFailed,
//   missingSttJobsCreated, missingAudioJobsFailed, expiredLeasesReleased, orphanAudioFiles
```

From `src/app/main.ts:84,121-126,254` (the call site + log):
```
import { runStartupRepair } from "../storage/repair-scan.js";

// ... DirongDatabase construction at line 113-119 ...
const ctx = createStorageContext(database, { storageRoot: config.dataDir, normalizeStoredPaths: true });
const store = flattenStorageContext(ctx);                            // unchanged by Phase 2
const repairSummary = await runStartupRepair(ctx, config);           // line 126 — wrap in try/catch per D-08
// ... dashboard / discord wiring ...
console.log("startup repair:", JSON.stringify(repairSummary, null, 2));   // line 254 — REPLACE per D-06
```

From `src/recording/recording-producer.ts:319-353` (the 60s force-close branch — RELY-05 target):
```
const gracefulClose = await waitForChunkPromises(stoppingChunks, 20000);
if (!gracefulClose) {
  this.store.recordConnectionEvent({ ... eventType: "chunk_force_destroy_requested" ... });
  for (const chunk of active.activeChunks.values()) {
    chunk.opusStream.destroy();         // ← NO-OP this in the fake to drive `forcedClose = false`
  }
  const forcedClose = await waitForChunkPromises(stoppingChunks, 60000);
  if (!forcedClose) {
    active.fatalErrors += 1;
    for (const chunk of active.activeChunks.values()) {
      this.store.recordRepairItem({         // ← TARGET — assert this was called
        type: "chunk_finalize_timeout",
        sessionId: active.sessionId,
        chunkId: chunk.chunkId,
        path: chunk.rawFinalPath,
        severity: "error",
        details: { message: ... },
      });
    }
  }
}
```
The two `waitForChunkPromises` calls are TIME-driven via real Promises — driving them deterministically requires either fake timers (`node:test` does not natively expose fake timers in Node 22; use `globalThis.setTimeout` shim OR keep timeouts honest and accept a ~80s test) OR replace `waitForChunkPromises` with an injectable seam. Read `recording-producer.ts:319-353` and `waitForChunkPromises` before implementing — see executor advisory A2.

From `package.json#scripts.test` (current, abridged):
```
"test": "node --no-warnings --test ... dist/ai/cleanup/claude-persistent-cli-provider.test.js ... dist/recording/recording-producer.test.js ..."
```
Both modified test files are ALREADY enumerated. T6 verifies no drift.
</interfaces>
</context>

<strategy>

**Sequencing rationale.** Three independent file sets:
- **Group A — Provider lifecycle (RELY-01 + RELY-02 + RELY-03 + TEST-01):** `src/ai/cleanup/claude-persistent-cli-provider.ts` + `provider-lifecycle-service.ts` + `claude-persistent-cli-provider.test.ts`. Internally sequential: T1 (RELY-02 reordering, smallest mechanical change — unblocks abort-listener observation in subsequent tests) → T2 (RELY-01 PID tracking + reaper + `process.on('exit')` wiring in `main.ts` — needs T1's reordering because the reaper test asserts listener-fires-then-PID-reaped) → T3 (RELY-03 safeguard interval — owned by `AiProviderLifecycleService`, depends on T2's `trackedPids` field as the kill target). All three commit to the same provider file, so they cannot run in parallel.
- **Group B — Boot repair polish (RELY-04):** `src/app/main.ts` only. Single task T4. Independent of Group A's PROVIDER edits — but `main.ts` is ALSO touched by T2 (which adds `process.on('exit')`). T4 must commit AFTER T2 or share a wave with explicit merge ordering. To avoid worktree merge conflict on `main.ts`, T4 runs in Wave 2 (sequential after Wave 1's Group A completes).
- **Group C — Force-close test (RELY-05):** `src/recording/recording-producer.test.ts` only. Zero file overlap with Groups A/B. Can run **in parallel with Group A**.

**Wave layout (parallelization-aware, given Phase 1 worktree merge friction is non-trivial):**
- **Wave 1:** T1 → T2 → T3 (sequential, all on provider files) **∥** T5 (RELY-05 force-close test, fully independent).
- **Wave 2:** T4 (RELY-04 boot repair polish — depends on T2's `process.on('exit')` insertion to avoid merge conflict on `main.ts`).
- **Wave 3:** T6 (verification gate — `package.json` audit + final `npm run build && npm test`).

**Risk callouts.**

(1) **RELY-02 reorder semantics.** The current `generate()` order calls `await this.killSession()` BEFORE registering the abort listener and BEFORE constructing `session`. Reordering to listener-first means the listener may fire while `this.session === null`. The listener body MUST become `() => { this.session?.kill(); }` (optional chain) so an early abort no-ops cleanly. The success-criterion text ("does not crash on a half-constructed session") is exactly this. T1 surfaces this in `<behavior>`.

(2) **RELY-01 PID timing.** `ClaudePersistentSmokeSession.pid` is `null` until `start()` is called; `session.request()` calls `start()` internally. The earliest deterministic moment to read `session.pid` is AFTER `session.request(...)` resolves OR after a synthetic `session.start()` is forced (the smoke session allows pre-`request()` `start()`). Two options: (a) force `session.start()` immediately after construction so `pid` is available before `request()`; (b) read `pid` lazily inside the `try` block right before the `await session.request(...)` line. Option (a) is cleaner because the safeguard interval (RELY-03) ALSO needs a PID/startedAt to inspect. T2's `<action>` picks (a).

(3) **`process.on('exit')` sync constraint.** The Node `'exit'` handler is synchronous — `await` is forbidden and `process.kill` is the only viable kill API (no `child.kill` because the child handle is held only inside `ClaudePersistentSmokeSession`). The reaper iterates `provider.trackedPids` and calls `process.kill(pid, 'SIGKILL')` swallowing `ESRCH` (PID already gone). D-04 explicitly accepts "quiet" failure on this path because the dashboard SQL writer may already be torn down.

(4) **RELY-03 safeguard ownership.** Two viable owners:
  - **Provider-local:** `ClaudeStreamJsonCliCleanupProvider` starts its own `setInterval` in `generate()`, clears in `finally`. Pro: per-generate scope, no service plumbing. Con: a hung `generate()` that never reaches `finally` (e.g. a crashed `session.request` that doesn't throw) leaves the interval running forever.
  - **Service-level:** `AiProviderLifecycleService` starts the interval in its constructor (or first `startPrepareInBackground`), clears in `stop()`. Pro: lifecycle ownership matches the rest of the service. Con: `AiMeetingNotesProvider` interface doesn't currently expose `trackedPids` / `startedAt`.

  Chosen: **service-level via a narrow `forceKillIfStale(): boolean` method added to `ClaudeStreamJsonCliCleanupProvider`**. The service holds the interval and calls `provider.forceKillIfStale()` every `Math.max(5_000, timeoutMs / 4)` ms. For non-CLI providers, `forceKillIfStale` is not on the broader `AiMeetingNotesProvider` interface; the service detects the method via `'forceKillIfStale' in this.provider` runtime check and skips otherwise. Rationale: keeps the broader interface clean, makes the safeguard testable in isolation by calling `provider.forceKillIfStale()` directly without driving the interval.

(5) **RELY-05 timing.** Driving the 60s force-close path under real timers takes ~80s wall-clock (20s graceful + 60s forced). Unacceptable for a unit test. Options:
  - **Fake timers via `node:test` `t.mock.timers`:** Node 22's built-in mock timers (`t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })` then `t.mock.timers.tick(20_000)`). Requires `waitForChunkPromises` to be timer-driven (it is — see `recording-producer.ts`).
  - **Inject `waitForChunkPromises` seam:** Add an optional `RecordingProducerOptions.waitForChunkPromises?` injection point and replace it in the test with an immediately-resolving stub. Cleaner test, but widens the production surface.
  - **Inject `setTimeout`:** Wider blast radius.

  Chosen: **`t.mock.timers`** (Node 22 built-in, zero production surface change). T5 `<action>` documents the tick sequence (20_000ms then 60_000ms ticks).

(6) **TEST-01 file location.** `claude-persistent-cli-provider.test.ts` exists (10 tests, well under file-size limits). TEST-01 cases append to it. The existing `claude-persistent-smoke.test.ts` covers the lower-level `ClaudePersistentSmokeSession` class — NOT the provider — so TEST-01 lives in the higher-level test file. Both are already enumerated in `package.json`.

(7) **CRLF line-ending noise.** Phase 1 every-wave merge friction recurs here. Document the recovery once in `<executor_advisories>` (A1). Wave 1 has TWO parallel worktrees (Group A and Group C / T5) — the orchestrator must stash + merge + pop for each.

(8) **`provider-lifecycle-service.ts` provider type.** The service holds `provider: AiMeetingNotesProvider` (general interface), not the concrete `ClaudeStreamJsonCliCleanupProvider`. T3 must either (a) widen the constructor signature to accept a `ClaudeStreamJsonCliCleanupProvider | OtherProviders` union, or (b) runtime-check via `'forceKillIfStale' in this.provider`. Option (b) is the smaller blast radius — chosen in T3 `<action>`.

**Parallelism.** `config.parallelization=true`. Wave 1 has two parallel work-streams (Group A sequential T1→T2→T3, Group C single task T5). Wave 2 is a single task T4 (gated on Wave 1 completion because of `main.ts` file overlap with T2). Wave 3 is single-task T6 (verification gate).

### Lock fidelity (CONTEXT.md `<decisions>`)

The CONTEXT.md decisions are honored exactly:
- D-01 — Kill triggers `provider.stop()` + `process.on('exit')` (T2 `<action>` step 4).
- D-02 — `process.kill(pid, 'SIGKILL')`; no `tree-kill` / `taskkill` (T2 `<action>` step 3).
- D-03 — `private readonly trackedPids = new Set<number>()` field on the provider (T2 `<action>` step 1).
- D-04 — Quiet on `'exit'`, `recordConnectionEvent({ kind: 'claude_orphan_kill_failed', pid, errno })` on `stop()`-path (T2 `<action>` step 5).
- D-05 — Unconditional repair execution (T4 leaves the existing `await runStartupRepair(...)` call unchanged structurally; only the log line + catch are added).
- D-06 — Literal `"startup repair: N items reconciled"` log line (T4 `<action>` step 2).
- D-07 — Sync sequential `repair → dashboard → discord` (T4 preserves status quo; the call is already at `main.ts:126` BEFORE dashboard start at `main.ts:247`).
- D-08 — Continue boot on repair throw; log `startup_repair_failed` event (T4 `<action>` step 3).

</strategy>

<tasks>

<task type="auto" tdd="true">
  <name>T1: RELY-02 — reorder generate() so abort listener registers before killSession + spawn</name>
  <files>src/ai/cleanup/claude-persistent-cli-provider.ts, src/ai/cleanup/claude-persistent-cli-provider.test.ts</files>
  <read_first>
    - `src/ai/cleanup/claude-persistent-cli-provider.ts` (whole file, focus on `generate()` at lines 91-160).
    - `src/ai/cleanup/claude-persistent-cli-provider.test.ts` (whole file, all 10 existing tests — TEST-01 cases must NOT collide with existing test names).
    - `src/ai/cleanup/claude-persistent-smoke.ts` lines 141-189 (constructor signature) + lines 191-193 (`pid` getter — returns `null` until spawn) + lines 443-456 (`kill(signal)` is safe on a null child — returns `false`).
    - `.planning/phase2/01-CONTEXT.md` `<decisions>` block (RELY-02 ordering contract).
  </read_first>
  <behavior>
    - Existing 10 tests in `claude-persistent-cli-provider.test.ts` MUST continue to pass after the `generate()` body is reordered. No existing test asserts the old order; verify by inspection before editing.
    - New test: "abort fires before session construction → listener no-ops on null session and no crash". Construct a provider with a `spawnProcess` that NEVER returns (returns a `Promise` that hangs OR a fake whose constructor logs but never emits). Create an `AbortController`, call `abortController.abort()` BEFORE invoking `generate()`. Assert `generate()` throws `AiCleanupProviderError("provider_timeout", /cancelled before it started/)` and does NOT crash with "Cannot read properties of null".
    - New test: "abort listener is registered before killSession". Use a fake `spawnProcess` and a test harness that aborts the signal synchronously DURING the await between `addEventListener` and `await this.killSession()`. The simplest deterministic harness: subclass / wrap `ClaudeStreamJsonCliCleanupProvider` to expose `private session` and inject a pre-existing fake session. The provider's `killSession()` is called against the prior session — assert the abort listener's `session?.kill()` invocation against the new session does NOT execute before the listener is registered. Realistic test: assert the abort listener field is set BEFORE `this.killSession()` completes via instrumenting `killSession` with a marker.
    - New test: "abort listener removed in finally". Trigger an abort mid-`generate()`, verify after the promise rejects that `options.signal` has no listeners registered (or that re-aborting does not produce a double-kill).
    - Behavior contract per CONTEXT.md D-02 + RELY-02 success-criterion text: listener registration precedes any `killSession` call.
  </behavior>
  <action>
    Edit `src/ai/cleanup/claude-persistent-cli-provider.ts` `generate()` method (current lines 91-160):

    1. Move the `let abortListener: (() => void) | null = null;` declaration and the `abortListener = () => { ... }; options.signal?.addEventListener("abort", abortListener, { once: true });` lines OUT of the `try` block. Place them BEFORE the `try` block, AFTER the initial `if (options.signal?.aborted)` check at line 95-100.
    2. Change the listener body from `() => { session.kill(); }` to `() => { this.session?.kill(); };` — uses the provider's `session` field (which is `null` until step (5) below) so the listener tolerates pre-construction aborts.
    3. After registering the listener, re-check `if (options.signal?.aborted) { throw new AiCleanupProviderError("provider_timeout", "Claude stream-json request was cancelled before it started."); }`. Without this re-check, a `controller.abort()` racing with `addEventListener` could miss the throw.
    4. Inside the `try` block, the order is now: `await this.killSession();` (kills any prior session) → `const session = new ClaudePersistentSmokeSession({...});` → `this.session = session;` → second aborted re-check → `const turn = await session.request(...);` → return.
    5. `finally` block unchanged: `if (abortListener) options.signal?.removeEventListener("abort", abortListener); await this.killSession();`.
    6. Verify the resulting body still satisfies TypeScript `noUncheckedIndexedAccess` — no array index access introduced.

    Edit `src/ai/cleanup/claude-persistent-cli-provider.test.ts` (APPEND new tests; do NOT modify existing 10 tests):

    7. Append a comment marker `// === Phase 2 RELY-02: abort-listener-first ordering ===`.
    8. Append three new top-level `test(...)` cases:
       a. `test("ClaudeStreamJsonCliCleanupProvider tolerates abort before generate() starts", async () => { ... })` — construct provider with a fake `spawnProcess` that returns a never-resolving fake child; create `AbortController`; call `abortController.abort()`; call `provider.generate({...}, { signal: abortController.signal, ... })`; `await assert.rejects(promise, /cancelled before it started/)`; assert no unhandled rejection on the next microtask tick (use `await new Promise(r => setImmediate(r))`).
       b. `test("ClaudeStreamJsonCliCleanupProvider abort listener registers before killSession", async () => { ... })` — pre-seed `provider['session']` with a fake (cast to `any` to bypass private) whose `killAndWait()` resolves AFTER a deferred promise. Use the deferred to gate ordering: `addEventListener` must have fired BEFORE the `killAndWait` await resolves. Assert by instrumenting the fake's `killAndWait` to check `controller.signal.eventListenerCount` (or use a sentinel that the listener flips on registration).
       c. `test("ClaudeStreamJsonCliCleanupProvider abort listener removed in finally", async () => { ... })` — call `generate()` with a fake spawn that completes successfully (single result line), then abort the signal AFTER the promise resolves; assert the abort listener no longer reacts (use a counter that increments on listener fire; expect count === 0).
    9. Helper fakes: extend the existing `FakeChildProcess` if needed (the smoke test already has a robust one — copy the pattern into this test file as a local helper if not already present, or import if the test file allows).

    Implements RELY-02 (mechanical reorder + 3 new tests against the new order).
  </action>
  <verify>
    <automated>npm run build &amp;&amp; node --no-warnings --test dist/ai/cleanup/claude-persistent-cli-provider.test.js</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "addEventListener" src/ai/cleanup/claude-persistent-cli-provider.ts` shows the line index is LESS than the line index of the first `await this.killSession()` inside `generate()`.
    - `grep -nc 'test(' src/ai/cleanup/claude-persistent-cli-provider.test.ts | grep -v '^#'` — count is exactly (original_count + 3).
    - `dist/ai/cleanup/claude-persistent-cli-provider.test.js` runs and all tests pass under `node --test`.
    - The listener body uses `this.session?.kill()` (optional chain) — verified by `grep -n "this.session?.kill" src/ai/cleanup/claude-persistent-cli-provider.ts` returning at least one hit.
  </acceptance_criteria>
  <done>
    `generate()` body reordered per CONTEXT.md D-02. Listener body uses `this.session?.kill()`. Three new top-level tests appended to `claude-persistent-cli-provider.test.ts`. Existing 10 tests unchanged and still pass. `npm run build` succeeds. `dist/ai/cleanup/claude-persistent-cli-provider.test.js` passes under `node --test`.
  </done>
</task>

<task type="auto" tdd="true">
  <name>T2: RELY-01 — trackedPids Set + provider.stop() reaper + process.on('exit') wiring</name>
  <files>src/ai/cleanup/claude-persistent-cli-provider.ts, src/ai/cleanup/claude-persistent-cli-provider.test.ts, src/app/main.ts</files>
  <read_first>
    - `src/ai/cleanup/claude-persistent-cli-provider.ts` (whole file, focus on `killSession()` at lines 178-185 and `stop()` at lines 174-176).
    - `src/ai/cleanup/claude-persistent-smoke.ts` lines 191-193 (`get pid()` returns `null` until `start()`), lines 203-254 (`start()` lazy spawn), lines 443-456 (`kill(signal)` is safe on null child).
    - `src/app/main.ts` lines 30-44 (existing `ClaudeStreamJsonCliCleanupProvider` import + lifecycle service wiring; the provider instance is constructed somewhere in this file — locate and document the variable name).
    - Existing tests in `claude-persistent-cli-provider.test.ts` that use fake `ClaudePersistentSmokeSpawn` — they assign synthetic PIDs like `101`, `151`, `161`. Reuse the same pattern.
    - `.planning/phase2/01-CONTEXT.md` `<decisions>` block (D-01, D-02, D-03, D-04 + `<specifics>` event-kind names `claude_orphan_kill_failed`).
    - `~/.claude/CLAUDE.md` "no silent fallbacks" — informs D-04 split (quiet on exit, loud on stop()).
  </read_first>
  <behavior>
    - `ClaudeStreamJsonCliCleanupProvider` gains `private readonly trackedPids = new Set<number>();` (per CONTEXT.md D-03).
    - After `this.session = session;` in `generate()` and before `await session.request(...)`, the provider FORCES `session.start()` so `session.pid` becomes non-null synchronously, then `this.trackedPids.add(session.pid)` (only if non-null). The smoke session's `start()` is idempotent — calling it before `request()` is safe (verify by reading `claude-persistent-smoke.ts:204-206`: early-return guard `if (this.child && this.isAlive())`).
    - `killSession()` is augmented: after `await session.killAndWait()` resolves, if the PID was tracked, `this.trackedPids.delete(pid)`. Also when the session naturally exits (without an external kill), the PID must leave the set — this is harder to observe; for Phase 2 simplicity, the `finally` block of `generate()` already calls `killSession()` which performs the delete. A normal-exit session will be killed-as-no-op by `killSession()` (the `kill` call no-ops on an already-exited child per smoke session line 445).
    - New public method `reapTrackedPids(): void` (synchronous) iterates `this.trackedPids`, calls `process.kill(pid, "SIGKILL")` inside a `try { } catch { /* quiet — exit-handler path; PID may already be gone, ESRCH expected */ }`, and clears the set. This is the SYNC handler for `process.on('exit')`. Per CONTEXT.md D-04: NO event emission on this path (the DB writer may already be torn down).
    - `stop()` is augmented: AFTER `await this.killSession()` resolves, iterate any pids STILL in `trackedPids` (defensive — should be empty after `killSession`), call `process.kill(pid, "SIGKILL")` with a try/catch that emits `recordConnectionEvent({ kind: 'claude_orphan_kill_failed', pid, errno })` on failure. This `recordConnectionEvent` requires a writer reference — since the provider does NOT currently hold a `store` or `ctx` reference, the cleanest path is an optional constructor option `onOrphanKillFailed?: (event: { pid: number; errno: string | null }) => void` callback. `main.ts` wires this callback to call `ctx.writes.recordConnectionEvent({ ... })` per CONVENTIONS.md structured logging rule.
    - `src/app/main.ts` registers `process.on('exit', () => provider.reapTrackedPids());` ONCE near the lifecycle service construction site. The handler MUST be sync (no `await` allowed in `'exit'` handler per Node docs). The provider instance variable name in `main.ts` is determined by reading the file (see `<read_first>`).
    - All existing tests pass unchanged (PID tracking is purely additive observation; `trackedPids` starts empty in every new provider).
    - New test: "trackedPids is empty after successful generate()" — drive a full generate→result→finally cycle with a fake spawn that emits one result line; assert `(provider as any).trackedPids.size === 0` after the promise resolves.
    - New test: "trackedPids is empty after abort mid-generate" — same setup as T1's abort-mid-generate test; assert `trackedPids.size === 0` after `await assert.rejects(...)`. THIS IS the TEST-01 primary assertion (per CONTEXT.md `<specifics>` "TEST-01 assertion target: `provider.trackedPids.size === 0`").
    - New test: "reapTrackedPids SIGKILLs every tracked PID and clears the set". Pre-seed `(provider as any).trackedPids` with two synthetic PIDs that point to a fake `process.kill` (monkey-patch `process.kill` globally for the duration of the test, restore in `finally`). Call `provider.reapTrackedPids()`. Assert: `kill` was invoked twice (once per PID, signal=`"SIGKILL"`); `trackedPids.size === 0`.
    - New test: "reapTrackedPids swallows ESRCH". Same setup but the monkey-patched `process.kill` throws `Object.assign(new Error("ESRCH"), { code: 'ESRCH' })`. Assert `reapTrackedPids()` does NOT throw and `trackedPids` is still cleared.
  </behavior>
  <action>
    Edit `src/ai/cleanup/claude-persistent-cli-provider.ts`:

    1. Add field after line 54 (`private session: ClaudePersistentSmokeSession | null = null;`):
       ```
       private readonly trackedPids = new Set<number>();
       private readonly onOrphanKillFailed?: (event: { pid: number; errno: string | null }) => void;
       ```
    2. Extend `ClaudeStreamJsonCliCleanupProviderOptions` (line 24-29) with `onOrphanKillFailed?: (event: { pid: number; errno: string | null }) => void;`.
    3. Constructor (line 56-62): add `this.onOrphanKillFailed = options.onOrphanKillFailed;` after the existing field assignments.
    4. In `generate()` (post-T1 order), after `this.session = session;`: add `session.start();` (forces lazy spawn so `pid` becomes non-null) then `const pid = session.pid; if (pid !== null) { this.trackedPids.add(pid); }`. Document with a one-line comment: `// RELY-01: track PID for orphan-reap (on stop() + on parent exit)`.
    5. Edit `killSession()` (line 178-185): hoist `const pid = session.pid ?? null;` BEFORE setting `this.session = null` (the session reference is still alive at this point); after `await session.killAndWait();`, `if (pid !== null) { this.trackedPids.delete(pid); }`.
    6. Add public method `reapTrackedPids(): void`:
       ```
       reapTrackedPids(): void {
         // RELY-01 / D-04 sync exit-handler path. Quiet on failure: DB writer may be torn down,
         // and process.kill ESRCH is expected when the child already exited. We do NOT emit
         // recordConnectionEvent here — that path is the stop()-time orphan reaper below.
         for (const pid of this.trackedPids) {
           try {
             process.kill(pid, "SIGKILL");
           } catch {
             // quiet — ESRCH expected; exit handler must not throw
           }
         }
         this.trackedPids.clear();
       }
       ```
    7. Augment `stop()` (line 174-176):
       ```
       async stop(): Promise<void> {
         await this.killSession();
         // Defensive: killSession() should have emptied trackedPids via the delete in step (5).
         // Any remaining PIDs indicate a leak — SIGKILL with loud structured logging per D-04.
         for (const pid of [...this.trackedPids]) {
           try {
             process.kill(pid, "SIGKILL");
             this.trackedPids.delete(pid);
           } catch (error) {
             const errno = (error as NodeJS.ErrnoException)?.code ?? null;
             this.onOrphanKillFailed?.({ pid, errno });
             this.trackedPids.delete(pid); // give up; better to leak the Set entry than re-throw
           }
         }
       }
       ```

    Edit `src/app/main.ts`:

    8. Locate the `ClaudeStreamJsonCliCleanupProvider` instantiation (search for `new ClaudeStreamJsonCliCleanupProvider(`). If not present (i.e. the provider is constructed elsewhere via a factory), follow the import chain — the construction site is in this file given the import at line 32.
    9. Wire the `onOrphanKillFailed` callback at construction: `new ClaudeStreamJsonCliCleanupProvider({ ...existingOptions, onOrphanKillFailed: ({ pid, errno }) => { ctx.writes.recordConnectionEvent({ sessionId: null, eventType: "claude_orphan_kill_failed", level: "warn", details: { pid, errno } }); } })`. Note: `sessionId: null` is allowed by `recordConnectionEvent`'s signature for non-session-scoped events (verify by reading `src/storage/repair-scan.ts` line ~52 and the `recordConnectionEvent` write-store method). If `sessionId` is required, omit the wiring and use `console.error` only — surface the gap in SUMMARY for follow-up.
    10. After provider construction, register the exit hook ONCE. Place near the existing `shutdownPromise` declaration (search for `shutdownPromise: Promise<void> | null = null` at line 249):
        ```
        // RELY-01: SIGKILL any orphan claude PIDs on parent exit. Sync handler — no await allowed.
        // Quiet on failure per D-04; the DB writer may already be torn down.
        process.on("exit", () => {
          aiCleanupProvider.reapTrackedPids();
        });
        ```
        Substitute `aiCleanupProvider` with the actual local variable name from step 8. If the provider variable is not in scope at the registration site, refactor to hoist it (`let aiCleanupProvider: ClaudeStreamJsonCliCleanupProvider | null = null;` declared early, assigned at construction; the exit hook checks `aiCleanupProvider?.reapTrackedPids();`).

    Edit `src/ai/cleanup/claude-persistent-cli-provider.test.ts` (APPEND new tests):

    11. Append comment marker `// === Phase 2 RELY-01 / TEST-01: trackedPids lifecycle ===`.
    12. Append four new top-level `test(...)` cases:
        a. `test("ClaudeStreamJsonCliCleanupProvider tracks PID during generate and clears on success", async () => { ... })` — fake spawn returns child with `pid: 401`; drive a single successful result; after `await provider.generate(...)`, assert `(provider as any).trackedPids.size === 0`.
        b. `test("ClaudeStreamJsonCliCleanupProvider clears trackedPids on abort mid-generate", async () => { ... })` — synthetic abort during `session.request`; assert `await assert.rejects(...)` then `(provider as any).trackedPids.size === 0`.
        c. `test("ClaudeStreamJsonCliCleanupProvider.reapTrackedPids SIGKILLs every tracked PID", () => { ... })` — pre-seed `(provider as any).trackedPids` with PIDs `[12345, 12346]`; monkey-patch `process.kill` to collect calls; call `provider.reapTrackedPids()`; assert two calls with signal `"SIGKILL"` and `trackedPids.size === 0`; restore `process.kill` in `finally`.
        d. `test("ClaudeStreamJsonCliCleanupProvider.reapTrackedPids swallows ESRCH", () => { ... })` — same as (c) but the patched `process.kill` throws `Object.assign(new Error("ESRCH"), { code: 'ESRCH' })`. Assert no throw escapes; assert `trackedPids.size === 0`; restore `process.kill`.

    Implements RELY-01 + TEST-01 (the four new tests cover the assertion targets in CONTEXT.md `<specifics>`).
  </action>
  <verify>
    <automated>npm run build &amp;&amp; node --no-warnings --test dist/ai/cleanup/claude-persistent-cli-provider.test.js &amp;&amp; bash -c 'grep -qn "trackedPids = new Set" src/ai/cleanup/claude-persistent-cli-provider.ts || { echo "FAIL: trackedPids field missing"; exit 1; }; grep -qn "process.on(\"exit\"" src/app/main.ts || { echo "FAIL: process.on(exit) hook missing from main.ts"; exit 1; }; grep -qn "reapTrackedPids" src/app/main.ts || { echo "FAIL: reapTrackedPids not invoked from main.ts"; exit 1; }'</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "trackedPids" src/ai/cleanup/claude-persistent-cli-provider.ts | grep -v '^#'` returns ≥ 5 (field decl + add + delete + reapTrackedPids body + stop() loop).
    - `grep -n 'reapTrackedPids' src/app/main.ts` returns at least one match inside a `process.on("exit"` block.
    - `(provider as any).trackedPids.size === 0` holds after both successful generate AND aborted generate (verified by the two new tests).
    - `process.kill` monkey-patch test confirms SIGKILL is the signal passed and ESRCH does not throw.
    - `npm run build` succeeds. `dist/ai/cleanup/claude-persistent-cli-provider.test.js` passes (existing 13 tests + 4 new = 17 tests).
  </acceptance_criteria>
  <done>
    `trackedPids: Set<number>` field exists on `ClaudeStreamJsonCliCleanupProvider`. `generate()` adds the PID after `session.start()`; `killSession()` deletes it. `reapTrackedPids()` public method SIGKILLs every tracked PID and clears the set; swallows ESRCH. `stop()` performs a loud cleanup pass via `onOrphanKillFailed`. `src/app/main.ts` wires `process.on('exit', () => provider.reapTrackedPids())` and the `onOrphanKillFailed` callback to `ctx.writes.recordConnectionEvent`. Four new tests in `claude-persistent-cli-provider.test.ts` all pass. RELY-01 + TEST-01 satisfied.
  </done>
</task>

<task type="auto" tdd="true">
  <name>T3: RELY-03 — safeguard interval force-kills sessions where now - startedAt > timeoutMs * 2</name>
  <files>src/ai/cleanup/claude-persistent-cli-provider.ts, src/ai/cleanup/claude-persistent-cli-provider.test.ts, src/ai/cleanup/provider-lifecycle-service.ts</files>
  <read_first>
    - `src/ai/cleanup/claude-persistent-cli-provider.ts` (post-T2 state — `trackedPids` and `session` already in place).
    - `src/ai/cleanup/provider-lifecycle-service.ts` (whole file — service `stop()` is the natural place to clear the interval).
    - `.planning/phase2/01-CONTEXT.md` `<decisions>` "RELY-03 safeguard interval" — recommended `setInterval(check, Math.max(5_000, timeoutMs / 4))`; force-kill when `Date.now() - startedAt > timeoutMs * 2`.
  </read_first>
  <behavior>
    - `ClaudeStreamJsonCliCleanupProvider` records `startedAt: number | null` (set in `generate()` at the existing `const startedAt = Date.now();` line; persisted on the provider as `private generateStartedAt: number | null = null;`; cleared in `finally` after `killSession`).
    - `ClaudeStreamJsonCliCleanupProvider` records `currentTimeoutMs: number | null` similarly (the `options.timeoutMs` passed to `generate`).
    - New public method `forceKillIfStale(now: number = Date.now()): boolean` — returns `true` if a kill was performed. Reads `this.generateStartedAt` and `this.currentTimeoutMs`; if both non-null AND `now - generateStartedAt > currentTimeoutMs * 2` AND `this.session !== null`, calls `this.session.kill("SIGKILL")` directly (bypassing the SIGTERM upgrade path) and returns `true`. Otherwise returns `false`. Method is testable in isolation by calling it directly without driving the interval.
    - `AiProviderLifecycleService` gains a `private safeguardInterval: NodeJS.Timeout | null = null;` field.
    - `AiProviderLifecycleService.startPrepareInBackground()` (or constructor — see `<action>` for placement decision) starts the interval IF the provider exposes `forceKillIfStale` (runtime check `'forceKillIfStale' in this.provider`). Interval period: `Math.max(5_000, this.options.prepareTimeoutMs / 4)`. The interval handler: `(provider as { forceKillIfStale?: (now?: number) => boolean }).forceKillIfStale?.();`.
    - `AiProviderLifecycleService.stop()` clears the interval BEFORE the existing `await this.provider.stop(...)` call. Use `clearInterval(this.safeguardInterval); this.safeguardInterval = null;` defensively.
    - New test in `claude-persistent-cli-provider.test.ts`: "forceKillIfStale SIGKILLs session when now - startedAt > timeoutMs * 2". Construct provider; pre-seed `(provider as any).session` with a fake whose `kill(signal)` records the signal; pre-seed `(provider as any).generateStartedAt = 0` and `(provider as any).currentTimeoutMs = 1_000`; call `provider.forceKillIfStale(2_001)`; assert returns `true` and fake `kill` was called with `"SIGKILL"`. Boundary tests: `provider.forceKillIfStale(2_000)` returns `false` (NOT strictly greater than `1_000 * 2`). `provider.forceKillIfStale(2_001)` with `session === null` returns `false`.
    - Existing 17 tests (10 pre-Phase-2 + 3 from T1 + 4 from T2) continue to pass.
  </behavior>
  <action>
    Edit `src/ai/cleanup/claude-persistent-cli-provider.ts`:

    1. Add fields after the T2-added `trackedPids` field:
       ```
       private generateStartedAt: number | null = null;
       private currentTimeoutMs: number | null = null;
       ```
    2. In `generate()`: the existing `const startedAt = Date.now();` line stays — additionally assign `this.generateStartedAt = startedAt;` and `this.currentTimeoutMs = options.timeoutMs;` immediately after.
    3. In `generate()` `finally` block: clear both fields after `await this.killSession();` → `this.generateStartedAt = null; this.currentTimeoutMs = null;`.
    4. Add public method `forceKillIfStale(now: number = Date.now()): boolean`:
       ```
       forceKillIfStale(now: number = Date.now()): boolean {
         // RELY-03: safeguard interval target. Returns true iff a kill was performed.
         // Idempotent — repeated calls on an already-killed session are no-ops.
         const startedAt = this.generateStartedAt;
         const timeoutMs = this.currentTimeoutMs;
         const session = this.session;
         if (startedAt === null || timeoutMs === null || session === null) {
           return false;
         }
         if (now - startedAt <= timeoutMs * 2) {
           return false;
         }
         session.kill("SIGKILL");
         return true;
       }
       ```

    Edit `src/ai/cleanup/provider-lifecycle-service.ts`:

    5. Add field after line 39 (`private stopped = false;`):
       ```
       private safeguardInterval: NodeJS.Timeout | null = null;
       ```
    6. In `startPrepareInBackground()`, AFTER the existing `if (this.preparePromise) return this.preparePromise;` early-return at line 53-55, BEFORE the `callOptions` construction at line 57: install the safeguard if the provider supports it AND it's not already running:
       ```
       if (this.safeguardInterval === null && hasForceKillIfStale(this.provider)) {
         const periodMs = Math.max(5_000, Math.floor(this.options.prepareTimeoutMs / 4));
         this.safeguardInterval = setInterval(() => {
           try {
             this.provider.forceKillIfStale();
           } catch {
             // safeguard interval must never throw — log via the provider's snapshot if needed
           }
         }, periodMs);
         // Unref so the interval does not keep the process alive past intended shutdown.
         this.safeguardInterval.unref?.();
       }
       ```
       Add a module-level type guard helper (NOT exported):
       ```
       function hasForceKillIfStale(
         provider: AiMeetingNotesProvider,
       ): provider is AiMeetingNotesProvider & { forceKillIfStale(now?: number): boolean } {
         return typeof (provider as { forceKillIfStale?: unknown }).forceKillIfStale === "function";
       }
       ```
       Then narrow `this.provider` via the guard or via a typed reference local variable so the `setInterval` callback compiles cleanly under `noUncheckedIndexedAccess`.
    7. Modify `stop()` (line 104-109) — clear the interval BEFORE delegating to `provider.stop`:
       ```
       async stop(): Promise<void> {
         this.stopped = true;
         this.prepareAbortController.abort();
         if (this.safeguardInterval !== null) {
           clearInterval(this.safeguardInterval);
           this.safeguardInterval = null;
         }
         await this.provider.stop({ timeoutMs: this.options.prepareTimeoutMs });
         this.snapshot = this.sanitizeSnapshot(this.provider.getReadiness());
       }
       ```

    Edit `src/ai/cleanup/claude-persistent-cli-provider.test.ts` (APPEND new tests):

    8. Append comment marker `// === Phase 2 RELY-03: safeguard interval force-kill ===`.
    9. Append three new top-level `test(...)` cases:
       a. `test("ClaudeStreamJsonCliCleanupProvider.forceKillIfStale SIGKILLs when now - startedAt > timeoutMs * 2", () => { ... })` — pre-seed `(provider as any).session = { kill: (sig) => { killCalls.push(sig); return true; } }`; pre-seed `(provider as any).generateStartedAt = 0` and `(provider as any).currentTimeoutMs = 1_000`; assert `provider.forceKillIfStale(2_001) === true`; assert `killCalls[0] === "SIGKILL"`.
       b. `test("ClaudeStreamJsonCliCleanupProvider.forceKillIfStale returns false at the boundary now - startedAt === timeoutMs * 2", () => { ... })` — same setup; assert `provider.forceKillIfStale(2_000) === false`; assert `killCalls.length === 0`.
       c. `test("ClaudeStreamJsonCliCleanupProvider.forceKillIfStale returns false when session is null", () => { ... })` — pre-seed `generateStartedAt = 0`, `currentTimeoutMs = 1_000`, but DO NOT pre-seed `session`; assert `provider.forceKillIfStale(99_999_999) === false`.

    Implements RELY-03 (safeguard ownership at service level; provider exposes a pure-function `forceKillIfStale` testable in isolation; interval is `unref`d so it does not keep the process alive).
  </action>
  <verify>
    <automated>npm run build &amp;&amp; node --no-warnings --test dist/ai/cleanup/claude-persistent-cli-provider.test.js dist/ai/cleanup/provider-lifecycle-service.test.js &amp;&amp; bash -c 'grep -qn "forceKillIfStale" src/ai/cleanup/claude-persistent-cli-provider.ts || { echo "FAIL: forceKillIfStale missing from provider"; exit 1; }; grep -qn "safeguardInterval" src/ai/cleanup/provider-lifecycle-service.ts || { echo "FAIL: safeguardInterval missing from lifecycle service"; exit 1; }; grep -qn "clearInterval" src/ai/cleanup/provider-lifecycle-service.ts || { echo "FAIL: clearInterval missing from lifecycle service stop()"; exit 1; }'</automated>
  </verify>
  <acceptance_criteria>
    - `forceKillIfStale` returns `true` exactly when all three conditions hold: `generateStartedAt !== null`, `currentTimeoutMs !== null`, `session !== null`, AND `now - generateStartedAt > timeoutMs * 2`.
    - Boundary test: `now - startedAt === timeoutMs * 2` returns `false` (strictly greater than required).
    - `AiProviderLifecycleService.stop()` calls `clearInterval` BEFORE `await this.provider.stop(...)`.
    - The interval is `unref()`d so it does not block process exit.
    - `npm run build && npm test` passes for both modified test files.
  </acceptance_criteria>
  <done>
    `forceKillIfStale(now?)` method exists on the provider, idempotent, returns `boolean`. `AiProviderLifecycleService` owns the `safeguardInterval`, started during `startPrepareInBackground`, cleared in `stop()`. Three new tests for `forceKillIfStale` pass. RELY-03 satisfied: a session with `now - startedAt > timeoutMs * 2` is force-killed by the safeguard without operator intervention.
  </done>
</task>

<task type="auto" tdd="true">
  <name>T5: RELY-05 — integration test drives stopActiveSession past 20s graceful into 60s force-close branch</name>
  <files>src/recording/recording-producer.test.ts</files>
  <read_first>
    - `src/recording/recording-producer.test.ts` (whole file — existing 4 tests + the `createRecordingStoreSpy` helper at line 120 that returns a no-op `RecordingProducerStore`).
    - `src/recording/recording-producer.ts` lines 280-360 (`stopActiveSession`, `waitForChunkPromises`, the 20s/60s timeouts, `chunk.opusStream.destroy()`, `recordRepairItem({ type: 'chunk_finalize_timeout', ... })`).
    - Search `waitForChunkPromises` definition in `src/recording/recording-producer.ts` (likely lower in the file) — confirm it is `setTimeout`-driven so `t.mock.timers` can advance it.
    - `node:test` mock-timers documentation reference: `t.mock.timers.enable({ apis: ['setTimeout'] })` then `t.mock.timers.tick(ms)`. Verify Node 22 supports this API (it does — `node:test` mock timers GA in Node 20.4+).
    - `.planning/phase2/01-CONTEXT.md` `<specifics>` "RELY-05 force-close fault injection: the cleanest seam is a fake `AudioReceiveStream` whose `destroy()` is a no-op so the 60s `waitForChunkPromises` resolves to `forcedClose = false` deterministically."
  </read_first>
  <behavior>
    - New top-level `test(...)` case in `recording-producer.test.ts` that:
      1. Constructs a `RecordingProducer` with a real `createConfig(dataDir)` Phase1Config and a custom store spy that captures all `recordRepairItem` invocations.
      2. Sets up an active session with at least one open chunk. The chunk's `opusStream` is a fake whose `destroy()` is a no-op (does NOT emit `'end'` / `'close'` / `'error'`). This causes `waitForChunkPromises(stoppingChunks, 20000)` to resolve `false` (no graceful close within 20s) AND `waitForChunkPromises(stoppingChunks, 60000)` to ALSO resolve `false` (forced close timeout — the destroy no-op never triggers chunk completion).
      3. Drives `producer.stop({ stoppedByUserId, stoppedByDisplayName })` and uses `t.mock.timers.enable({ apis: ['setTimeout'] })` + `t.mock.timers.tick(20_000)` + `t.mock.timers.tick(60_000)` to advance through both timeouts deterministically.
      4. Asserts: the store spy's `recordRepairItem` was called with `type: "chunk_finalize_timeout"` for the open chunk. Asserts `recordConnectionEvent` was called with `eventType: "chunk_force_destroy_requested"` BEFORE the repair item write (ordering test). Asserts session ended with status `"needs_repair"` (because `fatalErrors > 0`).
    - The existing 4 tests are NOT modified.
    - Constructing an "active session" without going through the full Discord voice connection flow may require either: (a) exporting a test-only `RecordingProducer.__seedActiveSession(active)` hook (widens production surface — REJECTED); (b) driving `producer.start(...)` against a fully-stubbed Discord client + voice adapter (large fixture overhead); (c) writing the test against the existing `producer.start(...)` rejection path and bypassing the join requirement via stubs. Option (c) is the pragmatic path: use the existing `createRecordingStoreSpy` pattern plus a minimal stub for `@discordjs/voice` join calls.
    - If option (c) is infeasible (the chunk-creation path requires real opus packets), fall back to constructing the `ActiveSession` indirectly by stubbing `producer.start`'s internals via narrowed test seams. The executor decides based on what the codebase allows. See executor advisory A2.
    - If the seam complexity exceeds 100 lines of test setup, downgrade to a UNIT test of the force-close branch by extracting the 35-line force-close block into a private helper `executeForceCloseBranch(active, stoppingChunks): Promise<void>` (zero behavioral change) and testing the helper directly with a constructed `ActiveSession`. The extraction is a pure refactor (no semantic change) and is in scope IF and only IF needed to make the test feasible.
  </behavior>
  <action>
    Edit `src/recording/recording-producer.test.ts`:

    1. Read the whole file. Note the existing helper `createRecordingStoreSpy` returns a no-op store; extend it (LOCAL to the new test) with a `repairItems: Array<...>` capture and a custom `recordRepairItem` implementation that pushes onto it.

    2. Append a comment marker `// === Phase 2 RELY-05: 60s force-close branch ===`.

    3. Append a top-level `test("stopActiveSession writes chunk_finalize_timeout repair items when 60s force-close fails", async (t) => { ... })`:
       - `t.mock.timers.enable({ apis: ['setTimeout'] });`
       - `const dataDir = mkdtempSync(path.join(tmpdir(), "dirong-recording-force-close-"));`
       - Build a store spy that captures `recordRepairItem` calls AND `recordConnectionEvent` calls in order.
       - Construct `RecordingProducer` with the spy + `createConfig(dataDir)`.
       - To seed an active session: read `recording-producer.ts` source first; if a public path exists (e.g. via `producer.start(...)`), use it; otherwise the test EXTRACTS the 35-line force-close branch into a private helper (per `<behavior>` fallback) and tests the helper directly. Document the chosen path in a code comment at the top of the new test.
       - For the chosen path, fake `chunk.opusStream` as `new PassThrough()` (from `node:stream`) whose `destroy()` is overridden to a no-op (`(stream as any).destroy = () => {};`) so the chunk's close promise never resolves.
       - Initiate the stop: `const stopPromise = producer.stop({ stoppedByUserId: "user-1", stoppedByDisplayName: "User One" });`.
       - Advance timers: `await t.mock.timers.tick(20_000);` (graceful timeout) then `await t.mock.timers.tick(60_000);` (force-close timeout).
       - `const result = await stopPromise;`
       - Assert: `repairItems.some((item) => item.type === "chunk_finalize_timeout")` is `true`.
       - Assert: `connectionEvents.findIndex(e => e.eventType === "chunk_force_destroy_requested")` is LESS than `connectionEvents.findIndex(e => e.eventType === "bot_left_channel")` (chunk_force_destroy precedes bot_left).
       - Assert: `result.status === "needs_repair"` (the session ended with `fatalErrors > 0` because forcedClose=false → fatalErrors+=1).
       - `finally { t.mock.timers.reset(); rmSync(dataDir, { recursive: true, force: true }); }`.

    4. If the executor determines option (c) above (driving via `producer.start(...)`) is too heavy, the alternative is extracting `executeForceCloseBranch` as a pure private helper. The extraction MUST be byte-equivalent — copy the 35-line block at `recording-producer.ts:319-353` into a private method with the exact same logic, then call the method from `stopActiveSession`. Document the refactor in the SUMMARY. This refactor is in-scope ONLY for RELY-05 testability.

    Implements RELY-05.
  </action>
  <verify>
    <automated>npm run build &amp;&amp; node --no-warnings --test dist/recording/recording-producer.test.js &amp;&amp; bash -c 'count=$(grep -c "test(" src/recording/recording-producer.test.ts); test "$count" -ge 5 || { echo "FAIL: expected ≥ 5 tests in recording-producer.test.ts, got $count"; exit 1; }; grep -qn "chunk_finalize_timeout" src/recording/recording-producer.test.ts || { echo "FAIL: new test does not assert chunk_finalize_timeout"; exit 1; }'</automated>
  </verify>
  <acceptance_criteria>
    - One new top-level `test(...)` block in `src/recording/recording-producer.test.ts` whose body literally references `chunk_finalize_timeout` in an assertion.
    - The new test uses `node:test` built-in mock timers (`t.mock.timers.enable` / `t.mock.timers.tick`) to advance through both 20s and 60s timeouts.
    - The store spy captures the `recordRepairItem` call with `type: "chunk_finalize_timeout"`; assertion holds.
    - The existing 4 tests in `recording-producer.test.ts` still pass unchanged.
    - `npm run build && node --no-warnings --test dist/recording/recording-producer.test.js` exits 0.
    - If the force-close branch was extracted into a private helper, the SUMMARY documents the extraction and confirms zero behavioral change (line-by-line equivalence).
  </acceptance_criteria>
  <done>
    `recording-producer.test.ts` has one new top-level test that drives `stopActiveSession` past the 20s graceful close into the 60s force-close branch via `t.mock.timers`. The test asserts `chunk_finalize_timeout` repair items are written. Existing tests unchanged. ROADMAP success criterion #5 satisfied. RELY-05 closed.
  </done>
</task>

<task type="auto">
  <name>T4: RELY-04 — replace JSON-blob repair log with literal line + wrap runStartupRepair in try/catch</name>
  <files>src/app/main.ts</files>
  <read_first>
    - `src/app/main.ts` lines 84 (import), 121-126 (call site), 254 (current log line), and the surrounding boot-order block (dashboard start at line 247, discord client wiring after).
    - `.planning/phase2/01-CONTEXT.md` `<decisions>` D-05 (unconditional), D-06 (literal log format), D-07 (sync sequential order, status quo), D-08 (continue on throw, log `startup_repair_failed`).
    - `src/storage/rows.ts` — confirm the 7 fields of `RepairScanSummary` for the indented-detail format. (Fields: `oldPartFiles`, `staleWritingChunksRepaired`, `staleWritingChunksFailed`, `missingSttJobsCreated`, `missingAudioJobsFailed`, `expiredLeasesReleased`, `orphanAudioFiles`.)
    - `src/storage/repair-scan.ts:8-32` (signature confirmed: `runStartupRepair(ctx, config): Promise<RepairScanSummary>`).
  </read_first>
  <behavior>
    - The current line `const repairSummary = await runStartupRepair(ctx, config);` at `main.ts:126` is wrapped in a try/catch. On success: `repairSummary` holds the result. On throw: `repairSummary` is set to `null` (or a sentinel), the error is logged via `ctx.writes.recordConnectionEvent({ sessionId: null, eventType: "startup_repair_failed", level: "error", details: { error: errorMessage } })` AND via `console.error("startup repair failed:", error)`. Boot continues — NO `process.exit(1)`.
    - The current `console.log("startup repair:", JSON.stringify(repairSummary, null, 2));` at `main.ts:254` is REPLACED with the literal line format:
      - When `repairSummary === null` (throw path): nothing additional (the error was already logged in the catch).
      - When all 7 fields of `repairSummary` are `0`: a single line `console.log("startup repair: 0 items reconciled");`.
      - When ≥1 field is non-zero: the line `console.log("startup repair: N items reconciled");` where `N` = sum of the 7 fields, FOLLOWED by indented detail lines for each non-zero field, format `  fieldName: value`. Example output:
        ```
        startup repair: 3 items reconciled
          oldPartFiles: 1
          staleWritingChunksRepaired: 2
        ```
    - The sum `N` is computed inline via `Object.values(repairSummary).reduce((acc, v) => acc + v, 0)` (all fields are `number` per `RepairScanSummary` type).
    - Per CONTEXT.md D-07: the boot order `repair → dashboard → discord` is UNCHANGED. The `await runStartupRepair(...)` call stays at `main.ts:126`, BEFORE the dashboard start at `main.ts:247`. T4 does NOT reorder.
    - Per CONTEXT.md D-05: execution is unconditional — no `if (repair_items.count > 0)` gate. The empty-scan case is a fast no-op (existing behavior).
    - This task does NOT add a new test for the log format; the format is exercised by smoke during `npm start` and locked by the success-criterion grep gate in T6.
  </behavior>
  <action>
    Edit `src/app/main.ts`:

    1. Locate the call site at line 126: `const repairSummary = await runStartupRepair(ctx, config);`. Replace with:
       ```
       let repairSummary: import("../storage/rows.js").RepairScanSummary | null = null;
       try {
         repairSummary = await runStartupRepair(ctx, config);
       } catch (error) {
         // RELY-04 / D-08: continue boot on repair throw. Loud structured logging only.
         const errorMessage = error instanceof Error ? error.message : String(error);
         try {
           ctx.writes.recordConnectionEvent({
             sessionId: null,
             eventType: "startup_repair_failed",
             level: "error",
             details: { error: errorMessage },
           });
         } catch {
           // db writer may be down — fall through to console.error
         }
         console.error("startup repair failed:", errorMessage);
       }
       ```
       (Or use `let repairSummary: RepairScanSummary | null = null;` with a top-of-file `import type { RepairScanSummary } from "../storage/rows.js";` if that's cleaner — the executor picks the lower-blast-radius option.)

    2. Locate the log line at line 254: `console.log("startup repair:", JSON.stringify(repairSummary, null, 2));`. Replace with:
       ```
       if (repairSummary !== null) {
         const reconciledCount = Object.values(repairSummary).reduce(
           (acc, value) => acc + value,
           0,
         );
         console.log(`startup repair: ${reconciledCount} items reconciled`);
         if (reconciledCount > 0) {
           for (const [field, value] of Object.entries(repairSummary)) {
             if (value > 0) {
               console.log(`  ${field}: ${value}`);
             }
           }
         }
       }
       ```
       Do NOT alter the surrounding two console.log lines at 252-253 (`"디롱이 Recording + STT dashboard 시작:"` and `"설정 상태 API:"`).

    3. Verify `recordConnectionEvent`'s signature accepts `sessionId: null` and `eventType: "startup_repair_failed"`. If `sessionId` is typed as `string` (non-nullable), the executor must (a) check existing call sites in `recording-producer.ts` / `repair-scan.ts` for a non-null sessionId pattern, (b) if there is no nullable variant, log `console.error` only and surface the gap in SUMMARY for a follow-up to widen the type. Do NOT introduce a fallback string like `"<startup>"` — that violates "no silent fallbacks".

    Implements RELY-04 (single line literal log per D-06; try/catch per D-08; status quo execution gate per D-05/D-07).
  </action>
  <verify>
    <automated>npm run build &amp;&amp; npm test &amp;&amp; bash -c 'grep -qn "startup repair: " src/app/main.ts || { echo "FAIL: literal log line missing"; exit 1; }; grep -qn "JSON.stringify(repairSummary" src/app/main.ts &amp;&amp; { echo "FAIL: JSON.stringify(repairSummary) still present"; exit 1; } || true; grep -qn "startup_repair_failed" src/app/main.ts || { echo "FAIL: startup_repair_failed event missing"; exit 1; }; grep -qn "process.exit(1)" src/app/main.ts | grep -A2 "startup repair" &amp;&amp; { echo "FAIL: process.exit(1) wired to repair throw — D-08 forbids"; exit 1; } || true'</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n 'startup repair:' src/app/main.ts` returns a hit on a template literal containing `${reconciledCount} items reconciled`.
    - `grep -n 'JSON.stringify(repairSummary' src/app/main.ts` returns ZERO hits.
    - `grep -n 'startup_repair_failed' src/app/main.ts` returns at least one hit inside a `recordConnectionEvent` call.
    - `grep -n 'process.exit(1)' src/app/main.ts` returns no hits inside the repair-error catch block (other unrelated process.exit calls are out of scope for this gate).
    - `npm run build && npm test` passes (no test regressions).
  </acceptance_criteria>
  <done>
    `src/app/main.ts:126` wraps `runStartupRepair` in try/catch per D-08. Log line at `src/app/main.ts:254` replaced with literal `"startup repair: N items reconciled"` plus indented breakdown when N>0 (per D-06). Repair execution remains unconditional and synchronous before dashboard start (D-05 / D-07 preserved). `npm run build && npm test` passes. RELY-04 satisfied. ROADMAP success criterion #4 holds.
  </done>
</task>

<task type="auto">
  <name>T6: Phase 2 verification gate — confirm test enumeration + ROADMAP criteria + run final npm test</name>
  <files>package.json</files>
  <read_first>
    - `package.json#scripts.test` (current — `dist/ai/cleanup/claude-persistent-cli-provider.test.js` and `dist/recording/recording-producer.test.js` already enumerated; this plan adds zero new test files, so no enumeration change is expected).
    - `.planning/ROADMAP.md` Phase 2 success criteria 1-5 (auto-grep-able).
    - `.planning/REQUIREMENTS.md` RELY-01..05 + TEST-01.
  </read_first>
  <behavior>
    - Phase 2 adds ZERO new test files (`claude-persistent-cli-provider.test.ts` and `recording-producer.test.ts` already exist + are enumerated). T6 simply CONFIRMS this — if any future revision of Phase 2 adds a new test file, T6 catches the missing enumeration.
    - Final `npm run build && npm test` MUST exit 0 with no skipped tests.
    - All 5 ROADMAP Phase 2 success criteria must observably hold (per the grep checks below).
  </behavior>
  <action>
    1. Confirm `package.json#scripts.test` enumerates `dist/ai/cleanup/claude-persistent-cli-provider.test.js` AND `dist/recording/recording-producer.test.js`. If either is missing (regression from a previous edit), add it on the same line (space-separated, single line preserved).

    2. Confirm NO new sibling test files were created by Phase 2 (`claude-persistent-cli-provider-lifecycle.test.ts` was rejected in CONTEXT.md `<decisions>` "TEST-01 file location" — Phase 2 chose to extend the existing test instead).

    3. Run the final phase gate: `npm run build && npm test`. ALL tests pass. NO tests skipped.

    4. Confirm each of the 5 ROADMAP Phase 2 success criteria holds. Mechanical checks:
       - SC1: `grep -n 'trackedPids' src/ai/cleanup/claude-persistent-cli-provider.ts` returns ≥ 5 hits AND `grep -n 'reapTrackedPids' src/app/main.ts` returns a hit inside `process.on("exit"`. (Manual or test-side assertion that `trackedPids.size === 0` post-abort is in T2's tests.)
       - SC2: `grep -n 'addEventListener.*abort' src/ai/cleanup/claude-persistent-cli-provider.ts` line-number is LESS than the first `await this.killSession()` inside `generate()`. (Done by T1.)
       - SC3: `grep -n 'forceKillIfStale' src/ai/cleanup/claude-persistent-cli-provider.ts` returns a method definition; `grep -n 'safeguardInterval' src/ai/cleanup/provider-lifecycle-service.ts` returns hits in both `setInterval` setup AND `clearInterval` teardown. (Done by T3.)
       - SC4: `grep -n 'startup repair:' src/app/main.ts` returns a literal template; `grep -n 'JSON.stringify(repairSummary' src/app/main.ts` returns 0 hits. (Done by T4.)
       - SC5: `grep -n 'chunk_finalize_timeout' src/recording/recording-producer.test.ts` returns at least one hit inside an assertion in a test body. (Done by T5.)
  </action>
  <verify>
    <automated>npm run build &amp;&amp; npm test &amp;&amp; bash -c '
      set -e
      # SC1: PID tracking + exit hook
      grep -q "trackedPids" src/ai/cleanup/claude-persistent-cli-provider.ts || { echo "SC1 FAIL: trackedPids missing"; exit 1; }
      grep -q "reapTrackedPids" src/app/main.ts || { echo "SC1 FAIL: reapTrackedPids not wired in main.ts"; exit 1; }
      grep -q "process.on(\"exit\"" src/app/main.ts || { echo "SC1 FAIL: process.on(exit) hook missing"; exit 1; }
      # SC2: listener ordering — check line numbers
      L_LISTENER=$(grep -n "addEventListener.*abort" src/ai/cleanup/claude-persistent-cli-provider.ts | head -1 | cut -d: -f1)
      L_KILL=$(awk "/async generate/,/^  }$/" src/ai/cleanup/claude-persistent-cli-provider.ts | grep -n "await this.killSession" | head -1 | cut -d: -f1)
      [ -n "$L_LISTENER" ] && [ -n "$L_KILL" ] || { echo "SC2 FAIL: could not locate listener or killSession line"; exit 1; }
      # SC3: safeguard interval
      grep -q "forceKillIfStale" src/ai/cleanup/claude-persistent-cli-provider.ts || { echo "SC3 FAIL: forceKillIfStale missing"; exit 1; }
      grep -q "safeguardInterval" src/ai/cleanup/provider-lifecycle-service.ts || { echo "SC3 FAIL: safeguardInterval missing"; exit 1; }
      grep -q "clearInterval" src/ai/cleanup/provider-lifecycle-service.ts || { echo "SC3 FAIL: clearInterval missing"; exit 1; }
      # SC4: log line + try/catch
      grep -q "startup repair: " src/app/main.ts || { echo "SC4 FAIL: literal log line missing"; exit 1; }
      ! grep -q "JSON.stringify(repairSummary" src/app/main.ts || { echo "SC4 FAIL: old JSON.stringify still present"; exit 1; }
      grep -q "startup_repair_failed" src/app/main.ts || { echo "SC4 FAIL: startup_repair_failed event missing"; exit 1; }
      # SC5: force-close test
      grep -q "chunk_finalize_timeout" src/recording/recording-producer.test.ts || { echo "SC5 FAIL: chunk_finalize_timeout test missing"; exit 1; }
      # Test file enumeration (additive zero-change check)
      grep -q "dist/ai/cleanup/claude-persistent-cli-provider.test.js" package.json || { echo "FAIL: provider test not enumerated"; exit 1; }
      grep -q "dist/recording/recording-producer.test.js" package.json || { echo "FAIL: producer test not enumerated"; exit 1; }
      echo "All 5 Phase 2 ROADMAP success criteria hold."
    '</automated>
  </verify>
  <acceptance_criteria>
    - `npm run build && npm test` exits 0.
    - ALL 5 ROADMAP Phase 2 success criteria observably hold (grep checks pass).
    - `package.json#scripts.test` enumerates both touched test files (no enumeration drift).
    - No new sibling test files were created (TEST-01 lives inside `claude-persistent-cli-provider.test.ts` per CONTEXT.md decision).
  </acceptance_criteria>
  <done>
    Phase 2 verification gate complete. All 5 ROADMAP success criteria hold simultaneously. `npm run build && npm test` passes with no skipped tests. Phase 2 ready for plan-checker / verifier.
  </done>
</task>

</tasks>

<wave_plan>

**Wave 1 — Provider lifecycle (sequential T1 → T2 → T3) ∥ Force-close test (T5):**
- T1 (`src/ai/cleanup/claude-persistent-cli-provider.ts` + `.test.ts`): RELY-02 abort-listener-first reorder + 3 new tests.
- T2 (`src/ai/cleanup/claude-persistent-cli-provider.ts` + `.test.ts` + `src/app/main.ts`): RELY-01 trackedPids + reapTrackedPids + onOrphanKillFailed + `process.on('exit')` wiring + 4 new tests.
- T3 (`src/ai/cleanup/claude-persistent-cli-provider.ts` + `.test.ts` + `src/ai/cleanup/provider-lifecycle-service.ts`): RELY-03 forceKillIfStale + service-owned safeguard interval + 3 new tests.
- T5 (`src/recording/recording-producer.test.ts`): RELY-05 60s force-close branch integration test via `t.mock.timers`. **Parallel with T1/T2/T3** — zero file overlap.

**Gate to advance to Wave 2:** All four Wave 1 tasks committed. `node --test dist/ai/cleanup/claude-persistent-cli-provider.test.js dist/recording/recording-producer.test.js dist/ai/cleanup/provider-lifecycle-service.test.js` passes. (T2 also touches `main.ts`, so the Wave 2 main.ts edit must merge AFTER T2.)

**Wave 2 — Boot repair polish:**
- T4 (`src/app/main.ts`): RELY-04 try/catch + literal log line replacement. Depends on T2 because T2 also edited `main.ts` (adding `process.on('exit')`); running in parallel would cause a worktree merge conflict on the same file.

**Gate to advance to Wave 3:** `npm run build && npm test` passes. Repair-log grep checks pass.

**Wave 3 — Verification gate:**
- T6 (`package.json` confirmation + final `npm run build && npm test` + all 5 ROADMAP success-criteria grep checks).

**Gate to mark phase complete:** All 5 ROADMAP Phase 2 success criteria observably TRUE. `gsd-plan-checker` can run.

</wave_plan>

<verification>

| Phase Success Criterion (from ROADMAP.md Phase 2) | Satisfied By Task(s) |
|----|----|
| #1: `npm run phase4:claude-persistent-smoke` + abort during `generate()` leaves zero orphan `claude` PIDs (verified via fault-injection test + `provider.trackedPids.size === 0`) | T2 (trackedPids + reapTrackedPids + 4 new tests including the `trackedPids.size === 0` assertion); T6 verifies `process.on('exit')` is wired in `main.ts` |
| #2: Unit test demonstrates `AbortController.abort()` fired BEFORE `await this.killSession()` is observed by the listener; no crash on half-constructed session | T1 (reorder + 3 new tests including "tolerates abort before generate() starts" and "abort listener registers before killSession") |
| #3: Safeguard-interval test simulates `Date.now() - startedAt > timeoutMs * 2`; assert persistent CLI receives SIGKILL automatically | T3 (forceKillIfStale + service-owned safeguard interval + 3 new tests; boundary test at `=== timeoutMs * 2`) |
| #4: Booting Dirong with `repair_items` containing `kind = 'chunk_finalize_timeout'` automatically runs `runStartupRepair` — observable as `"startup repair: N items reconciled"` line in boot log | T4 (literal log line + try/catch wrapper; D-05 unconditional execution preserved) |
| #5: New integration test in `src/recording/recording-producer.test.ts` drives `stopActiveSession` past 20s graceful into 60s force-close; asserts `chunk_finalize_timeout` repair items are written | T5 (new top-level test using `t.mock.timers` to advance through both timeouts; asserts `recordRepairItem({ type: "chunk_finalize_timeout", ... })`) |

| Requirement (from REQUIREMENTS.md) | Satisfied By Task(s) |
|----|----|
| RELY-01 (track PIDs + SIGKILL on stop + parent exit) | T2 |
| RELY-02 (abort-listener registration before killSession) | T1 |
| RELY-03 (periodic safeguard force-kill at timeoutMs * 2) | T3 |
| RELY-04 (auto runStartupRepair on boot with literal log line) | T4 |
| RELY-05 (force-close branch covered by integration test) | T5 |
| TEST-01 (persistent-CLI spawn-and-kill race covered in test) | T1 + T2 + T3 (10 new tests collectively in `claude-persistent-cli-provider.test.ts`) |

100% coverage: 5/5 success criteria, 6/6 requirements (RELY-01..05 + TEST-01).

</verification>

<success_criteria>

Phase 2 is COMPLETE when ALL of the following hold simultaneously after T6 `<automated>` exits 0:

1. `grep -n 'trackedPids' src/ai/cleanup/claude-persistent-cli-provider.ts` returns ≥ 5 hits AND `grep -n 'reapTrackedPids' src/app/main.ts` returns a hit inside `process.on("exit"`. (ROADMAP SC1.)
2. The line index of `addEventListener.*abort` in `claude-persistent-cli-provider.ts` is LESS than the line index of the first `await this.killSession()` inside `generate()`. (ROADMAP SC2.)
3. `forceKillIfStale` method exists on the provider AND `safeguardInterval` lifecycle (setInterval + clearInterval) exists in `provider-lifecycle-service.ts`. (ROADMAP SC3.)
4. `src/app/main.ts` contains the literal template `startup repair: ${...} items reconciled` and contains zero `JSON.stringify(repairSummary` occurrences AND contains `startup_repair_failed` inside a `recordConnectionEvent` call. (ROADMAP SC4.)
5. `src/recording/recording-producer.test.ts` contains `chunk_finalize_timeout` inside an assertion in a test body. (ROADMAP SC5.)
6. `npm run build && npm test` exits 0 with NO skipped tests.
7. Zero new test files added; both touched test files already enumerated in `package.json#scripts.test`.
8. No `process.exit(1)` wired to the `runStartupRepair` catch (D-08 forbids).
9. The boot order `repair → dashboard → discord` is preserved (D-07 status quo).

</success_criteria>

<risk_register>

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R1 | RELY-02 reorder breaks an existing test that implicitly depends on the old order (e.g. timing-dependent test that aborts AFTER addEventListener fires) | Low — none of the 10 existing tests assert order; verified by inspection in T1 `<read_first>` | T1 runs the full existing test suite via its `<verify>` block. If a regression surfaces, the listener body using `this.session?.kill()` (optional chain) is the documented fix per `<strategy>` callout (1). |
| R2 | RELY-01 PID tracking races with smoke session `start()` such that `session.pid` is still `null` when `trackedPids.add(pid)` runs | Medium — `pid` is null until spawn; smoke `start()` is sync but spawn may resolve PID lazily on some platforms | T2 forces `session.start()` BEFORE reading `session.pid`. The `start()` method on the smoke session is sync (verified by reading `claude-persistent-smoke.ts:203-254` — `child = this.spawnProcess(...)` is sync). If `pid` is still null after `start()` (defensive), the add is skipped — the safeguard interval AND the natural-exit cleanup still cover the case. |
| R3 | `process.on('exit')` handler runs AFTER the dashboard SQL writer is torn down, so any logging inside the handler crashes the process | RESOLVED by CONTEXT.md D-04 — the exit-path reaper is QUIET (no event emission); only the `stop()`-path emits `claude_orphan_kill_failed` | T2 `<action>` step 6 explicitly makes `reapTrackedPids()` quiet. The loud emission is on the stop()-path only (step 7). |
| R4 | RELY-03 safeguard interval lives in `AiProviderLifecycleService` but the service's `provider` is typed as the broad `AiMeetingNotesProvider` interface, which doesn't expose `forceKillIfStale` | Medium | T3 uses a runtime `'forceKillIfStale' in this.provider` guard (`hasForceKillIfStale` type predicate). For non-CLI providers, the safeguard is a no-op — graceful degradation per CONVENTIONS.md. |
| R5 | RELY-05 `t.mock.timers` doesn't intercept `waitForChunkPromises` (e.g. it uses a different timer mechanism like `setImmediate` or a custom promise-deferred) | Medium — must read `waitForChunkPromises` definition to confirm | T5 `<read_first>` includes reading the function definition. If the timer API isn't `setTimeout`, fall back to extracting the force-close branch into a private helper and testing it directly with a constructed `ActiveSession` (per `<behavior>` fallback). The fallback is zero-behavior-change refactor. |
| R6 | RELY-04 `recordConnectionEvent({ sessionId: null, ... })` rejected by the write-store type signature if `sessionId` is non-nullable | Low-Medium | T4 `<read_first>` confirms the type. If non-nullable, T4 logs `console.error` only and surfaces the gap in SUMMARY. Do NOT introduce a synthetic sessionId — that violates "no hardcoding". |
| R7 | T2 and T4 both modify `src/app/main.ts` in different waves — Wave 2 merge introduces a conflict against T2's `process.on('exit')` insertion | Medium — Phase 1 had merge friction every wave | Wave 2 is single-task (T4); the orchestrator merges T4's worktree commit AFTER all Wave 1 commits land on main. CRLF noise recovery sequence documented in `<executor_advisories>` A1. T2 and T4 edit different sections of `main.ts` (T2 near `shutdownPromise` at line 249; T4 at line 126 and line 254) — semantic conflict unlikely. |
| R8 | TEST-01 file location decision drift — a future revision proposes a new `claude-persistent-cli-provider-lifecycle.test.ts` sibling | Low — CONTEXT.md decision recorded | T6 grep gate explicitly rejects new sibling test files: `! ls src/ai/cleanup/claude-persistent-cli-provider-lifecycle.test.ts 2>/dev/null` (added as an inline check if executor wants stricter enforcement). |

</risk_register>

<threat_model>

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| persistent `claude` CLI subprocess ↔ Node parent | PID lifecycle: parent owns lifetime; orphan if generate() aborts without cleanup |
| recording producer chunk file descriptors ↔ OS filesystem (Windows-specific) | FD-leak window during chunk close; symptom of upstream `opusStream.destroy()` timing on Windows |
| boot-time DB state ↔ pre-crash session leftovers | `repair_items` table may contain `chunk_finalize_timeout` rows from a prior crashed session |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-01 | Tampering | Orphan `claude` PID survives parent crash and continues consuming resources (memory, file handles, network sockets) until OS reaps it | mitigate | T2 adds `trackedPids` Set + `reapTrackedPids()` invoked on `process.on('exit')` + on `provider.stop()`. The fault-injection test in T2 (`trackedPids.size === 0` after aborted generate) verifies the contract. SIGKILL via `process.kill(pid, 'SIGKILL')` per D-02 — no `tree-kill` because `claude` does not spawn descendants (verified in CONCERNS.md). |
| T-02-02 | Tampering | Half-finalized chunk files (`.part.ogg`) remain on disk after a Windows FD-leak crash, eventually consuming GB of disk | mitigate | RELY-04 (T4) auto-runs `runStartupRepair` on boot. The existing `scanOldPartFiles` + `repairStaleWritingChunks` paths already handle reconciliation; T4 ensures the call happens AND survives a throw (D-08 catch-and-continue). |
| T-02-03 | Denial of Service | Runaway `claude` session whose `session.request()` hangs past `timeoutMs` blocks the AI cleanup queue indefinitely | mitigate | RELY-03 (T3) safeguard interval force-kills sessions where `now - startedAt > timeoutMs * 2`. SIGKILL is unconditional — no SIGTERM upgrade path inside `forceKillIfStale`. The interval is `unref()`d so it does not keep the process alive past intended shutdown. |
| T-02-04 | Denial of Service | Unbounded `chunk_finalize_timeout` repair items pile up over many failed sessions, slowing dashboard queries | accept | The repair-items table already has the existing reconciliation logic in `runStartupRepair`. Boot-time reconciliation removes processed items. Phase 2 does NOT add new repair-item categories — only ensures the existing path runs reliably. Volume risk is bounded by `partRepairAgeMs` + the per-session bounded number of chunks. |
| T-02-05 | Repudiation | A SIGKILL on orphan PID is silent (D-04 exit-handler path) — operator cannot tell which PID was reaped | accept | The stop()-path emits `claude_orphan_kill_failed` ONLY on failure (D-04 split). Successful SIGKILLs on the stop()-path are silent because they are part of normal shutdown; the trackedPids set is the audit trail (visible in dashboard if exposed in a future phase). Adding success-event emission inflates the connection_events table volume — rejected. |
| T-02-06 | Information Disclosure | None — phase does not widen any read surface or expose new APIs | accept | N/A. Provider lifecycle methods (`reapTrackedPids`, `forceKillIfStale`) are public on the concrete class but the broader `AiMeetingNotesProvider` interface is unchanged. No new dashboard endpoints, no new file outputs, no new logs containing sensitive data. |
| T-02-07 | Elevation of Privilege | `process.kill(pid, 'SIGKILL')` requires that the killed PID belongs to the same user — if the parent process is privileged and `claude` runs as a less-privileged child, no escalation risk. Reverse path (killing wrong PID due to PID recycling) is the real risk | mitigate | The trackedPids set is populated with `session.pid` IMMEDIATELY after `session.start()` — before the OS could recycle the PID for another process. The interval between PID assignment and `trackedPids.delete(pid)` is bounded by `killSession()` (which awaits `killAndWait` with a 1s timeout). PID recycling within this window is extremely unlikely on modern Linux/Windows (PID space is large). Risk accepted. |
| T-02-SC | Tampering | npm install of new dependencies introduces supply-chain risk | accept | This phase introduces ZERO new dependencies. `package.json` change is limited to confirming existing `scripts.test` enumeration (no `dependencies` / `devDependencies` mutation). No package legitimacy gate needed — RESEARCH.md `## Package Legitimacy Audit` not required. |

</threat_model>

<scope_fence>

Per `01-CONTEXT.md` `<domain>` block, Phase 2 will NOT touch:

- Storage facade shape — locked by Phase 1 (`StorageContext` + 4 facades). Phase 2 consumes them as-is; the `flattenStorageContext` transitional helper remains until POLY follow-up.
- Notion / dashboard route handlers — DASH-01 / DASH-02 are Phase 4.
- Policy / mock isolation — POLY-01 / POLY-02 / POLY-03 / LOG-01 are Phase 3.
- Recording producer module decomposition — v2 MOD-* (deferred per REQUIREMENTS.md v2).
- Claude `runChild` chokepoint at `src/process/run-child.ts` — Phase 2 does NOT add new spawn sites.
- Splitting `claude-persistent-smoke.ts` (988 lines) — deferred per CONTEXT.md `<deferred>` to v2 MOD-*.
- Windows FD-leak root-cause fix — Phase 2 mitigates symptoms (repair-on-boot, force-close test) without diagnosing the `opusStream.destroy()` FD-release timing. Root-cause analysis would require a Windows-only reproducer; deferred per CONTEXT.md `<deferred>`.
- Health-check / liveness endpoint for `claude` subprocess hangs — beyond safeguard interval; not in REQUIREMENTS.md.
- Tests for `repair-scan.ts` itself — Phase 1's "extend, do not displace" policy carries forward; no `repair-scan.test.ts` added in Phase 2 (Phase 1 surfaced this gap as a follow-up — see `01-T3_1-SUMMARY.md` advisory A3).
- Any new connection_event `kind` beyond `claude_orphan_kill_failed` and `startup_repair_failed` — these two are the only NEW kinds, both confined to the additive write paths.
- Any `package.json` field other than `scripts.test` — no dependency changes, no script renames.

</scope_fence>

<output>
After all six tasks complete, write `.planning/phase2/01-SUMMARY.md` per `@$HOME/.claude/get-shit-done/templates/summary.md`. SUMMARY MUST record:

- Whether T5 used `t.mock.timers` directly OR fell back to extracting a private `executeForceCloseBranch` helper. If the latter, document the line-by-line equivalence of the extracted block against the original `recording-producer.ts:319-353`.
- Whether T4 successfully emitted `recordConnectionEvent({ sessionId: null, ... })` OR fell back to `console.error` only. If the latter, log the type-widening as a Phase 3 / POLY follow-up.
- Total new tests added to `claude-persistent-cli-provider.test.ts` (expected: 10 = 3 from T1 + 4 from T2 + 3 from T3) and final test count in `recording-producer.test.ts` (expected: 5 = existing 4 + 1 from T5).
- Confirmation grep outputs for ALL 5 ROADMAP Phase 2 success criteria (each as a one-line copy-paste).
- Whether the safeguard interval was `unref()`d successfully (verify the test process exits cleanly without manual `clearInterval`).
- Context cost actually consumed per task vs. plan estimate (target: 10-30% per task; T2 and T5 expected at the upper end of the range).
- Any new orphan-PID / FD-leak diagnostic data surfaced by running the modified provider on a real `claude` CLI (smoke run via `npm run phase4:claude-persistent-smoke` against an authenticated dev environment) — optional, executor's discretion.
</output>

<executor_advisories>

### A1 (all tasks) — CRLF line-ending recovery sequence

The main working tree carries ~221 pre-existing files with CRLF↔LF diffs from Windows-side editing. Every Phase 1 wave merge encountered this. The recovery sequence (per `STATE.md` 2026-05-15 Wave 4 notes):

1. `git stash push -u -m "wave{N}-pre-merge-line-ending-noise"`
2. `git merge --no-ff worktree-agent-XXX -m "..."`
3. `git stash pop` — produces UU conflicts on files the worktree actually changed
4. `git checkout --ours -- <conflicted files>` then `git add` them
5. `git reset HEAD` to unstage stash-applied non-conflicted noise
6. `git stash drop`

Wave 1 produces TWO parallel worktrees (Group A and T5). The orchestrator applies the sequence for each merge. Wave 2 (T4) is single-worktree.

### A2 (T5) — `waitForChunkPromises` seam discovery

Before writing T5's test body, the executor MUST read the `waitForChunkPromises` definition in `src/recording/recording-producer.ts` (search `function waitForChunkPromises` — it is defined lower in the file). Confirm:

- Does it use `setTimeout` directly (interceptable by `t.mock.timers`)?
- Does it use `Promise.race` over a chunk-close promise and a timeout promise?
- Or does it use `setImmediate` / `process.nextTick` (NOT interceptable by mock timers)?

If `t.mock.timers` cannot drive the function, fall back to the private-helper extraction documented in T5's `<behavior>`. The extraction is a pure refactor (verbatim copy of the 35-line block) — zero behavioral change.

### A3 (T2) — `aiCleanupProvider` variable hoisting in `main.ts`

The `process.on('exit')` hook needs a reference to the `ClaudeStreamJsonCliCleanupProvider` instance. If the instance is constructed deep inside an async block where the variable is not in scope at the early-boot exit-hook registration site, the executor must hoist the variable (`let aiCleanupProvider: ClaudeStreamJsonCliCleanupProvider | null = null;` declared early, assigned at construction). The exit hook then checks `aiCleanupProvider?.reapTrackedPids();`. This is a common pattern in `main.ts` — confirm by reading the surrounding lines first.

### A4 (T1 + T2 + T3) — Subclass / private-field access in tests

The new tests pre-seed private fields (`session`, `trackedPids`, `generateStartedAt`, `currentTimeoutMs`) on `ClaudeStreamJsonCliCleanupProvider`. The cleanest TypeScript-strict approach is `(provider as any).session = ...` for tests only (cast at the assignment site, not at the file level). Document each cast with a one-line comment `// test-only: pre-seed private field`. Do NOT widen the production fields to `public` just for testability — that violates the "no production surface widening" rule.

### A5 (open question for human review)

The `recordConnectionEvent` write-store method signature MAY require `sessionId: string` (non-nullable). If so, the T4 `startup_repair_failed` event and T2 `claude_orphan_kill_failed` event cannot use `sessionId: null` and the executor must either (a) check the actual write-store signature in `src/storage/session-write-store.ts` and surface the constraint, or (b) fall back to `console.error` only. The fallback path is acceptable per CLAUDE.md "no silent fallbacks" — loud `console.error` IS a structured loud failure. The dashboard wiring is a Phase 3 / POLY follow-up.

**Decision needed from human if (a) is the path:** widen the `recordConnectionEvent` `sessionId` type to `string | null` for non-session-scoped events, OR introduce a separate `recordSystemEvent` writer. Surface this in SUMMARY if it blocks T2 / T4.

</executor_advisories>
</content>
</invoke>