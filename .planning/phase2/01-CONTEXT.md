# Phase 2: Persistent CLI & Recording Reliability — Context

**Gathered:** 2026-05-15
**Status:** Ready for planning
**Source:** Synthesized from `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md` (RELY-01..05 + TEST-01), `.planning/ROADMAP.md` Phase 2 block, `.planning/codebase/CONCERNS.md` ("Persistent Claude CLI lifecycle" + "Recording producer chunk-finalize timeout cascade"), `.planning/phase1/01-CONTEXT.md` (carry-forward decisions), and direct reads of `src/ai/cleanup/claude-persistent-cli-provider.ts`, `src/recording/recording-producer.ts:296-356`, `src/storage/repair-scan.ts`, `src/app/main.ts:126,254`.

<domain>
## Phase Boundary

Phase 2 hardens the recording → AI cleanup pipeline against three failure shapes:
1. **Orphan `claude` subprocesses** when `generate()` is aborted, times out, or the parent crashes (RELY-01/02/03 + TEST-01).
2. **Windows FD-leak crash recovery** — a previous session leaving `chunk_finalize_timeout` repair items must auto-reconcile on next boot without operator action (RELY-04).
3. **Untested force-close path** — the 60-second forced chunk-close branch at `recording-producer.ts:319-356` is currently uncovered (RELY-05).

This phase does NOT touch: storage facade shape (locked by Phase 1), Notion / dashboard route handlers (DASH-01/02 → Phase 4), policy / mock isolation (POLY-01/02/03 → Phase 3), or recording producer module decomposition (v2 MOD-*). No new user-facing UI/CLI capability.

</domain>

<decisions>
## Implementation Decisions

### Orphan-PID cleanup scope (RELY-01)

- **D-01 — Kill triggers:** `provider.stop()` + `process.on('exit')`. SIGINT/SIGTERM transitively trigger `process.exit`, so explicit signal handlers are NOT registered (avoids ordering conflicts with `discord.js` listeners that may already exist on the same signals).
- **D-02 — Kill API:** `process.kill(pid, 'SIGKILL')` (Node stdlib). No `tree-kill`, no Windows-specific `taskkill /F /T`. Rationale: `claude` CLI does not itself spawn descendants, so single-process kill suffices. Zero external dependencies (POLY-aligned).
- **D-03 — PID storage:** `private readonly trackedPids = new Set<number>()` field on `ClaudeStreamJsonCliCleanupProvider`. Single provider instance is constructed by `provider-lifecycle-service`; encapsulation is natural; test isolation is straightforward (one fixture per test).
- **D-04 — SIGKILL failure handling:** Quiet (catch-and-suppress) on the `process.on('exit')` path — that handler is sync-only and terminal, and the dashboard SQL writers may already be torn down. On the `stop()`-path, emit `recordConnectionEvent({ kind: 'claude_orphan_kill_failed', pid, errno })` so the operator sees a non-zero counter in the dashboard. **Reject** blanket-swallow per CLAUDE.md "no silent fallbacks".

### Boot repair behavior (RELY-04)

- **D-05 — Execution gate:** Unconditional (status quo at `src/app/main.ts:126`). An empty scan is a 1-2 ms NOP and adding a count-query branch saves negligible time while adding a code path. Idempotency-first principle wins.
- **D-06 — Log format:** Single line `"startup repair: N items reconciled"` (matches the ROADMAP success-criterion text literally). When `N > 0`, the line is followed by an indented breakdown (`  oldPartFiles: …`, `  staleWritingChunksRepaired: …`, etc.). When `N == 0` the bare line `"startup repair: 0 items"` is sufficient. Replaces the current `JSON.stringify(repairSummary, null, 2)` blob at `main.ts:254`.
- **D-07 — Execution order:** Synchronous, blocking boot: `runStartupRepair` → start dashboard → Discord login (current order at `main.ts`). Repair must complete before the dashboard accepts connections so dashboard reads observe a consistent post-repair DB state.
- **D-08 — Failure handling:** Repair throw → log error + `recordConnectionEvent({ kind: 'startup_repair_failed', error })` → continue boot. Do NOT `process.exit(1)`. Rationale: `runStartupRepair` is a補 (補助 — boosting wheel) for partial-recovery scenarios; the recording / STT / AI cleanup pipelines work fine on a clean DB. Killing boot on a repair throw would prevent the operator from seeing the dashboard banner that explains the failure.

### Claude's Discretion (researcher / planner decides)

