# Testing Patterns

**Analysis Date:** 2026-05-15

## Test Framework

**Runner:**
- Node's built-in test runner: `node --test` (Node.js >= 22.12.0 — see `engines.node` in `package.json`).
- No Jest, Vitest, Mocha, AVA, or other framework. No `jest.config.*` / `vitest.config.*` files exist.
- Tests are plain TypeScript that import:
  ```ts
  import test from "node:test";
  import assert from "node:assert/strict";
  ```

**Assertion Library:**
- `node:assert/strict` exclusively (`assert.equal`, `assert.deepEqual`, `assert.match`, `assert.doesNotMatch`, `assert.ok`, `assert.throws`, `assert.rejects`).

**Run Commands:**
```bash
npm run build                    # tsc -p tsconfig.json (compiles src/ → dist/)
npm test                         # node --no-warnings --test dist/<each>.test.js (explicit list)
```

- IMPORTANT: `package.json` `"test"` enumerates each `dist/*.test.js` path explicitly. When you ADD a new `*.test.ts` file, you MUST also append the matching compiled `dist/.../<name>.test.js` path to the `test` script in `package.json`, or the test will silently not run in CI / `npm test`.
- There is no test-watch mode wired up. Re-run `npm run build && npm test` after edits, or run a single compiled file with `node --test dist/path/to/file.test.js`.
- There is no coverage script wired up. Run `node --test --experimental-test-coverage dist/...` ad-hoc if you need it.

## Test File Organization

**Location:**
- Co-located with source. Each `foo.ts` has a sibling `foo.test.ts` in the same directory.
- 75 test files alongside ~161 source files (~1 test per 2 source modules).

**Naming:**
- `<module>.test.ts` always — confirmed across `src/errors.test.ts`, `src/ai/cleanup/draft.test.ts`, `src/storage/migrations.test.ts`, `src/notion/automation-service.test.ts`, `src/dashboard/server.test.ts`, etc.
- No `__tests__/` or separate `tests/` directory.
- Shared test fixture builders that span more than one test live in `*test-fixtures.ts` (`src/notion/test-fixtures.ts`) and are imported only by `*.test.ts` files.

**Structure:**
```
src/
  errors.ts
  errors.test.ts                          # co-located
  ai/cleanup/
    draft.ts
    draft.test.ts
    fake-provider.ts                      # test double, exported for tests + smoke CLI
    runner.ts
    runner.test.ts
  notion/
    automation-service.ts
    automation-service.test.ts
    test-fixtures.ts                      # shared draft input builder
```

## Test Structure

**Suite Organization:**
- Flat top-level `test("...", async () => { ... })` calls. NO `describe()` blocks (the codebase rarely uses subtests).
- Subtests via `t.test(...)` are used in only one place (`src/settings/reset-service.test.ts:161`).
- Test names are full English sentences describing the behavior under test (Given/When/Then implicit), e.g.:
  ```ts
  test("validateMeetingNotesDraftV1 rejects schemaVersion mismatch", () => { ... });
  test("doctor tolerates legacy transcript_segments without speech_status", () => { ... });
  test("Notion client sends required headers and JSON bodies", async () => { ... });
  ```
- Each test is independent and self-contained. There are no global `beforeEach` / `afterEach` hooks.

**Setup / Teardown Pattern (try / finally):**

The dominant pattern uses per-test fixture creation + a `try { ... } finally { fixture.close(); }` block to guarantee cleanup. Example from `src/storage/file-retention.test.ts`:

```ts
test("executeRetentionDeletionPlan deletes raw and STT audio after Notion success", () => {
  const fixture = createFixture();
  try {
    const paths = seedSessionArtifacts(fixture, {
      sessionId: fixture.sessionId,
      writeAudioFiles: true,
    });
    const plan = buildRetentionDeletionPlan({ ... });

    const result = executeRetentionDeletionPlan(plan);

    assert.equal(result.deleted, 2);
    assert.equal(existsSync(paths.rawAudioPath), false);
  } finally {
    fixture.close();
  }
});
```

Filesystem fixtures use `mkdtempSync(path.join(os.tmpdir(), "dirong-...-"))` and are deleted with `rmSync(dir, { recursive: true, force: true })` in `finally`.

**Process-env preservation (when tests must touch `process.env`):**
- Capture, mutate, then restore via a small `restoreEnv` helper. See `src/health.test.ts`:
  ```ts
  const previousToken = process.env.DISCORD_BOT_TOKEN;
  try {
    process.env.DISCORD_BOT_TOKEN = "env-token-must-not-be-used";
    // ... assertions ...
  } finally {
    restoreEnv("DISCORD_BOT_TOKEN", previousToken);
  }
  ```

