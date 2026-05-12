# Dirong Dashboard Settings Design

작성일: 2026-05-10

이 문서는 첫 설정 위자드 이후 사용자가 대시보드에서 관리해야 하는 설정, 상태,
복구, 데이터 정리 흐름을 정의한다. 첫 설정 onboarding은
`docs/notion-setup-wizard-plan.md`가 담당하고, 이 문서는 운영/설정/복구 화면을
담당한다.

관련 문서:

- `docs/notion-setup-wizard-plan.md`
- `docs/dashboard-visual-design.md`
- `docs/discord-meeting-notes-pipeline.md`
- `docs/notion-db-structure.md`
- `docs/notion-i18n-plan.md`
- `docs/phase-5-notion-writer-design.md`
- `docs/대시보드 디자인/와이어프레임/project/Dirong Dashboard Wireframes.html`

## 1. 범위

대시보드 설정은 다음을 담당한다.

- 설정 완료/미완료 상태 표시
- Discord 서버와 프로젝트 관리
- STT 모델 설치, 테스트, 삭제, 재다운로드
- Claude AI provider 설정과 연결 테스트
- Notion managed DB 상태, 상태 다시 확인, 복구
- 필수 필드 잠금 표시와 커스텀 필드 관리
- 보관 정책, 정리 보류, 수동 재시도, 삭제 이력
- token/key redaction과 재입력

대시보드 설정은 다음을 기본 흐름에서 하지 않는다.

- `.env` fallback 사용
- Discord guild id, Notion database id, data source id, property id 직접 입력 요구
- 기존 Notion DB 자동 마이그레이션
- 기존 DB/필드/페이지 임의 삭제
- 액션 아이템 상태 자동 완료

## 2. 핵심 원칙

- 대시보드는 항상 열 수 있다.
- 설정이 미완료된 기능은 단계별로 잠근다.
- 제품 런타임 설정 출처는 local settings store, local secret file, SQLite registry,
  code defaults뿐이다.
- 필수 설정을 찾지 못하면 `.env`에서 대신 읽지 않고 설정 미완료 상태를 보여준다.
- token/key는 저장 후 원문을 다시 표시하지 않는다.
- 위험한 복구는 사용자 확인 후 실행한다.
- 오디오 파일은 처리용 임시 데이터로 보고, Notion 업로드 성공 후 즉시 삭제한다.

## 3. 정보 구조

권장 최상위 구조는 와이어프레임의 `대시보드 B`를 기준으로 한다. 서버와 화면 전환은
좌측 사이드바에 고정하고, 우측 본문에 현재 화면을 렌더링한다.

```text
좌측 사이드바
├─ SERVERS
│  ├─ 서버 A · 디롱팀
│  ├─ 서버 B · 사이드
│  └─ + 서버 추가
├─ SECTIONS
│  ├─ 대시보드
│  ├─ DB 설정
│  ├─ 로그
│  └─ 설정
└─ QUICK
   ├─ 녹음 시작
   └─ 상태 다시 확인

우측 본문
├─ 화면 제목 + compact status chips
└─ 화면별 본문
```

좌측 사이드바는 대시보드, DB 설정, 로그, 설정 화면에서 유지한다. 서버가 다르면 다른
프로젝트일 가능성이 높으므로, 서버를 가장 큰 전환 단위로 본다. `+ 서버 추가`는 새
서버를 연결하고, 후속으로 해당 서버의 Notion parent page와 보관 정책을 따로 설정할
수 있게 한다.

우측 본문 헤더에는 compact status chip을 둔다. 이 줄은 자세한 로그가 아니라 현재
시스템이 쓸 수 있는 상태인지 빠르게 보는 곳이다. 대시보드에서는 제목 오른쪽 또는
우측 공간의 중간에 배치하고, DB 설정/로그/설정 화면에서는 필요하면 같은 형태를
간결하게 유지한다.

상태 chip 항목:

```text
녹음 연결
텍스트 변환(faster-whisper-small)
AI(Claude)
Notion
```

상태 표시는 작은 구체 아이콘과 짧은 이름으로 한다.

```text
초록: 연결됨 / 준비됨
노랑: 연결 중 / 처리 중 / 확인 중
빨강: 연결 실패 / 설정 필요 / 확인 필요
회색: 아직 사용 전 / 비활성
```

좌측 `SECTIONS` 역할:

- `대시보드`: 현재 회의 처리 흐름과 결과를 보는 기본 화면
- `DB 설정`: Notion managed DB, 필수 필드, DB별 사용자 필드, 추가 DB 자리 관리
- `로그`: 문제 해결용 이벤트, 자세한 오류, 내부 ID, repair item 확인
- `설정`: Discord, STT, AI, 보관 정책, 초기화 같은 운영 설정

프로젝트 단위:

```text
project/workspace
├─ Discord guild
├─ Notion parent page / managed DB registry
├─ upload settings
├─ notification channel
└─ retention policy
```

전역 설정:

- 앱 언어
- STT provider/model/runtime 기본값
- Claude provider 기본값
- local model 저장소
- local secret file
- dashboard 표시 설정
- dashboard theme: system / light / dark

프로젝트별 설정:

- Discord guild allowlist entry
- slash command 등록 상태
- Notion parent page
- managed DB registry 연결
- Notion upload mode
- 보관 정책 override
- 알림 채널

