# Codebase Structure

**Analysis Date:** 2026-05-15

## Directory Layout

```
discord_record_bot/
├── src/                          # All TypeScript source (compiled to dist/)
│   ├── app/                      # Entry points: main + per-phase CLIs + ops scripts
│   ├── ai/cleanup/               # Phase 4 — Claude-driven meeting notes cleanup
│   │   └── draft/                # MeetingNotesDraftV1 parse/validate/normalize
│   ├── assets/                   # Bundled binary assets (e.g. dirong/dirong_discord.png)
│   ├── cli/                      # Shared CLI plumbing (arg parser, error printer)
│   ├── dashboard/                # Local-only HTTP dashboard server + routes
│   │   └── public/               # Static dashboard assets (HTML/CSS/JS)
│   ├── discord/                  # Discord slash-command payloads + active-project gate
│   ├── i18n/                     # Locale catalog + per-call locale resolver
│   ├── messages/                 # Human-readable status formatting (locale-aware)
│   ├── notion/                   # Phase 5 — Notion REST adapter + automation
│   ├── process/                  # Hardened child_process spawn wrapper + policy
│   ├── projects/                 # Multi-project store + active-project switching
│   ├── recording/                # Phase 1 — Discord voice recording producer
│   ├── runtime/                  # PollingLoop primitive (used by every automation)
│   ├── scripts/                  # Build-time scripts (copy assets, portable bundle)
│   ├── settings/                 # JSON-backed settings + secrets + reset orchestration
│   ├── setup/                    # First-run wizard (whisper install, OpenAI test, etc.)
│   ├── storage/                  # SQLite schema, migrations, repositories, SessionStore
│   │   └── schema-fragments/     # Per-table SQL chunks composed by schema.ts
│   ├── stt/                      # Phase 3 — STT provider port + adapters + automation
│   ├── transcript/               # Pure timeline/time-format helpers
│   ├── config.ts                 # Phase1Config type + snapshot helper
│   ├── dave.ts                   # Discord-Audio-via-WebRTC-Encryption (DAVE) helpers
│   ├── errors.ts                 # DirongError + redaction + safe error info
│   ├── health.ts                 # Reusable health check predicates
│   └── media.ts                  # Audio file helpers (sha256, etc.)
├── scripts/                      # Runtime helper scripts shipped with the app
│   └── local-whisper-json.py    # Python entrypoint invoked by LocalWhisperSttProvider
├── docs/
│   ├── completed-features.md    # Changelog of shipped features
│   └── plans/                   # Per-feature plan documents
├── graphify-out/                 # Knowledge-graph artefacts (do not edit by hand)
│   ├── GRAPH_REPORT.md           # God nodes + community structure
│   └── wiki/                    # (optional) navigable wiki form
├── .planning/codebase/           # GSD codebase maps (this directory)
├── dist/                         # `tsc` build output (gitignored)
├── references/                   # Vendored upstream code for reference (read-only)
├── package.json                  # Scripts + Node 22 + dependencies
├── tsconfig.json                 # Strict TS, NodeNext, target ES2022
├── Dirong Start.bat              # Windows launcher → `npm start`
├── AGENTS.md                     # Agent orchestration rules
├── CLAUDE.md                     # Project-specific Claude instructions
├── README.md
└── LICENSE
```

## Directory Purposes

**`src/app/`:**
- Purpose: Every executable entry point. Nothing else may sit at this layer.
- Contains: `main.ts` (long-running runtime), `phase{3,4,5}-*-cli.ts` (parsers + bodies), thin CLI launchers (`real-stt.ts`, `ai-cleanup.ts`, `notion-upload.ts`, `fake-stt.ts`, `claude-persistent-smoke.ts`), ops tools (`doctor.ts`, `repair.ts`, `session-purge.ts`).
- Key files: `src/app/main.ts`, `src/app/phase4-ai-cleanup-cli.ts`, `src/app/doctor.ts`.

