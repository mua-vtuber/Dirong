# Dirong — Discord Record Bot

## What This Is

Dirong is a local-first Discord voice recording bot for meeting workflows. It records per-speaker audio from a Discord voice channel, transcribes the audio into segments, generates an AI-cleaned meeting-note draft, and optionally publishes the draft to Notion. The app runs on the user's own machine — settings, secrets, recordings, transcripts, drafts, and the SQLite database all live locally rather than in any hosted service.

Target users: self-hosting Discord communities and small teams (primarily Korean-speaking, with full English UX) who want auditable, private meeting transcripts and notes without sending audio to a third-party SaaS.

## Core Value

A meeting host can run `/dirong start` in Discord and end up with a clean, validated, locally-owned meeting note (and an optional Notion page) without exporting any audio or transcript outside their machine.

## Requirements

### Validated

<!-- Existing capabilities inferred from `.planning/codebase/STACK.md`, `ARCHITECTURE.md`, and `STRUCTURE.md`. These are shipped and relied upon. -->

- ✓ **Local-first storage** — settings, secrets, recordings, transcripts, drafts, and SQLite DB all live under per-OS user data dirs (`%LOCALAPPDATA%\Dirong` / `~/Library/Application Support/Dirong` / `~/.local/share/dirong`); see `src/settings/dirong-user-data.ts`
- ✓ **Discord voice recording (per-speaker chunks)** — `/dirong start|stop|status` slash commands record per-speaker `.opus` chunks via `@discordjs/voice` + `prism-media`; see `src/recording/`, `src/discord/`
- ✓ **Multi-project / multi-guild support** — switch active project for different Discord servers/workspaces; command gate blocks inactive projects; see `src/projects/`
- ✓ **STT pipeline (two providers)** — local Whisper via bundled `scripts/local-whisper-json.py` + `faster-whisper`, and OpenAI STT; managed by `src/stt/`, CLI entry `phase3:stt`
- ✓ **AI meeting-note cleanup (Claude Code CLI)** — persistent CLI provider produces validated draft + Markdown preview; see `src/ai/cleanup/`, CLI entry `phase4:ai-cleanup`
- ✓ **Notion upload with managed schema** — schema creation, diff/repair, and page property mapping for completed drafts; see `src/notion/`, CLI entry `phase5:notion-upload`
- ✓ **Local dashboard** — http://127.0.0.1:3095/, HMAC-SHA256 audio token auth, setup wizard, queue/automation status, schema repair, signed local audio playback; see `src/dashboard/`
- ✓ **Setup wizard** — first-launch interactive setup for Discord/STT/AI/Notion + local Whisper Python env bootstrap; see `src/setup/wizard-service.ts`
- ✓ **Operational tooling** — `npm run doctor` (read-only diagnostics), `npm run repair` (recover stale chunks/leases/queue), `npm run sessions:purge` (storage GC); see `src/app/doctor.ts`, `src/app/repair.ts`, `src/app/session-purge.ts`
- ✓ **Portable Windows release** — bundled Node.js + Python runtime, `Dirong Start.bat` launcher, auto-provisioned portable Python (commit `f8623a4`)
- ✓ **Internationalization** — full UX in Korean and English; `src/i18n/catalog.ts` (≈4.8k lines)
- ✓ **Native Node test runner** — co-located `*.test.ts` next to sources; CI via `npm test` on built `dist/`

### Active

<!-- ⚠ PROPOSED next milestone scope, derived from `.planning/codebase/CONCERNS.md` HIGH + selected MEDIUM items.
     The user invoked `/gsd:new-project` without an explicit milestone goal, so these are the highest-leverage
     hardening targets the codebase analysis surfaced. Replace with feature scope if a different milestone is intended.
     Refine via `/gsd:plan-phase` or by editing this list and re-running `/gsd:plan-phase 1`. -->

**Milestone (proposed): Stability & Hardening v0.1**

- [ ] Split `SessionStore` god node (136 edges) into role-scoped facades (read / write / fake-stt)
- [ ] Eliminate silent fallbacks that violate the "no silent fallbacks" policy (`src/recording/speaker-chunk-manager.ts`, three bare `catch{}` sites in recording/STT)
- [ ] Harden persistent Claude CLI lifecycle (PID tracking, abort-listener race, runaway-safeguard interval)
- [ ] Wrap each `migrations.ts` step in `BEGIN IMMEDIATE / COMMIT` and verify per-fragment idempotency
- [ ] Auto-run `repair-scan.ts` on boot when the prior session left `chunk_finalize_timeout` items
- [ ] Move `fake-provider.ts` / `fake-runner.ts` under a `__dev__/` subtree with an ESLint `no-restricted-imports` rule limiting callers to phase4/phase2 dev CLIs
- [ ] Replace bare `null`/`{}` route returns with a `RouteOutcome` discriminated union in `src/dashboard/`
- [ ] Add startup warning when `dashboardHost !== "127.0.0.1"`
- [ ] Backfill tests for the highest-risk fragility paths: persistent CLI spawn-and-kill races, recording 60s force-close branch, mid-step migration crash recovery

### Out of Scope

