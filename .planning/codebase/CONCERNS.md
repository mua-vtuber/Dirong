# Codebase Concerns

**Analysis Date:** 2026-05-15
**Source signals:** `graphify-out/GRAPH_REPORT.md` (god nodes line 1507), targeted Grep across `src/` and `scripts/`, focused reads of recording / STT / dashboard / persistent-CLI lifecycle modules.

Findings are categorized by severity (HIGH / MEDIUM / LOW) and grouped by area. Each entry names the file, the concrete issue, and an actionable next step. Items the previous quality agent already validated as accepted-with-caveat are recorded as MEDIUM, not HIGH (per retry instructions).

---

## HIGH severity

### Debt — God-node concentration: `SessionStore` (136 edges) and `DirongDatabase` (127 edges)

**Files:**
- `src/storage/session-store.ts` (879 lines)
- `src/storage/sqlite.ts`
- `src/storage/sql-runner.ts` (`SqlRunner`, 113 edges — also a god node)

**Problem:** From `graphify-out/GRAPH_REPORT.md` (lines 1507-1517), `SessionStore`, `DirongDatabase`, and `SqlRunner` are the top three project-owned hubs (the others are Python stdlib internals). Any change to session lifecycle, schema, or SQL execution touches >100 call sites. This is the single largest "blast radius" risk in the codebase.

**Impact:** Refactors to session storage are slow, risk regressions across recording / STT / AI cleanup / Notion upload pipelines, and resist parallel work.

**Fix approach:** Split `SessionStore` into role-scoped facades (e.g. `SessionWriteStore`, `SessionReadStore`, `FakeSttStore`) that share `SqlRunner`. Do not "improve" the god node — split it.

### Debt — Oversized modules

**Files (LOC):**
- `src/i18n/catalog.ts` — 4,780 lines
- `src/setup/wizard-service.ts` — 1,892 lines
- `src/notion/dashboard-service.ts` — 1,541 lines
- `src/settings/product-settings.ts` — 1,328 lines
- `src/storage/migrations.ts` — 1,056 lines
- `src/ai/cleanup/automation-service.ts` — 1,034 lines
- `src/app/main.ts` — 1,013 lines
- `src/ai/cleanup/claude-persistent-smoke.ts` — 988 lines

**Problem:** Eight production modules exceed 1,000 lines. `catalog.ts` at 4,780 lines is the dominant TypeScript artifact in the repo. `wizard-service.ts` mixes secret persistence, settings mutation, and UI flow in one class.

**Impact:** Reviews are expensive, test isolation is hard, and the modules become local "god nodes" inside their communities (Communities 11, 18 in the graph have very high cohesion: 0.07-0.11, indicating tight internal coupling).

**Fix approach:**
- `catalog.ts`: Split by locale or by feature surface (recording / dashboard / wizard / notion). The current single-file pattern blocks lazy-loading and inflates the bundle for every consumer.
- `wizard-service.ts`: Separate the "secret write" path from the "settings mutation" path; the latter currently always passes through the former.
- `migrations.ts`: Extract per-migration files (some already exist under `src/storage/schema-fragments/`); keep the runner thin.

---

## MEDIUM severity

### Policy — Fake providers reachable from production code (accepted-with-caveat)

**Files:**
- `src/ai/cleanup/fake-provider.ts` — `FakeAiCleanupProvider`, `FakeMalformedJson*`, `FakeInvalidSchema*`
- `src/stt/fake-runner.ts` — `runFakeSttBatch`
- `src/app/fake-stt.ts` — wired to `phase2:fake-stt` CLI
- `src/app/ai-cleanup.ts:2` — imports `FakeAiCleanupProvider`
- `src/app/phase4-ai-cleanup-cli.ts:42,58-60,99` — `--include-fake-stt` flag