### 3.1 대시보드 탭

대시보드 탭은 사용자가 가장 자주 보는 화면이다. 내부 상태를 모두 펼쳐 놓지 않고,
회의가 어디까지 진행됐는지 카드 흐름으로 보여준다.

대시보드는 와이어프레임 `B`를 기본으로 하되, 상태 라인은 와이어프레임 `C`처럼 우측
본문 헤더에 compact chip으로 배치한다.

```text
좌측 사이드바: 서버 / 화면 메뉴 / 빠른 액션
우측 헤더: 대시보드 제목 + 녹음 · STT · AI · Notion status chips
우측 본문: 처리 카드 / 오디오·변환 텍스트 / 회의록
```

첫 설정 위자드는 대시보드 상단에 붙는 섹션이 아니다. 앱을 처음 켰고 설정이 끝나지
않았으면 대시보드 대신 위자드 화면만 보여준다. 사용자는 `나중에 설정하고 대시보드
보기`로 넘길 수 있지만, 설정이 필요한 기능은 잠긴 상태로 표시한다.

첫 설정을 끝내지 않고 대시보드로 넘어온 경우에는 최상단에 붉은 고정 경고 바를
보여준다. 이 경고는 스크롤해도 계속 보이며, 클릭하면 첫 설정 위자드로 돌아간다.
모든 필수 설정이 완료되면 사라진다.

경고 바 예:

```text
설정이 아직 끝나지 않았습니다.
디롱이를 사용하려면 첫 설정을 완료해 주세요.
[이어서 설정하기]
```

기본 순서:

```text
처리 카드 1: 참여자
처리 카드 2: 녹음 / 텍스트 변환
처리 카드 3: AI 회의록 작성
처리 카드 4: Notion 업로드

오디오 / 변환 텍스트
회의록
```

처리 카드 색:

```text
회색: 대기 중
노랑: 진행 중
초록: 완료
빨강: 실패 또는 확인 필요
```

첫 번째 카드는 참여자를 보여준다. 기본 화면에는 Discord 닉네임과 Discord ID만
표시한다. 봇 계정은 닉네임 옆에 `(봇)`을 붙인다. 발화 수와 chunk 수는 여기서
보여주지 않고, 아래 `오디오 / 변환 텍스트` 섹션의 상단 요약으로 보낸다.

참여자 카드 예:

```text
참여자
홍길동
1234567890

김디롱 (봇)
9876543210
```

두 번째 카드는 녹음과 텍스트 변환을 한 흐름으로 묶는다. `대기 중`과 `녹음 중`을
반복해서 크게 보여주기보다는, 실제 동작 중일 때만 진행 문구와 숫자를 보여준다.

진행 중 예:

```text
녹음 중...
텍스트 변환 중...
변환 성공 12개 · 실패 0개
```

종료 후 예:

```text
녹음 종료
음성 파일 12개
텍스트 변환 성공 12개
텍스트 변환 실패 0개
```

세 번째 카드는 AI 회의록 작성 상태를 보여준다.

```text
AI가 회의록을 작성 중...
회의록 작성 완료
```

네 번째 카드는 Notion 업로드 상태를 보여준다.

```text
Notion 업로드 대기
Notion 업로드 중...
Notion 업로드 완료
Notion 업로드 실패: 다시 확인 필요
```

오디오 섹션은 각 음성 파일과 해당 변환 텍스트를 함께 볼 수 있게 한다. 섹션 상단에는
참여자별 발화 수, 변환 성공 수, 변환 실패 수를 요약한다. 봇 계정은 필요할 때 표시하되
기본 발화 통계에는 포함하지 않는다. 기본 화면에서는 목록을 간단히 보여주고, 항목을
열면 오디오 재생과 변환 텍스트를 같이 확인한다.

예:

```text
홍길동님의 발화: 12개
김철수님의 발화: 8개
변환 성공: 19개
변환 실패: 1개

[00:00:12] 홍길동.webm  ▶
변환 텍스트 보기
```

`session id`, `chunk id`, `sha256`, raw file path 같은 내부 식별자는 기본 화면에
노출하지 않는다. `session id`와 `chunk id`는 자세히 보기나 로그 탭에 두고,
`sha256`은 파일 동일성 확인용 기술 값이므로 로그 상세에만 둔다. DB path와 raw file
path는 문제 해결용 설정/로그 영역에서만 보여준다.

회의록은 오디오/변환 텍스트 아래에 둔다. 사용자의 최종 관심사는 회의록이므로,
처리 흐름을 본 뒤 바로 결과를 확인할 수 있어야 한다.

### 3.2 화면별 와이어프레임 결정

기준 조합:

| 화면 | 기준 와이어프레임 | 결정 |
|------|------------------|------|
| 대시보드 | B + C status chips | 좌측 사이드바를 유지하고, 상태는 우측 헤더의 compact chip으로 표시 |
| DB 설정 | B | 좌측 사이드바는 그대로 두고, 우측 본문 안에서 `회의록 / 작업자 / 액션 아이템 / + DB 추가` 가로 탭 사용 |
| 설정 | C | 좌측 사이드바는 그대로 두고, 우측 본문 안에서 `Discord / STT / AI / Notion / 데이터·보관 / 자동 종료 / 초기화` 가로 탭 사용 |
| 설정 미완료 | A | 위자드를 건너뛴 뒤에는 붉은 고정 경고 바와 잠긴 기능 카드 표시 |
| 로그 | 신규 타임라인형 | 와이어프레임에 없으므로 문제 해결 타임라인 화면으로 별도 정의 |

