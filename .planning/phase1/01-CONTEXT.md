# Phase 1: Storage Foundation — Context

**Gathered:** 2026-05-15
**Status:** Ready for planning
**Source:** Synthesized from `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/codebase/CONCERNS.md`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`, and direct read of `src/storage/session-store.ts:1-60`, `src/storage/sql-runner.ts`, `src/storage/migrations.ts:1-30` (no `discuss-phase` artifact existed; `/gsd:plan-phase` was invoked directly after `/gsd:new-project`).

<domain>
## Phase Boundary

Phase 1 is the **storage layer hardening** phase of the Stability & Hardening v0.1 milestone. Three things must change in this phase, and nothing else:

1. **Decompose `SessionStore`** (`src/storage/session-store.ts`, 879 lines, 136 graph edges) from a single god-node aggregate into role-scoped facades that share `SqlRunner`. The split is structural, not semantic — existing repository modules (`ChunkRepository`, `SessionRepository`, `TranscriptRepository`, `RepairRepository`, `MeetingNotesDraftRepository`, `SttJobQueue`, `AiCleanupJobQueue`) are already natural seams; the work is replacing the `SessionStore` god-node entry point with role-scoped facades that callers consume directly.
2. **Atomize each numbered migration** (`src/storage/migrations.ts`, 1,056 lines, 16+ migrations in `SCHEMA_MIGRATIONS`) so every step runs inside a single `BEGIN IMMEDIATE / COMMIT` block, and verify each is idempotent.
3. **Cover mid-step migration crash recovery** with a fault-injection test (TEST-02).

This phase does NOT touch: storage engine choice (SQLite stays — locked by local-first constraint), Notion read-models (Phase 1 is storage-only, dashboard-side decoupling is a v2 concern), or the persistent CLI lifecycle (Phase 2 owns RELY-*).

The work is sequenced first because every later phase (RELY, POLY, DASH) consumes storage interfaces; landing the new facades before they ride on the surface eliminates rework.

</domain>

<decisions>
## Implementation Decisions

### Storage decomposition (STORE-01)

- **Lock**: `SessionStore` will be **replaced** by role-scoped facades, not "improved" in place. The class itself is removed from the public surface (or kept as a thin deprecation shim during transition, then deleted within this phase — no shim survives Phase 1).
- **Lock**: The new facades share a single `SqlRunner` instance per `DirongDatabase`. No facade owns its own connection. The dependency direction is `Facade → SqlRunner → DirongDatabase`.
- **Lock**: Suggested role-scoped facades (final names are planner's discretion, but the partitioning is locked):
  - `SessionWriteStore` — session lifecycle writes (create, finalize, mark abandoned), chunk writes, repair-item writes
  - `SessionReadStore` — `dashboard-read-model`, `ai-cleanup-terminal-read-model`, `status-text-read-model`, session/chunk/transcript reads
  - `JobQueueStore` (or two: `SttJobQueueStore` + `AiCleanupJobQueueStore`) — wrapping `SttJobQueue` + `AiCleanupJobQueue`
  - `RuntimeStateStore` — recording-runtime state, AI-cleanup terminal state, lease repair
- **Lock**: No production caller (`grep -r "from .*session-store" src/ --include="*.ts" | grep -v "^src/storage/" | grep -v test`) imports `SessionStore` after the phase. The single entry point becomes a composition root in `src/storage/index.ts` (or equivalent) that constructs and returns the role-scoped facades.
- **Claude's Discretion**: How to migrate callers (big-bang vs facade-by-facade). Default recommendation: facade-by-facade in dependency-leaf-first order — start with the facade that has the fewest callers (likely `RepairRepository`-backed) and work up to read-models.
- **Claude's Discretion**: Whether to introduce a `StorageContext` aggregator that bundles the facades for callers that legitimately need multiple roles (e.g. `src/app/main.ts` composition root). This is OK as long as it's a struct of facades, not a new god class.

### Migration atomicity (STORE-02)

- **Lock**: Every numbered migration in `SCHEMA_MIGRATIONS` runs inside one `BEGIN IMMEDIATE / COMMIT` block. The transaction wraps the entire `migration.apply(db)` call; partial commits are not allowed.
- **Lock**: The migration runner — not each migration body — owns the transaction wrapping. Existing migrations stay structurally unchanged; the change is at the loop level in whatever currently iterates `SCHEMA_MIGRATIONS`.
- **Lock**: Crash mid-step leaves the DB in the **pre-step** state. Detect via the `schema_migrations` (or equivalent ledger) table — the failed migration's row is never written. Schema hash before and after a failed step must be identical.
- **Lock**: `node:sqlite`'s `DatabaseSync` transaction semantics are the substrate. `SqlRunner.transaction<T>()` already exists (`src/storage/sql-runner.ts:6-8`) and delegates to `DirongDatabase.transaction`. The migration runner uses the same primitive — do **not** invent a parallel transaction wrapper.
- **Claude's Discretion**: Whether to use `BEGIN IMMEDIATE` vs `BEGIN DEFERRED`. Default to `IMMEDIATE` because migrations write — `IMMEDIATE` acquires the reserved lock up front and avoids "database is locked" surprises if any concurrent reader is active during boot-time migration.
- **Claude's Discretion**: Whether to add a `--dry-run` migration mode. Out of scope unless trivially free.

### Migration idempotency self-test (STORE-03)

- **Lock**: Each numbered migration step is run twice in a fresh DB inside the test, and the resulting schema is asserted equivalent (same `PRAGMA table_info(<table>)` and `PRAGMA index_list(<table>)` outputs after both runs).
- **Lock**: The self-test lives in `src/storage/migrations.test.ts` (existing, 1,624 lines — extend, do not displace). Add new test cases; do not refactor existing ones in this phase.
- **Claude's Discretion**: Whether to extract a shared `runMigrationTwiceAndDiffSchema(migration, freshDb)` helper. Recommended because it keeps the per-migration test cases small (one-line invocation per migration).
- **Note**: A migration that is provably idempotent (e.g. `CREATE TABLE IF NOT EXISTS`) and a migration that mutates rows (e.g. `UPDATE ... SET column = ...` without a guard) behave differently on second run. The self-test catches mutation migrations that lack idempotency guards. Some migrations may **legitimately fail** the self-test on first audit — those are the ones the phase needs to fix (or wrap in an idempotency check), not the test.

### Migration crash-recovery test (TEST-02)

- **Lock**: Test simulates a `db.exec` failure between two SQL fragments inside a single migration step (e.g. by monkey-patching one `db.exec` call to throw on the Nth invocation). After the throw, the test asserts:
  1. The `schema_migrations` ledger has no row for the failed migration.
  2. `PRAGMA table_info` for any tables the migration touches matches the pre-migration baseline.
  3. The next call to `runMigrations()` re-runs the same step cleanly.
- **Lock**: The test lives in `src/storage/migrations.test.ts`. Use Node native test runner + `node:assert/strict` (matches existing convention per `.planning/codebase/TESTING.md`).
- **Claude's Discretion**: Choice of fault-injection mechanism. Cleanest is a `DatabaseSync` proxy that counts `exec` invocations and throws on the N-th. Acceptable alternative: pick a migration with a known multi-step body and wrap one specific `db.exec` line in a stub.

### Ledger surface (cross-cutting)

- **Lock**: Whatever table tracks "this migration has been applied" (likely a `schema_migrations` table created by the runner or by an early migration) is the source of truth for idempotency and crash recovery. The planner MUST locate it in `src/storage/migrations.ts` and confirm its name before writing tasks. If no ledger exists today, that itself is a finding to surface — the phase may need a small zero-th task to add one.
- **Claude's Discretion**: If the ledger does not exist, decide whether to add it as part of STORE-02 or carve a `STORE-02a` task. Recommendation: bundle it into STORE-02 since the phase contract is "atomic migrations," and atomicity needs a write-once ledger to be meaningful.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (planner, executor, verifier) MUST read these before writing tasks or code.**

### Project context
- `.planning/PROJECT.md` — Validated/Active scope, constraints (local-first, no silent fallbacks, no production mocks)
- `.planning/REQUIREMENTS.md` — STORE-01/02/03 + TEST-02 verbatim text and the v1/v2 boundary
- `.planning/ROADMAP.md` — Phase 1 success criteria (4 items, all observable / grep-checkable / test-driven)
- `.planning/STATE.md` — Current focus, dependency notes (Phases 2/3/4 nominally depend on Phase 1)

### Codebase map (output of `/gsd:map-codebase`, commit `dd18f77`)
- `.planning/codebase/STRUCTURE.md` — `src/storage/` directory layout and naming conventions
- `.planning/codebase/ARCHITECTURE.md` — Where storage sits in the layered pipeline (recording → STT → AI cleanup → Notion)
- `.planning/codebase/CONVENTIONS.md` — TypeScript strict + `noUncheckedIndexedAccess`; no linter; co-located tests
- `.planning/codebase/TESTING.md` — `node --test` runner; `npm test` enumerates each compiled test path explicitly in `package.json` — adding a new `*.test.ts` requires updating `package.json`
- `.planning/codebase/CONCERNS.md` — HIGH/MEDIUM source for STORE-01..03 + TEST-02; specifically:
  - HIGH: God-node concentration on `SessionStore` (136 edges) and `DirongDatabase` (127 edges)
  - MEDIUM: Performance — concentrated SQL execution in `migrations.ts` (calls outside transactions at lines 251, 256, 274, leaving partial state on crash)

### Production source (Phase 1 working set)
- `src/storage/session-store.ts` (879 lines) — the god-node being decomposed
- `src/storage/sql-runner.ts` (25 lines) — the shared transaction primitive (`transaction<T>()`, `run`, `get`, `all`); STORE-01 facades and STORE-02 migration runner both consume this
- `src/storage/sqlite.ts` (74 lines) — `DirongDatabase` (127 edges) wrapper around `node:sqlite` `DatabaseSync`
- `src/storage/migrations.ts` (1,056 lines) — `SCHEMA_MIGRATIONS` array; runner location to confirm before STORE-02
- `src/storage/schema-fragments/` — already-extracted per-migration SQL constants (referenced from migrations.ts imports)
- `src/storage/session-repository.ts`, `chunk-repository.ts`, `transcript-repository.ts`, `repair-repository.ts`, `meeting-notes-draft-repository.ts`, `stt-job-queue.ts`, `ai-cleanup-job-queue.ts` — natural seams for facade partitioning
- `src/storage/dashboard-read-model.ts`, `ai-cleanup-terminal-read-model.ts`, `status-text-read-model.ts` — read-side surfaces consumed by `SessionStore`

### Tests (Phase 1 must not break, will extend)
- `src/storage/migrations.test.ts` (1,624 lines) — STORE-03 + TEST-02 land here
- `src/storage/session-purge.test.ts`, `dashboard-read-model.test.ts`, `migrations.test.ts`, `schema-consistency.test.ts`, `session-store-paths.test.ts`, `session-store-ai-cleanup.test.ts`, `file-retention.test.ts` — co-located storage tests; STORE-01 facade migrations may require updates here

### Build / test infrastructure (Phase 1 must update)
- `package.json#scripts.test` — every `*.test.ts` is enumerated explicitly. Any new test file (idempotency self-test, mid-crash test, per-facade tests) MUST be added to this list, otherwise CI silently skips it.
- `tsconfig.json` — strict + `noUncheckedIndexedAccess`; new facades must compile under these flags
- `dist/` — `npm test` runs against `dist/**/*.test.js`; planner should expect `npm run build && npm test` as the canonical verification command