**`src/ai/cleanup/`:**
- Purpose: Phase 4 (transcript → meeting-notes draft) — provider port, runner, automation, persistent Claude CLI adapter, draft schema.
- Key files: `src/ai/cleanup/runner.ts`, `src/ai/cleanup/automation-service.ts`, `src/ai/cleanup/provider.ts`, `src/ai/cleanup/claude-persistent-cli-provider.ts`, `src/ai/cleanup/storage-port.ts`, `src/ai/cleanup/draft/schema.ts`.

**`src/cli/`:**
- Purpose: Shared CLI plumbing reused by every `src/app/*` entry point.
- Key files: `src/cli/arg-parser.ts`, `src/cli/error-output.ts`, `src/cli/stt-summary.ts`.

**`src/dashboard/`:**
- Purpose: Local-only HTTP dashboard + JSON command surface.
- Key files: `src/dashboard/server.ts`, `src/dashboard/router.ts`, `src/dashboard/notion-routes.ts`, `src/dashboard/project-routes.ts`, `src/dashboard/setup-routes.ts`, `src/dashboard/settings-reset-routes.ts`, `src/dashboard/security.ts`, `src/dashboard/storage-port.ts`, `src/dashboard/state.ts`, `src/dashboard/static-assets.ts`.
- Static assets live in `src/dashboard/public/` and are copied to `dist/dashboard/public/` by `src/scripts/copy-dashboard-assets.ts`.

**`src/discord/`:**
- Purpose: Slash-command payloads + guild gate (no runtime — `RecordingProducer` owns the voice connection).
- Key files: `src/discord/commands.ts`, `src/discord/active-project-command-gate.ts`.

**`src/i18n/` and `src/messages/`:**
- Purpose: Locale catalog + status text formatting.
- Key files: `src/i18n/catalog.ts`, `src/i18n/app-locale.ts`, `src/messages/human-status.ts`, `src/messages/session-status.ts`, `src/messages/user-messages.ts`.

**`src/notion/`:**
- Purpose: Phase 5 — Notion REST client, schema management, page/blocks writer, registry of managed databases, member-roster sync, automation polling loop.
- Key files: `src/notion/automation-service.ts`, `src/notion/writer.ts`, `src/notion/client.ts`, `src/notion/schema-manager.ts`, `src/notion/registry-store.ts`, `src/notion/write-store.ts`, `src/notion/dashboard-service.ts`, `src/notion/managed-schema*.ts`, `src/notion/member-roster-*.ts`, `src/notion/property-rules.ts`, `src/notion/upload-retention.ts`, `src/notion/target.ts`.

**`src/process/`:**
- Purpose: Hardened subprocess execution + allow-list policy. Anything that calls `spawn` must go through here.
- Key files: `src/process/run-child.ts`, `src/process/command-policy.ts`.

**`src/projects/`:**
- Purpose: Multi-project storage + active-project switching with safety gates.
- Key files: `src/projects/project-store.ts`, `src/projects/active-project-service.ts`, `src/projects/project-types.ts`.

**`src/recording/`:**
- Purpose: Phase 1 — Discord voice ingest. Owns Opus stream demultiplex, per-speaker chunk lifecycle, transcode, alone-finalize.
- Key files: `src/recording/recording-producer.ts`, `src/recording/chunk-finalizer.ts`, `src/recording/speaker-chunk-manager.ts`, `src/recording/voice-connection-controller.ts`, `src/recording/alone-finalize-service.ts`, `src/recording/storage-port.ts`.

**`src/runtime/`:**
- Purpose: Reusable async primitives. Currently houses only `PollingLoop`/`EnabledPollingLoop`.
- Key files: `src/runtime/polling-loop.ts`.

**`src/scripts/`:**
- Purpose: Build-time scripts run by `npm run build` and `npm run bundle:portable`. Compiled into `dist/scripts/`.
- Key files: `src/scripts/copy-dashboard-assets.ts`, `src/scripts/create-portable-bundle.ts`.

**`src/settings/`:**
- Purpose: Persistent product settings (locale, retention, STT/AI/Notion config), secret store, reset orchestration, setup-status snapshot.
- Key files: `src/settings/product-settings.ts`, `src/settings/local-settings-store.ts`, `src/settings/local-secret-store.ts`, `src/settings/reset-service.ts`, `src/settings/defaults.ts`, `src/settings/dirong-user-data.ts`, `src/settings/app-settings.ts`, `src/settings/tool-profiles.ts`.

