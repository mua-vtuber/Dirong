# Code Quality Remediation Prework Design

> [!IMPORTANT]
> 역사 기록, 현재 실행 경로 아님: 이 문서는 2026-05-07 기준의 사전 정리 기록이며,
> 현재 구현 기준은 최신 설계 문서와 코드 상태를 우선합니다.

작성일: 2026-05-07

이 문서는 `docs/code-quality-audit-2026-05-07.md`를 다시 코드 기준으로
검증하고, 실제 수정에 들어가기 전 작업 순서와 경계를 정리한다.

이번 문서의 범위는 설계와 작업 전 판단 정리뿐이다. 이 문서를 작성하면서
소스 코드는 수정하지 않았다.

## 1. 확인한 기준

확인한 문서:

- `docs/code-quality-audit-2026-05-07.md`
- `docs/claude-persistent-and-alone-finalize-design.md`
- `docs/ai-cleanup-automation-phase-c-design.md`
- `docs/phase-1-recording-producer-adoption-plan.md`

확인한 코드:

- `package.json`, `tsconfig.json`
- `src/index.ts`, `src/commands.ts`, `src/doctor.ts`, `src/recorder.ts`, `src/session.ts`
- `src/config.ts`, `src/health.ts`, `src/app/main.ts`, `src/discord/commands.ts`
- `src/storage/sqlite.ts`, `src/storage/schema.ts`, `src/storage/session-store.ts`
- `src/storage/repair-scan.ts`, `src/stt/runner.ts`, `src/stt/automation-service.ts`
- `src/ai/cleanup/claude-cli-provider.ts`
- `src/ai/cleanup/claude-persistent-cli-provider.ts`
- `src/ai/cleanup/claude-persistent-smoke.ts`
- `src/ai/cleanup/automation-service.ts`, `src/ai/cleanup/runner.ts`
- `src/ai/cleanup/provider-lifecycle-service.ts`
- `src/dashboard/server.ts`, `src/recording/recording-producer.ts`
- 관련 테스트 파일: `claude-persistent-*`, `automation-service`, `runner`,
  `session-store-ai-cleanup`, `dashboard`, `alone-finalize`, `stt`

검증 명령:

```text
npm run build
npm test
```

결과:

- `npm run build`: PASS
- `npm test`: PASS, 106 tests

외부 기준:

- Node 공식 문서 기준 `node:sqlite`는 Node 22 계열에서 active development,
  최신 문서 계열에서는 release candidate로 표시된다. 따라서 "곧바로 교체"보다
  "어댑터 격리"가 더 안전한 1차 대응이다.

## 2. 감사 문서 판단 검증

### 2.1 판단 유지: 실제 수정 우선순위가 높은 항목

#### Phase 0 entry/recorder 잔존

감사 문서 판단에 동의한다.

근거:

- `package.json`에 `phase0:start`, `phase0:doctor`가 남아 있다.
- `Dirong Phase0 Start.bat`가 `npm run phase0:doctor`와 `/dirong-test`를 안내한다.
- `src/index.ts`가 `loadPhase0Config`, `guildCommandPayloads`,
  `Phase0Recorder`를 사용해 실제 Discord client entry로 동작한다.
- `src/commands.ts`는 `/dirong-test` command payload를 만든다.
- `src/recorder.ts`, `src/session.ts`는 Phase 0 JSON writer 기반 녹음 경로다.
- `tsconfig.include = ["src/**/*.ts"]`라서 Phase 0 파일도 계속 컴파일된다.

판단:

- 운영 entry와 실험 entry가 동시에 유지되는 것은 혼동과 사고 위험이 있다.
- `Phase0HealthReport` 같은 이름은 현재도 `runHealthCheck()`의 반환 타입으로
  쓰이므로, 삭제 작업 중 이름 정리도 같이 검토해야 한다.

우선순위: P0

#### `ClaudeCliCleanupProvider` one-shot 잔존

감사 문서 판단에 동의한다.

