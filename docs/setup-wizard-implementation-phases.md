# Setup Wizard Implementation Phases

작성일: 2026-05-10

이 문서는 Dirong 비개발자용 첫 설정 위자드와 대시보드 설정을 구현하기 위한 단계별
작업 계획이다. 제품/UX 결정은 `docs/notion-setup-wizard-plan.md`와
`docs/dashboard-settings-design.md`를 따른다.

## 1. 참조 문서

필수:

- `docs/notion-setup-wizard-plan.md`
- `docs/dashboard-settings-design.md`
- `docs/notion-db-structure.md`
- `docs/notion-i18n-plan.md`
- `docs/discord-meeting-notes-pipeline.md`

참고:

- `docs/phase-5-notion-writer-design.md`
- `docs/phase3-stt-design.md`
- `docs/ai-provider-lifecycle-design.md`
- `docs/phase-4-ai-cleanup-design.md`
- `docs/claude-persistent-and-alone-finalize-design.md`

`docs/phase-5-notion-writer-design.md`의 단일 data source와 `.env` fallback 중심 내용은
legacy 설명으로만 본다. 새 구조와 충돌하면 setup wizard, dashboard settings,
notion DB/i18n 문서를 우선한다.

## 2. 전역 결정

- 제품 런타임은 `.env` fallback을 사용하지 않는다.
- 설정 출처는 local settings store, local secret file, SQLite registry, code defaults만
  사용한다.
- 필수 설정이 없으면 `.env`에서 대신 읽지 않고 설정 미완료 상태를 반환한다.
- MVP secret 저장은 OS credential manager가 아니라 local secret file로 한다.
- 대시보드는 항상 열리되, 설정 미완료 기능은 단계별로 잠근다.
- 앱 언어, 위자드 언어, Notion schema locale은 MVP에서 하나로 묶는다.
- i18n은 TypeScript locale catalog로 시작하고, 나중에 JSON export 가능하게 구조화한다.
- 에러와 다음 행동 안내 문구도 i18n key로 관리한다.
- Discord guild id, Notion database id, data source id, property id를 사용자에게 직접
  입력하게 하지 않는다.
- STT는 local faster-whisper를 기본 추천으로 한다.
- bundled Python과 FFmpeg를 전제로 한다.
- faster-whisper 패키지와 모델은 첫 실행 위자드에서 설치/다운로드한다.
- AI provider는 MVP에서 Claude만 실제 지원하되, `provider + mode(cli/api)` 구조로 둔다.
- Notion은 internal connection token과 parent page URL만 받는다.
- Notion managed DB 생성은 `parseNotionPageUrl`, `createManagedNotionSchema`,
  `NotionRegistryStore`, schema preset을 재사용한다.
- 오디오 파일은 Notion 업로드 성공 후 즉시 삭제한다.
- STT 텍스트와 AI draft는 기본 30일 보관 후 삭제한다.

### 2.1 2026-05-12 DB 설정 후속 구현 상태

완료된 항목:

- Notion managed registry의 local 상태와 remote schema check 결과를 분리했다.
- 필수 필드/관계 diff, 복구 계획 preview, 사용자 확인 후 repair apply를 구현했다.
- managed schema diff를 writer 검증 경로에서 재사용해 업로드 전 검증 중복을 줄였다.
- DB 설정 화면에서 role별 check/repair UX를 연결했다.
- 사용자 custom property rule을 meeting/member/task role별로 분리 저장한다.
- action item DB 업로드 경로를 연결해 task page를 생성/갱신한다.
- Notion 설정 변경은 다음 automation tick과 수동 dashboard action에 반영된다.
- `npm run doctor`가 local managed registry summary를 표시하고,
  `--notion-remote`에서만 Notion API를 호출한다.

후속 항목:

- 기존 DB 가져오기와 자동 마이그레이션은 고급 기능으로 남긴다.
- 작업자/액션 아이템 DB의 사용자 필드 입력 UI와 source 확장은 후속 단계로 둔다.
- 액션 아이템 상태 자동 완료, 멘션/알림, hosted bot, Notion OAuth는 MVP 범위 밖이다.

