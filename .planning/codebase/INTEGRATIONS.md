# External Integrations

**Analysis Date:** 2026-05-15

## APIs & External Services

**Discord Platform:**
- Discord Gateway / REST — Bot connection used for guild voice recording, slash command registration, presence/voice-state monitoring.
  - SDK/Client: `discord.js` ^14.25.1 (entry: `src/app/main.ts:14`); `Client` constructed with `GatewayIntentBits.Guilds | GatewayIntentBits.GuildVoiceStates | GatewayIntentBits.GuildMembers` (see `src/app/main.ts`).
  - Slash commands: declared in `src/discord/commands.ts` (`/dirong start | stop | status`), registered per-guild via `phase1GuildCommandPayloads`.
  - Auto-registration toggle: `Phase1Config.autoRegisterCommands` in `src/config.ts`.
  - Auth: Bot token, secret ref `discord.bot_token` via `LocalSecretStore` (`src/settings/local-secret-store.ts:13`). Application ID stored in plaintext local settings under `discord.applicationId`.
  - OAuth2 invite URL builder: `buildDiscordInviteUrl()` in `src/setup/wizard-service.ts:1625` constructs `https://discord.com/oauth2/authorize?client_id=...&permissions=3146752&scope=bot+applications.commands`.

- Discord Voice (WebRTC + DAVE/E2EE) — Per-speaker Opus stream capture.
  - SDK/Client: `@discordjs/voice` ^0.19.0; `prism-media` ^2.0.0-alpha.0 for Opus decode + WebM mux.
  - Implementation: `src/recording/recording-producer.ts`, `src/recording/voice-connection-controller.ts`, `src/recording/speaker-chunk-manager.ts`.
  - DAVE (Discord Audio/Video End-to-end) introspection: `src/dave.ts` walks the voice connection state for DAVE/MLS/encrypt/decrypt evidence. Toggle `Phase1Config.enableDave`.
  - Decryption-failure tolerance: `Phase1Config.decryptionFailureTolerance` (default 24).
  - Health probe: `src/health.ts:4` calls `generateDependencyReport()` from `@discordjs/voice` and checks AES-256-GCM availability via `node:crypto`.

**Speech-to-Text (STT):**
- OpenAI Audio Transcriptions — Optional cloud STT.
  - SDK/Client: Plain `fetch` (no `openai` npm package). Endpoint `https://api.openai.com/v1/audio/transcriptions` (see `src/stt/openai-provider.ts:11`).
  - Model: `gpt-4o-mini-transcribe` (default in `src/settings/defaults.ts:58`); `response_format: "json"`.
  - Upload limit: 25 MB enforced client-side at `src/stt/openai-provider.ts:12`.
  - Auth: Bearer header `Authorization: Bearer <apiKey>` from secret ref `stt.openai_api_key`.
  - Connection test: `DefaultOpenAiSttConnectionTester` calls `https://api.openai.com/v1/models/<model>` (see `src/setup/openai-stt-connection-test.ts:3`).

- Local Whisper (faster-whisper / openai-whisper) — Default offline STT.
  - Wrapper: `scripts/local-whisper-json.py` (CLI: `--check`, `--check-model`, `--download-model`, `--input`, `--model`, `--device`, `--compute-type`, `--language`).
  - Provider: `src/stt/local-whisper-provider.ts` spawns the wrapper via `runProcess()` (`src/media.ts`).
  - Default model: `small` on `cpu` with `int8` compute type (`src/settings/defaults.ts:60`).
  - Install pipeline: `src/setup/local-whisper-install-service.ts` orchestrates `checking_python → creating_venv → installing_package → checking_package → downloading_model → checking_model`. Managed Python venv at `<userData>/python-venv/` (`src/settings/dirong-user-data.ts:70`). Models cached under `<userData>/models/`.
  - Provider selection: `src/stt/provider-factory.ts`.