근거:

- 운영 entry인 `src/app/main.ts`와 수동 CLI인 `src/app/ai-cleanup.ts`는 모두
  `ClaudePersistentCliCleanupProvider`를 생성한다.
- `ClaudeCliCleanupProvider`의 비테스트 사용처는 없다.
- persistent provider는 `DEFAULT_CLAUDE_CLEANUP_MODEL` 상수만 one-shot 파일에서
  import한다.
- one-shot provider의 `runCommand()`는 `resolveShellFalseCommand()`를 사용하지
  않아 Windows `.cmd`/`.bat` 실행 경로가 persistent provider와 다르다.

판단:

- one-shot class와 테스트는 제거하고, 모델 상수만 별도 파일로 이동하는 편이
  맞다.
- 단, persistent provider의 `stream-json` 방식은 사용자 의도가 들어간 코드이므로
  제거 대상이 아니다.

우선순위: P1

#### `applySchemaMigrations` 정식화

감사 문서의 문제의식에 동의한다. 다만 현재 데이터가 즉시 깨지는 버그라기보다,
다음 schema 변경 전에 반드시 끝내야 하는 기반 작업이다.

근거:

- `src/storage/sqlite.ts`는 신규 DB에 `SCHEMA_SQL`을 실행한 뒤
  `applySchemaMigrations()`를 호출한다.
- 현재 migration 함수는 `transcript_segments.speech_status` 보강과 값 보정만 한다.
- `dirong_migrations` 같은 적용 이력 테이블은 없다.
- `ai_cleanup_jobs`, `meeting_notes_drafts` 등은 baseline `CREATE TABLE IF NOT EXISTS`
  에만 존재한다.

판단:

- `dataDir`/audio path 상대화 같은 실제 DB 변경을 하려면 먼저 versioned migration
  인프라가 필요하다.

우선순위: P0

#### STT processing lease repair 비대칭

감사 문서 판단에 동의한다.

근거:

- STT lease repair는 `runSttBatch()`와 `repair-scan`에서
  `releaseExpiredProcessingLeases()`로 수행된다.
- AI cleanup automation은 매 tick마다 AI cleanup job lease만
  `repairExpiredAiCleanupProcessingJobs()`로 복구한다.
- AI cleanup은 `getAiCleanupSttTerminalSnapshot()`에서 STT queued/processing이
  없어야 진행한다.

판단:

- STT automation이 disabled되거나 죽은 상태에서 processing lease가 만료되면,
  AI cleanup이 STT terminal을 영원히 기다릴 수 있다.
- AI cleanup tick 또는 별도 housekeeper에서 STT lease를 복구해야 한다.

우선순위: P1

#### `SessionStore` god object

감사 문서 판단에 동의한다.

근거:

- `src/storage/session-store.ts`는 현재 1833줄이며, 세션 CRUD, chunk, STT queue,
  transcript, AI cleanup jobs, drafts, dashboard read model, repair item을 모두
  포함한다.
- `listFinalizedSessionsForAiCleanupAutomation()`과
  `getAiCleanupSttTerminalSnapshot()`은 AI cleanup policy와 SQL 집계를 동시에
  담고 있다.
- `getDashboardState()`는 여러 read query와 JSON redaction을 한 메서드에서 수행한다.

판단:

- 장기적으로 repository/read-model 분리가 맞다.
- 다만 Phase 0 삭제와 migration 인프라보다 먼저 건드리면 충돌 면적이 너무 크다.

우선순위: P2

#### 절대 경로 저장

감사 문서 판단에 동의하되, 범위는 문서보다 더 넓다.

근거:

- `RecordingProducer.start()`는 `sessionDir = createUniqueSessionDir(config.dataDir, ...)`
  로 절대 경로를 만든 뒤 `sessions.data_dir`에 저장한다.
- chunk의 `raw_audio_path`, `stt_audio_path`, STT job의 `input_audio_path`도 절대
  파일 경로를 전제로 사용된다.