**Status:** The previous quality agent confirmed both fakes are gated behind developer-only CLIs (`phase4:claude-persistent-smoke` for the AI fake, `phase2:fake-stt` for STT) and require explicit opt-in flags (`--provider fake --smoke-test --include-fake-stt`). `runFakeSttBatch` writes records with `provider = 'dirong-fake-stt'` and downstream read models filter them out (`src/storage/transcript-repository.ts:102-104`, `src/storage/session-repository.ts:152`, `src/notion/draft-input-read-model.ts:120`).

**Residual concern:** The gate is policy, not type. Nothing prevents a future caller from instantiating `FakeAiCleanupProvider` from `src/app/main.ts`. The `dirong-fake-stt` provider tag is the only structural barrier protecting the Notion upload path.

**Fix approach:** Move `fake-provider.ts` and `fake-runner.ts` under a `__dev__/` or `dev-tools/` subtree, and add an ESLint `no-restricted-imports` rule that blocks importing them from anywhere except `src/app/phase4-ai-cleanup-cli.ts`, `src/app/phase2-fake-stt-cli.ts`, and tests.

### Fragility — Persistent Claude CLI lifecycle

**Files:**
- `src/ai/cleanup/claude-persistent-cli-provider.ts:106,158,178-185`
- `src/ai/cleanup/claude-persistent-smoke.ts:218,935`
- `src/ai/cleanup/provider-lifecycle-service.ts`

**Problem:** `ClaudeStreamJsonCliCleanupProvider.generate()` calls `await this.killSession()` both before spawning and again in the `finally` block. The session is a spawned `claude` subprocess; if `killAndWait()` throws or hangs, `this.session` is already nulled (`killSession` line 180), so a leaked process can become orphaned without a tracking handle. Abort listener is registered after `killSession` but before spawn (lines 107-119), creating a small race window where an early `abort` signal kills a session about to be replaced.

**Impact:** Under aborted/timed-out runs, `claude` child processes may leak and consume memory until the parent exits. Hard to detect in production because the parent does not list living child PIDs anywhere.

**Fix approach:**
1. Track the spawned PID in a `Set<number>` field on the provider; on `stop()`/process exit, send `SIGKILL` to anything still alive.
2. Move the abort-listener registration to occur **before** `await this.killSession()` so the abort signal can never fire against a half-constructed session.
3. Add a periodic `safeguard` interval that compares `Date.now() - session.startedAt` to `timeoutMs * 2` and force-kills runaways.

### Fragility — Recording pipeline silent fallbacks for speaker resolution

**File:** `src/recording/speaker-chunk-manager.ts:45-68`

**Problem:** `resolveSpeakerSnapshot` swallows two `catch` blocks (one bare `catch {}` on line 48, one with a `recordConnectionEvent` log on line 57) and returns `{ displayName: userId, isBot: false }` as a fallback. Every Discord ID that fails both `guild.members.fetch()` and `client.users.fetch()` becomes a transcript entry attributed to a raw snowflake with `isBot: false`.

**Impact:** Violates the user's CLAUDE.md "no silent fallbacks that mask missing data" rule. A bot user mis-classified as `isBot: false` can leak into Notion uploads as a real participant. The rendered transcript shows numeric IDs instead of names with no in-line indication that lookup failed.

**Fix approach:**
- Distinguish "Discord rate-limited / network failure" (transient — retry) from "user no longer exists" (permanent — record as `unknown user`, set a quarantine flag on the chunk).
- Surface the fallback to the dashboard so the operator sees a non-zero `speaker_lookup_failed` count rather than discovering it in the transcript later.

### Fragility — Recording producer chunk-finalize timeout cascade

**File:** `src/recording/recording-producer.ts:319-356`

**Problem:** `stopActiveSession` waits 20s for graceful chunk close, then 60s for forced close, then records each unfinalized chunk to a `chunk_finalize_timeout` repair item. On Windows the underlying file descriptors are not always freed when `opusStream.destroy()` returns synchronously, so the next session can fail to open the same path.