DB 설정과 설정 화면은 대시보드의 좌측 사이드바를 계속 공유한다. 따라서 각 화면 안에
또 다른 좌측 메뉴를 중첩하지 않는다. 세부 카테고리 전환은 우측 본문 안의 가로 탭으로
처리한다.

로그 화면은 상태 라인을 대체하지 않는다. 기본 화면에서는 사람이 읽는 요약과 다음 행동을
보여주고, 원본 id/path/hash/raw JSON/stack trace는 `자세히 보기` 안에 둔다.

로그 탭 구조:

```text
로그

[전체] [확인 필요] [녹음] [STT] [AI] [Notion] [시스템]

최근 확인 필요
- Notion 업로드 실패
- STT 파일 없음
- Claude 응답 실패

이벤트 타임라인
시간 | 영역 | 사람이 읽는 요약 | 다음 행동 | 자세히 보기
```

### 3.3 시각 디자인과 테마

시각 디자인, 디롱이 이미지, theme 값, `04 Washed Blocks` 적용 기준은
`docs/dashboard-visual-design.md`를 따른다.

이 문서에서는 화면 구조와 설정 동작만 정의한다. theme 설정 값은 제품 설정으로
관리하므로 `system`, `light`, `dark`를 지원하고 local settings에 저장한다. 현재
Phase 6C 구현에서는 세 값이 모두 같은 Washed Blocks palette를 사용하며, light/dark
별도 palette 분리는 후속 시각 조정으로 둔다.

## 4. 설정 완료 상태

대시보드 개요에는 기능별 상태 카드를 보여준다.

상태 값:

```text
not_configured
checking
ready
warning
blocked
repair_required
```

기능별 잠금 규칙:

| 기능 | 필요한 설정 | 누락 시 |
|------|-------------|---------|
| Discord 로그인 | Discord bot token | 봇 시작 불가 |
| 녹음 시작 | Discord token, 선택된 guild, slash command 등록, STT ready | 녹음 시작 버튼 잠금 |
| STT 처리 | STT provider, model, runtime, preflight 통과 | 변환 시작 불가 |
| AI 회의록 생성 | Claude CLI/API 설정, 연결 테스트 | 회의록 생성 불가 |
| Notion 업로드 | Notion token, parent page, managed registry | 업로드 불가 |
| 자동 삭제 | 보관 정책, cleanup job 상태 | 정리 보류 표시 |

설정 미완료 CTA 예:

```text
Discord 봇 연결이 필요합니다.
설정 위자드를 열어 bot token과 서버 선택을 완료해 주세요.
```

위자드를 건너뛴 상태에서는 대시보드 최상단에 고정 경고 바를 표시한다. 경고 바는
단순 안내가 아니라 첫 설정 위자드로 돌아가는 진입점이다.

```text
설정이 아직 끝나지 않았습니다. 디롱이를 사용하려면 첫 설정을 완료해 주세요.
이어서 설정하기
```

```text
Notion 연결이 끊겼습니다.
연결을 다시 검사하거나 관리 DB 복구를 진행해 주세요.
```

설정 화면은 와이어프레임 `설정 C`를 기준으로 한다. 좌측 사이드바는 유지하고, 우측
본문 상단에 설정 카테고리 가로 탭을 둔다.

```text
설정

Discord | STT | AI | Notion | 데이터·보관 | 자동 종료 | 초기화
```

탭 개수가 많으므로 좁은 화면에서는 가로 스크롤, 접힌 메뉴, 또는 `더보기` 처리를
제공한다. 각 탭 안에서는 관련 설정만 보여주고, token/key 원문은 표시하지 않는다.

## 5. Discord 설정

Discord 설정 탭은 서버 ID 직접 입력 대신 서버 선택과 상태 확인을 제공한다.

표시 항목:

- bot token 상태: `연결됨`, `누락됨`, `다시 입력 필요`
- application ID
- 봇이 들어간 서버 목록
- 녹음을 허용한 서버 목록
- guild slash command 등록 상태
- 음성 채널 권한 검사 결과

기본 동작:

- 사용자가 서버를 선택하면 local settings allowlist에 guild id를 저장한다.
- 선택된 guild에 slash command를 자동 등록한다.
- global slash command 등록은 기본값으로 사용하지 않는다.
- allowlist 밖 guild의 interaction은 거부한다.

여러 서버:

- MVP 첫 설정은 서버 1개를 권장한다.
- 여러 서버 허용은 대시보드 고급 설정에서 켠다.
- 서버를 추가하면 새 프로젝트 설정을 만든다.
- 서버별 Notion 연결과 보관 정책을 별도로 둘 수 있다.

주요 액션:

- `서버 추가`
- `서버 제거`
- `명령 새로고침`
- `권한 다시 검사`
- `bot token 다시 입력`

서버 제거는 allowlist에서만 제거한다. Discord 서버에서 봇을 추방하거나 기존
데이터를 삭제하지 않는다.

## 6. STT 설정

STT 설정은 local faster-whisper를 기본 추천으로 둔다. OpenAI STT는 숨기지 않되
`API 발급 필요 - 유료` 대안으로 표시한다.