- `dashboard/server.ts`, `repair-scan.ts`, `session-store.ts`가 DB path를 그대로
  `existsSync()` 또는 audio response에 사용한다.

판단:

- `sessions.data_dir`만 상대화하면 부족하다. audio path 전체에 path resolver 경계가
  필요하다.
- 이 작업은 migration 인프라 이후 별도 PR로 분리해야 한다.

우선순위: P2

### 2.2 부분 동의: 방향은 맞지만 설계 조정 필요

#### `node:sqlite`

방향에는 동의하지만, `better-sqlite3` 즉시 도입에는 동의하지 않는다.

근거:

- 현재 코드가 직접 `DatabaseSync`를 사용하는 파일은 `storage/sqlite.ts`,
  `app/sqlite-backup.ts`, `app/doctor.ts`다.
- package policy상 새 dependency는 명시 요청 없이 추가하지 않는다.
- native dependency 도입은 Windows 개발 환경과 배포 경로에 새 실패 지점을 만든다.

판단:

- 1차 작업은 `DirongDatabase`/backup/doctor 주변에 최소 인터페이스를 두는
  adapter isolation이다.
- 실제 driver 교체는 Node LTS/운영 배포 요구가 명확해졌을 때 결정한다.

우선순위: P3

#### `stream-json` / Claude CLI schema drift

위험 감시는 필요하지만, 이 방식 자체는 문제로 보지 않는다.

근거:

- persistent provider 테스트가 `--input-format stream-json`,
  `--output-format stream-json`, `--verbose`, `--json-schema`를 명시적으로 검증한다.
- `ClaudePersistentSmokeSession`은 `type: "assistant"`에서 text를 모으고,
  `type: "result"`를 turn boundary로 본다.
- 결과가 오지 않으면 request timeout에서 process를 kill한다. 따라서 "영원히 hang"은
  현재 코드 기준 정확하지 않다.

판단:

- `stream-json`은 사용자 의도에 따른 설계 결정이므로 유지한다.
- 보강한다면 version preflight 결과를 readiness/smoke output에 남기고,
  parser 테스트에 unknown event와 malformed line 케이스를 더하는 정도가 적절하다.

우선순위: P2 guard, not cleanup

#### automation base class

중복은 맞지만, 곧바로 abstract base class로 올리는 것에는 신중해야 한다.

근거:

- `SttAutomationService`와 `AiCleanupAutomationService`는 timer/start/stop/runOnce
  골격이 거의 같다.
- 그러나 AI cleanup 쪽은 readiness retry, in-flight session, expired AI job repair,
  STT terminal snapshot 등 상태가 더 많다.

판단:

- 상속형 `PollingAutomation`보다 작은 scheduler helper 또는 composition이 더 안전하다.
- P0/P1 정리 후 중복 제거 pass에서 다시 판단한다.

우선순위: P3

### 2.3 정정: 현재 코드 기준 동의하지 않는 항목

#### waiter timer 누수

감사 문서 판단에 동의하지 않는다.

근거:

- `waitForNextStdoutLine()`의 waiter는 line/error/exit/timeout 경로에서
  `removeArrayValue()`를 호출한다.
- line/error/exit 경로에서는 `clearTimeout(timer)`도 수행한다.
- `waitForExit()`도 exit 경로에서 `clearTimeout(timer)`를 수행한다.

판단:

- 현재 코드 기준 timer 누수 항목은 오진이다.
- 별도 수정 작업으로 잡지 않는다.

#### `prepareAbortController` stop 후 재사용

현재 버그로는 동의하지 않는다.

근거:

- `AiProviderLifecycleService.stop()`은 `stopped = true`로 바꾼다.
- `startPrepareInBackground()`는 `stopped`이면 기존 snapshot을 반환하고 prepare를
  새로 시작하지 않는다.
- 현재 앱 흐름에서 stop은 shutdown 경로다.

판단:

- "dashboard에서 AI 재준비 버튼을 추가하면 controller lifecycle 재설계 필요"는 맞다.
- 현재 작업 우선순위에는 넣지 않는다.

#### `softTimer` long-held closure

누수로 보기는 어렵다.

근거:

- `RecordingProducer.pipeAndFinalizeChunk()`의 `finally`에서 `softTimer`와
  `hardCapTimer`를 모두 clear한다.
- soft rollover는 "다음 silence에서 닫고 hard cap을 backstop으로 유지"하는 의도적
  상태다.

판단:

- 코멘트 보강은 가능하지만, 독립 작업으로 잡을 필요는 낮다.

## 3. 작업 전 설계

이번 cleanup/remediation은 한 번에 큰 리팩터링으로 처리하지 않는다.
기존 동작을 테스트로 고정하고, 냄새 단위로 작은 PR/작업을 순서대로 진행한다.

공통 원칙:

- 새 dependency는 추가하지 않는다.
- 기존 DB 데이터 보존을 기본 전제로 한다.
- `stream-json` persistent Claude 경로는 유지한다.
- 삭제/분리는 한 작업에서 하나의 smell만 해결한다.
- 각 작업 전후 `npm run build && npm test`를 통과시킨다.

### 3.1 Work Package A: Phase 0 entry 정리

목표:

- 실험용 Phase 0 Discord entry와 `/dirong-test` command를 운영 코드에서 제거한다.
- 운영 entry는 `src/app/main.ts`, command는 `/dirong` 하나로 명확히 한다.

예상 변경:

- 삭제 후보:
  - `src/index.ts`
  - `src/commands.ts`
  - `src/doctor.ts`
  - `src/recorder.ts`
  - `src/session.ts`
  - `Dirong Phase0 Start.bat`
- `package.json`:
  - `phase0:start`, `phase0:doctor` 삭제
  - `phase1:start`, `phase1:doctor`, `phase1:repair`는 중복 alias라 삭제 검토
  - `main`은 `dist/app/main.js`로 변경 검토
  - package name/description의 phase0 명칭 정리 검토
- `src/config.ts`:
  - `Phase0Config`, `Phase0ConfigSnapshot`, `loadPhase0Config`, `snapshotConfig` 삭제
  - 공통 `SttSafeFormat`, Phase 1/3 config는 유지
- `src/health.ts`:
  - `Phase0HealthReport` 이름을 `HealthReport`로 rename 검토
  - `runHealthCheck()` 호출처 compile 확인

행동 고정:

- 기존 Phase 1+/운영 경로 테스트 전체 실행.
- `phase0:*` 제거 후 `npm test` script에서 삭제된 테스트/파일 참조가 없어야 한다.

수용 기준:

- `/dirong-test` 관련 rg 결과가 0이거나 문서 기록에만 남는다.
- `npm run build && npm test` PASS.
- Phase 1+/STT/AI cleanup 테스트 106개 또는 업데이트된 테스트 세트가 PASS.

### 3.2 Work Package B: migration 인프라

목표:

- 현재 ad hoc `applySchemaMigrations()`를 versioned migration runner로 바꾼다.
- 이후 path 상대화 같은 DB 변경을 안전하게 적용할 수 있게 한다.

예상 변경:

- `src/storage/migrations.ts` 또는 `src/storage/migrations/index.ts` 추가
- `dirong_migrations` 테이블 추가:

```sql
CREATE TABLE IF NOT EXISTS dirong_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

- migration id 예시:
  - `001_transcript_segments_speech_status`
- 신규 DB baseline인 `SCHEMA_SQL`은 현재 최종 schema를 유지한다.
- migration runner는 이미 적용된 id를 건너뛰고, 미적용 migration만 transaction 안에서
  실행한다.
- 기존 `speech_status` 보정 logic은 migration 함수로 이동한다.

행동 고정:

- legacy DB fixture를 만들어 `transcript_segments`에 `speech_status`가 없는 상태에서
  migration이 컬럼과 값을 보강하는 테스트 추가.
- migration idempotency 테스트 추가.
- baseline `SCHEMA_SQL`로 만든 새 DB에서도 migration runner가 안전하게 통과하는지
  테스트한다.

수용 기준:

- 기존 DB upgrade와 신규 DB bootstrap이 모두 PASS.
- `dirong_migrations`에 적용 이력이 남는다.
- `npm run build && npm test` PASS.

### 3.3 Work Package C: one-shot Claude provider 제거

목표:

- 운영 미사용 one-shot provider를 제거하고 persistent provider만 유지한다.
- 사용자 의도인 `stream-json` warm session 경로는 건드리지 않는다.

예상 변경:

- `src/ai/cleanup/claude-models.ts` 추가:
  - `DEFAULT_CLAUDE_CLEANUP_MODEL = "haiku"`
  - 마지막 검증 기준/의도 주석 추가 가능
- `src/ai/cleanup/claude-persistent-cli-provider.ts` import 변경
- 삭제 후보:
  - `src/ai/cleanup/claude-cli-provider.ts`
  - `src/ai/cleanup/claude-cli-provider.test.ts`
- `package.json` test script에서 삭제된 test entry 제거

보강 가능 항목:

- `ClaudePersistentCliCleanupProvider.preflight()`가 `claude --version` stdout을
  readiness detail 또는 smoke CLI 출력에 남기도록 확장할지 검토한다.
- `parseClaudeStreamJsonLine()` 테스트에 unknown event/malformed JSON을 추가한다.

수용 기준:

- `ClaudeCliCleanupProvider` rg 결과가 0.
- persistent provider tests PASS.
- `stream-json` args를 검증하는 테스트는 유지.
- `npm run build && npm test` PASS.

### 3.4 Work Package D: STT lease housekeeper 보강

목표:

- STT automation이 멈추거나 disabled인 경우에도 AI cleanup이 만료된 STT processing
  lease 때문에 영구 대기하지 않게 한다.

설계 선택지:

1. AI cleanup automation tick에서 `releaseExpiredProcessingLeases()`를 호출한다.
2. 별도 `HousekeepingService`를 만들어 STT/AI lease repair를 한곳에서 수행한다.
3. STT automation을 항상 enabled로 강제한다.

선호안:

- 1번을 먼저 적용한다. 가장 작고 기존 store 메서드를 재사용한다.
- snapshot에는 필요하면 `repairedExpiredSttLeases`를 별도 필드로 추가한다.
- AI cleanup job repair summary와 STT lease repair summary를 섞지 않는다.

행동 고정:

- AI cleanup automation test에 다음 케이스 추가:
  - finalized session에 expired STT processing job이 있음
  - STT automation을 직접 돌리지 않음
  - AI cleanup automation `runOnce()`가 먼저 lease를 queued로 되돌림
  - 다음 tick 또는 같은 tick에서 STT terminal 대기 상태가 정확히 표현됨

수용 기준:

- expired STT lease가 자동으로 requeued 또는 repair item 기록된다.
- AI cleanup이 영구 processing 상태만 보고 멈추지 않는다.
- `npm run build && npm test` PASS.

### 3.5 Work Package E: DB path resolver와 상대 경로 전환

목표:

- repo/OS/user/container 이동에 취약한 absolute data/audio path 저장을 줄인다.

전제:

- Work Package B migration 인프라 완료 후 진행한다.

설계:

- `config.dataDir`을 storage root로 정의한다.
- DB에는 root 기준 상대 path를 저장하는 방향으로 전환한다.
- read boundary에서만 absolute path로 resolve한다.
- resolver 예시:

```ts
type StoredAudioPath = string;