- **RELY-02 abort-listener ordering:** success-criterion text locks the contract ("listener registration precedes any `killSession` call"). Planner implements the exact line reordering inside `generate()` (current order at `claude-persistent-cli-provider.ts:106-119` is `killSession → spawn → addListener`; target order is `addListener → killSession → spawn`).
- **RELY-03 safeguard interval:** frequency, ownership (provider field vs service field), and start/stop wiring are open. Recommended default: `setInterval(check, Math.max(5_000, timeoutMs / 4))` — checks every `timeoutMs/4` (or 5s minimum) and force-kills any session whose `Date.now() - startedAt > timeoutMs * 2`. Researcher confirms idiomatic Node pattern.
- **RELY-05 force-close test:** fault-injection mechanism (fake `AudioReceiveStream` whose `destroy()` is a no-op vs lower-level FS stub) and file location (extend `recording-producer.test.ts` vs new sibling). Planner picks the smaller diff.
- **TEST-01 file location:** extend existing `claude-persistent-smoke.test.ts` vs new `claude-persistent-cli-provider-lifecycle.test.ts`. Researcher checks if `smoke.test.ts` is already at its file-size limit per `CONVENTIONS.md`.
- **Wave / plan split:** suggested grouping is Wave 1 = provider lifecycle (RELY-01/02/03 + TEST-01, all in `claude-persistent-cli-provider.ts` + its test), Wave 2 = boot repair polish (RELY-04, just `main.ts` + a tiny log helper), Wave 3 = force-close test (RELY-05, just `recording-producer.test.ts`). Independent file sets — Wave 1 and Wave 3 can run in parallel. Planner finalizes after dependency analysis.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project / phase context
- `.planning/PROJECT.md` — local-first constraint, no silent fallbacks, no production mocks, structured logging via `recordConnectionEvent`.
- `.planning/REQUIREMENTS.md` §"Reliability — Subprocess & File-Descriptor Lifecycle (RELY)" — verbatim text for RELY-01..05 + TEST-01.
- `.planning/ROADMAP.md` Phase 2 block — 5 success criteria (auto-grep-able for the RELY-01..05 surface).
- `.planning/STATE.md` — Phase 1 carry-forward facts (`StorageContext` exists, `runStartupRepair(ctx, config)` already wired, transitional `flattenStorageContext` helper still in place pending POLY).

### Phase 1 carry-forward (locked, do not re-decide)
- `.planning/phase1/01-CONTEXT.md` — storage facade composition root; `repair-scan.ts` already accepts `StorageContext`.
- `.planning/phase1/01-PLAN.md` §"Strategy" — wave pattern, atomic-commit per task, "extend, do not displace" tests.
- `src/storage/storage-context.ts` — `StorageContext` type definition + facades.

### Codebase map (CONCERNS source signals)
- `.planning/codebase/CONCERNS.md` §"Fragility — Persistent Claude CLI lifecycle" — RELY-01/02/03 source text + the orphan-PID failure mode description.
- `.planning/codebase/CONCERNS.md` §"Fragility — Recording producer chunk-finalize timeout cascade" — RELY-04 / RELY-05 source.
- `.planning/codebase/CONCERNS.md` §"Test Coverage Gaps" — explicitly flags `claude-persistent-smoke.ts` race conditions + `recording-producer.ts:319-380` force-close branch as uncovered.
- `.planning/codebase/CONVENTIONS.md` — TypeScript strict + `noUncheckedIndexedAccess`; co-located tests; `.js` extension in imports; named exports; structured logging via `recordConnectionEvent`.
- `.planning/codebase/TESTING.md` — `node --test` runner; every new `*.test.ts` MUST be enumerated in `package.json#scripts.test` (or CI silently skips it).

### Production source (Phase 2 working set)
- `src/ai/cleanup/claude-persistent-cli-provider.ts:27,52,60,95-178` — `spawnProcess?` injection seam (line 27 / 52), abort-listener race surface (lines 102-119), `killSession()` (line 178), abort handlers around `generate()`.
- `src/ai/cleanup/claude-persistent-smoke.ts:218,935` — `spawn` site + `ClaudePersistentSmokeSpawn` type.
- `src/ai/cleanup/provider-lifecycle-service.ts` — provider instance owner; safeguard interval cleanup hook target.
- `src/recording/recording-producer.ts:290-356` — `stopActiveSession`, 20s graceful + 60s force-close branch, `chunk_finalize_timeout` repair-item write.
- `src/storage/repair-scan.ts:8-32,29` — `runStartupRepair` signature + 7-field `RepairScanSummary` shape; the read/write methods it calls via `ctx.writes` / `ctx.reads` / `ctx.jobs` / `ctx.runtime`.
- `src/app/main.ts:84,126,254` — current `import`, call site, and `console.log` for repair summary.

### Tests (extend, do not displace)
- `src/ai/cleanup/claude-persistent-smoke.test.ts` — existing smoke test surface; TEST-01 may extend here.
- `src/recording/recording-producer.test.ts` — happy-path force-close coverage; RELY-05 extends here.

