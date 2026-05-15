# Technology Stack

**Analysis Date:** 2026-05-15

## Languages

**Primary:**
- TypeScript 5.9.x — All application source under `src/**/*.ts`. Strict mode enabled with `noUncheckedIndexedAccess`. Compiled to ES2022 / NodeNext modules in `dist/`.

**Secondary:**
- Python 3.x (>= 3.10 expected by `faster-whisper`) — Single helper script `scripts/local-whisper-json.py` that wraps `faster-whisper` (preferred) or `openai-whisper` (fallback) and prints transcription JSON on stdout. Invoked as a child process by the local Whisper STT provider.
- Shell/Batch — `Dirong Start.bat` is the Windows portable launcher.

## Runtime

**Environment:**
- Node.js >= 22.12.0 (declared in `package.json` `engines.node`). The project relies on Node 22's built-in `node:sqlite` (`DatabaseSync`) — see `src/storage/sqlite.ts:3`. No `better-sqlite3` / `sqlite3` native module is used.
- ESM modules only (`"type": "module"` in `package.json`; `module: "NodeNext"` in `tsconfig.json`).
- The portable bundle ships its own Node.js runtime and a NuGet-distributed Python (default `3.13.10`) — see `src/scripts/create-portable-bundle.ts:21`.

**Package Manager:**
- npm (no other lockfile types present)
- Lockfile: `package-lock.json` (committed, present at repo root)

## Frameworks

**Core:**
- `discord.js` ^14.25.1 — Gateway client, slash command builder, interaction routing. Used in `src/app/main.ts`, `src/discord/commands.ts`, `src/setup/wizard-service.ts`, `src/recording/recording-producer.ts`.
- `@discordjs/voice` ^0.19.0 — Voice connection, opus receive streams, DAVE/E2EE inspection. Used in `src/recording/recording-producer.ts`, `src/recording/voice-connection-controller.ts`, `src/health.ts` (`generateDependencyReport`).
- `prism-media` ^2.0.0-alpha.0 — Opus decoding / WebM container muxing for received voice streams. Used in `src/recording/recording-producer.ts:19`.
- `opusscript` ^0.0.8 — Pure-JS Opus codec fallback used by `@discordjs/voice` when no native opus is present.
- `node:http` (built-in) — Local dashboard HTTP server bound to `127.0.0.1:3095`. See `src/dashboard/server.ts:1` and `src/dashboard/router.ts`.
- `node:sqlite` (Node 22 built-in) — Local SQLite store via `DatabaseSync`. See `src/storage/sqlite.ts`.

**Testing:**
- Node.js built-in test runner (`node --test`) — There is no jest / vitest / mocha. The test command runs the compiled `.test.js` files explicitly listed in `package.json` `scripts.test` against `dist/`. See `package.json:14`.
- `node:assert/strict` (used implicitly in test files via the pattern compiled from `*.test.ts` source files such as `src/storage/migrations.test.ts`).

**Build/Dev:**
- TypeScript compiler `tsc -p tsconfig.json` produces `dist/`.
- `node dist/scripts/copy-dashboard-assets.js` copies `src/dashboard/public/*` and `src/assets/*` into `dist/`. See `src/scripts/copy-dashboard-assets.ts`.
- `dist/scripts/create-portable-bundle.js` produces a Windows portable distribution under `portable/Dirong/`. See `src/scripts/create-portable-bundle.ts`.

## Key Dependencies

**Critical:**
- `discord.js` ^14.25.1 — Core Discord gateway and slash command surface.
- `@discordjs/voice` ^0.19.0 — Required for voice receive (the entire recording pipeline).
- `prism-media` ^2.0.0-alpha.0 — Decodes Opus from Discord into a re-encodable stream.
- `ffmpeg-static` ^5.2.0 — Bundled ffmpeg binary used to transcode chunks to a STT-safe format. Resolved by `resolveFfmpegPath()` in `src/media.ts:28` with system `ffmpeg` as fallback.
- `node-crc` ^1.3.2 — CRC computation used by the recording / chunk pipeline (consumed indirectly through `prism-media` / WebM segment processing).
- `opusscript` ^0.0.8 — Pure-JS Opus, ensures voice runtime works without native compilation.

