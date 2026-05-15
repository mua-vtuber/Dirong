# Requirements: Dirong — Discord Record Bot

**Defined:** 2026-05-15
**Core Value:** A meeting host can run `/dirong start` and end up with a clean, validated, locally-owned meeting note (and an optional Notion page) without exporting any audio or transcript outside their machine.

> **Milestone (proposed): Stability & Hardening v0.1** — derived from `.planning/codebase/CONCERNS.md` HIGH + selected MEDIUM. The user invoked `/gsd:new-project` without an explicit milestone goal, so this requirement set targets the highest-leverage, contained, policy-aligned work surfaced by the codebase map. If a different milestone is intended, edit this file and re-run `/gsd:plan-phase 1`.

## v1 Requirements

Each item is testable and traceable. REQ-IDs are stable; phase mapping is filled in by `gsd-roadmapper` (see Traceability below).

### Storage Decomposition (STORE)

- [ ] **STORE-01**: `SessionStore` (currently 879 lines, 136 graph edges) is split into role-scoped facades (e.g. `SessionWriteStore`, `SessionReadStore`, `FakeSttStore`) that share `SqlRunner`. No production caller imports `SessionStore` directly after the split. — `src/storage/session-store.ts`, `src/storage/sql-runner.ts`
- [ ] **STORE-02**: Each numbered migration in `src/storage/migrations.ts` (currently 1,056 lines) executes inside a single `BEGIN IMMEDIATE / COMMIT` block; mid-step crash leaves the DB in a pre-step state, never partially applied.
- [ ] **STORE-03**: Each migration step is verifiable as idempotent via a self-test that runs the step twice and asserts schema equivalence.

### Reliability — Subprocess & File-Descriptor Lifecycle (RELY)

- [ ] **RELY-01**: `ClaudeStreamJsonCliCleanupProvider` tracks every spawned `claude` PID in a `Set<number>`; on `stop()` and on parent-process exit, anything still alive receives `SIGKILL`. Verified by a fault-injection test that aborts mid-`generate()`. — `src/ai/cleanup/claude-persistent-cli-provider.ts`
- [ ] **RELY-02**: Abort-listener registration in `ClaudeStreamJsonCliCleanupProvider.generate()` runs **before** any `await this.killSession()`, so the listener cannot fire against a half-constructed session.
- [ ] **RELY-03**: A periodic safeguard interval force-kills any persistent-CLI session whose `Date.now() - startedAt` exceeds `timeoutMs * 2`.
- [ ] **RELY-04**: On boot, when the prior session left any `chunk_finalize_timeout` repair items, `src/storage/repair-scan.ts` runs automatically (no manual `npm run repair` required to recover from a Windows FD-leak crash). — `src/recording/recording-producer.ts`, `src/storage/repair-scan.ts`
- [ ] **RELY-05**: The 60-second forced chunk-close branch in `recording-producer.ts:319-356` is exercised by an integration test (currently uncovered).

### Policy — Silent Fallbacks & Production Mocks (POLY)

- [ ] **POLY-01**: `resolveSpeakerSnapshot` (`src/recording/speaker-chunk-manager.ts:45-68`) no longer returns `{ displayName: userId, isBot: false }` as a silent fallback. Discord lookup failures are split into "transient (retry)" vs "permanent (record as `unknown user`, mark chunk quarantined)", and the operator sees a non-zero `speaker_lookup_failed` count in the dashboard.
- [ ] **POLY-02**: All three bare `catch {}` sites are replaced with `catch (error)` plus structured logging via `recordConnectionEvent` or the existing logger — `src/recording/recording-producer.ts:471`, `src/stt/openai-provider.ts:124`, `src/stt/local-whisper-provider.ts:115`.
- [ ] **POLY-03**: `src/ai/cleanup/fake-provider.ts` and `src/stt/fake-runner.ts` are moved under a `__dev__/` (or equivalent) subtree. An ESLint `no-restricted-imports` rule blocks importing them from anywhere except `src/app/phase4-ai-cleanup-cli.ts`, `src/app/phase2-fake-stt-cli.ts` (or the renamed equivalent), and `*.test.ts` files. CI fails if a new caller is added.

### Dashboard — Surface Hygiene (DASH)

- [ ] **DASH-01**: `src/dashboard/` route handlers no longer return bare `null` / `undefined` / `{}` as ambiguous sentinels. A `RouteOutcome` discriminated union (`{ kind: "handled"; response }` vs `{ kind: "skip" }`) is introduced and enforced by lint or by a router-level type signature. Affected files include `notion-routes.ts`, `project-routes.ts`, `setup-routes.ts`, `setup-routes.ts`, and `router.ts`.
- [ ] **DASH-02**: When `dashboardHost !== "127.0.0.1"`, `src/dashboard/server.ts` emits a startup warning on stdout and on the dashboard's first event log entry, citing the LAN exposure of the audio token TTL window.