## 3. Phase 1 - 설정 저장 기반

목표: 제품 런타임에서 `.env` fallback 없이 동작하는 설정 저장 기반을 만든다.

주요 작업:

- 현재 설정 로딩 구조를 파악한다.
- `{DirongUserData}` 경로 결정을 코드에 반영한다.
- local settings store를 추가한다.
- local secret file을 추가한다.
- token/key redaction 규칙을 추가한다.
- 제품용 설정 완료/미완료 상태 모델을 추가한다.
- dashboard server에서 설정 상태를 조회할 수 있는 최소 API를 추가한다.
- 기존 env loader는 필요하면 개발자/legacy 경로로 격리한다.
- 제품 설정 로딩 경로에서는 `.env`를 읽지 않는다.

완료 기준:

- 설정이 없어도 대시보드는 열린다.
- 설정 상태 API가 기능별 `not_configured`, `ready`, `blocked` 같은 상태를 반환한다.
- secret 원문이 API 응답과 로그에 노출되지 않는다.
- 제품 설정 로딩 경로에서 `.env` fallback이 발생하지 않는다.

이번 Phase에서 하지 않는 것:

- 전체 위자드 UI 구현
- Notion DB 생성 UI 구현
- Discord guild 선택 UI 구현
- STT 모델 다운로드 구현
- Claude 연결 테스트 구현

## 4. Phase 2 - i18n 기반

목표: 위자드/대시보드 설정 문구를 TypeScript locale catalog 기반으로 분리한다.

주요 작업:

- `ko`, `en` locale catalog 구조를 만든다.
- key naming 규칙을 적용한다.
- `t(key)` 또는 유사 helper를 만든다.
- setup/settings/error/action 문구의 기반 key를 추가한다.
- 누락 key를 타입 수준에서 잡을 수 있게 구조화한다.
- 언어 선택 값을 local settings에 저장한다.

완료 기준:

- 앱 언어 설정을 읽고 저장할 수 있다.
- 위자드/설정 API가 i18n key 기반 오류와 action hint를 반환할 수 있다.
- `ko`와 `en` catalog의 구조 불일치를 개발 중에 잡을 수 있다.

이번 Phase에서 하지 않는 것:

- 모든 기존 화면 문구의 전면 이관
- 완전한 영어 문구 품질 검수
- Notion schema locale 분리

## 5. Phase 3 - 위자드 Backend API

목표: UI가 호출할 첫 설정 위자드 API를 만든다.

주요 작업:

- setup state 조회 API
- language 저장 API
- Discord application ID 저장 API
- Discord bot token 저장 API
- Discord 연결 테스트 API
- 봇이 들어간 guild 목록 조회 API
- guild allowlist 저장 API
- STT provider/model 저장 API
- Claude CLI/API 설정 저장 API
- Claude 연결 테스트 API
- Notion token 저장 API
- Notion parent page URL 저장 API
- Notion parent page 검증 API
- managed DB 생성 API

완료 기준:

- 프론트엔드 없이 API 호출만으로 위자드 상태를 순서대로 진행할 수 있다.
- guild id는 API 내부 값으로만 다루고, 사용자는 서버 이름 중심으로 선택한다.
- Notion database id, data source id, property id를 사용자 입력으로 받지 않는다.
- token/key는 secret file에 저장되고 API 응답에는 redacted 상태만 나온다.

이번 Phase에서 하지 않는 것:

- 전체 UI 구현
- Notion repair UI 구현
- 기존 DB 가져오기
- 여러 서버 프로젝트 UI 완성

## 6. Phase 4 - 첫 설정 위자드 UI

목표: 비개발자가 따라갈 수 있는 첫 설정 화면을 만든다.

화면 흐름:

```text
언어 선택
-> 환영/모드 선택
-> Discord 봇 연결
-> Discord 서버 선택
-> STT provider/model 선택
-> Claude CLI/API 선택
-> Notion internal connection token 입력
-> Notion parent page URL 입력
-> managed DB 생성
-> 녹음 자동 종료 확인
-> 개인정보/보관 정책 확인
-> 최종 점검
```

완료 기준:

- 새 사용자가 대시보드에서 설정을 끝까지 완료할 수 있다.
- 설정 실패 시 한국어 action hint를 보여준다.
- database id, data source id, property id, guild id를 직접 입력하게 하지 않는다.
- 최종 점검 화면이 기능별 ready/blocked 상태를 보여준다.

이번 Phase에서 하지 않는 것:

- 대시보드 운영 탭 전체 구현
- Notion 필수 필드 복구 UI
- STT 모델 삭제/재다운로드 UI

## 7. Phase 5 - Notion Managed Flow 연결

목표: 기존 Notion managed schema backend를 위자드와 대시보드 상태에 연결한다.

주요 작업:

- `parseNotionPageUrl` 재사용
- `createManagedNotionSchema` 재사용
- `NotionRegistryStore` 재사용
- schema preset locale 적용
- registry가 있으면 기존 managed DB 상태 표시
- registry가 없으면 parent page 아래 `회의록`, `작업자`, `액션 아이템` DB 생성
- Notion token/parent page 오류를 i18n action hint로 반환

완료 기준:

- parent page URL만으로 managed DB 세트가 생성된다.
- 생성 결과가 SQLite registry에 저장된다.
- 다음 실행 시 registry 기반 상태가 표시된다.
- 기존 DB/필드를 임의로 수정하거나 삭제하지 않는다.

이번 Phase에서 하지 않는 것:

- 기존 DB 가져오기
- 액션 아이템 상태 자동 완료
- Notion 사람 자동 매핑/멘션 알림

## 8. Phase 5.5 - 사람용 상태 문구 레이어

목표: 내부 상태, 오류, 로그를 비개발자가 읽고 다음 행동을 알 수 있는 공통 문구
형식으로 변환한다.

Phase 6의 대시보드 화면 정리에 들어가기 전에 "무슨 말을 보여줄지"를 먼저
정리한다. 이 Phase는 화면을 크게 다시 만드는 단계가 아니라, 대시보드/위자드/Discord
응답이 같은 문제를 같은 말투로 설명할 수 있게 하는 얇은 공통 레이어다.

권장 표시 형식:

```text
제목: 지금 무슨 일이 일어났는지 한 줄로 설명
설명: 왜 막혔는지, 사용자가 알아야 할 영향
다음 행동: 사용자가 지금 할 수 있는 행동
자세히 보기: 개발자용 원문, ID, 경로, technicalDetail
```

주요 작업:

- 내부 `status`, `message`, `userAction`, `technicalDetail`을 사람용 표시 모델로 감싸는
  공통 타입과 helper를 만든다.
- 기존 원문 로그와 기술 세부정보는 삭제하지 않고 `자세히 보기`용으로 보존한다.
- token/key, 긴 ID, 로컬 파일 경로 같은 민감하거나 어려운 값은 기본 화면에 직접
  노출하지 않는다.
- 우선 설정/운영에서 자주 보이는 영역부터 적용한다.
  - Discord 설정 상태
  - STT 설정/준비 상태
  - Claude 설정/준비 상태
  - Notion token, parent page, managed registry 상태
  - Notion 자동 업로드 상태
  - 녹음 자동 종료 상태
- i18n key 기반으로 확장할 수 있게 하되, 모든 기존 문구를 한 번에 갈아엎지는 않는다.

완료 기준:

- 대시보드와 위자드가 같은 상태를 같은 사람용 문구 구조로 표시할 수 있다.
- 사용자는 `blocked`, `registry`, `target`, `data source` 같은 내부 용어를 먼저 보지
  않고도 다음 행동을 알 수 있다.
- 개발자용 세부정보는 필요할 때 펼쳐 볼 수 있다.
- 기존 로그/오류 정보가 손실되지 않는다.
- build/typecheck/test가 통과한다.