**Impact:** Long-tail crash recovery scenarios may leave `.opus` files locked or partially written. `repair-scan.ts` is responsible for reconciling these but it does not run automatically on next startup.

**Fix approach:** Run `src/storage/repair-scan.ts` automatically on boot when a previous session has any `chunk_finalize_timeout` repair items.

### Fragility — Wide `try/catch` swallowing in `recording-producer.ts` and STT providers

**Files:**
- `src/recording/recording-producer.ts:471` (bare `catch {}`)
- `src/stt/openai-provider.ts:124` (bare `catch {}`)
- `src/stt/local-whisper-provider.ts:115` (bare `catch {}`)

**Problem:** Three production code paths catch errors without logging or routing them. Even if the suppressed error is benign (e.g. "file already deleted"), the bare `catch` form makes it impossible to distinguish "expected ENOENT" from "permission denied" or "disk full".

**Fix approach:** Replace each bare `catch {}` with `catch (error)` and either (a) log via the existing `recordConnectionEvent` / structured logger or (b) document the specific exception class being suppressed. The user's CLAUDE.md explicitly forbids silent-fallback patterns.

### Performance — Concentrated SQL execution in `migrations.ts`

**File:** `src/storage/migrations.ts` (1,056 lines, dozens of `db.exec(...)` calls between lines 90 and 816)

**Problem:** Each migration step executes raw SQL string-concatenated in TS. Several migrations call `db.exec` outside of a transaction (e.g. lines 251, 256, 274). If a migration crashes mid-step the database is left in a half-applied state; the only recovery is the schema-fragment files under `src/storage/schema-fragments/`.

**Impact:** First-run install on a corrupted DB produces hard-to-diagnose state. Migrations that ran partially leave orphan tables (e.g. `notion_blocks_old` at line 638) until the next `repair`.

**Fix approach:** Wrap every numbered migration in a single `BEGIN IMMEDIATE / COMMIT` block (lines 90/96 already do this for the outer driver — extend to per-migration scope) and add a self-test that each fragment is idempotent.

### Debt — Dashboard route file growth

**Files:**
- `src/dashboard/notion-routes.ts`
- `src/dashboard/project-routes.ts`
- `src/dashboard/setup-routes.ts`
- `src/dashboard/settings-reset-routes.ts`
- `src/dashboard/router.ts:323` (audio path matched with `RegExp.exec`)

**Problem:** Multiple route files use `return null` / `return undefined` / `return {}` as sentinel responses (notion-routes:283,379; project-routes:196,211,225,240; setup-routes:385,392; http:72,82,169,176). This blends "request not handled" with "request handled, empty body" semantics.

**Impact:** Caller in `router.ts` cannot tell whether a `null` means "404, try next route" or "200, no payload". Future refactors will accidentally swap behaviors.

**Fix approach:** Introduce a `RouteOutcome` union type (`{ kind: "handled"; response }` vs `{ kind: "skip" }`) and forbid bare `null` returns in route handlers via lint.

---

## LOW severity

### Security — Dashboard token model

**File:** `src/dashboard/security.ts`

**Status:** Implementation is solid: HMAC-SHA256 audio tokens (line 146), constant-time comparison (line 161), Sec-Fetch-Site enforcement (line 52), Origin/Host check (lines 33-50), 5-minute audio TTL (line 6). Token header is `x-dirong-dashboard-token`.

**Residual concern:** `buildDashboardHtml` (line 73) injects `window.__DIRONG_DASHBOARD_TOKEN__` via `JSON.stringify`. If any other script inserted into the same HTML mishandles the global, the token leaks. The dashboard binds to `dashboardHost` (configurable) — a misconfigured `0.0.0.0` deploy exposes the token to anyone on LAN within the 5-minute audio TTL window.

**Fix approach:** Document explicitly that `dashboardHost` must be `127.0.0.1` for any non-trusted network. Add a startup warning in `src/dashboard/server.ts:200-251` when `dashboardHost !== "127.0.0.1"`.

