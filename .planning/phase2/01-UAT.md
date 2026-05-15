---
status: testing
phase: 02-persistent-cli-recording-reliability
source:
  - .planning/phase2/01-T1-T2-T3-SUMMARY.md
  - .planning/phase2/01-T5-SUMMARY.md
  - .planning/phase2/01-T4-SUMMARY.md
  - .planning/phase2/01-T6-SUMMARY.md
started: 2026-05-16T00:00:00Z
updated: 2026-05-16T00:00:00Z
---

## Phase 2 nature

Phase 2 is a **backend reliability hardening phase** — no user-facing UI/CLI behavior change. RELY-01..03 added orphan-PID tracking + reaping + safeguard interval to `ClaudeStreamJsonCliCleanupProvider`; RELY-04 polished the boot repair log line and wrapped `runStartupRepair` in try/catch; RELY-05 added an integration test that drives `stopActiveSession` through the 60s force-close branch. TEST-01 added 10 new lifecycle tests in `claude-persistent-cli-provider.test.ts`.

All deliverables are observable through automated gates (build, test, grep, line-index ordering, cold-start smoke), not through user-flow steps that have no UI surface. The UAT runs the automated gates as a snapshot and asks the user to confirm absence of regression they observed outside the UAT scope.

## Current Test

number: 9
name: Final acceptance
expected: |
  All 8 automated checkpoints below have passed. The user reviews the snapshot and either confirms (Phase 2 verified) or flags a regression they observed outside this UAT scope.
awaiting: user response

## Tests

### 1. Cold Start Build
expected: `npm run build` exits 0; `tsc -p tsconfig.json` completes; dashboard asset copy runs.
result: pass
evidence: BUILD_EXIT=0; no TypeScript errors.

### 2. Full Test Suite Green
expected: `npm test` exits 0 with 528/528 pass, 0 fail, 0 skipped, 0 cancelled. (+11 vs Phase 1 baseline: 10 new lifecycle tests + 1 new force-close test.)
result: pass
evidence: `tests 528 / pass 528 / fail 0 / cancelled 0 / skipped 0 / todo 0 / duration_ms ~8500`.

### 3. ROADMAP SC1 — RELY-01 (orphan-PID tracking + exit hook)
expected: `trackedPids` referenced ≥ 5 times in `claude-persistent-cli-provider.ts`; `reapTrackedPids` wired in `main.ts`; `process.on("exit")` registered in `main.ts`.
result: pass
evidence: trackedPids=10 refs in provider; reapTrackedPids=2 refs in main.ts (definition forward + call inside exit hook); process.on("exit")=1 (single registration).

### 4. ROADMAP SC2 — RELY-02 (abort-listener ordering)
expected: `addEventListener("abort", …)` line index < first `await this.killSession()` line index in `claude-persistent-cli-provider.ts`.
result: pass
evidence: listener at line 142; first killSession at line 155. 142 < 155 ✓. Additionally proven by T1's static-source assertion test (PASS in `npm test`).

### 5. ROADMAP SC3 — RELY-03 (safeguard interval)
expected: `forceKillIfStale` method on provider; `safeguardInterval` + `clearInterval` lifecycle in `provider-lifecycle-service.ts`.
result: pass
evidence: forceKillIfStale=4 refs in provider; safeguardInterval=7 refs (setInterval setup + teardown + .unref + provider hook + ...); clearInterval=1 ref (teardown only). Boundary test at `=== timeoutMs * 2` passes in `npm test`.

### 6. ROADMAP SC4 — RELY-04 (boot repair polish)
expected: literal `"startup repair:"` line in `main.ts`; zero `JSON.stringify(repairSummary` occurrences (old format removed); `startup_repair_failed` event wired; zero `process.exit(1)` on repair path per D-08.
result: pass
evidence: `startup repair:`=1, `JSON.stringify(repairSummary`=0, `startup_repair_failed`=1, `process.exit(1)` inside runStartupRepair scope=0.

### 7. ROADMAP SC5 — RELY-05 (force-close test)
expected: `chunk_finalize_timeout` referenced inside an assertion in `recording-producer.test.ts`.
result: pass
evidence: 4 refs in the test file (test name + 2 assertion bodies + 1 helper var). New top-level test runs `stopActiveSession` past both 20s graceful and 60s force-close timeouts via `t.mock.timers` (or via extracted `executeForceCloseBranch` helper per A2 fallback).

### 8. Cold-start runtime smoke
expected: `node dist/app/doctor.js` boots cleanly; import chain `doctor.ts → createStorageContext → 4 facades → ClaudeStreamJsonCliCleanupProvider` loads without `MODULE_NOT_FOUND`; exits 0 (env-config gaps reported as "실패한 항목" are expected — Discord token not set in this environment).
result: pass
evidence: DOCTOR_EXIT=0. CLI runs, reports missing Discord token as expected, advises `npm run repair`. Phase 2's main.ts edits (try/catch + log line + process.on("exit")) load cleanly with no runtime import errors.