표시 항목:

- provider: local faster-whisper 또는 OpenAI STT
- 선택 모델: small, medium, custom
- device/compute type
- bundled Python 상태
- FFmpeg 상태
- 모델 설치 상태
- 최근 preflight 결과

모델 상태:

```text
설치 안 됨
다운로드 중
설치됨
손상됨
업데이트 가능
삭제 가능
```

저장 위치:

```text
{DirongUserData}/models/faster-whisper-small
{DirongUserData}/models/faster-whisper-medium
```

대시보드 액션:

- `모델 다운로드`
- `preflight 다시 실행`
- `복구`
- `다시 다운로드`
- `사용하지 않는 모델 삭제`

삭제 정책:

- 모델 파일은 회의 데이터가 아니므로 Notion 업로드 후 자동 삭제 대상이 아니다.
- 현재 선택된 모델은 삭제 전에 확인한다.
- 삭제 후 파일이나 폴더가 남아 있으면 삭제 성공으로 표시하지 않는다.
- 삭제 실패 시 남은 경로와 원인을 보여준다.

preflight의 목적은 PC 성능을 사용자에게 알려주는 것이다. small 모델도 느리면
다음 선택지를 보여준다.

- 더 작은 모델 또는 빠른 설정
- 회의 후 처리 모드
- GPU 사용 설정
- OpenAI STT 대안

## 7. AI 설정

MVP에서 실제 지원하는 provider는 Claude로 제한한다. 설정 모델은 provider와 mode를
분리해 이후 provider 확장을 가능하게 한다.

설정 모델:

```text
ai.provider = "claude"
ai.mode = "cli" | "api"
ai.model = ...
ai.cliCommand = ...
ai.apiKeySecretRef = ...
```

표시 항목:

- Claude CLI/API 선택
- model
- CLI command 또는 API key 상태
- 최근 연결 테스트 결과
- 마지막 실패 이유

token/key 표시 원칙:

- 원문 표시 금지
- `연결됨`, `누락됨`, `다시 입력`만 표시
- 로그와 대시보드 API 응답에서 redaction

주요 액션:

- `Claude CLI 검사`
- `API key 다시 입력`
- `연결 테스트`
- `모델 변경`

AI provider는 Notion token, Notion page id, Notion API 권한을 받지 않는다. Notion
쓰기는 항상 Dirong 앱이 담당한다.

## 8. Notion 설정

Notion 설정은 managed DB registry 상태를 보여주고, 필수 필드/관계가 깨졌을 때
안전한 복구 흐름을 제공한다.

현재 구현 기준:

- registry ready와 remote schema check 결과를 분리해 표시한다. 네트워크 실패만으로
  SQLite registry를 수정하지 않는다.
- `Notion 상태 다시 확인`은 role별 data source를 다시 읽고 필수 필드/관계 diff를
  계산한다.
- 누락된 필수 필드는 사용자 확인 후 복구 계획을 적용하며, 복구된 항목만 registry
  mapping에 반영한다.
- Notion token, parent page, upload mode 변경은 다음 automation tick과 dashboard action에
  반영된다.
- 회의록 업로드 후 AI draft의 액션 아이템은 `Dirong 액션 ID` 기준으로 task page를
  생성하거나 갱신한다.
- `npm run doctor`는 기본적으로 local registry만 요약하고, `npm run doctor -- --notion-remote`
  에서만 Notion API로 live schema check를 실행한다.

Notion 설정은 최상위 `DB 설정` 화면 안에 둔다. 대시보드 전체의 좌측 사이드바는 계속
유지하고, 우측 본문 안에서는 와이어프레임 `DB 설정 B`처럼 가로 탭을 사용한다. 화면
안에 또 다른 좌측 메뉴를 중첩하지 않는다.

DB 설정 내부 구조:

```text
좌측 사이드바
서버 / 대시보드 / DB 설정 / 로그 / 설정

우측 본문
회의록 | 작업자 | 액션 아이템 | + DB 추가
선택한 DB의 상태 / 필수 필드 / 사용자 필드 / 상태 다시 확인 / 복구
```

표시 항목:

- Notion token 상태
- parent page URL
- managed schema locale
- managed DB 생성 상태
- DB별 title/link
- DB별 property mapping 상태
- relation/rollup 상태
- 앱이 마지막으로 불러온 Notion schema 상태

DB 설정 가로 탭 역할:

- `회의록`: 회의록 DB의 필수 필드, 상태, 업로드 mapping 확인
- `작업자`: Discord 닉네임과 Notion 연결용 작업자 DB 확인
- `액션 아이템`: 액션 아이템 DB 생성 상태와 필드 확인
- `+ DB 추가`: 기본 3개 DB 외의 추가 managed DB를 위한 자리. MVP에서는 준비 중 안내만 표시

사용자 필드는 별도 최상위 탭이 아니라 각 managed DB 탭 안에서 다룬다. 선택한 DB의
상태와 필수 필드 아래에 custom property rule 영역을 두고, 현재 구현에서는 회의록 DB
필드 설정을 먼저 제공한다. 작업자/액션 아이템 DB의 사용자 필드 저장은 후속 단계로
연결한다.

```text
대상 DB: 회의록 / 작업자 / 액션 아이템
source: AI가 회의 내용에서 추출 / 고정값 / 참가자 기반 relation / 후속 확장
```

