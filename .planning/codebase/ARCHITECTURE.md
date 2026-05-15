<!-- refreshed: 2026-05-15 -->
# Architecture

**Analysis Date:** 2026-05-15

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│  Entry Points (CLI scripts via `package.json#scripts`)                       │
│                                                                              │
│  start (main.ts)   doctor   repair   sessions:purge                          │
│  phase2:fake-stt   phase3:stt   phase4:ai-cleanup                            │
│  phase4:claude-persistent-smoke   phase5:notion-upload                       │
│  bundle:portable                                                             │
│  `src/app/*.ts`                                                              │
└────────────┬─────────────────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  Long-running runtime (`src/app/main.ts`) — wires every subsystem,           │
│  owns the Discord `Client`, `RecordingProducer`, `DashboardServer`,          │
│  and the four background polling automations (STT, AI cleanup,               │
│  Notion upload, alone-finalize).                                             │
└────────────┬─────────────────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  Phase pipeline (event-driven, not in-memory chained — DB-mediated)          │
│                                                                              │
│  Phase 1 RECORDING            Phase 3 STT             Phase 4 AI CLEANUP     │
│  `src/recording/*`            `src/stt/*`             `src/ai/cleanup/*`     │
│   RecordingProducer            SttAutomationService    AiCleanupAutomation   │
│   ChunkFinalizer ─► transcode  PollingLoop tick        PollingLoop tick      │
│   chunk row + raw/stt files    runSttBatch(provider)   runAiCleanup(provider)│
│                                                                              │
│                                                       Phase 5 NOTION UPLOAD  │
│                                                       `src/notion/*`         │
│                                                       NotionAutomationService│
│                                                       PollingLoop tick       │
│                                                       runNotionUpload()      │
└────────────┬─────────────────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  Service primitives (cross-cutting)                                          │
│                                                                              │
│  PollingLoop / EnabledPollingLoop   Provider lifecycle wrappers              │
│  `src/runtime/polling-loop.ts`      `src/ai/cleanup/provider-lifecycle*.ts`  │
│                                                                              │
│  SttProvider port + adapters        AiCleanupProvider port + adapters        │
│  `src/stt/provider.ts`              `src/ai/cleanup/provider.ts`             │
│   - LocalWhisperSttProvider          - ClaudeStreamJsonCliCleanupProvider    │
│   - OpenAiSttProvider                - FakeAiCleanupProvider (smoke only)    │
│   - FakeSttProvider                                                          │
│                                                                              │
│  NotionClient port + HTTP adapter   Storage ports (per subsystem)            │
│  `src/notion/client.ts`             `src/recording/storage-port.ts`          │
│                                     `src/stt/storage-port.ts`                │
│                                     `src/ai/cleanup/storage-port.ts`         │
│                                     `src/dashboard/storage-port.ts`          │
└────────────┬─────────────────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  Persistence layer — single SQLite database + filesystem artifacts           │
│                                                                              │
│  SessionStore (god-node, 136 edges) — façade over repositories               │
│  `src/storage/session-store.ts`                                              │
│   ├── SessionRepository       ChunkRepository        TranscriptRepository    │
│   ├── SttJobQueue             AiCleanupJobQueue      MeetingNotesDraftRepo   │
│   ├── RepairRepository        DashboardReadModel     StatusTextReadModel     │
│   └── AiCleanupTerminalReadModel                                             │
│                                                                              │
│  SqlRunner (113 edges)        DirongDatabase (127 edges)                     │
│  `src/storage/sql-runner.ts`  `src/storage/sqlite.ts`                        │
│  - thin SQL exec wrapper      - node:sqlite + WAL + migrations               │
│                                                                              │
│  StoragePathResolver — relative-path normalization across moves              │
│  `src/storage/path-resolver.ts`                                              │
│                                                                              │
│  Filesystem layout under `config.dataDir/<sessionId>/`:                      │
│   raw_chunks/*.opus  →  stt_audio/*.{wav,m4a}  →                             │
│   ai_cleanup/*.{json,md}  →  notion_writes/* (rows in DB)                    │
└──────────────────────────────────────────────────────────────────────────────┘
             │
             ▼ (sinks)
┌──────────────────────────────────────────────────────────────────────────────┐
│  External sinks                                                              │
│                                                                              │
│  Discord Gateway (discord.js)        Notion REST API (notion/client.ts)      │
│  Local Whisper subprocess            Claude CLI subprocess                   │
│  OpenAI Whisper HTTP API             Local-only HTTP dashboard (loopback)    │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| `main` long-running app | Boots DB, wires every service, owns Discord client + dashboard, drives 4 automations | `src/app/main.ts` |
| `RecordingProducer` | Joins voice channel, demultiplexes Opus streams into per-speaker chunks, writes raw + stt audio | `src/recording/recording-producer.ts` |
| `ChunkFinalizer` | Transcodes raw opus → STT-safe format, queues `stt_jobs` row | `src/recording/chunk-finalizer.ts` |
| `SpeakerChunkManager` | Tracks active speaker chunks, enforces silence/rollover/max-chunk windows | `src/recording/speaker-chunk-manager.ts` |
| `VoiceConnectionController` | Discord voice connection lifecycle + recovery | `src/recording/voice-connection-controller.ts` |
| `AloneFinalizeService` | Auto-stops a session when only bots remain | `src/recording/alone-finalize-service.ts` |
| `SttAutomationService` | Polling loop that drains `stt_jobs` queue via configured provider | `src/stt/automation-service.ts` |
| `runSttBatch` | One-shot batch runner reused by CLI and automation | `src/stt/runner.ts` |
| `SttProvider` (port) | Boundary for transcription engines | `src/stt/provider.ts` |
| `LocalWhisperSttProvider` | Adapter spawning `scripts/local-whisper-json.py` portable Python | `src/stt/local-whisper-provider.ts` |
| `OpenAiSttProvider` | Adapter calling OpenAI audio transcription HTTP API | `src/stt/openai-provider.ts` |
| `AiCleanupAutomationService` | Polling loop that finds finalized sessions and dispatches AI cleanup | `src/ai/cleanup/automation-service.ts` |
| `runAiCleanup` | Per-session cleanup workflow (claim → prompt → parse → persist) | `src/ai/cleanup/runner.ts` |
| `AiCleanupProvider` (port) | Boundary for LLM cleanup providers | `src/ai/cleanup/provider.ts` |
| `ClaudeStreamJsonCliCleanupProvider` | Persistent Claude CLI process with stream-json protocol | `src/ai/cleanup/claude-persistent-cli-provider.ts` |
| `AiProviderLifecycleService` | Wraps provider with prepare/warm/reset state machine | `src/ai/cleanup/provider-lifecycle-service.ts` |
| `NotionAutomationService` | Polling loop that uploads finished drafts to Notion | `src/notion/automation-service.ts` |
| `runNotionUpload` | Upload workflow (resolve target → write page + blocks → record write) | `src/notion/writer.ts` |
| `NotionClient` (port) | Notion REST API HTTP adapter | `src/notion/client.ts` |
| `NotionRegistryStore` (god-node, 100 edges) | Workspace + managed-database registry | `src/notion/registry-store.ts` |
| `NotionWriteStore` | Idempotency log of Notion writes per draft | `src/notion/write-store.ts` |
| `NotionDashboardService` | Dashboard-facing read+command model for Notion state | `src/notion/dashboard-service.ts` |
| `SessionStore` (god-node, 136 edges) | Aggregating façade over all repositories + path resolver | `src/storage/session-store.ts` |
| `SqlRunner` (god-node, 113 edges) | Prepared-statement wrapper for non-Session callers | `src/storage/sql-runner.ts` |
| `DirongDatabase` (god-node, 127 edges) | `node:sqlite` handle + migrations + WAL + busy-timeout | `src/storage/sqlite.ts` |
| `applySchemaMigrations` | Forward-only migration runner | `src/storage/migrations.ts` |
| `PollingLoop` / `EnabledPollingLoop` | Cancellable interval-based tick scheduler reused by every automation | `src/runtime/polling-loop.ts` |
| `runChild` | Hardened `child_process.spawn` wrapper used by Whisper + Claude adapters | `src/process/run-child.ts` |
| `DashboardServer` | Local-only HTTP server hosting React/HTML dashboard + JSON APIs | `src/dashboard/server.ts` |
| `ProductSettings` (load + providers) | Reads filesystem settings, derives setup-status snapshot, supplies runtime accessors | `src/settings/product-settings.ts` |
| `SettingsResetService` | Coordinated reset across stores (settings, secrets, projects, registry, writes) | `src/settings/reset-service.ts` |
| `ProjectStore` / `ActiveProjectService` | Multi-project switching + scope guard | `src/projects/project-store.ts`, `src/projects/active-project-service.ts` |
| i18n catalog | Locale-keyed message lookup used everywhere user-visible | `src/i18n/catalog.ts`, `src/i18n/app-locale.ts` |
| Setup wizard | Initial setup orchestration (discord token, whisper install, notion connect) | `src/setup/wizard-service.ts` |

## Pattern Overview

**Overall:** Layered hexagonal pipeline.

- A long-running Node.js process (`src/app/main.ts`) owns every subsystem and exposes manual entry points as standalone CLI scripts under `src/app/`.
- Each pipeline stage is an autonomous **automation service** built on the shared `PollingLoop` primitive, communicating with the next stage through SQLite job queues — there is no in-memory chain between phases.
- Each stage exposes a **provider port** (`SttProvider`, `AiCleanupProvider`, `NotionClient`) with concrete adapters (local subprocess, HTTP API, fake). Adapters are swapped via factories (`createPhase3SttProvider`, `createAiCleanupProvider` in `main.ts`).
- Each stage has a **storage port** (`*-port.ts` modules) that scopes which `SessionStore` operations the stage can call, enabling tight tests with in-memory fakes.

**Key Characteristics:**
- Phase boundaries are durable: every stage transition writes a row + file artifact, so a crash never loses work.
- Single SQLite database (path from `config.dbPath`) is the shared bus; WAL mode + `BEGIN IMMEDIATE` transactions provide concurrency.
- All long-running work goes through `PollingLoop` so cancel/abort/runOnce semantics are uniform.
- All subprocess work goes through `src/process/run-child.ts` with policy gating (`src/process/command-policy.ts`).
- Multi-tenant: every stage filters by `project_id` resolved from `ProjectStore.getActiveProjectId()`.

## Layers

**Entry layer (`src/app/`):**
- Purpose: Bootstrapping for `npm start` and every phase CLI; arg parsing + wiring + process exit code.
- Location: `src/app/`
- Contains: `main.ts`, `phase{3,4,5}-*-cli.ts`, `doctor.ts`, `repair.ts`, `session-purge.ts`, `notion-upload.ts`, `ai-cleanup.ts`, `real-stt.ts`, `fake-stt.ts`, `claude-persistent-smoke.ts`.
- Depends on: every domain subsystem.
- Used by: `package.json#scripts` only.

**Runtime layer (`src/runtime/`, `src/process/`, `src/cli/`, `src/i18n/`, `src/messages/`, `src/errors.ts`, `src/health.ts`):**
- Purpose: Reusable mechanical primitives — polling, subprocess, arg parsing, locale, CLI error printing, health checks.
- Depends on: nothing in domain layers (lowest layer aside from `storage/sqlite.ts`).
- Used by: every domain layer.

**Domain layers (parallel, each owns its provider port + storage port + automation service):**
- `src/recording/` — Discord voice → opus chunks → STT-ready audio.
- `src/stt/` — chunk audio → transcript segments via Whisper.
- `src/ai/cleanup/` — transcript timeline → meeting-notes draft via Claude.
- `src/notion/` — meeting-notes draft → Notion page + relations.

Each domain layer:
- Defines its own `*-port.ts` describing the SessionStore subset it consumes.
- Defines a provider interface where applicable (`SttProvider`, `AiCleanupProvider`, `NotionClient`).
- Exposes an `automation-service.ts` (or `dashboard-service.ts`) that wraps the runner in a `PollingLoop`.

**Settings/projects/setup layer (`src/settings/`, `src/projects/`, `src/setup/`):**
- Purpose: Persistent configuration, multi-project switching, setup wizard state.
- Storage: JSON files (`settings.json`, `secrets.json`) + SQLite tables (`dirong_projects`, etc.).

**Edge layer (`src/discord/`, `src/dashboard/`):**
- Purpose: Inbound surfaces.
- `src/discord/commands.ts` defines the `/dirong` slash-command payload; `src/discord/active-project-command-gate.ts` validates the invoking guild.
- `src/dashboard/server.ts` runs the local HTTP dashboard with route modules for setup, projects, notion, settings reset.

**Storage layer (`src/storage/`):**
- Purpose: SQLite + filesystem persistence; aggregates all repository access through `SessionStore`.

## Data Flow

### Primary Pipeline: Discord audio → Notion page

1. User runs `/dirong start` in Discord (`src/app/main.ts:407` `handleDirongCommand`).
2. `RecordingProducer.start()` joins the voice channel and creates a `sessions` row + per-session directory (`src/recording/recording-producer.ts`).
3. For every speaker, `SpeakerChunkManager` opens an Opus stream and writes `raw_chunks/<chunk>.opus`; on rollover/silence/max-length `ChunkFinalizer` transcodes to `stt_audio/<chunk>.<sttSafeFormat>` and inserts a row in `stt_jobs` queue (`src/recording/chunk-finalizer.ts`).
4. `SttAutomationService` polling tick calls `runSttBatch` (`src/stt/runner.ts`), which:
   - releases expired processing leases,
   - claims one queued job (`claimNextSttJob`),
   - calls the active `SttProvider.transcribe()`,
   - writes a `transcript_segments` row via `completeSttJob` (`src/stt/storage-port.ts`).
5. When Discord voice goes empty `AloneFinalizeService` calls `producer.stop()` which marks the session `finalized` (`src/recording/alone-finalize-service.ts`).
6. `AiCleanupAutomationService` polling tick calls `listFinalizedSessionsForAiCleanupAutomation`, then `runAiCleanup` per session (`src/ai/cleanup/runner.ts`):
   - builds `Phase4TranscriptTimeline` from transcript segments + member roster + custom property prompt,
   - hashes the input and calls `getOrCreateAiCleanupJob` (idempotency on `inputHash`),
   - claims the job, calls `AiCleanupProvider.generate()` against persistent Claude CLI,
   - parses `MeetingNotesDraftV1` JSON, renders Markdown, stores in `meeting_notes_drafts`.
7. `NotionAutomationService` polling tick reads completed drafts via `NotionDraftInputReadModel`, calls `runNotionUpload` (`src/notion/writer.ts`):
   - resolves Notion target via `NotionRegistryStore` + `parseNotionTargetUrl`,
   - writes `notion_writes` idempotency row (`NotionWriteStore`),
   - calls `NotionClient.createPage` / `appendBlockChildren` / `updatePage`.
8. On upload success the configured `NotionUploadRetentionHandler` (built in `main.ts:771`) deletes audio per `RetentionPolicy` from `src/storage/file-retention.ts`.

### Manual phase invocation

1. Operator runs `npm run phase4:ai-cleanup -- --session <id>` (`src/app/ai-cleanup.ts` → `phase4-ai-cleanup-cli.ts`).
2. CLI parses args (`src/cli/arg-parser.ts`), constructs `SessionStore`, `AiCleanupProvider`, calls `runAiCleanup` once.
3. CLI prints structured result via `src/cli/error-output.ts` and exits with appropriate code.

### Dashboard request flow

1. `DashboardServer.start()` (`src/dashboard/server.ts`) binds `127.0.0.1` (`LOCAL_ONLY_DASHBOARD_HOST`).
2. Each request enters `routeDashboardRequest` (`src/dashboard/router.ts`) which checks `createDashboardToken` (`src/dashboard/security.ts`) then dispatches to a route module (`notion-routes.ts`, `project-routes.ts`, `setup-routes.ts`, `settings-reset-routes.ts`).
3. Route handlers call into the corresponding domain service (e.g. `NotionDashboardService`, `SetupWizardService`).
4. Heartbeat: if no client request arrives within `clientHeartbeatTimeoutMs` (20 s in `main.ts:237`) the server triggers `shutdown("dashboard_closed")`.

**State Management:**
- All durable state lives in SQLite (`config.dbPath`) and the per-session filesystem tree under `config.dataDir`.
- In-memory state is owned by service classes (`RecordingProducer.activeSessions`, `NotionAutomationService.inFlightDraftIds`, `PollingLoop.tickPromise`); it is reconstructed from DB on restart by `runStartupRepair` (`src/storage/repair-scan.ts`).

## Key Abstractions

**Port (`*-port.ts`):**
- Purpose: Subset of `SessionStore` methods a domain layer is allowed to call. Enables in-memory test doubles.
- Examples: `src/recording/storage-port.ts`, `src/stt/storage-port.ts`, `src/ai/cleanup/storage-port.ts`, `src/dashboard/storage-port.ts`.
- Pattern: Type-only TypeScript interfaces composed via intersection (e.g. `RecordingProducerStore = ConnectionEventStore & RepairItemStore & SessionLifecycleStore & SpeakerStore & ChunkWriteStore`).

**Provider:**
- Purpose: Pluggable adapter behind a stable interface for external compute.
- Examples: `SttProvider` (`src/stt/provider.ts`), `AiCleanupProvider` (`src/ai/cleanup/provider.ts`), `NotionClient` (`src/notion/client.ts`).
- Pattern: Selected by factory function reading settings (`createPhase3SttProvider`, `createAiCleanupProvider`, `createNotionClient`).

**Automation service:**
- Purpose: Long-running background worker for one phase.
- Examples: `SttAutomationService`, `AiCleanupAutomationService`, `NotionAutomationService`, `AloneFinalizeService`.
- Pattern: Wraps a `PollingLoop`, exposes `start() / stop() / runOnce() / getSnapshot()`. Snapshot powers both dashboard JSON and console `status` text.

**Snapshot + display:**
- Purpose: Locale-aware human-readable status. Each automation returns a `*Snapshot` plus a `formatXForStatus(snapshot, locale)` function (`src/messages/human-status.ts`).
- Examples: `formatSttAutomationForStatus`, `formatNotionAutomationForStatus`, `formatAiCleanupAutomationForStatus`.

**Job queue (DB-backed):**
- Purpose: Crash-safe handoff between phases.
- Examples: `stt_jobs` (`src/storage/stt-job-queue.ts`), `ai_cleanup_jobs` (`src/storage/ai-cleanup-job-queue.ts`), `notion_writes`.
- Pattern: `claim*` writes worker_id + lease_until_iso; `releaseExpired*Leases(nowIso)` repairs orphaned claims at tick start.

**Stored path normalization:**
- Purpose: Database stores filesystem paths relative to `storageRoot`, so `dataDir` may be moved without breaking references.
- File: `src/storage/path-resolver.ts` (`createStoragePathResolver`, `toStoredPath`, `resolveStoredPath`).

## Entry Points

**`start` (long-running):**
- Location: `src/app/main.ts` → built to `dist/app/main.js`.
- Triggers: `npm start`, `npm run dev`, `Dirong Start.bat`.
- Responsibilities: Boot the entire product — DB open + migrate, dashboard, Discord login, four automations, slash-command registration, console REPL.

**`doctor`:**
- Location: `src/app/doctor.ts`.
- Triggers: `npm run doctor`.
- Responsibilities: Run `health.ts` checks + `managed-schema-status` snapshot, print summary, exit non-zero on critical failures.

**`repair`:**
- Location: `src/app/repair.ts`.
- Triggers: `npm run repair`.
- Responsibilities: Run `runStartupRepair` (orphaned chunks, expired leases, partial files) and print results without starting the runtime.

**`sessions:purge`:**
- Location: `src/app/session-purge.ts` → `src/app/session-purge-cli.ts`.
- Triggers: `npm run sessions:purge`.
- Responsibilities: Apply `src/storage/session-purge.ts` to delete sessions older than retention threshold (DB rows + files).

**Phase CLIs (`phase2:fake-stt`, `phase3:stt`, `phase4:ai-cleanup`, `phase4:claude-persistent-smoke`, `phase5:notion-upload`):**
- Location: `src/app/{fake-stt,real-stt,ai-cleanup,claude-persistent-smoke,notion-upload}.ts` (entrypoints) → `src/app/phase{3,4,5}-*-cli.ts` (parsers + runners).
- Triggers: `npm run phase{2..5}:*`.
- Responsibilities: One-shot manual invocation of a single phase against a single session, useful for debugging and `--dry-run` diagnostics.

**`bundle:portable`:**
- Location: `src/scripts/create-portable-bundle.ts`.
- Triggers: `npm run bundle:portable`.
- Responsibilities: Produce a portable distribution including the embedded Python runtime referenced by `local-whisper-provider.ts`.

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop. SQLite is accessed synchronously through `node:sqlite` (`DirongDatabase.db`), so all DB calls are blocking on the main thread; long-running work (Whisper, Claude, Notion HTTP) is delegated to subprocesses or async fetch.
- **Subprocess gating:** All `child_process.spawn` calls must go through `src/process/run-child.ts`; policy lives in `src/process/command-policy.ts`.
- **Database concurrency:** WAL mode is mandatory (`PRAGMA journal_mode = WAL` in `src/storage/sqlite.ts:49`); all writes use `BEGIN IMMEDIATE` via `DirongDatabase.transaction`. `busy_timeout` is set from `config.dbBusyTimeoutMs`.
- **Dashboard is local-only:** `DashboardServer` binds `LOCAL_ONLY_DASHBOARD_HOST` (`src/settings/defaults.ts`) — no remote exposure.
- **`SessionStore` is the single aggregate root.** Domain code outside `src/storage/` must depend on a port (`*-port.ts`), not directly on `SessionStore`. The exception is `main.ts` which constructs and threads it.
- **Stored paths are relative.** Direct `fs` access on `*_path` columns must round-trip through `StoragePathResolver`.
- **Project scope is mandatory.** Every domain action must resolve `projectId` (typically `projectStore.getActiveProjectId() ?? DEFAULT_PROJECT_ID` from `src/projects/project-types.ts`). Unscoped queries against project-aware tables are a defect.
- **No silent fallbacks for missing config.** Per project policy, missing required settings must raise a loud error rather than substitute defaults; see `requireSetupDefaults`/`canStartXAutomation` gates in `src/settings/product-settings.ts`.
- **No mock data on production paths.** Fake providers (`FakeSttProvider`, `FakeAiCleanupProvider`) are only selected through explicit `--provider fake` CLI flags or `*.test.ts` files.
- **Forward-only migrations.** `applySchemaMigrations` runs once on open; an automatic `backupOpenDatabaseSnapshot` is taken before any pending migration runs (`src/storage/sqlite.ts:39`). Migration files live in `src/storage/schema-fragments/` and are listed in `src/storage/migrations.ts`.
- **i18n-required for user-facing text.** All user-visible strings go through `t(locale, key)` / `formatLocaleText(locale, key, vars)` from `src/i18n/catalog.ts`.

## Anti-Patterns

### Bypassing `SessionStore` with raw SQL

**What happens:** Calling `new SqlRunner(database)` from a domain module and writing ad-hoc SQL.
**Why it's wrong:** Migrations, path normalization, transaction boundaries, and idempotency invariants all live in repository methods. Raw SQL silently skips them.
**Do this instead:** Add the operation to the appropriate repository (`src/storage/*-repository.ts` or `*-job-queue.ts`), surface it through `SessionStore`, then expose just that method on the consuming layer's `*-port.ts`.

### Reading absolute paths directly from rows

**What happens:** `fs.existsSync(row.input_audio_path)` against a row whose `input_audio_path` is a stored relative path.
**Why it's wrong:** When `dataDir` is moved or the bundle is repackaged the absolute prefix changes; rows now point nowhere.
**Do this instead:** Use `SessionStore.resolveStoredPath` / the resolver returned by `createStoragePathResolver` (`src/storage/path-resolver.ts`).

### Spawning child processes outside `runChild`

**What happens:** `import { spawn } from "node:child_process"` inside an adapter (e.g. a new STT provider).
**Why it's wrong:** Skips command policy, timeout enforcement, stderr capture, and the structured error envelope used by `printCliError`.
**Do this instead:** Use `runChild` from `src/process/run-child.ts`; see `src/stt/local-whisper-provider.ts` for the canonical pattern.

### Inline `setInterval` for background work

**What happens:** A new automation uses `setInterval` directly.
**Why it's wrong:** Loses cancel-on-shutdown, abort-signal propagation, lease repair on restart, and `runOnce()` testability.
**Do this instead:** Compose `PollingLoop` from `src/runtime/polling-loop.ts`; see `NotionAutomationService` constructor in `src/notion/automation-service.ts:108`.

### Hardcoded user-facing strings

**What happens:** `interaction.editReply("Recording started")`.
**Why it's wrong:** Bypasses locale switching driven by `createAppLocaleResolver` (`src/i18n/app-locale.ts`); breaks Korean/English parity.
**Do this instead:** Add the key to `src/i18n/catalog.ts` and use `t(resolveAppLocale(), "key")`.

### Querying project-scoped tables without `project_id`

**What happens:** `SELECT * FROM notion_writes WHERE draft_id = ?` without filtering by `project_id`.
**Why it's wrong:** A reset/migration may leave rows from another project; multi-project mode breaks invariants.
**Do this instead:** Resolve `projectStore.getActiveProjectId() ?? DEFAULT_PROJECT_ID` and include it in the predicate (search for `project_id` in `src/notion/write-store.ts` and `src/storage/migrations.ts` for the canonical SQL shape).

## Error Handling

**Strategy:** Throw a typed `DirongError` (`src/errors.ts`) for user-facing failures; let unexpected exceptions bubble to the top-level handlers in `main.ts` (`process.on("uncaughtException", ...)`, `process.on("unhandledRejection", ...)`) which call `printCliError` and `shutdown`.

**Patterns:**
- CLI surfaces format errors with `printCliError(error, { prefix })` from `src/cli/error-output.ts`.
- Locale-aware messages use `toLocalizedErrorMessage(error, locale)` from `src/errors.ts`.
- For background ticks `PollingLoop.options.onScheduledError` swallows-and-logs so a single tick failure does not stop the loop.
- Job-queue runners distinguish `failProcessingSttJob` / `blockAiCleanupJob` (terminal) from `releaseExpired*Leases` (retryable).
- Provider adapters wrap external errors in `AiCleanupProviderError` / `NotionApiError` with a discriminated `failureKind` so upper layers can decide retry vs block.

## Cross-Cutting Concerns

**Logging:** `console.log` / `console.error` only. Structured fields are emitted as JSON via `JSON.stringify(redactForJson(...))` (`src/errors.ts`) to keep secrets out of logs.

**Validation:** Schemas live close to their owner — `src/notion/schema.ts` for Notion property shapes, `src/ai/cleanup/draft/schema.ts` + `src/ai/cleanup/draft/validate.ts` for the `MeetingNotesDraftV1` JSON contract, `src/cli/arg-parser.ts` for CLI input.

**Authentication:**
- Discord: bot token from `Phase1Config.discordBotToken` passed to `client.login` in `src/app/main.ts:328`.
- Notion: API key resolved per-project via `NotionRuntimeSettingsProvider` (`src/notion/settings.ts`) → `createNotionClient`.
- Dashboard: per-process token from `createDashboardToken` (`src/dashboard/security.ts`); the dashboard binds loopback only.
- OpenAI STT: API key from `SttSettings.openai.apiKey` (`src/stt/openai-provider.ts`).
- Local Whisper / Claude CLI: process-level credentials (no key handed to the adapter).

**Secrets:** Persisted under `LocalSecretStore` (`src/settings/local-secret-store.ts`) referenced by opaque `secret_ref` strings; never logged (see `redactSensitiveText` in `src/errors.ts`).

**Locale resolution:** `createAppLocaleResolver({ getLocale })` in `src/i18n/app-locale.ts` is built once in `main.ts` and threaded into every service via `localeResolver` constructor option, so a single setting flips every automation's status text.

**Health & repair:** `src/health.ts` defines reusable checks (DB reachable, ffmpeg present, Whisper installed). `src/storage/repair-scan.ts` is run at startup and via `npm run repair`.

---

*Architecture analysis: 2026-05-15*