### 9. Final acceptance
expected: User confirms no regression observed outside this UAT scope.
result: blocked
blocked_by: environment / cross-platform-native-binding
reason: |
  User reported recording could not complete on Windows. Investigation revealed `ERR_DLOPEN_FAILED` on `node_modules/node-crc/build/Release/crc.node` — message "not a valid Win32 application" indicates a Linux ELF binary in the Windows-side node_modules. Root cause: WSL-side `npm install` (during Wave 1 T5 it ran `npm install --no-save @snazzah/davey-linux-x64-gnu`) re-placed native modules with Linux binaries, overwriting prior Windows binaries. Same class of issue as the carry-forward documented in STATE.md commit `27152f9` (`@snazzah/davey` Linux/Windows binary mismatch).
  
  Phase 2 code is NOT at fault. The `node-crc` package is consumed by the recording producer's chunk-CRC step, which fires immediately when a chunk is being finalized — hence the symptom chain (chunk status stuck at "writing" → audioUrls empty → no playbar → no STT job → no AI cleanup).
  
  Recovery: on the Windows side, run `npm install` (or `npm rebuild node-crc`) to overwrite the Linux binary with the Windows variant. After that, the recording pipeline should function normally. Re-run UAT step 9 to confirm.

## Summary

total: 9
passed: 8
issues: 0
pending: 0
skipped: 0
blocked: 1

## Gaps

- truth: "User can run /dirong start in Discord, the bot records audio to chunks, STT transcription runs over the chunks, and AI cleanup produces a meeting note draft — the canonical end-to-end happy path of the product."
  status: failed
  reason: "User reported the recording itself could not be confirmed (let alone STT conversion or AI cleanup). Diagnosis pending — most likely root cause is the recording pipeline, not the downstream STT/AI stages (which only fail because they have no input)."
  severity: blocker
  test: 9
  user_followup_2026-05-16: "봇이 음성 채널에 입장은 했는데 녹음 결과가 없다 → 추가 단서: 음성 파일은 디스크에 있을 것으로 추측되고, 대시보드에 chunk 갯수는 표시되지만 *재생바가 생성되지 않았다*."
  refined_root_cause: "Recording producer는 chunk를 디스크에 쓰고 DB에 chunk row를 만드는 흐름까지는 정상 동작했다(갯수 표시). 그러나 chunk가 *재생 가능한 상태*(transcoded + audio path resolved)로 전이되지 않아 dashboard의 재생바 UI가 활성화되지 않았다. 가설: Phase 1 Wave 3 storage cutover에서 dashboard read-model의 audio path resolution이 깨졌거나, transcode 큐(STT job 생성) 흐름이 동작하지 않음. Phase 1 UAT는 cold-start build + 부팅 smoke까지만 검증했고 *실제 녹음 → transcode → dashboard 재생* 흐름은 검증되지 않았으므로, Phase 1 회귀일 가능성이 Phase 2 회귀 가능성보다 높음."
  diagnosis_candidates:
    - "Phase 2 T2 added `process.on('exit', () => aiCleanupProvider.reapTrackedPids())` at main.ts:183. If any path during boot triggers process exit (uncaught throw, etc.), the reaper runs prematurely. Less likely — process.on(exit) only fires at actual process end."
    - "Phase 2 T3 added `safeguardInterval` setInterval inside AiProviderLifecycleService.start(). The interval calls `forceKillIfStale(Date.now(), timeoutMs * 2)` periodically. If `provider.session.startedAt` is unexpectedly 0 / null / undefined when checked, the safeguard might force-kill an active session prematurely. Worth checking the `startedAt` initialization."
    - "Phase 2 T2 narrowed `createAiCleanupProvider` return type from AiCleanupProvider to ClaudeStreamJsonCliCleanupProvider. If any other call site relied on the broader type, downstream wiring could break — but TypeScript would have caught this in tsc (and it didn't)."
    - "Phase 2 T3 added wrapAiCleanupProviderWithLifecycle forwarding of forceKillIfStale via dynamic property assignment. If the wrap altered an existing method's binding, AI cleanup calls could fail — but RELY-05 happy-path test passes."
    - "Bot was not restarted after Phase 2 commits landed — runs an old build."
    - "An unrelated environmental issue (Discord token rotation, voice receive subsystem, native binding mismatch, etc.) coincidentally surfaced during Phase 2 testing."
  artifacts: []  # filled by diagnosis after user provides last-observed-step
  missing: []  # filled by diagnosis

## Follow-ups (out of scope for this UAT — already logged in STATE.md)

- POLY (Phase 3): update narrow ports (`RecordingProducerStore`, `DashboardStore`, `SttBatchStore`, `AiCleanupAutomationStore`) to accept facade-typed inputs, then delete the transitional `flattenStorageContext` + `FlatStorageStore` from `storage-context.ts`.
- Hygiene: `dist/storage/job-retry-policy.test.js` pre-existing test still not enumerated in `package.json#scripts.test`.
- **Environment hygiene (new — added 2026-05-16):** `node-crc` joins `@snazzah/davey` as a known cross-platform-native-binding pain point. Both modules ship platform-specific binaries that get overwritten when `npm install` runs from the wrong side (WSL vs Windows) of the shared checkout. Documented mitigation: re-run `npm install` on each platform when switching, or maintain platform-isolated `node_modules`. Adding this to STATE.md "Environment note" carry-forward.