DB별 상태:

```text
ready
not_created
permission_denied
database_missing
required_property_missing
property_type_mismatch
relation_broken
registry_missing
repair_required
```

registry가 있으면 새 DB를 만들지 않고 기존 managed DB 세트 상태를 보여준다. 앱 시작
시, DB 설정 탭 진입 시, 사용자 필드 저장 후에는 Notion schema를 다시 불러와 현재
상태를 표시한다. 사용자에게는 `schema 검사`라는 표현보다 `Notion 상태 다시 확인`을
사용한다.

앱 언어와 Notion schema locale은 생성 전 기본 선택에서는 같이 간다. 하지만 DB 세트가
한 번 생성된 뒤에는 registry에 저장된 `managed schema locale`, `property_name`,
`property_id`를 기준으로 계속 사용한다. 사용자가 이후 앱 언어를 영어로 바꾸더라도
이미 한국어로 생성한 Notion DB 필드명을 자동 변경하지 않는다.

registry 대상 DB가 삭제됐거나 필수 필드가 깨졌으면 화면에서 바로 문제를 보여주고,
사용자 확인 후 복구한다.

복구 원칙:

- 기존 DB를 임의로 삭제하지 않는다.
- 기존 property를 임의로 타입 변경하지 않는다.
- Notion DB에 있는 property를 Dirong 대시보드에서 삭제하지 않는다.
- 사용자가 Dirong 사용자 필드 목록에서 제거해도 Notion의 실제 property는 그대로 둔다.
- 필수 필드 누락은 사용자 확인 후 새 property 생성으로 복구한다.
- 삭제된 필드의 과거 데이터는 되살릴 수 없음을 안내한다.
- 복구 후 SQLite registry의 property mapping을 갱신한다.
- 등록되지 않은 Notion property가 있어도 자동 삭제하지 않는다.

필수 필드 UI:

- 필수 필드는 카드/칸 형태로 잠금 상태를 보여준다.
- 정상 필드는 일반 배경으로 표시한다.
- 누락된 필드는 붉은 배경으로 표시한다.
- 필수 필드 이름을 Notion에서 바꾸면 Dirong 연결이 호환되지 않을 수 있다는 안내를
  필수 필드 영역에 붙인다.
- 각 누락 칸 안에 복구 버튼을 반복해서 넣지 않는다.
- 필수 필드 목록 아래에 `누락된 필수 필드 복구` 버튼을 하나 둔다.
- 버튼을 누르기 전 복구 대상 필드 목록을 모달로 보여준다.

필수 필드 안내 문구:

```text
필수 필드는 Dirong이 회의록을 올릴 때 사용하는 연결 정보입니다.
Notion에서 이름을 바꾸거나 타입을 바꾸면 업로드가 동작하지 않을 수 있습니다.
```

필수 필드 누락 예:

```text
필수 필드

[회의 제목] 정상
[회의 날짜] 누락
[참석자] 누락
[회의록] 정상

필수 필드 2개가 없습니다.
누락된 필드:
- 회의 날짜
- 참석자

[누락된 필수 필드 복구]
```

사용자 필드 저장 시 Notion에 등록되지 않은 property가 남아 있으면 삭제하지 않고
안내 모달만 보여준다.

```text
Notion에는 Dirong 설정에 등록되지 않은 필드가 3개 있습니다.
이 필드들은 삭제되지 않으며, Dirong이 값을 채우지 않습니다.
필요 없다면 Notion에서 직접 삭제해 주세요.

계속 저장할까요?
```

복구 문구 예:

```text
필수 필드가 사라졌습니다.
복구하면 새 필드를 만들고 Dirong 연결 정보를 갱신합니다.
기존 삭제된 필드의 데이터는 되살릴 수 없습니다.
```

주요 액션:

- `Notion 상태 다시 확인`
- `누락된 필수 필드 복구`
- `DB 다시 생성`
- `Notion token 다시 입력`
- `parent page 변경`

기존 DB 가져오기:

- MVP 기본 흐름이 아니다.
- 고급 기능으로 둔다.
- 사용자가 이미 만들어둔 Notion 데이터베이스를 Dirong semantic schema에 맞게 연결하는
  기능이다.
- 기존 DB 안의 페이지를 가져오거나 마이그레이션하는 기능이 아니다.

## 9. 필드와 커스텀 property

필수 필드는 잠금 상태로 보여준다.

필수 필드 UI가 막아야 하는 것:

- 삭제
- semantic key 변경
- 호환되지 않는 타입 변경
- rollup/source 역할 변경

커스텀 필드:

- 회의록, 작업자, 액션 아이템 DB별로 추가할 수 있다.
- 현재 custom property rules 흐름을 참고한다.
- 현재 구현은 DB role별로 사용자 필드 rule을 분리 저장한다.
- MVP에서는 회의록 DB의 `AI` source를 우선 노출한다.
- 후속으로 작업자/액션 아이템 DB의 사용자 필드 입력 UI, `고정값`,
  `액션 아이템 전용 source`, `참가자 기반 relation`을 확장한다.
- 사용자가 커스텀 필드를 Dirong 목록에서 제거해도 Notion DB의 실제 property는
  삭제하지 않는다.
- Dirong 목록에 없는 Notion property가 있으면 저장 전 안내 모달로 알리고, 필요한
  삭제는 사용자가 Notion에서 직접 처리하게 한다.