### Process / conventions
- `~/.claude/CLAUDE.md` — "no silent fallbacks", "no hardcoding", "structured logging via recordConnectionEvent", "spawn() goes through src/process/run-child.ts" (informs D-02 / D-04 / D-08).
- `src/process/run-child.ts` — canonical spawn chokepoint (`shell: false`, `windowsHide: true`). Phase 2 does NOT add new spawn sites; it adds a lifecycle layer around the existing `ClaudePersistentSmokeSpawn` injection point.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`ClaudePersistentSmokeSpawn` injection seam** (`claude-persistent-cli-provider.ts:27,60`): already an optional constructor parameter — TEST-01 plugs in a fake spawn here without touching real `claude` binary or `src/process/run-child.ts`.
- **`StorageContext` + `ctx.runtime` / `ctx.writes` / `ctx.reads` / `ctx.jobs`**: Phase 1 facades already cover every read/write `runStartupRepair` needs (lines 22-29 of `repair-scan.ts`). No new storage seam required.
- **`recordConnectionEvent(...)` writer**: existing dashboard event sink; Phase 2 emits two new event kinds (`claude_orphan_kill_failed`, `startup_repair_failed`).
- **`RepairScanSummary` type** (`src/storage/rows.ts`): existing 7-field shape; D-06's log helper consumes it directly without reshaping.

### Established Patterns
- **Atomic commit per task + worktree isolation** (proven by Phase 1 Waves 2/3/4): each wave produces ONE worktree commit, merged back to main with `--no-ff`. Pre-existing CRLF line-ending noise (~221 files) requires stash-and-pop around the merge — `--ours` resolves stash-pop conflicts in favor of merge HEAD.
- **`tsc -p tsconfig.json && node --test dist/...`** is the canonical verification command. New test files MUST be enumerated in `package.json#scripts.test` in the SAME wave that creates them (Phase 1 T4.1 pattern: enumerate AFTER all facade test files exist, single line, space-separated).
- **"Extend, do not displace" test policy** (Phase 1 CONTEXT.md Lock): new test cases appended as new top-level `test(...)` blocks; existing tests are NOT refactored in a single phase. TEST-01 follows this.

### Integration Points
- **`src/app/main.ts:126` → `runStartupRepair(ctx, config)`** — already wired; Phase 2 only changes the LOG side (line 254) and possibly adds an error-catch around the call.
- **`provider-lifecycle-service.ts` → `ClaudeStreamJsonCliCleanupProvider`** — service constructs the provider; D-04 + RELY-03 safeguard hook live on the provider itself, but the service is the cleanup-on-exit owner.
- **`process.on('exit', …)`** — single global registration in `src/app/main.ts` (or wherever the lifecycle service is composed). The handler iterates `provider.trackedPids` (per D-03) and calls `process.kill(pid, 'SIGKILL')`.

</code_context>

<specifics>
## Specific Ideas

- **Log line literal:** `"startup repair: N items reconciled"` (verbatim from ROADMAP success-criterion text). When `N == 0`, no indented detail follows — operators learn quickly that "0 items" is the clean-boot signature.
- **Dashboard event kinds:** `claude_orphan_kill_failed` (RELY-01 failure path), `startup_repair_failed` (RELY-04 failure path). Both consume the existing `recordConnectionEvent` writer; no schema migration needed because `connection_events.kind` is a free-text column (verified from Phase 1 storage decomposition).
- **TEST-01 assertion target:** `provider.trackedPids.size === 0` after `provider.stop()` AND a synthetic abort during `generate()`. Avoid `ps -ef | grep claude` shell-out — the existing fake-spawn seam returns a synthetic PID number, so the assertion is fully in-memory and deterministic.
- **RELY-05 force-close fault injection:** the cleanest seam is a fake `AudioReceiveStream` whose `destroy()` is a no-op so the 60s `waitForChunkPromises` resolves to `forcedClose = false` deterministically. `recording-producer.ts:332-335` is the exact target.
- **CRLF noise carry-forward:** Phase 1 Wave 3/4 merge friction (line-ending noise in user's working tree) recurs every wave. Orchestrator playbook: stash → merge → stash-pop with `git checkout --ours` on conflicted files → drop stash. Document this once at Phase 2 plan time so executors don't reinvent the recovery sequence.

</specifics>

<deferred>
## Deferred Ideas

- **Split `claude-persistent-smoke.ts` (988 lines)** — `CONCERNS.md` flags it; deferred to v2 MOD-* (`REQUIREMENTS.md` v2 scope). Phase 2 only ADDS to the file (or its sibling test); it does not split the production module.
- **ESLint `no-restricted-imports` rule for `__dev__/`** — that's POLY-03 (Phase 3), not Phase 2.
- **Replacing `runChild()` with a higher-level spawn manager** — out of scope; the existing chokepoint at `src/process/run-child.ts` already enforces `shell: false`.
- **Recording producer FD-leak root-cause fix on Windows** — Phase 2 mitigates symptoms (repair-on-boot, force-close test) without diagnosing the Windows-specific `opusStream.destroy()` FD-release timing. Root cause would require a Windows-only reproducer and likely belongs in v2 hardening.
- **Health-check / liveness endpoint for `claude` subprocess hangs** — beyond the safeguard interval. Not requested; not in REQUIREMENTS.md. Logged here so it doesn't get re-discovered.

</deferred>

---

*Phase: 02-persistent-cli-recording-reliability*
*Context gathered: 2026-05-15 (discuss-phase, 2 areas deep-dived: Cleanup scope + Boot repair condition; 4 questions each, 8 decisions captured)*
