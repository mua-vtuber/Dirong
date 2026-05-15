# Roadmap: Dirong — Stability & Hardening v0.1

## Overview

Brownfield maintenance milestone targeting the highest-leverage hardening items surfaced by `.planning/codebase/CONCERNS.md`: split the `SessionStore` god node, harden the persistent Claude CLI lifecycle, eliminate silent-fallback policy violations, isolate fake providers structurally, and clean up dashboard route outcomes. The journey starts at the storage layer (highest blast radius — every later phase rides on the new facades) and ends at the dashboard surface.

This is a bounded, contained milestone — 16 v1 requirements across STORE / RELY / POLY / DASH / LOG / TEST categories — not a feature ship. Phases are ordered by blast radius (storage first) so the rest of the work can land against stable interfaces in parallel.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3, 4): Planned milestone work
- Decimal phases (e.g. 2.1): Reserved for urgent insertions (none planned)

- [ ] **Phase 1: Storage Foundation** - Split SessionStore into role-scoped facades, wrap each migration in a single transaction, and add migration crash-recovery tests
- [ ] **Phase 2: Persistent CLI & Recording Reliability** - Track and reap orphan `claude` PIDs, fix abort-listener race, auto-run repair-scan on boot, and cover the 60s force-close branch with an integration test
- [ ] **Phase 3: Policy Compliance — Silent Fallbacks & Mock Isolation** - Eliminate the four silent-fallback sites, route AI-cleanup `console.warn` to the dashboard, and structurally isolate fake providers behind ESLint
- [ ] **Phase 4: Dashboard Surface Hygiene** - Replace ambiguous `null`/`{}` route returns with a `RouteOutcome` union and warn at startup when the dashboard binds outside loopback

## Phase Details

### Phase 1: Storage Foundation
**Goal**: Storage layer is no longer a single god node, every migration is atomic and self-verifying, and a mid-step migration crash never corrupts the DB.
**Depends on**: Nothing (first phase — highest blast radius, must precede other refactors)
**Requirements**: STORE-01, STORE-02, STORE-03, TEST-02
**Success Criteria** (what must be TRUE):
  1. `grep -r "from .*session-store" src/ --include="*.ts" | grep -v "^src/storage/" | grep -v test` returns zero hits — no production caller outside `src/storage/` imports `SessionStore` directly; all consume role-scoped facades (`SessionWriteStore`, `SessionReadStore`, `FakeSttStore`).
  2. Running `npm test` with a fault-injection test that throws inside `db.exec` between two SQL fragments of any numbered migration leaves the DB in the pre-migration state (schema hash equals the pre-migration hash; `schema_migrations` table does not record the failed migration as applied).
  3. A migration self-test runs every numbered step twice in a fresh DB and asserts identical schema (`PRAGMA table_info` + `PRAGMA index_list` for each table) after both runs.
  4. `npm run build && npm test` passes after the split with no skipped tests; the new `dist/storage/migrations.test.js` and split-store test files are listed in `package.json#scripts.test`.
**Plans**: TBD

### Phase 2: Persistent CLI & Recording Reliability
**Goal**: Aborted/timed-out `claude` runs never leak child processes, the recording producer's force-close path is exercised by a test, and a Windows FD-leak crash auto-heals on next boot.
**Depends on**: Phase 1
**Requirements**: RELY-01, RELY-02, RELY-03, RELY-04, RELY-05, TEST-01
**Success Criteria** (what must be TRUE):
  1. Running `npm run phase4:claude-persistent-smoke` and aborting mid-`generate()` (via SIGINT or test-driven `AbortController.abort()`) leaves zero orphan `claude` PIDs — verified by a fault-injection test that snapshots `ps -ef | grep claude` (or platform equivalent) before and after, and by inspecting the provider's internal `Set<number>` PID tracker.
  2. A unit test demonstrates that an `AbortController.abort()` fired before `await this.killSession()` in `generate()` is observed by the listener and does not crash on a half-constructed session (listener registration precedes any `killSession` call).
  3. A safeguard interval test simulates a session whose `Date.now() - startedAt > timeoutMs * 2` and asserts the persistent CLI process receives `SIGKILL` automatically without operator intervention.
  4. Booting Dirong (`npm start`) when `repair_items` contains any row with `kind = 'chunk_finalize_timeout'` automatically runs `runStartupRepair` — observable as a "startup repair: N items reconciled" line in the boot log without the operator having to invoke `npm run repair`.
  5. A new integration test in `src/recording/recording-producer.test.ts` (or a sibling file) drives `stopActiveSession` past the 20s graceful close into the 60s force-close branch (`recording-producer.ts:319-356`) and asserts both that `chunk_finalize_timeout` repair items are written and that the test path is reported as covered.