후속 source 예:

- AI가 회의 내용에서 추출
- 고정값
- 참가자 기반 relation
- 작업자 DB relation
- 액션 아이템 draft 필드

## 10. 데이터/보관 설정

Dirong은 hosted 서비스를 기본으로 하지 않는다. 음성 원본과 STT 텍스트는 사용자가
실행 중인 PC에 저장된다. 대시보드는 저장 위치, 보관 정책, 삭제 이력을 명확히
보여줘야 한다.

기본 정책:

- 오디오 파일은 Notion 업로드 성공 후 즉시 삭제한다.
- STT 텍스트와 AI draft는 기본 30일 보관 후 삭제한다.
- 세션 메타데이터와 삭제 이력은 계속 보관할 수 있다.

삭제 대상과 기본 타이밍:

| 대상 | 예 | 기본 삭제 시점 |
|------|----|----------------|
| 오디오 파일 | raw audio chunks, STT-safe converted audio | Notion 업로드 성공 후 즉시 |
| 임시 파일 | 변환/처리 중 생성된 파일 | pipeline 완료 또는 cleanup tick |
| 텍스트 처리 결과 | STT 텍스트, AI draft | 기본 30일 후 |
| 메타데이터 | session id, Notion page URL, write status, 오류 요약, 삭제 이력 | 계속 보관 가능 |

업로드 재시도:

- 업로드는 3회 자동 재시도한다.
- 계속 실패하면 `정리 보류`로 둔다.
- 다음 실행 또는 수동 재시도에서 다시 시도할 수 있다.
- Notion write status가 `done`이 되기 전에는 오디오 파일을 자동 삭제하지 않는다.

정리 보류 예:

```text
정리 보류: Notion 업로드 실패
Notion에 회의록이 올라가지 않아 원본 음성과 STT 결과를 삭제하지 않았습니다.
문제를 해결한 뒤 다시 업로드하거나, 수동으로 삭제해 주세요.
```

대시보드 액션:

- `업로드 다시 시도`
- `오디오 삭제`
- `텍스트 처리 결과 삭제`
- `삭제 이력 보기`
- `보관 기간 변경`

기본 UI에서 `자동 삭제 안 함` 또는 `무기한 보관`은 노출하지 않는다. 필요하다면
고급 설정에서 강한 경고와 함께 제공한다.

## 11. 녹음 자동 종료 설정

기본값:

```text
DIRONG_ALONE_FINALIZE_ENABLED=true
DIRONG_ALONE_FINALIZE_GRACE_MS=90000
```

대시보드에서는 켜짐/꺼짐과 대기 시간을 변경할 수 있다.

권장 선택지:

```text
30초 / 60초 / 90초(추천) / 120초
```

30초는 테스트 또는 빠른 종료를 원하는 사용자용 선택지로 둔다. 제품 기본값은
90초다.

## 12. 설정 초기화와 삭제

사용자가 지우기 쉬워야 하는 데이터는 `{DirongUserData}` 아래에 모은다.

권장 위치:

```text
{DirongUserData}/settings
{DirongUserData}/secrets
{DirongUserData}/models
{DirongUserData}/sessions
{DirongUserData}/logs
```

초기화 범위:

- `연결 설정 초기화`: token/key, Discord/Notion/AI 연결 정보 삭제
- `모델 삭제`: downloaded faster-whisper model 삭제
- `세션 데이터 삭제`: local session/audio/text/draft 데이터 삭제
- `전체 Dirong 데이터 삭제`: settings, secrets, models, sessions, logs 삭제

삭제는 실제 파일/폴더 제거를 확인한 뒤 성공으로 표시한다. 실패하면 남은 경로와
원인을 보여준다.

## 13. i18n

첫 설정 위자드뿐 아니라 대시보드 전체가 TypeScript locale catalog를 사용한다. 사용자에게
보이는 문구는 하드코딩하지 않고 i18n key로 관리한다.

i18n 적용 대상:

- 좌측 사이드바의 서버 목록, `+ 서버 추가`, 화면 메뉴, 빠른 액션
- compact status chip label과 상태 문구
- 대시보드 처리 카드 제목, 본문, 빈 상태, 실패 안내
- 오디오/변환 텍스트/회의록 섹션 제목과 요약 문구
- DB 설정의 가로 탭, 필수 필드 상태, DB별 사용자 필드 form label
- 버튼, 모달, confirm 문구, toast/result 문구
- 설정 화면의 가로 탭, 설명, 도움말, tooltip, reset/delete 경고
- theme 선택 label과 설명
- 로그 탭의 사용자용 요약, 필터 이름, 이벤트 영역 이름, 펼치기 label
- 접근성 문구가 들어간다면 `aria-label`, `title` 문구

API에서 내려오는 내부 상태 값은 그대로 화면에 노출하지 않는다. 예를 들어 `ready`,
`blocked`, `processing`, `required_property_missing` 같은 값은 UI에서 locale key로
변환해 보여준다. 단, 로그의 자세히 보기 영역에서는 원본 status, event type, id, path,
hash를 기술 정보로 표시할 수 있다.

동적 문구는 문자열 이어붙이기보다 placeholder를 사용한다.

```text
dashboard.audio.summary.speakerUtterances
ko: {name}님의 발화: {count}개
en: {name}: {count} utterances
```