**Async tests:** Use `async () => { ... }` with `await` and `assert.rejects(...)`.

## Mocking

**Framework:** None. There is NO `node:test` mock module usage, no `jest.mock`, no `proxyquire`, no `sinon`. The codebase does not monkey-patch modules.

**Strategy: dependency injection + hand-written fakes.**

Every collaborator is passed in through a constructor / options object (see `CONVENTIONS.md > Patterns`), so tests substitute a fake implementation directly. Examples:

**Fake AI provider (`src/ai/cleanup/fake-provider.ts`):**
```ts
export class FakeAiCleanupProvider implements AiCleanupProvider {
  readonly providerName = "fake";
  readonly modelName = "fake-meeting-notes-v1";
  readonly supportsJsonSchema = true;
  async preflight(): Promise<void> { return; }
  async generate(input, _options) {
    const draft = buildFakeDraft(input);
    return { provider: this.providerName, model: this.modelName, rawText: JSON.stringify(draft), ... };
  }
}
// Subclasses model error scenarios:
export class MalformedJsonAiCleanupProvider extends FakeAiCleanupProvider { ... }
export class InvalidSchemaAiCleanupProvider extends FakeAiCleanupProvider { ... }
export class RepairingInvalidSchemaAiCleanupProvider extends FakeAiCleanupProvider { ... }
```

Used in `src/ai/cleanup/runner.test.ts`:
```ts
const result = await runAiCleanupForSession(fixture.store, {
  ...baseRunOptions(fixture.sessionId),
  provider: new FakeAiCleanupProvider(),
  backup: () => ["backup.sqlite"],
});
```

**Fake Notion client (`src/notion/automation-service.test.ts`):**
- `FakeNotionClient` is defined locally in the test file with a `calls: []` log array, then injected via `createService(fixture, { client })`. Tests assert against `client.calls` instead of mocking HTTP.

**Fake Notion HTTP server (`src/notion/client.test.ts`):**
- `withFakeNotionServer(...)` spins up an actual `node:http` server bound to an ephemeral port and asserts on captured request method/URL/headers/body. This validates the real HTTP client without mocking `fetch`.

**Fake STT provider (`src/stt/provider.ts > FakeSttProvider`):**
- Returns deterministic `[FAKE STT] ... chunk=...` text. Reachable in production ONLY via the explicit `phase2:fake-stt` CLI (`src/app/fake-stt.ts` → `src/stt/fake-runner.ts`); never wired into the real recording pipeline.

**Fake services / spies for Discord:**
- Discord types (`Client`, `Guild`, `VoiceBasedChannel`) are cast from minimal object literals (`{ user: { id: "bot-user" } } as Client`). See `src/recording/recording-producer.test.ts`. Recording-store interactions are captured by a hand-rolled spy (`createRecordingStoreSpy(createdSessions)`).

**Polling / timing:**
- `PollingLoop` (`src/runtime/polling-loop.ts`) takes injectable `setTimeout`/`clearTimeout`. Tests drive it with `service.runOnce()` instead of waiting on real timers.

**What to Mock:**
- External SDKs / HTTP services (Notion API, Claude CLI, Whisper).
- Discord.js client objects (cast minimal stubs).
- Slow / nondeterministic providers (AI cleanup, STT, sqlite-backup).

**What NOT to Mock:**
- `node:fs`, `node:path`, `node:crypto`, `node:sqlite` — use real temp directories and real `DatabaseSync` instances. The codebase tests against the real SQLite engine via `DirongDatabase` for fidelity (see `src/storage/migrations.test.ts`).
- Internal pure functions — call them directly.
- The TypeScript module loader — never use module-level monkey patching.

## Fixtures and Factories

**Test Data:**

Fixtures are constructed via local `createFixture()` / `createSessionFixture()` / `createFinalizedTranscriptFixture()` helpers defined at the bottom of each test file. They typically return an object with:
- A `dir` (temp directory)
- A live `database`/`store`
- A `close()` cleanup function
- Helper accessors (e.g. `countAiRows`, `countRosterRoles`)

Pattern from `src/ai/cleanup/runner.test.ts`:
```ts
const fixture = createFinalizedTranscriptFixture();
try {
  // ... use fixture.store, fixture.sessionId, fixture.dbPath ...
} finally {
  fixture.close();
}
```

**Shared fixture builder:**
- `src/notion/test-fixtures.ts` exports `makeNotionDraftInput(options)` — a deterministic `NotionDraftInput` factory used by Notion-related test files. Imported with `import { makeNotionDraftInput } from "./test-fixtures.js";`.
- This is the ONLY shared cross-file fixture module. Most fixtures are file-local.