이번 Phase에서 하지 않는 것:

- 대시보드 전체 레이아웃 재설계
- 아이콘, 접기/펼치기, 탭 중심의 화면 정리
- 모든 기존 화면 문구의 전면 i18n 이관
- 모든 로그 문구의 완전한 제품 문구화
- Notion 복구/재생성 동작 구현

## 9. Phase 6 - 대시보드 설정/복구

목표: 첫 설정 이후 운영 화면을 구현한다.

주요 작업:

- Phase 5.5의 사람용 상태 문구 레이어를 사용해 상태 과다 노출을 줄인다.
- 대시보드 개요 상태 카드
- Discord 서버/프로젝트 관리
- slash command 새로고침
- STT 모델 상태/삭제/재다운로드/복구
- Claude CLI/API 설정 관리
- Notion 탭 `회의록 | 작업자 | 액션 아이템 | +`
- 필수 필드 잠금 표시
- schema 재검사
- 사용자 확인 후 복구/재생성
- 보관 정책 변경
- 정리 보류 상태 표시
- 수동 업로드 재시도
- 수동 삭제와 삭제 이력
- 설정 초기화

완료 기준:

- 위자드 완료 후 설정을 다시 확인/수정/복구할 수 있다.
- Notion 필수 필드/DB 복구는 사용자 확인 후 실행된다.
- 오디오 삭제, 텍스트 보관, 정리 보류 상태가 대시보드에 명확히 표시된다.
- local secret file과 사용자 데이터 삭제 흐름이 제공된다.

이번 Phase에서 하지 않는 것:

- hosted Dirong bot
- Notion OAuth
- 자동 DB 마이그레이션

## 10. Phase 7 - 제품화 정리

목표: 배포 전 문구, 기본값, 검증을 다듬는다.

주요 작업:

- `.env` 사용자 문구 제거
- legacy env 경로 개발자 전용 격리 확인
- 기본값 정리
- Windows 경로와 삭제 동작 확인
- error/action 문구 한국어 품질 정리
- 영어 문구 기본 검토
- build/typecheck/test 실행
- 문서 갱신

완료 기준:

- 비개발자용 경로에서 `.env` 수정 안내가 나오지 않는다.
- 설정 초기화/삭제가 의도한 파일을 정리한다.
- 주요 설정 API와 UI가 build/typecheck/test를 통과한다.
- 구현 결과가 관련 문서에 반영된다.

## 11. 권장 진행 방식

- 새 세션마다 한 Phase만 구현한다.
- 각 Phase 시작 시 관련 문서와 현재 코드를 먼저 읽는다.
- 구현 전에 해당 Phase의 짧은 작업 계획을 제시한다.
- Phase 범위를 넘는 작업은 TODO나 후속 Phase로 남긴다.
- 변경 후 가능한 build/typecheck/test를 실행한다.
- 완료 보고에는 변경 파일, 검증 결과, 다음 Phase의 시작점을 포함한다.

## 12. 운영 runbook - disposable Notion smoke

이 절차는 실제 사용자 workspace나 운영 DB에 적용하지 않는다. 항상 삭제 가능한 새 parent
page를 만들어 수행한다.

1. Notion에서 임시 parent page를 만든다.
2. Dirong integration을 임시 parent page에만 공유한다.
3. 첫 설정 위자드 또는 DB 설정 화면에 Notion token과 parent page URL을 저장한다.
4. managed DB 생성 액션을 실행한다.
5. `npm run doctor`를 실행해 local registry summary가 `ready`, `DB=3/3`,
   `mappings=25/25`인지 확인한다. 이 명령은 Notion API를 호출하지 않는다.
6. `npm run doctor -- --notion-remote`를 실행해 live schema check를 확인한다. 실패해도
   token 원문이 stdout/stderr에 나오면 안 된다.
7. 테스트 회의 draft를 업로드해 회의록 page와 액션 아이템 task page가 만들어지는지
   확인한다.
8. 테스트가 끝나면 임시 parent page를 삭제한다.
