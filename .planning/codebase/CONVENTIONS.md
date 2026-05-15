# Coding Conventions

**Analysis Date:** 2026-05-15

## Naming Patterns

**Files:**
- `kebab-case.ts` for all source modules (e.g. `session-store.ts`, `local-settings-store.ts`, `provider-lifecycle-service.ts`).
- Tests are co-located and suffixed `.test.ts` (e.g. `src/ai/cleanup/draft.test.ts`, `src/storage/migrations.test.ts`).
- Directories are `kebab-case` (`src/ai/cleanup/`, `src/notion/`, `src/storage/`, `src/recording/`).
- ESM `.js` extension is required in `import` paths even though sources are `.ts` (NodeNext moduleResolution). Example: `import { SessionStore } from "../../storage/session-store.js";`

**Functions / Variables / Methods:**
- `camelCase` (`runHealthCheck`, `parseCliArgs`, `summarizeSafeError`, `redactSensitiveText`, `applyRetentionAfterSuccessfulUpload`).
- Boolean-returning helpers prefer `is`/`has`/`should` prefixes (`isDebugMode` in `src/cli/error-output.ts`, `hasCompleteManagedNotionUploadRegistry` in `src/notion/managed-registry-policy.ts`).
- Builders / factories use `make*` / `build*` / `create*` (`makeNotionDraftInput`, `buildPhase4SystemPrompt`, `createNotionClient`).

**Types / Interfaces / Classes:**
- `PascalCase` for `class`, `type`, and `interface` (`DirongDatabase`, `SessionStore`, `NotionAutomationService`, `FakeAiCleanupProvider`, `AiCleanupRunResult`).
- Type aliases are preferred over `interface` for object shapes (e.g. `NotionAutomationSnapshot`, `AiCleanupRunOptions` in `src/ai/cleanup/runner.ts`). `interface` is used for ports / provider contracts (`SttProvider` in `src/stt/provider.ts`).
- Class-based god nodes per the graph: `SessionStore`, `DirongDatabase`, `SqlRunner`, `NotionRegistryStore` — these are the central abstractions other modules compose.

**Constants:**
- `SCREAMING_SNAKE_CASE` for module-level constants (`DEFAULT_REGISTERED_SENSITIVE_VALUE_LIMIT`, `MEETING_NOTES_DRAFT_SCHEMA_VERSION`, `PHASE4_AI_CLEANUP_PROMPT_VERSION`, `KOREAN_NOTION_SCHEMA_PRESET`, `EXPECTED_MIGRATION_IDS`).
- DB column names in row types use `snake_case` (`session_id`, `display_name_snapshot`, `start_ms`) to mirror SQLite columns; TS object/property identifiers everywhere else stay camelCase.

## Code Style

**Formatting:**
- No `.prettierrc`, `.editorconfig`, or formatter config is committed.
- Observed in-repo style: 2-space indent, double-quoted strings, trailing commas on multi-line literals, semicolons everywhere, line width loosely ~100.
- Always preserve the existing 2-space / double-quote / trailing-comma style when editing.