**Plans**: TBD

### Phase 3: Policy Compliance — Silent Fallbacks & Mock Isolation
**Goal**: Every site flagged by CONCERNS.md as violating the "no silent fallbacks / no mock on production" policy either fails loudly or is structurally walled off; AI-cleanup warnings reach the dashboard instead of stdout.
**Depends on**: Phase 1
**Requirements**: POLY-01, POLY-02, POLY-03, LOG-01
**Success Criteria** (what must be TRUE):
  1. With a Discord member lookup that throws a permanent "user not found" error, `resolveSpeakerSnapshot` no longer returns `{ displayName: <userId>, isBot: false }`; instead the chunk is recorded with a `speaker_lookup_failed` quarantine flag and the dashboard's connection-event feed surfaces a non-zero `speaker_lookup_failed` counter visible to the operator.
  2. `grep -nE 'catch\s*\{' src/recording/recording-producer.ts src/stt/openai-provider.ts src/stt/local-whisper-provider.ts` returns zero hits — every previously bare `catch {}` is replaced with `catch (error)` plus a structured log call (via `recordConnectionEvent` or the existing logger).
  3. After moving `fake-provider.ts` and `fake-runner.ts` under a `__dev__/` (or equivalent) subtree, adding an ESLint `no-restricted-imports` rule, and running `npm run lint` (or the equivalent CI check), importing `FakeAiCleanupProvider` from any file other than `src/app/phase4-ai-cleanup-cli.ts`, `src/app/phase2-fake-stt-cli.ts`, or a `*.test.ts` file produces a lint error that fails CI.
  4. Triggering the warning condition at `src/ai/cleanup/progress.ts:131` and `src/ai/cleanup/runner.ts:731` (e.g. via the existing test scenarios that hit those branches) results in an event row visible in the dashboard's AI-cleanup event log; `console.warn` no longer appears in those code paths.
**Plans**: TBD

### Phase 4: Dashboard Surface Hygiene
**Goal**: Dashboard route handlers express intent unambiguously through a discriminated union, and the operator is loudly warned when the dashboard binds anywhere other than loopback.
**Depends on**: Phase 1
**Requirements**: DASH-01, DASH-02
**Success Criteria** (what must be TRUE):
  1. After the refactor, `grep -nE 'return (null|undefined|\{\})\s*;' src/dashboard/notion-routes.ts src/dashboard/project-routes.ts src/dashboard/setup-routes.ts src/dashboard/router.ts` returns zero hits; every route handler returns a `RouteOutcome` value (`{ kind: "handled"; response }` or `{ kind: "skip" }`), and the router's TypeScript signature rejects bare `null` returns at compile time.
  2. Starting Dirong with `dashboardHost = "0.0.0.0"` (or any value other than `127.0.0.1` / `LOCAL_ONLY_DASHBOARD_HOST`) emits a startup warning to stdout citing LAN exposure within the audio-token TTL window, AND inserts the same warning as the first event-log entry visible on the dashboard. Starting with the default `127.0.0.1` produces no such warning.
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Storage Foundation | 0/TBD | Not started | - |
| 2. Persistent CLI & Recording Reliability | 0/TBD | Not started | - |
| 3. Policy Compliance — Silent Fallbacks & Mock Isolation | 0/TBD | Not started | - |
| 4. Dashboard Surface Hygiene | 0/TBD | Not started | - |

---
*Roadmap created: 2026-05-15 (gsd-roadmapper, brownfield, derived from REQUIREMENTS.md v1 + CONCERNS.md)*