### Logging Hygiene (LOG)

- [ ] **LOG-01**: `console.warn` calls in `src/ai/cleanup/progress.ts:131` and `src/ai/cleanup/runner.ts:731` are routed through `recordConnectionEvent` or a dedicated AI-cleanup event sink so warnings appear in the dashboard rather than being lost in stdout.

### Test Coverage Backfill (TEST)

- [ ] **TEST-01**: Persistent-CLI spawn-and-kill race conditions described in CONCERNS.md are covered by a fault-injection test in `claude-persistent-smoke.test.ts` (or a new `claude-persistent-cli-provider-lifecycle.test.ts`). Test asserts no orphaned PID after abort.
- [ ] **TEST-02**: Mid-step migration crash recovery is simulated in `migrations.test.ts` (e.g. inject `db.exec` failure between two steps; assert the DB is in a clean pre-step state, not partially applied).

## v2 Requirements

Acknowledged but deferred. Tracked here so they don't get re-discovered later.

### Module Decomposition (MOD)

- **MOD-01**: Split `src/i18n/catalog.ts` (4,780 lines) by locale or feature surface, enabling lazy-loading. Deferred — bundle size is not the current bottleneck.
- **MOD-02**: Split `src/setup/wizard-service.ts` (1,892 lines) — separate the secret-write path from the settings-mutation path.
- **MOD-03**: Slim `src/notion/dashboard-service.ts` (1,541 lines) and `src/settings/product-settings.ts` (1,328 lines).
- **MOD-04**: Slim `src/app/main.ts` (1,013 lines) — entry-point should be a composition root only.

### Hardening Follow-ups (HARD2)

- **HARD2-01**: Sentinel test ensuring `DirongError.format()` output never contains any value currently present in `LocalSecretStore.snapshot()` (defends against future Discord token format changes that bypass regex redaction).
- **HARD2-02**: Document in `CONVENTIONS.md` that all child-process invocations must go through `runChild()`.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Hosted SaaS deployment | License restricts to self-hosted personal/educational/non-commercial use; multi-tenant changes require license review |
| Mobile / web client beyond local dashboard | Threat model assumes single-machine trust; remote access by design unsupported |
| Real-time / live streaming transcripts | Pipeline is session-based; live streaming is a redesign of the recording producer + queue model — out of this milestone |
| Replacing SQLite with Postgres or another DB | Local-first constraint; SQLite stays. STORE-* requirements are about modularizing access, not replacing the engine |
| Splitting `i18n/catalog.ts` on this milestone | See v2 MOD-01 — bundle size not yet the bottleneck |
| Adding STT providers beyond local Whisper + OpenAI | Surface stays the two existing providers; deeper provider abstraction is a v0.2+ concern |
| Multi-language meeting-note generation beyond ko/en | Depends on AI cleanup prompt design; deferred |

## Traceability

Each requirement maps to exactly one phase. See `.planning/ROADMAP.md` for phase definitions and success criteria.

| Requirement | Phase | Status |
|-------------|-------|--------|
| STORE-01 | Phase 1 | Pending |
| STORE-02 | Phase 1 | Pending |
| STORE-03 | Phase 1 | Pending |
| RELY-01 | Phase 2 | Pending |
| RELY-02 | Phase 2 | Pending |
| RELY-03 | Phase 2 | Pending |
| RELY-04 | Phase 2 | Pending |
| RELY-05 | Phase 2 | Pending |
| POLY-01 | Phase 3 | Pending |
| POLY-02 | Phase 3 | Pending |
| POLY-03 | Phase 3 | Pending |
| DASH-01 | Phase 4 | Pending |
| DASH-02 | Phase 4 | Pending |
| LOG-01 | Phase 3 | Pending |
| TEST-01 | Phase 2 | Pending |
| TEST-02 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0

**Phase Distribution:**
- Phase 1 (Storage Foundation): 4 requirements — STORE-01, STORE-02, STORE-03, TEST-02
- Phase 2 (Persistent CLI & Recording Reliability): 6 requirements — RELY-01, RELY-02, RELY-03, RELY-04, RELY-05, TEST-01
- Phase 3 (Policy Compliance): 4 requirements — POLY-01, POLY-02, POLY-03, LOG-01
- Phase 4 (Dashboard Surface Hygiene): 2 requirements — DASH-01, DASH-02

---
*Requirements defined: 2026-05-15*
*Last updated: 2026-05-15 — traceability populated by gsd-roadmapper (16/16 mapped)*