**Infrastructure:**
- `node:sqlite` (built-in, no npm dep) — Persists sessions, chunks, STT/AI/Notion job queues, project registry, Notion managed schema state. Database at `<userData>/sessions/dirong.sqlite`.
- `node:crypto` — Hashes audio (`createHash` in `src/media.ts:1`), signs dashboard audio tokens (`src/dashboard/security.ts`), validates AES-256-GCM availability for DAVE.
- `node:http` — Dashboard server.
- `node:child_process` — Spawns `ffmpeg`, `claude` CLI, `python` whisper script. See `src/process/run-child.ts` and `src/ai/cleanup/claude-persistent-cli-provider.ts`.

## Configuration

**Environment:**
- Settings are not env-driven for the user-facing surface; they live in JSON files under the platform user-data directory. Resolved by `resolveDirongUserDataPath()` in `src/settings/dirong-user-data.ts:22`:
  - Windows: `%LOCALAPPDATA%\Dirong`
  - macOS: `~/Library/Application Support/Dirong`
  - Linux: `~/.local/share/dirong` (respects `XDG_DATA_HOME`)
- Override env vars (recognized by `src/settings/dirong-user-data.ts` and `src/scripts/create-portable-bundle.ts`):
  - `DIRONG_USER_DATA_DIR` — explicit override of the data root.
  - `DIRONG_PORTABLE_DATA_DIR` — used by the portable launcher.
  - `DIRONG_PORTABLE_ROOT`, `DIRONG_PORTABLE_PYTHON`, `DIRONG_PORTABLE_PYTHON_CACHE_DIR`, `DIRONG_PORTABLE_PYTHON_DIR` — portable bundle wiring.
  - `LOCALAPPDATA`, `APPDATA`, `XDG_DATA_HOME`, `HOME` — standard OS hints.
- Local settings file: `<userData>/settings/settings.json` (schema in `src/settings/local-settings-store.ts`, `DirongLocalSettings`, `schemaVersion: 1`).
- Local secrets file: `<userData>/secrets/secrets.json` (schema in `src/settings/local-secret-store.ts`, secret refs `discord.bot_token`, `stt.openai_api_key`, `ai.claude_api_key`, `notion.internal_connection_token`).
- No `.env` file is read by the application. There is no committed `.env*` template.

**Build:**
- `tsconfig.json` — `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `noUncheckedIndexedAccess: true`, `rootDir: src`, `outDir: dist`. JSON modules enabled.
- No bundler (no webpack/rollup/esbuild/vite). Pure `tsc` output.
- No linter / formatter config detected (`.eslintrc*`, `.prettierrc*`, `biome.json` not present).

## Platform Requirements

**Development:**
- Node.js >= 22.12.0 with the experimental `node:sqlite` API enabled by default in 22.x.
- Python with `venv` available on PATH for local Whisper bootstrap (the setup wizard creates an app-managed `python-venv`, then installs `faster-whisper` and downloads the selected model). Not required when using OpenAI STT.
- Optional: A working Claude Code CLI (`claude` on PATH) for the AI cleanup phase. See `src/ai/cleanup/claude-persistent-cli-provider.ts:57` (default command `claude`).

**Production:**
- Local-first / self-hosted only. Three deployment shapes:
  1. Manual `npm install && npm run build && npm start` on the user's machine.
  2. Windows portable bundle via `npm run bundle:portable` (Node, Python, scripts, app, `data/` skeleton packaged together; launcher `Dirong Start.bat`).
  3. `Dirong Start.bat` git-clone style launcher that runs `npm install` + `npm run build` + `npm start` and opens the dashboard.
- Dashboard always binds to loopback (`LOCAL_ONLY_DASHBOARD_HOST = "127.0.0.1"` — `src/settings/defaults.ts:23`) on default port `3095`.

---

*Stack analysis: 2026-05-15*