**AI Cleanup (Meeting-note generation):**
- Anthropic Claude Code CLI (`claude`) — The only currently supported AI cleanup runtime path.
  - Invocation: `src/ai/cleanup/claude-persistent-cli-provider.ts` (`ClaudeStreamJsonCliCleanupProvider`). Default command `"claude"` (`src/ai/cleanup/claude-persistent-cli-provider.ts:57`).
  - Persistent stream-JSON session: `src/ai/cleanup/claude-persistent-smoke.ts` keeps a long-running stdin/stdout JSON conversation.
  - Default model: `DEFAULT_CLAUDE_CLEANUP_MODEL` from `src/ai/cleanup/claude-models.ts`. Setup-wizard model choices: `haiku | sonnet | opus` (`src/settings/defaults.ts:31`).
  - Preflight: `claude --version` via `runChild` (5 s timeout).
  - Setup-only API smoke: setup wizard can validate an Anthropic API key by GETing `https://api.anthropic.com/v1/models?limit=1` with `x-api-key` and `anthropic-version: 2023-06-01` (`src/setup/wizard-service.ts:1511`). Production AI path is CLI-only; the API mode is exposed in settings via `AiProviderMode = "cli" | "api"` in `src/settings/local-settings-store.ts:34` but the production runtime in `src/app/main.ts` wires the CLI provider.
  - Auth: secret ref `ai.claude_api_key` (only relevant for the API smoke test; CLI auth is delegated to the `claude` CLI's own login state).

**Notion:**
- Notion API v1 (data sources / databases / pages / blocks).
  - Client: hand-rolled `FetchNotionClient` in `src/notion/client.ts:144`. No `@notionhq/client` package.
  - Base URL: `https://api.notion.com` (default in `src/notion/settings.ts:50`). Notion-Version header default: `2026-03-11` (`src/notion/settings.ts:49`).
  - Endpoints used:
    - `GET /v1/pages/{id}`, `POST /v1/pages`, `PATCH /v1/pages/{id}`
    - `GET /v1/databases/{id}`, `POST /v1/databases`
    - `POST /v1/data_sources`, `GET /v1/data_sources/{id}`, `PATCH /v1/data_sources/{id}`, `POST /v1/data_sources/{id}/query`
    - `PATCH /v1/blocks/{id}/children`, `GET /v1/blocks/{id}/children` (paginated, page_size=100)
  - Error model: `NotionApiError` with kind `auth | not_found | conflict | rate_limited | validation | server | network | timeout | invalid_json | unknown` (`src/notion/client.ts:86`). Honors `Retry-After`.
  - Auth: Bearer header `Authorization: Bearer <token>` from secret ref `notion.internal_connection_token`. Internal Integration Token model.
  - Managed schema: roles, presets, diff/repair under `src/notion/schema-presets.ts`, `src/notion/managed-schema*.ts`, persisted in SQLite via `src/notion/registry-store.ts` and migrations `002_notion_writes`, `003_notion_custom_property_rules`, `007_notion_registry`, `009_notion_member_roster_cache`, etc. (`src/storage/migrations.ts:14`).
  - Upload pipeline: `src/notion/automation-service.ts`, `src/notion/writer.ts`, `src/notion/upload-retention.ts`, `src/notion/dashboard-service.ts`.

**Anthropic Public API:**
- Used **only** for the setup-wizard model-list smoke test described above. Not used at runtime by the AI cleanup pipeline.

**NuGet (build-only):**
- `https://api.nuget.org/v3-flatcontainer/python/<version>/python.<version>.nupkg` — Downloaded by `src/scripts/create-portable-bundle.ts:311` to embed Python into the Windows portable bundle. Not invoked at app runtime.

## Data Storage

**Databases:**
- SQLite (single file, embedded)
  - Engine: Node.js built-in `node:sqlite` (`DatabaseSync`) — see `src/storage/sqlite.ts:3`.
  - Connection: `<userData>/sessions/dirong.sqlite` (`src/settings/dirong-user-data.ts:66`).
  - Pragmas applied at open: `busy_timeout = <Phase1Config.dbBusyTimeoutMs>`, `foreign_keys = ON`, `journal_mode = WAL` (`src/storage/sqlite.ts:30-49`).
  - Schema bootstrap: `SCHEMA_SQL` from `src/storage/schema.ts`, then sequential migrations in `src/storage/migrations.ts` (`SCHEMA_MIGRATIONS` array, ids `001_*` through `012_*`).
  - Migration safety: a backup snapshot is written before applying any pending migration (`backupOpenDatabaseSnapshot()` from `src/storage/sqlite-backup.ts`).
  - Repositories: `src/storage/session-repository.ts`, `src/storage/chunk-repository.ts`, `src/storage/meeting-notes-draft-repository.ts`, `src/storage/repair-repository.ts`, queues `src/storage/stt-job-queue.ts` and `src/storage/ai-cleanup-job-queue.ts`.

**File Storage:**
- Local filesystem only — All recordings, transcripts, AI drafts, logs, models, and Python venv live under the user-data directory:
  - `<userData>/sessions/` — Audio chunks, per-session artifacts, SQLite DB.
  - `<userData>/models/` — Local Whisper model cache (`src/settings/dirong-user-data.ts:63`).
  - `<userData>/python-venv/` — Managed Python virtualenv (`src/settings/dirong-user-data.ts:70`).
  - `<userData>/logs/` — App logs.
  - `src/ai/cleanup/artifact-store.ts` persists AI drafts/preview markdown to per-session artifact paths under `sessions/`.
- Path resolution: `src/storage/path-resolver.ts`.
- Retention: `src/storage/file-retention.ts` plus `DEFAULT_RETENTION_SETTINGS = { deleteAudioAfterNotionUpload: true, textDraftRetentionDays: 30 }` (`src/settings/defaults.ts:102`).

**Caching:**
- None as a separate service. In-process caches only:
  - `SpeakerChunkManager` keeps `DEFAULT_SPEAKER_SNAPSHOT_CACHE_LIMIT` snapshots in memory (`src/recording/recording-producer.ts:42`).
  - Notion member roster cache table (`009_notion_member_roster_cache` migration; `src/notion/member-roster-store.ts`).

## Authentication & Identity

**Auth Provider:**
- None — no end-user authentication. The product is a single-user, local-first daemon. Surfaces:
  - Discord bot identity is the only "remote" identity; auth is via bot token to Discord.
  - Notion identity is via an internal-integration token attached to a parent page that the user manually shares with the integration.
  - OpenAI / Anthropic identities are bearer-key only.
- Dashboard authorization: not user/session based. Mutating requests require:
  - `Origin` header equal to `http://127.0.0.1:<port>` (`src/dashboard/security.ts` → `requireJsonMutationRequest` invoked from `src/dashboard/router.ts:69`).
  - A per-process random `dashboardToken` (`createDashboardToken()` minted at `DashboardServer` construction, `src/dashboard/server.ts:181`) supplied by the in-page client.
  - JSON content-type / mutation-method checks.
- Audio playback uses signed URLs minted with a per-process `audioTokenSecret` and verified by `verifySignedAudioToken()` in `src/dashboard/security.ts`.

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry, no Datadog, no Bugsnag, no analytics SDK).
- Errors are surfaced via `DirongError` (`src/errors.ts`), localized via `toLocalizedErrorMessage()`, and printed to console / dashboard. Sensitive values are redacted by `redactSensitiveText()` and a `registerSensitiveValue()` registry (`src/errors.ts`, used from `src/settings/local-secret-store.ts:45`).