### Security — Subprocess invocation surface

**Files:**
- `src/process/run-child.ts` — single chokepoint, `shell: false`, `windowsHide: true`
- `src/app/main.ts:1007`, `src/scripts/create-portable-bundle.ts`, `src/ai/cleanup/claude-persistent-smoke.ts:935`

**Status:** All `spawn()` call sites go through `runChild()` or wrap `spawn` directly with `shell: false`. The Windows-specific `resolveShellFalseCommand` (lines 88-120) is careful to never invoke `cmd.exe /C` with unescaped user-controlled args (`escapeWindowsArg` at line 157). Command names are not user-influenced (they come from settings: `claude`, `python`, `ffmpeg`).

**Residual concern:** `resolveWindowsExecutable` (line 122) calls `where.exe` with the bare `command` string. While `command` here is a settings value (not URL-derived), a typo'd settings entry containing path separators is rejected (line 123 `if (/[\\/]/.test(command)) return null`). Robust enough for current threat model.

**Fix approach:** No action required. Document in CONVENTIONS.md that all child-process invocations must go through `runChild`.

### Security — Secret redaction in error messages

**File:** `src/errors.ts:61-82`

**Status:** `DirongError` redacts `[REDACTED_OPENAI_API_KEY]`, `[REDACTED_NOTION_API_KEY]`, `[REDACTED_ANTHROPIC_API_KEY]`, `[REDACTED_DISCORD_TOKEN_LIKE_VALUE]`. Notion client (`src/notion/client.ts:574`) additionally splits on the literal apiKey value. No env var is ever logged in raw form. No `.env` file is read by the runtime — secrets live in `LocalSecretStore` (`src/settings/local-secret-store.ts`) referenced by `DEFAULT_SECRET_REFS`.

**Residual concern:** The redaction relies on regex/string matching against known prefixes. A rotated/regional Discord token format change (Discord has done this before) would silently bypass redaction.

**Fix approach:** Add a sentinel test that ensures `DirongError.format()` output never contains any value currently present in `LocalSecretStore.snapshot()`.

### Debt — `console.warn` in non-CLI paths

**Files:**
- `src/ai/cleanup/progress.ts:131`
- `src/ai/cleanup/runner.ts:731`

**Problem:** Two production code paths use `console.warn` directly instead of routing through the dashboard event log. Per `CONVENTIONS.md`, structured logging should be used for everything outside `src/app/` and `src/cli/`.

**Fix approach:** Route through `recordConnectionEvent` or a dedicated AI-cleanup event sink so the warnings show up in the dashboard instead of being lost in stdout.

### Debt — No discovered TODO / FIXME markers

**Status:** Grep across `src/` and `scripts/` for `TODO|FIXME|XXX|HACK|@deprecated` returned zero hits in non-test code. This is unusual and a positive sign — but it also means hidden debt is not surfaced inline. The "concerns" entries above were derived from structural and behavioral analysis rather than author-marked debt.

---

## Test Coverage Gaps (cross-cutting)

**Files / areas with thin coverage relative to risk:**

- `src/ai/cleanup/claude-persistent-smoke.ts` (988 LoC) — has `claude-persistent-smoke.test.ts` but the spawn-and-kill race conditions described above are not test-driven; they would require fault-injection harness.
- `src/recording/recording-producer.ts:319-380` (forced-chunk-close path) — happy paths are covered by `recording-producer.test.ts`; the 60s force-close timeout branch is not exercised.
- `src/storage/migrations.ts` mid-step crash recovery — `migrations.test.ts` exists but does not simulate `db.exec` failure between two non-transactional steps (e.g. line 251 → 256).

**Priority:** Medium. These are exactly the paths most likely to bite production users (orphaned subprocesses, locked recording files, half-applied schema).

---

*Concerns audit: 2026-05-15*