**`src/setup/`:**
- Purpose: First-run wizard logic — Whisper install detection/install, OpenAI connection test, wizard state machine.
- Key files: `src/setup/wizard-service.ts`, `src/setup/local-whisper-install-service.ts`, `src/setup/openai-stt-connection-test.ts`.

**`src/storage/`:**
- Purpose: Single durable persistence layer — `node:sqlite` handle, schema fragments, forward-only migrations, repositories per aggregate, the `SessionStore` façade.
- Key files: `src/storage/sqlite.ts`, `src/storage/schema.ts`, `src/storage/migrations.ts`, `src/storage/sql-runner.ts`, `src/storage/session-store.ts`, `src/storage/session-repository.ts`, `src/storage/chunk-repository.ts`, `src/storage/transcript-repository.ts`, `src/storage/stt-job-queue.ts`, `src/storage/ai-cleanup-job-queue.ts`, `src/storage/meeting-notes-draft-repository.ts`, `src/storage/repair-repository.ts`, `src/storage/repair-scan.ts`, `src/storage/path-resolver.ts`, `src/storage/file-retention.ts`, `src/storage/sqlite-backup.ts`, `src/storage/dashboard-read-model.ts`, `src/storage/status-text-read-model.ts`, `src/storage/ai-cleanup-terminal-read-model.ts`, `src/storage/session-purge.ts`, `src/storage/rows.ts`.
- Per-table SQL fragments live in `src/storage/schema-fragments/` and are concatenated by `src/storage/schema.ts`.

**`src/stt/`:**
- Purpose: Phase 3 — STT provider port + adapters + batch runner + automation service.
- Key files: `src/stt/automation-service.ts`, `src/stt/runner.ts`, `src/stt/provider.ts`, `src/stt/provider-factory.ts`, `src/stt/local-whisper-provider.ts`, `src/stt/openai-provider.ts`, `src/stt/fake-runner.ts`, `src/stt/storage-port.ts`.

**`src/transcript/`:**
- Purpose: Pure helpers (no I/O) — timeline construction, time formatting.
- Key files: `src/transcript/timeline.ts`, `src/transcript/time-format.ts`.

**`scripts/` (project root, non-TS):**
- Purpose: Helper executables shipped with the app.
- Key files: `scripts/local-whisper-json.py` (invoked by `LocalWhisperSttProvider`).

**`graphify-out/`:**
- Purpose: Generated knowledge-graph artefacts.
- Generated: Yes (by `graphify update .`).
- Committed: Yes — relied on by `CLAUDE.md` for navigation.

**`docs/`:**
- Purpose: Human-authored docs and plan history.
- Key files: `docs/completed-features.md`, files under `docs/plans/`.

## Key File Locations

**Entry Points (all under `src/app/`):**
- `src/app/main.ts`: `npm start` — long-running app (Discord client + dashboard + 4 automations).
- `src/app/doctor.ts`: `npm run doctor` — health check.
- `src/app/repair.ts`: `npm run repair` — startup repair sweep without runtime.
- `src/app/session-purge.ts`: `npm run sessions:purge` — old session cleanup.
- `src/app/fake-stt.ts`: `npm run phase2:fake-stt` — synthetic STT for pipeline tests.
- `src/app/real-stt.ts`: `npm run phase3:stt` — manual phase 3 invocation.
- `src/app/ai-cleanup.ts`: `npm run phase4:ai-cleanup` — manual phase 4 invocation.
- `src/app/claude-persistent-smoke.ts`: `npm run phase4:claude-persistent-smoke` — Claude CLI smoke test.
- `src/app/notion-upload.ts`: `npm run phase5:notion-upload` — manual phase 5 invocation.
- `src/scripts/create-portable-bundle.ts`: `npm run bundle:portable`.

**Configuration:**
- `package.json`: Scripts, dependencies, Node engine pin (`>=22.12.0`), `"type": "module"`.
- `tsconfig.json`: Strict mode, `target ES2022`, `module NodeNext`, `noUncheckedIndexedAccess`, `rootDir: src`, `outDir: dist`.
- `src/config.ts`: `Phase1Config` shape (the runtime config object loaded by `main.ts`).
- `src/settings/defaults.ts`: Hard defaults (host = loopback, STT format, etc.).
- `src/settings/product-settings.ts`: Composes filesystem settings + DB-backed registry into a runtime snapshot used by `main.ts`.