**Linting:**
- No ESLint / Biome config is committed.
- Quality is enforced through TypeScript `strict: true` plus `noUncheckedIndexedAccess: true` (see `tsconfig.json`).
- Enforced compiler options: `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `forceConsistentCasingInFileNames: true`, `esModuleInterop: true`, `resolveJsonModule: true`.
- New code MUST type-check under `noUncheckedIndexedAccess`. Index access returns `T | undefined` and must be narrowed before use (see how `result.checks.find(...)` is checked with `?.` in `src/health.test.ts`).

**Module System:**
- `"type": "module"` in `package.json`. All TypeScript is ESM.
- All imports MUST use the `.js` extension even when the source file is `.ts` (NodeNext requirement).
- No barrel `index.ts` files; import directly from the defining module.

## Import Organization

Observed order in source files (e.g. `src/ai/cleanup/runner.ts`, `src/notion/automation-service.ts`):

1. `node:*` builtins (`node:assert/strict`, `node:fs`, `node:path`, `node:crypto`, `node:sqlite`, `node:test`).
2. Third-party packages (`discord.js`, `@discordjs/voice`).
3. Internal absolute-from-src relative imports (`../../errors.js`, `../i18n/catalog.js`).
4. Same-directory imports (`./draft.js`, `./prompts.js`).
5. Type-only imports use `import type` and are usually grouped with their value-import counterpart.

**Path Aliases:** None. `tsconfig.json` defines no `paths` mapping; everything is relative.

## Error Handling

**Custom error class:**
- `DirongError` (in `src/errors.ts`) carries a `code: string` plus message; thrown for domain failures (e.g. `runner.ts`, `repair-workflow.ts`).
- Notion HTTP errors throw `NotionApiError` (`src/notion/client.ts`) with status code preserved.
- Provider errors throw `AiCleanupProviderError` (`src/ai/cleanup/provider.ts`) with classified failure kinds.

**Top-level CLI handlers:**
- All `src/app/*.ts` entry points wrap their body in `try { ... } catch (error) { printCliError(error); process.exit(1); }` (see `src/app/fake-stt.ts`, and similarly `doctor.ts`, `notion-upload.ts`, `phase3-stt-cli.ts`, `repair.ts`).
- `src/cli/error-output.ts#printCliError` localizes the message via `formatUserFacingError`, appends a debug hint, and dumps `safeErrorInfo` only when `--debug` is present.

**Secret redaction (mandatory before any error / log surface):**
- Use `summarizeSafeError`, `summarizeSafeText`, `redactSensitiveText`, `redactForJson`, and `safeErrorInfo` from `src/errors.ts`.
- Register runtime secrets with `registerSensitiveValue(...)` so they are scrubbed from later messages (capped at 256 entries with LRU eviction).
- Built-in regex scrubbers cover Discord bot tokens, OpenAI `sk-` keys, Notion `ntn_` keys, Anthropic `sk-ant-` keys, Discord JWT-shape tokens, and `authorization|token|secret|api_key` key/value pairs.
- Never `console.error(error)` directly in production paths — always go through `printCliError` or `summarizeSafeError`.

**Result objects over thrown errors for workflow code:**
- Long-running workflows return result discriminated unions instead of throwing for expected outcomes. See `AiCleanupRunResult.status` (`"dry_run" | "done" | "already_done" | "blocked" | "failed" | "not_claimed"`) in `src/ai/cleanup/runner.ts`, and `NotionAutomationStatus` in `src/notion/automation-service.ts`.
- Throws are reserved for programmer errors, contract violations, and unrecoverable IO.

## Logging

**Framework:** None. The codebase uses `console.log` / `console.error` only.

**Patterns:**
- User-facing CLI output formatted by helpers in `src/cli/stt-summary.ts`, `src/messages/human-status.ts`, `src/messages/user-messages.ts`.
- All free-form text passed to the user is run through `formatLocaleText(t(locale, key), ...)` from `src/i18n/catalog.ts` so every message is localized (Korean default, English supported). Inspect `src/i18n/catalog.test.ts` for the contract: `listLocaleKeys(catalogs.en)` MUST equal `listLocaleKeys(catalogs.ko)`.
- Anything that may leak a secret MUST be passed through `redactSensitiveText` first.
- `--debug` flag enables verbose JSON dumps via `safeErrorInfo`.

## Comments

**When to Comment:**
- Comments are sparse; prefer self-explanatory names. Korean comments appear inline for domain language.
- Comment when explaining *why* a non-obvious decision exists (e.g. backup-before-migration rationale in `src/storage/sqlite.ts`).
- Avoid restating what the code says.

**JSDoc/TSDoc:** Not used. Types and parameter names carry the documentation burden.

## Function Design

**Size:** Most exported functions are < 60 lines. When a function grows past that, extract helpers into the same file (see the helper pyramid `runAiCleanupForSession` → `cleanup-workflow.ts` → `repair-workflow.ts`).

**Parameters:**
- A single positional argument plus an `options` object for everything optional (`new SessionStore(database, { storageRoot, normalizeStoredPaths })`, `runAiCleanupForSession(store, options)`).
- Avoid more than 2 positional parameters.
- Prefer "named arguments" via `{ ... }` once you cross 3 inputs.

**Return Values:**
- Return typed objects, not tuples. Discriminated unions are used for status reporting.
- Async work returns `Promise<T>`; `void` returning IO is acceptable for fire-and-forget setup helpers.

## Module Design

**Exports:**
- Named exports only — never `export default`. Confirmed across `src/errors.ts`, `src/storage/session-store.ts`, `src/notion/client.ts`, `src/cli/arg-parser.ts`.
- Co-locate related types, constants, and helpers in the same file as the primary class/function.

**Barrel Files:** None. Every module imports directly from the defining file. Do NOT introduce `index.ts` re-export barrels.

## Patterns

**Dependency injection via constructor / options object:**
- Services accept their collaborators (`NotionClient`, `NotionRegistryStore`, `NotionWriteStore`, `localeResolver`, `getSettings`, polling timers) through their `*Options` type. See `NotionAutomationServiceOptions` in `src/notion/automation-service.ts` and `AiCleanupRunOptions` in `src/ai/cleanup/runner.ts`.
- This makes substituting a fake (e.g. `FakeAiCleanupProvider`, `FakeNotionClient`) trivial in tests with no module mocking.

**Storage ports:**
- Each subsystem defines a `storage-port.ts` that narrows `SessionStore`'s surface to exactly what the workflow needs (`AiCleanupRunStore` in `src/ai/cleanup/storage-port.ts`, `SttBatchStore` in `src/stt/storage-port.ts`, `RecordingProducerStore` in `src/recording/storage-port.ts`). Workflows depend on the port, not on `SessionStore` directly.

**Repository pattern under SessionStore:**
- `SessionStore` composes per-aggregate repositories (`SessionRepository`, `ChunkRepository`, `TranscriptRepository`, `SttJobQueue`, `AiCleanupJobQueue`, `MeetingNotesDraftRepository`, `RepairRepository`) over a shared `SqlRunner`. Add new persistence by extending an existing repository or adding a new one — never run raw SQL outside one.

**SQLite migrations:**
- Schema is defined statically in `src/storage/schema.ts`; incremental changes go through ordered migrations in `src/storage/migrations.ts` keyed by stable IDs (`001_transcript_segments_speech_status` … `012_remove_default_members_custom_rule`). Tests assert the full ID list (`src/storage/migrations.test.ts`).
- `DirongDatabase` ALWAYS backs up the existing DB to `<dbname>.YYYYMMDDhhmmss.bak.sqlite` via `VACUUM ... INTO` before applying pending migrations and aborts loudly if backup fails (`src/storage/sqlite.ts`, `src/storage/sqlite-backup.ts`).

**Polling loops:**
- Long-running services use `PollingLoop<T>` from `src/runtime/polling-loop.ts`. It accepts injectable `setTimeout`/`clearTimeout` for deterministic tests and supports `runOnce()` for synchronous test ticks (used heavily in `automation-service.test.ts`).

**i18n everywhere user-visible:**
- `src/i18n/catalog.ts` exposes `t(locale, key)` and `formatLocaleText`. Every user-facing string MUST come through it. Catalog parity is enforced by `src/i18n/catalog.test.ts`.
- Locale resolution lives in `src/i18n/app-locale.ts`; CLIs resolve via `resolveCliLocale()` (`src/cli/error-output.ts`); services accept an `AppLocaleResolver`.

**No mock data on production paths (CLAUDE.md absolute rule):**
- ALL `Fake*` providers MUST live behind a `--source fake` / `phase2:fake-stt` opt-in or in test files. Compliant locations:
  - `src/ai/cleanup/fake-provider.ts` — exported `FakeAiCleanupProvider`, `MalformedJsonAiCleanupProvider`, `InvalidSchemaAiCleanupProvider`, `RepairingInvalidSchemaAiCleanupProvider`. These are imported by `runner.test.ts`, `automation-service.test.ts`, `claude-persistent-smoke.ts`.
  - `src/stt/provider.ts` — `FakeSttProvider`. Used by `src/stt/fake-runner.ts` which is only invoked from `src/app/fake-stt.ts` (the `phase2:fake-stt` developer command, never wired into the recording-time pipeline).
  - `src/notion/test-fixtures.ts` — `makeNotionDraftInput` test fixture builder. Imported only by `*.test.ts` files; do not import from production code.
- Deviation watch: `src/ai/cleanup/fake-provider.ts` is not under a `__tests__/` or `test-utils/` path. It is imported by `src/ai/cleanup/claude-persistent-smoke.ts`, which is itself wired up as the `phase4:claude-persistent-smoke` developer/diagnostic CLI (`package.json`). Treat this CLI as a developer-only smoke harness, not a user-facing surface; do not extend its consumption into the recording / dashboard / Notion automation paths.
- Health and config readers MUST report `"missing"` rather than substituting defaults when secrets are absent (`src/health.test.ts` enforces this contract: env-var fallbacks like `DISCORD_BOT_TOKEN` MUST NOT mask missing product config).

**Atomic file writes:**
- All artifact persistence goes through `writeTextAtomic` in `src/ai/cleanup/artifact-store.ts` (write-to-temp + rename). Mirror this when adding new on-disk artifacts.

**Stable IDs and content hashes:**
- Cleanup jobs / drafts identified by deterministic IDs (`makeAiCleanupJobId`, `sha256Text`, `stableStringify` in `src/ai/cleanup/timeline-input.ts`).
- Notion block sync uses content hashes (`src/notion/content-hash.ts`) to detect changes idempotently.

---

*Convention analysis: 2026-05-15*