한국어와 영어는 직역하지 않는다. 메뉴와 버튼의 느낌이 다를 수 있으므로 같은 의미를
각 언어의 제품 문구로 자연스럽게 작성한다.

누락 key 정책:

- 개발 중에는 누락 key를 눈에 띄게 표시해 바로 찾을 수 있게 한다.
- 제품 빌드에서는 한국어 fallback을 우선 사용하고, 누락 key를 로그에 남긴다.
- token, id, path, hash 같은 사용자 데이터나 기술 값은 번역하지 않는다.

권장 key 예:

```text
dashboard.nav.dashboard
dashboard.nav.databaseSettings
dashboard.nav.logs
dashboard.nav.settings
dashboard.sidebar.servers.label
dashboard.sidebar.sections.label
dashboard.sidebar.quick.label
dashboard.server.add.action
settings.overview.status.ready
dashboard.setupIncomplete.banner.title
dashboard.setupIncomplete.banner.description
dashboard.setupIncomplete.banner.action
dashboard.status.recording.label
dashboard.status.stt.label
dashboard.status.ai.label
dashboard.status.notion.label
dashboard.card.participants.title
dashboard.card.recording.title
dashboard.card.aiNotes.title
dashboard.card.notionUpload.title
dashboard.audio.summary.speakerUtterances
dashboard.audio.summary.sttDone
dashboard.audio.summary.sttFailed
dashboard.logs.details.toggle
dashboard.logs.filters.all
dashboard.logs.filters.needsAttention
dashboard.logs.filters.recording
dashboard.logs.filters.stt
dashboard.logs.filters.ai
dashboard.logs.filters.notion
dashboard.logs.filters.system
dashboard.logs.timeline.title
dashboard.logs.needsAttention.title
dashboard.db.tabs.meeting
dashboard.db.tabs.members
dashboard.db.tabs.actionItems
dashboard.db.tabs.customDb
dashboard.db.customDb.title
dashboard.db.customFields.scopedTitle
dashboard.settings.tabs.discord
dashboard.settings.tabs.stt
dashboard.settings.tabs.ai
dashboard.settings.tabs.notion
dashboard.settings.tabs.retention
dashboard.settings.tabs.aloneFinalize
dashboard.settings.tabs.reset
dashboard.settings.theme.label
dashboard.settings.theme.system
dashboard.settings.theme.light
dashboard.settings.theme.dark
settings.discord.guild.add.title
settings.discord.commands.refresh.action
settings.stt.model.delete.confirmBody
settings.ai.claude.test.error
settings.notion.status.refresh.action
settings.notion.schema.repair.confirmBody
settings.notion.schema.unmanagedFields.confirmBody
settings.data.cleanup.pending.title
settings.data.cleanup.retry.action
```

앱 언어와 위자드 언어는 MVP에서 하나로 묶는다. Notion schema locale은 DB 생성 전에는
앱 언어 기본값을 따르지만, DB 생성 후에는 registry에 저장된 생성 당시 locale과 실제
필드명을 계속 사용한다. 앱 언어 변경은 기존 Notion DB 필드명 변경으로 이어지지 않는다.

## 14. Phase 6 구현과 현재 시각 기준

Phase 6은 한 번에 최종 디자인까지 확정하지 않고 구조 구현과 시각 조정을 나누어 진행했다.
현재 제품 기본 방향은 `Phase 6C: Washed Blocks`다. `Phase 6A`는 정보 구조를 만들었고,
`Phase 6B`의 vintage/kraft 실험은 제거했다. 현재 기준은 `docs/대시보드 디자인/샘플2`의
`04 Washed Blocks`를 실제 대시보드에 맞춘 형태다.

### 14.1 Phase 6A: 대시보드 구조 구현

목표는 최종 시각 디자인 확정이 아니라, 문서에 정한 대시보드 정보 구조와 화면 전환을
실제 동작하는 기반으로 만드는 것이다.

Phase 6A 범위:

- 좌측 사이드바 구조 구현: 서버, 화면 메뉴, 빠른 액션
- 우측 본문 헤더의 compact status chip 구현
- 대시보드 카드 흐름 구현: 참여자, 녹음/STT, AI 회의록, Notion 업로드
- 오디오/변환 텍스트와 회의록 영역 재배치
- DB 설정 화면의 `회의록 | 작업자 | 액션 아이템 | + DB 추가` 가로 탭 구현
- 설정 화면의 `Discord | STT | AI | Notion | 데이터·보관 | 자동 종료 | 초기화` 가로 탭 구현
- 로그 화면의 사용자용 요약 + 다음 행동 중심 타임라인 구현
- 설정 미완료 sticky warning bar와 잠긴 기능 카드 구현
- 대시보드/DB 설정/로그/설정의 사용자 표시 문구를 TypeScript locale catalog에 연결
- 디롱이 이미지 asset build/copy 경로 준비
- Discord 녹음 시작 메시지에 `dirong_discord.png` 첨부

Phase 6A 스타일 원칙:

- `docs/dashboard-visual-design.md`를 따르되, 최종 세부 디자인을 고정하지 않는다.
- CSS 변수와 재사용 가능한 component class를 우선 정리한다.
- 샘플 HTML을 그대로 복사하지 않는다.
- mascot theme 방향은 가볍게 반영하되, 세부 간격/색감/장식은 이후 시각 pass에서 다듬는다.
- 화면 구조, 상태 변환, i18n, 접근 가능한 버튼/탭 동작을 우선한다.