function toStoredPath(root: string, absolutePath: string): StoredAudioPath;
function resolveStoredPath(root: string, storedPath: StoredAudioPath): string;
```

주의:

- `sessions.data_dir`뿐 아니라 `chunks.raw_audio_path`, `chunks.stt_audio_path`,
  `stt_jobs.input_audio_path`, draft output paths까지 범위를 확인해야 한다.
- `repair-scan`, dashboard audio endpoint, STT provider input, backup/draft writer가 모두
  같은 resolver를 써야 한다.

행동 고정:

- 기존 absolute path DB를 migration하는 fixture test.
- 새 session 생성 시 상대 path가 저장되는 test.
- dashboard audio endpoint와 repair scan이 resolver를 통해 실제 파일을 찾는 test.

수용 기준:

- 기존 absolute path DB를 읽을 수 있다.
- 새 DB row는 relative path를 저장한다.
- `npm run build && npm test` PASS.

### 3.6 Work Package F: `SessionStore` 분할 준비

목표:

- 기능 변경 없이 storage 책임을 나눈다.

전제:

- Phase 0 삭제 완료.
- migration 인프라 완료.
- path resolver 방향 결정 완료.

분할 순서:

1. 내부 helper와 type을 유지한 채 read-only dashboard view를 먼저 분리한다.
2. STT jobs repo를 분리한다.
3. AI cleanup jobs/drafts repo를 분리한다.
4. chunks repo를 분리한다.
5. sessions repo를 분리한다.
6. 마지막에 `SessionStore` facade 유지 여부를 결정한다.

행동 고정:

- 기존 storage/AI/STT/dashboard tests를 그대로 통과시킨다.
- 각 분할은 public method signature를 가능한 유지한다.

수용 기준:

- 한 PR에서 한 책임만 이동한다.
- 호출처 변경이 최소화된다.
- `npm run build && npm test` PASS.

## 4. 후순위 또는 보류 항목

다음 항목은 당장 P0/P1 작업에 넣지 않는다.

- `waitForNextStdoutLine`/`waitForExit` timer cleanup: 현재 오진.
- `prepareAbortController` 재생성: 현재 shutdown-only lifecycle에서는 버그 아님.
- `softTimer` closure: 현재 finally cleanup이 있음.
- dashboard HTML 분리: 유효하지만 운영 위험은 낮음.
- automation base class: 상속보다 composition helper를 추후 검토.
- `runProcess`/`runCommandForExit` 통합: one-shot provider 삭제 후 범위 축소 재평가.
- env parser 통합: 정책 차이가 있어 별도 정리 작업으로 분리.
- `better-sqlite3` 도입: 새 dependency이므로 명시 요청 전 보류.

## 5. 첫 구현 순서 제안

1. Work Package A: Phase 0 entry 정리
2. Work Package B: migration 인프라
3. Work Package C: one-shot Claude provider 제거
4. Work Package D: STT lease housekeeper
5. Work Package E: DB path resolver와 상대 경로 전환
6. Work Package F: `SessionStore` 분할 준비

이 순서는 다음 이유로 선택한다.

- 삭제 가능한 dead code를 먼저 제거해 이후 grep/build/test 표면을 줄인다.
- DB migration 인프라를 먼저 넣어 데이터 보존이 필요한 후속 작업을 안전하게 만든다.
- Claude cleanup은 one-shot 제거와 persistent guard 보강으로 범위를 작게 유지한다.
- `SessionStore` 대분할은 앞의 기반 정리가 끝난 뒤 해야 충돌과 회귀 위험이 낮다.

## 6. 남은 질문

- `phase1:*` script alias도 이번 Phase 0 정리에서 같이 삭제할지, 아니면 한 번 더
  release/runbook 정리 후 삭제할지 결정이 필요하다.
- `Phase0HealthReport` rename을 Phase 0 삭제 작업에 포함할지, 별도 명명 정리 작업으로
  분리할지 결정이 필요하다.
- Claude CLI 호환성 guard는 version warning만 할지, 특정 version allowlist까지 둘지
  결정이 필요하다.

현재 판단으로는 첫 작업에서 `phase1:*` alias와 health type rename까지 포함해도
작업량은 작지만, package/runbook 변경이 넓어지는 점은 감수해야 한다.