### Knowledge graph
- `graphify-out/GRAPH_REPORT.md` — confirms `SessionStore` (136 edges), `DirongDatabase` (127 edges), `SqlRunner` (113 edges) as the top three project-owned hubs (line ~1507). Useful for the planner to estimate facade-by-facade migration impact via `graphify path "<caller>" "SessionStore"`.

</canonical_refs>

<specifics>
## Specific Ideas

- **Composition root location**: `src/app/main.ts` is the canonical composition root (entry point). Whatever assembles the role-scoped facades from `DirongDatabase + SqlRunner` should be wired in here or in a dedicated `src/storage/index.ts` that `main.ts` imports.
- **Failure-mode signal preservation**: Any `try/catch` currently in `SessionStore` that catches and re-throws as a `DirongError` (per `src/errors.ts:61-82` redaction) must preserve that translation in the new facades. Don't strip secret redaction during the split.
- **Read-model boundary**: `dashboard-read-model.ts` is consumed by HTTP handlers in `src/dashboard/`. Phase 4 (DASH-*) explicitly depends on Phase 1 in ROADMAP — if `SessionReadStore` changes the shape of any read-model output, surface that to the Phase 4 plan.
- **Migration ledger**: Confirm whether a `schema_migrations` (or `_dirong_migrations`, etc.) table exists today. If absent, adding it is part of STORE-02; the ledger row is what makes "pre-step state on crash" provable.
- **Per-migration self-test scope**: A few migrations (e.g. data-mutation ones that re-run UPDATE statements without a NOT-already-set guard) may legitimately differ on second run. The self-test should distinguish "schema differs" (= idempotency bug) from "data differs" (= expected for some mutation migrations) — ARCH choice for the planner.
- **Backward compatibility during cutover**: Some PRs may straddle "old `SessionStore` still imported" + "new facade defined." Acceptable within Phase 1 commit chain, but the phase exit criterion is **zero** old imports — verifiable by the `grep` in success criterion #1.