**Logs:**
- `console.*` only, with localization helpers. Persistent log directory exists at `<userData>/logs/` but log writing is per-feature (no centralized logger framework).
- Health introspection: `src/health.ts` → `runHealthCheck()` produces a `HealthReport` consumed by `npm run doctor` (`src/app/doctor.ts`) and the recording producer's startup gate.
- Notion / STT / AI automation services expose snapshot getters consumed by the dashboard for live status (`formatNotionAutomationForStatus`, `formatSttAutomationForStatus`, `formatAiCleanupAutomationForStatus`, `formatAiReadinessForStatus`, `formatAloneFinalizeForStatus`).

## CI/CD & Deployment

**Hosting:**
- Self-hosted on the user's machine. Distribution channel:
  - GitHub Releases (`https://github.com/mua-vtuber/Dirong/releases/latest`) for the portable Windows zip.
  - Source repository at `https://github.com/mua-vtuber/Agestra` (referenced in `src/i18n/catalog.ts:2107` / `:4471`).

**CI Pipeline:**
- `.github/FUNDING.yml` is present but no GitHub Actions workflow files were detected at the standard `.github/workflows/` path during exploration. Tests are intended to be run locally via `npm test` (which requires `npm run build` first because the test runner targets `dist/`).

## Environment Configuration

**Required env vars:**
- None at runtime for the normal install path. All secrets/settings are read from `<userData>/settings/settings.json` and `<userData>/secrets/secrets.json`.
- Optional overrides:
  - `DIRONG_USER_DATA_DIR` — relocate the user-data root.
  - `DIRONG_PORTABLE_DATA_DIR` / `DIRONG_PORTABLE_ROOT` / `DIRONG_PORTABLE_PYTHON` / `DIRONG_PORTABLE_PYTHON_CACHE_DIR` / `DIRONG_PORTABLE_PYTHON_DIR` — used by the portable launcher and bundler (`src/scripts/create-portable-bundle.ts:22`).
  - `LOCALAPPDATA`, `APPDATA`, `XDG_DATA_HOME`, `HOME` — standard OS hints honored when computing the data root.

**Secrets location:**
- File: `<userData>/secrets/secrets.json` (mode set via `chmodSync` after write — see `src/settings/local-secret-store.ts:1`).
- Schema: `{ schemaVersion: 1, secrets: { <ref>: { value, createdAt, updatedAt } } }`.
- Known refs (`DEFAULT_SECRET_REFS` in `src/settings/local-secret-store.ts:13`):
  - `discord.bot_token`
  - `stt.openai_api_key`
  - `ai.claude_api_key`
  - `notion.internal_connection_token`
- Snapshots / API responses always show `[REDACTED]` or `[MISSING]`, never the raw value (`SecretPresenceSnapshot`).

## Webhooks & Callbacks

**Incoming:**
- None. The dashboard HTTP server bound to `127.0.0.1:3095` only serves the operator UI (`src/dashboard/router.ts`, `src/dashboard/server.ts`). It explicitly rejects non-loopback hosts via `LOCAL_ONLY_DASHBOARD_HOST` and same-origin / token enforcement.
- No public webhook endpoint is exposed for Discord (the bot uses the gateway, not interaction webhooks) or Notion.

**Outgoing:**
- HTTPS to `https://api.openai.com/v1/audio/transcriptions` and `https://api.openai.com/v1/models/<model>` (STT runtime + setup test).
- HTTPS to `https://api.notion.com/v1/...` (all Notion operations).
- HTTPS to `https://api.anthropic.com/v1/models?limit=1` (setup-wizard Claude API smoke test only).
- HTTPS to `https://discord.com/oauth2/authorize` (URL construction only — opened in the user's browser to invite the bot).
- HTTPS to `https://api.nuget.org/v3-flatcontainer/python/...` during portable bundle creation (build-time only).
- No outgoing telemetry or analytics traffic.

---

*Integration audit: 2026-05-15*