**Deterministic timestamps:**
- Tests use fixed ISO timestamps (`const nowIso = "2026-05-11T00:00:00.000Z"`) and hand-rolled `now: () => nowIso` to keep snapshots stable. See `src/notion/automation-service.test.ts`, `src/storage/file-retention.test.ts`.

**Location:**
- File-local fixture functions live below the `test(...)` calls in the same `*.test.ts` file.
- Cross-file fixtures live next to the source under `*test-fixtures.ts` and are imported only by `*.test.ts` consumers.

## Coverage

**Requirements:** None enforced. No coverage thresholds, no badge, no CI report.

**View Coverage:**
```bash
node --test --experimental-test-coverage dist/<file>.test.js
```

(Ad-hoc only — not wired into npm scripts.)

## Test Types

**Unit Tests:**
- Pure logic: `src/errors.test.ts`, `src/cli/arg-parser.test.ts`, `src/ai/cleanup/draft.test.ts`, `src/i18n/catalog.test.ts`, `src/transcript/timeline.test.ts`, `src/notion/blocks.test.ts`, `src/notion/managed-schema-diff.test.ts`.
- These exercise functions / classes directly with no IO.

**Integration Tests:**
- Real SQLite + temp directories: `src/storage/migrations.test.ts`, `src/storage/file-retention.test.ts`, `src/storage/session-purge.test.ts`, `src/notion/automation-service.test.ts`, `src/ai/cleanup/runner.test.ts`, `src/ai/cleanup/automation-service.test.ts`.
- Real HTTP server: `src/notion/client.test.ts` (binds an ephemeral port via `node:http.createServer`).
- Real subprocess: `src/app/doctor.test.ts` uses `spawnSync(process.execPath, ["--no-warnings", doctorPath], { env, timeout })` to run the compiled CLI end-to-end and assert on stdout / stderr / exit code.
- Dashboard server: `src/dashboard/server.test.ts` boots the real `node:http` server and connects via `node:net` sockets.

**E2E Tests:**
- Not formalized as a separate tier. The CLI tests in `src/app/*.test.ts` (doctor, phase3-stt, phase4-ai-cleanup, phase5-notion-upload, session-purge, sqlite-backup) ARE end-to-end at the CLI surface.
- The Claude persistent CLI smoke test (`src/ai/cleanup/claude-persistent-smoke.test.ts`) is a developer-only smoke harness; it exists alongside the `phase4:claude-persistent-smoke` CLI in `package.json`.

## Common Patterns

**Async Testing:**
```ts
test("runAiCleanupForSession dry-run does not change the DB", async () => {
  const fixture = createFinalizedTranscriptFixture();
  try {
    const result = await runAiCleanupForSession(readOnlyStore, {
      ...baseRunOptions(fixture.sessionId),
      dryRun: true,
      provider: new FakeAiCleanupProvider(),
    });
    assert.equal(result.status, "dry_run");
    assert.equal(result.dbChanged, false);
  } finally {
    fixture.close();
  }
});
```

**Error Testing:**
```ts
// Synchronous throws — pass a constructor or regex matcher:
assert.throws(
  () => validateMeetingNotesDraftV1(invalid, ctx),
  DraftValidationError,
);
assert.throws(
  () => readRequiredStringArg("   ", "--value required"),
  /required/,
);

// Async rejections:
await assert.rejects(
  producer.start({ ... }),
  /unhealthy/,
);
```

**Subprocess CLI Testing:**
```ts
const result = spawnSync(process.execPath, ["--no-warnings", doctorPath], {
  cwd: process.cwd(),
  encoding: "utf8",
  timeout: 5_000,
  env: fixture.env,
});
assert.equal(result.status, 0, result.stderr || result.stdout);
assert.match(result.stdout, /\[Notion managed registry\]/);
assert.doesNotMatch(result.stderr + result.stdout, new RegExp(rawToken));   // secret never leaks
```

**Locale parity check (`src/i18n/catalog.test.ts`):**
```ts
test("locale catalogs expose the same key structure", () => {
  assert.deepEqual(listLocaleKeys(catalogs.en), listLocaleKeys(catalogs.ko));
});
```
Always extend BOTH `catalogs.en` and `catalogs.ko` when adding a localized message; this test will fail loudly if you don't.

**Secret-leak regression checks:**
- Tests assert that secrets do NOT appear in any output (`assert.doesNotMatch(result.stderr + result.stdout, new RegExp(rawToken))` in `src/app/doctor.test.ts`). Mirror this pattern when adding any code path that could log a secret.

---

*Testing analysis: 2026-05-15*