</specifics>

<deferred>
## Deferred Ideas

- **Splitting `i18n/catalog.ts`** — flagged in CONCERNS.md, deferred to v2 MOD-01 in REQUIREMENTS.md (bundle size not yet the bottleneck).
- **Splitting `setup/wizard-service.ts`, `notion/dashboard-service.ts`, `settings/product-settings.ts`, `app/main.ts`** — v2 MOD-02..04. Phase 1 stays inside `src/storage/` only.
- **Replacing SQLite** — explicitly Out of Scope per PROJECT.md (local-first constraint).
- **Postgres / remote DB / sharding** — same as above.
- **Optimising migration performance** — STORE-02/03 are about correctness (atomicity, idempotency), not throughput. Migration speed is acceptable today; no optimisation work in this phase.
- **Refactoring existing storage tests for style** — extend, do not displace. Style cleanup is v2 if anywhere.
- **Submodule extraction of `src/storage/` into a separate package** — not contemplated; would defeat the local-first single-binary distribution model.

</deferred>

<scope_fence>
## Scope Fence (what Phase 1 will NOT touch)

- Files outside `src/storage/`, `src/app/main.ts` (composition wiring only), `package.json` (test enumeration), and `src/storage/__tests__` / co-located test files. Touching anything else means scope creep — surface to the user before proceeding.
- Behavioral changes to existing migrations. STORE-02 wraps them; it does not re-author them.
- New schema additions. The phase is pure structure + correctness; if a new migration is needed for the ledger (and one doesn't exist), it's the **only** new schema work allowed in this phase.
- Notion / Discord / STT / AI-cleanup / dashboard / recording code paths. Phases 2/3/4 cover those.
- Performance tuning. Concerns flagged in CONCERNS.md as "Performance — concentrated SQL execution" are addressed via atomicity (STORE-02), not via index/query optimisation.

</scope_fence>

---

*Phase: 01-storage-foundation*
*Context gathered: 2026-05-15 (synthesized; no `discuss-phase` artifact existed at planning time)*