Phase 6A 완료 조건:

- `npm run build`가 통과한다.
- 가능하면 영향 범위 테스트 또는 `npm test`가 통과한다.
- 실제 Discord/Notion smoke test는 disposable 환경이 없으면 실행하지 않는다.
- 변경 파일과 남은 리스크를 요약한다.

### 14.2 Phase 6B: vintage/kraft 실험

Phase 6B에서는 vintage/kraft 방향을 실험했다. 이후 사용자 피드백에 따라 이 방향은
기본 제품 theme에서 제외했다. 종이 질감, 세피아/오렌지 중심 palette, vintage 장식,
kraft background는 현재 구현에서 제거한다.

제거 기준:

- vintage/kraft 전용 CSS block은 남기지 않는다.
- 이전 기본 CSS의 light card, rounded radius, orange active tone에 의존하지 않는다.
- theme 값은 남기되 현재 palette는 Washed Blocks로 통일한다.

### 14.3 Phase 6C: Washed Blocks 시각 기준

Phase 6C는 `샘플2 / 04 Washed Blocks`를 기준으로 현재 대시보드를 정리한 시각 pass다.

Phase 6C 범위:

- 배경은 단색 dark surface로 유지한다. 세로줄, grid texture, gradient texture는 쓰지 않는다.
- 좌측 사이드바는 220px 기준의 compact operational navigation으로 유지한다.
- 모든 주요 UI는 각진 block으로 표시한다. status dot과 native radio/checkbox 외에는
  radius를 쓰지 않는다.
- 처리 카드, locked card, metric, required field, setup notice는 명시적인 gap/margin으로
  서로 붙지 않게 한다.
- DB 설정의 누락 필드 목록 아래에는 안내/복구 박스를 하나만 두고, 마지막 필드와 붙지
  않도록 `required-field-grid` 하단 흐름을 유지한다.
- typography는 `Archivo`, `Archivo Black`, `IBM Plex Mono`를 기준으로 한다.
- `system`, `light`, `dark` theme 값은 유지하되 현재는 동일한 Washed palette를 적용한다.
- 브라우저 desktop/mobile screenshot으로 겹침, 잘림, 붙은 박스, 배경 texture 잔여 여부를
  확인한다.

## 15. 현재 확정 사항

- 와이어프레임 기준은 `대시보드 B + C status chips`, `DB 설정 B`, `설정 C`,
  `설정 미완료 A`로 한다.
- 시각 디자인, 디롱이 이미지, `04 Washed Blocks` 샘플 적용 기준은
  `docs/dashboard-visual-design.md`를 따른다.
- theme 값은 `system`, `light`, `dark`를 지원하고 local settings에 저장한다. 현재 시각
  구현에서는 세 값 모두 같은 Washed Blocks palette를 쓴다.
- 전체 화면은 좌측 사이드바를 유지하고, 화면별 세부 전환은 우측 본문의 가로 탭으로
  처리한다.
- 로그 화면은 새로 정의한 타임라인형 화면을 사용한다.
- 대시보드는 항상 열고, 설정 미완료 기능만 잠근다.
- 첫 설정 위자드를 건너뛰면 최상단 고정 경고 바를 보여주고, 클릭 시 위자드로
  돌아간다.
- 위자드, 대시보드, DB 설정, 로그, 설정 탭의 사용자 표시 문구는 모두 TypeScript
  locale catalog를 사용한다.
- 여러 Discord 서버는 고급 설정으로 허용하되 서버별 프로젝트 설정을 둔다.
- STT 모델과 Claude provider는 전역 기본값으로 둔다.
- Notion 연결, upload mode, 보관 정책은 프로젝트별 override를 허용한다.
- Notion registry가 있으면 기존 managed DB 상태를 보여준다.
- 앱 언어를 바꿔도 이미 생성된 Notion DB의 필드명은 자동 변경하지 않는다.
- 생성된 Notion DB의 schema locale과 실제 property name/id는 registry에 저장한 값을
  기준으로 사용한다.
- Notion 필수 필드/DB 복구는 사용자 확인 후 실행한다.
- Notion property 삭제 기능은 제공하지 않는다.
- 필수 필드 누락은 필드 칸을 붉게 표시하고, 목록 아래의 `누락된 필수 필드 복구`
  버튼 하나로 처리한다.
- action item DB가 healthy이면 회의록 업로드 시 task page를 생성/갱신하고, unhealthy이면
  회의록 page만 올린 뒤 warning으로 남긴다.
- 배경은 단색으로 유지하고 세로줄/격자 texture를 쓰지 않는다.
- UI block은 각진 형태를 유지한다. rounded card 스타일은 기본 theme에 쓰지 않는다.
- typography는 `Archivo`, `Archivo Black`, `IBM Plex Mono`를 기준으로 한다.
- vintage/kraft 실험 방향은 현재 기본 제품 theme에서 제외한다.
- 오디오 파일은 Notion 업로드 성공 후 즉시 삭제한다.
- STT 텍스트와 AI draft는 기본 30일 보관 후 삭제한다.
- local secret file은 Dirong 데이터 초기화로 함께 지울 수 있어야 한다.