**Core Logic:**
- `src/storage/session-store.ts`: Aggregate root for all DB access.
- `src/storage/sqlite.ts`: DB handle, WAL, migrations, `transaction(fn)`.
- `src/runtime/polling-loop.ts`: Cancellable interval-based loop used by every automation.
- `src/recording/recording-producer.ts`: Voice channel join + chunk lifecycle.
- `src/stt/runner.ts`: Phase 3 batch worker.
- `src/ai/cleanup/runner.ts`: Phase 4 per-session cleanup workflow.
- `src/notion/writer.ts`: Phase 5 Notion upload workflow.
- `src/dashboard/server.ts`: Local HTTP dashboard host.

**Testing:**
- Tests live next to their source as `*.test.ts` (e.g. `src/storage/migrations.test.ts`, `src/notion/writer.test.ts`).
- `npm run test` enumerates compiled test files explicitly in `package.json#scripts.test` (no glob discovery).

## Naming Conventions

**Files:**
- `kebab-case.ts` for all source modules (e.g. `recording-producer.ts`, `phase4-ai-cleanup-cli.ts`).
- `*.test.ts` co-located with the module under test (e.g. `runner.ts` ↔ `runner.test.ts`).
- `*-port.ts` for type-only port interfaces (`storage-port.ts`, `dashboard/storage-port.ts`).
- `*-service.ts` for stateful services with start/stop lifecycle (`automation-service.ts`, `wizard-service.ts`, `reset-service.ts`).
- `*-store.ts` for stateful repository wrappers (`session-store.ts`, `write-store.ts`, `project-store.ts`, `member-roster-store.ts`).
- `*-repository.ts` for narrow per-aggregate DB accessors used by `SessionStore`.
- `*-runner.ts` / `runner.ts` for one-shot batch workflows callable by both CLI and automation.
- `phase{N}-*-cli.ts` for phase-CLI parser+body modules in `src/app/`.
- `*-routes.ts` for dashboard route modules.
- `dirong-*` prefix for product-branded artefacts (`dirong-user-data.ts`, `dirong_discord.png`).

**Directories:**
- Lowercase single word per subsystem (`recording`, `notion`, `stt`, `dashboard`).
- Nested only when a subsystem has a tightly-coupled internal cluster (`ai/cleanup/draft/`, `storage/schema-fragments/`).

**Identifiers (TypeScript):**
- `PascalCase` for classes and exported types: `SessionStore`, `NotionAutomationService`, `Phase1Config`.
- `camelCase` for functions and local variables: `runSttBatch`, `createPhase3SttProvider`.
- `SCREAMING_SNAKE` for module-level constants: `DEFAULT_PROJECT_ID`, `MEETING_NOTES_DRAFT_SCHEMA_VERSION`, `LOCAL_ONLY_DASHBOARD_HOST`.
- `T` prefix is **not** used for type aliases; plain `PascalCase` is used (`SttRunOptions`, not `TSttRunOptions`).

## Where to Add New Code

**A new pipeline phase or background automation:**
- Service: `src/<phase>/automation-service.ts` (extend `PollingLoop`).
- One-shot runner: `src/<phase>/runner.ts`.
- Provider port (if external compute): `src/<phase>/provider.ts` + adapter file(s).
- Storage port: `src/<phase>/storage-port.ts` listing the `SessionStore` subset you consume.
- CLI: `src/app/phase{N}-<phase>-cli.ts` (parser + body) and a thin launcher `src/app/<phase>.ts` referenced from `package.json#scripts`.
- Tests: `*.test.ts` co-located, then add the compiled paths to `package.json#scripts.test`.

**A new STT or AI provider adapter:**
- Implementation: `src/stt/<name>-provider.ts` or `src/ai/cleanup/<name>-provider.ts`.
- Wire it into the factory: `src/stt/provider-factory.ts` or `createAiCleanupProvider` in `src/app/main.ts`.
- Subprocess access must go through `runChild` (`src/process/run-child.ts`).