- Hosted SaaS deployment — license restricts to self-hosted personal/educational/non-commercial use; multi-tenant/cloud auth would require a license change
- Mobile / web client — UX is a local dashboard at `127.0.0.1:3095`; remote access is intentionally not supported by the threat model (`src/dashboard/security.ts`)
- Real-time / live streaming transcripts — current pipeline is session-based (record → finalize → STT → AI → Notion); live streaming would require redesigning the recording producer and queue model
- Replacing `SessionStore` wholesale (e.g. swap SQLite for Postgres) — the local-first constraint means SQLite stays; concerns are about modularizing it, not replacing it
- Splitting `i18n/catalog.ts` (4.8k lines) on this milestone — flagged in CONCERNS.md but bundle size is not the current bottleneck; defer until lazy-loading becomes a measurable need
- Additional STT providers beyond local Whisper + OpenAI — surface stays the two existing providers; deeper provider abstraction is a v0.2+ concern
- Multi-language meeting-note generation beyond ko/en — depends on the AI cleanup prompt design, deferred

## Context

- **Brownfield, single-maintainer.** Existing TypeScript codebase, ~534 source files, 27k graph nodes / 54k edges. Active development in 2026-Q2; current top-of-tree commit `dd18f77` (after `/gsd:map-codebase`). Recent commits show ongoing portable-runtime, i18n, and AI-cleanup-schema work — the project is not in maintenance freeze.
- **Persistent Claude CLI is the AI surface.** `src/ai/cleanup/claude-persistent-cli-provider.ts` spawns `claude` as a long-lived child process via stream-JSON. This is a relatively novel integration pattern — most lifecycle/race concerns in CONCERNS.md are around it.
- **Two god nodes anchor risk.** `SessionStore` (136 edges) and `DirongDatabase` (127 edges) are the largest blast-radius components. Any session/schema change in the next milestone will touch them.
- **No linter/formatter, native Node test runner.** Style is enforced only by `tsconfig.json` strict mode. `npm test` enumerates each compiled test path explicitly in `package.json` — adding a new `*.test.ts` requires updating `package.json`. (See `.planning/codebase/TESTING.md`.)
- **Fakes are gated, not type-isolated.** `FakeAiCleanupProvider` and `FakeSttProvider` are reachable from production source via dev-only CLIs (`phase4:claude-persistent-smoke`, `phase2:fake-stt`). The user's CLAUDE.md absolute prohibition on production-path mocks treats these as accepted-with-caveat per the prior quality audit; CONCERNS.md lists structural isolation as the next step.
- **License: source-available, non-commercial, self-host only.** Any roadmap item that implies hosted/multi-tenant must be flagged for license review.

## Constraints

- **Tech stack**: Node.js ≥ 22.12.0, TypeScript ^5.9.3, ESM (`"type": "module"`), `discord.js` ^14.25.1, `@discordjs/voice` ^0.19.0, `better-sqlite3` (via `src/storage/`). Test runner is Node native `node --test`. — Locked by ecosystem and by the Windows portable bundle (`scripts/create-portable-bundle.ts`).
- **Local-first**: No hosted services, no telemetry. All secrets in `LocalSecretStore` only; never in env / `.env` / log lines (see `src/errors.ts:61-82` redaction). — License + threat model.
- **Windows is a first-class target**: portable bundle, file-descriptor quirks (see CONCERNS — recording-producer chunk-finalize cascade), `where.exe`-based executable resolution. — Most users run Windows.
- **No mock data on production paths**: per global `CLAUDE.md` policy. Existing fakes (`fake-provider.ts`, `fake-runner.ts`, `fake-stt.ts`) are accepted-with-caveat because dev-CLI gated, but new code must not extend the surface. — Hard requirement; structural isolation is in Active scope.
- **No silent fallbacks**: per global `CLAUDE.md` policy. CONCERNS.md flags 4 production sites that violate this; resolving them is in Active scope.
- **Subprocess safety**: all `spawn()` must go through `src/process/run-child.ts` (`shell: false`, `windowsHide: true`). — Existing convention; codify in `CONVENTIONS.md`.
- **Dashboard surface**: must default to `127.0.0.1` bind; tokens are HMAC short-TTL only. — Threat model assumes single-machine trust.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Initialize project in brownfield mode using existing `.planning/codebase/` map | `/gsd:map-codebase` already produced 7 codebase docs (commit `dd18f77`); inferring Validated from real code is more accurate than a blank slate | — Pending |
| Active scope = stability/hardening derived from CONCERNS.md HIGH+selected MEDIUM | No explicit milestone goal was provided to `/gsd:new-project`; CONCERNS.md surfaced concrete, contained, high-leverage targets that match the user's "no silent fallbacks / no mock on production" CLAUDE.md policy | — Pending |
| Default config: `mode=interactive`, `granularity=standard`, `parallel=true`, `commit_docs=true`, `model_profile=balanced` | Conservative defaults for a long-term maintained codebase; user can flip to `yolo` via `/gsd:settings` if rapid iteration becomes the goal | — Pending |
| Skip 4-agent project research phase | Domain (Discord recording, Whisper STT, Notion API) is well-known, and `.planning/codebase/` already documents the actual stack; spending ~4 researcher-agent budgets on generic ecosystem research has low marginal value vs. acting on existing CONCERNS.md | — Pending |
| Persistent Claude CLI is the AI cleanup surface (vs. SDK) | Already shipped (`src/ai/cleanup/claude-persistent-cli-provider.ts`); README explicitly states "Currently this step supports Claude Code CLI only" | ✓ Good |
| Local-first only (no hosted mode) | License + threat model | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition` or `/gsd:plan-phase` for the next phase):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-15 after initialization (brownfield, derived from `.planning/codebase/`)*
