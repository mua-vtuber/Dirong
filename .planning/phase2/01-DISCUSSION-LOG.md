# Phase 2: Persistent CLI & Recording Reliability — Discussion Log

**Discussed:** 2026-05-15
**Mode:** discuss-phase (default), 2 areas selected, 4 questions each
**Reference:** see `01-CONTEXT.md` for canonical decisions

---

## Pre-discussion analysis

**Gray areas identified by Claude (4 presented):**
1. Cleanup 범위 (RELY-01) — orphan claude PID SIGKILL trigger scope
2. Boot repair 조건 (RELY-04) — when/how to invoke `runStartupRepair`
3. Test 격리 전략 (TEST-01 / RELY-05) — fake spawn vs real claude binary
4. Wave 분할 (orchestration) — big-bang vs wave-by-wave

**User selected:** Cleanup 범위 (RELY-01) + Boot repair 조건 (RELY-04). Areas 3 and 4 deferred to planner discretion (locked by ROADMAP success-criterion text + Phase 1 wave pattern proven).

---

## Area 1: Cleanup 범위 (RELY-01)

### Q1 — Kill triggers scope

**Options presented:**
- stop() + process.on('exit') 둘 다 (recommended) — covers normal shutdown + last-chance sync net; SIGINT/SIGTERM transitively via process.exit
- + SIGINT/SIGTERM 명시 핸들러도 추가 — explicit signal handlers, more handlers, potential ordering conflicts with discord.js
- stop()만 충분 — minimum code, panic exposure on uncaughtException

**User selected:** stop() + process.on('exit') 둘 다 (recommended)
**Decision:** D-01 in CONTEXT.md

### Q2 — Windows SIGKILL approach

**Options presented:**
- process.kill(pid, 'SIGKILL') 단독 (recommended) — Node stdlib, internally TerminateProcess on Windows
- tree-kill package — covers descendant tree, adds dependency
- Windows-only taskkill /F /T — uses existing run-child.ts; POSIX fallback

**User selected:** process.kill(pid, 'SIGKILL') 단독 (recommended)
**Decision:** D-02 in CONTEXT.md — rationale recorded: claude CLI does not spawn descendants.

### Q3 — PID storage location

**Options presented:**
- Provider 인스턴스 field (recommended) — `private readonly trackedPids = new Set<number>()`
- Module-level static Set — process-wide, test-isolation risk
- Service-level Set (provider-lifecycle-service) — SRP-clean but extra boundary

**User selected:** Provider 인스턴스 field (recommended)
**Decision:** D-03 in CONTEXT.md

### Q4 — SIGKILL failure handling

**Options presented:**
- process.on('exit') quiet, stop() emits dashboard event (recommended) — context-sensitive
- 항상 dashboard 이벤트 — consistent but exit-path SqlRunner may already be torn down
- 전부 swallow — rejected per CLAUDE.md no-silent-fallbacks

**User selected:** process.on('exit') quiet, stop() emits dashboard event (recommended)
**Decision:** D-04 in CONTEXT.md

---

## Area 2: Boot repair 조건 (RELY-04)

### Q1 — Execution gate

**Options presented:**
- 현상유지 — 무조건 실행 (recommended) — main.ts:126 status quo; empty scan is NOP
- chunk_finalize_timeout 항목 있을 때만 — adds count-query branch
- 무조건 실행 + 결과 기반 대시보드 이벤트 — variant of recommended

**User selected:** 현상유지 — 무조건 실행 (recommended)
**Decision:** D-05 in CONTEXT.md — rationale: idempotency-first; NOP cost negligible.

### Q2 — Log format

**Options presented:**
- "startup repair: N items reconciled" 한 줄 (recommended) — matches success-criterion text
- JSON blob + summary 둘 다 — verbose
- summary를 대시보드 이벤트로도 기록 — overshoot for clean boots

**User selected:** "startup repair: N items reconciled" 한 줄 (recommended)
**Decision:** D-06 in CONTEXT.md — replaces current `JSON.stringify` blob at main.ts:254.

### Q3 — Run order vs server start

**Options presented:**
- Repair → 대시보드 시작 → Discord login (recommended, status quo) — sequential consistency
- 비동기 백그라운드 repair — race risk during recording
- "복구 중..." lock screen UX — over-engineered for 0-1s typical repair

**User selected:** Repair → 대시보드 시작 → Discord login (recommended, status quo)
**Decision:** D-07 in CONTEXT.md

### Q4 — Failure handling (user asked clarifying question first)

**User clarifying question (rendered through AskUserQuestion's "Other"):** "Repair이 정확히 뭘 회복시키는 시스템인데?"

**Claude response:** Read `repair-scan.ts:1-120`; explained the 7 sub-tasks (oldPartFiles memo, staleWritingChunks finalize, missingSttJobs补充, missingAudio fail, expired lease release, orphan audio count). Repair is a 补 (helper), not a critical path — most operations write repair_items or counts, no destructive actions. ffmpeg-missing case only flags the chunk as needs_repair.

**Re-posed Q4 options:**
- 죽어도 계속 — 에러 로그 + 대시보드 경고 표시 후 부팅 진행 (recommended)
- 재시도 1회 후 폴백 — handles transient SQLite locks
- 완전 실패 — process.exit(1) — rejected as over-reaction

**User selected:** 죽어도 계속 — 에러 로그 + 대시보드 경고 표시 후 부팅 진행 (recommended)
**Decision:** D-08 in CONTEXT.md

---

## Cross-area notes

- **Phase 1 carry-forward** acknowledged at discussion open: `StorageContext` wired, `runStartupRepair(ctx, config)` already in place, wave-with-worktree pattern proven, "extend, do not displace" test policy.
- **CRLF line-ending merge friction** mentioned as a recurring operational concern (Phase 1 Waves 3 + 4 hit it). Captured under `<specifics>` in CONTEXT.md so executors / orchestrator do not reinvent the stash-pop-with-`--ours` recovery sequence.
- **Scope creep redirects:** none triggered — user stayed strictly within RELY-01 and RELY-04 surfaces.

---

## Areas deferred (not discussed, intentional)

- **RELY-02 abort-listener ordering** — success-criterion text locks the contract; planner mechanically applies.
- **RELY-03 safeguard interval frequency** — researcher selects idiomatic default (recommended: `timeoutMs/4` with 5s minimum).
- **RELY-05 force-close test fault injection mechanism** — planner picks smaller diff.
- **TEST-01 file location** — planner decides based on file-size limits.
- **Wave/plan split** — planner decides based on file overlap; Phase 1 pattern strongly suggests Wave 1 (lifecycle) || Wave 2 (boot polish) || Wave 3 (force-close test).

---

*Discussion log: 2026-05-15*