**A new Notion property type / managed-schema rule:**
- Schema definition: `src/notion/schema.ts` and `src/notion/schema-presets.ts`.
- Diff/repair: extend `src/notion/managed-schema-diff.ts`, `src/notion/managed-schema-repair.ts`.
- Page write side: `src/notion/page-properties.ts`, `src/notion/property-shape.ts`, `src/notion/relation-resolver.ts`.

**A new SQLite table or column:**
- Add a SQL fragment under `src/storage/schema-fragments/` and reference it from `src/storage/schema.ts`.
- Add a migration to `src/storage/migrations.ts` (forward-only; backup is automatic).
- Add a `Row` type to `src/storage/rows.ts`.
- Build a focused repository under `src/storage/<thing>-repository.ts` and surface it via `SessionStore`.
- Add the new methods to the relevant `*-port.ts` so consumers can be tested with fakes.

**A new dashboard endpoint:**
- Route module: `src/dashboard/<area>-routes.ts` (or extend an existing one).
- Register in `src/dashboard/router.ts`.
- Auth via `createDashboardToken` in `src/dashboard/security.ts`.
- Domain logic stays in the corresponding `*-service.ts` — routes only translate HTTP ↔ method calls.

**A new Discord slash-command or subcommand:**
- Payload: extend `phase1GuildCommandPayloads` in `src/discord/commands.ts`.
- Handler: branch in `handleDirongCommand` inside `src/app/main.ts` (or extract a handler module if it grows).
- Guild gate: `evaluateActiveProjectCommandGate` (`src/discord/active-project-command-gate.ts`) must pass before any side effect.

**Shared utilities:**
- Async/timer primitives: `src/runtime/`.
- Subprocess helpers: `src/process/`.
- Pure transcript/time helpers: `src/transcript/`.
- Audio/file helpers: `src/media.ts`.
- Error envelope/redaction: `src/errors.ts`.
- Health predicates: `src/health.ts`.

**User-facing strings:**
- Always add the key to `src/i18n/catalog.ts` (both locale catalogs) and consume via `t(locale, key)` / `formatLocaleText(locale, key, vars)` — never hardcode.

**Tests:**
- Co-locate with source: `<module>.test.ts` next to `<module>.ts`.
- After adding a test, append the compiled path to `package.json#scripts.test` (e.g. `dist/<dir>/<name>.test.js`); discovery is explicit.

## Special Directories

**`dist/`:**
- Purpose: TypeScript build output.
- Generated: Yes (`tsc -p tsconfig.json`).
- Committed: No (gitignored).

**`graphify-out/`:**
- Purpose: Knowledge-graph artefacts referenced by `CLAUDE.md`.
- Generated: Yes (`graphify update .`).
- Committed: Yes.

**`references/`:**
- Purpose: Vendored upstream code for read-only reference (e.g. `craig/`, `discord-meeting-recorder/`).
- Generated: No.
- Committed: Yes — but excluded from compilation (`tsconfig.json` only includes `src/**/*.ts`). Treat as documentation, never import.

**`src/assets/`:**
- Purpose: Bundled binary assets resolved at runtime via `import.meta.url` (e.g. `dirong/dirong_discord.png` attached to `/dirong start` notices).
- Generated: No.
- Committed: Yes.

**`src/storage/schema-fragments/`:**
- Purpose: SQL `CREATE TABLE` chunks composed by `src/storage/schema.ts`.
- Generated: No.
- Committed: Yes.

**`src/dashboard/public/`:**
- Purpose: Static assets served by `DashboardServer`.
- Generated: No (authored by hand); copied to `dist/dashboard/public/` by the build step.
- Committed: Yes.

**`.planning/codebase/`:**
- Purpose: GSD codebase maps (this directory).
- Generated: Yes (by GSD map agents).
- Committed: Yes.

**`.agestra/`, `.codex/`, `.omc/`, `.omx/`, `.claude/`:**
- Purpose: Tooling state for various agent runners.
- Generated: Yes.
- Committed: Mixed (tooling-specific) — do not place product code here.

---

*Structure analysis: 2026-05-15*
