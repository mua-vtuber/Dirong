# 디롱이 Phase 1 RecordingProducer 실행 가이드

Phase 1의 목표는 실제 STT, AI 요약, Notion 작성이 아닙니다. 디롱이가
Discord 음성 채널에 들어가 사람별 오디오 chunk를 저장하고, SQLite에 metadata와
`queued` STT job을 남기며, dashboard에서 완료 chunk를 재생해 보는 단계입니다.

## 1. 준비물

- Windows 10 또는 11
- Node.js 22.12.0 이상
- 테스트용 Discord 서버
- 테스트용 Discord 봇 토큰
- Discord Application ID / Client ID
- 테스트 서버(Guild) ID

봇 초대 시 권한은 최소한 다음이 필요합니다.

- `bot`
- `applications.commands`
- View Channel
- Connect

Phase 1은 고정 voice channel ID를 요구하지 않습니다. `/dirong start`를 실행한
사용자가 현재 들어가 있는 음성 채널에 디롱이가 들어갑니다.

## 2. .env 만들기

프로젝트 루트에서 `.env.example`을 복사해 `.env` 파일을 만들고 값을 채웁니다.

```text
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
```

현재 RecordingProducer 앱은 고정 voice channel ID를 사용하지 않습니다.

토큰은 절대 공유하지 마세요. Phase 1 앱은 토큰 원문을 콘솔, SQLite,
dashboard에 표시하지 않도록 구성되어 있습니다.

## 3. 실행 방법

가장 쉬운 방법은 프로젝트 루트의 `Dirong Start.bat` 파일을 더블클릭하는
것입니다.

bat 파일은 다음 순서로 실행합니다.

```text
npm install
npm run build
npm run doctor
npm start
```

직접 실행하려면 같은 명령을 터미널에서 실행하면 됩니다.

앱이 켜지면 dashboard가 기본적으로 다음 주소에서 열립니다.

```text
http://127.0.0.1:3095/
```

## 4. Discord 사용 방법

1. 사람이 Discord 음성 채널에 들어갑니다.
2. 같은 서버의 텍스트 채널에서 `/dirong start`를 실행합니다.
3. 디롱이가 사용자의 현재 음성 채널에 들어오는지 확인합니다.
4. 공개 녹음 고지 메시지가 텍스트 채널에 표시되는지 확인합니다.
5. 말한 뒤 dashboard의 Recent Chunks에서 audio 재생 컨트롤이 생기는지 봅니다.
6. 종료할 때 `/dirong stop`을 실행합니다.
7. 상태 확인은 `/dirong status`를 사용합니다.

콘솔에서는 개발/응급용으로 다음 명령을 사용할 수 있습니다.

```text
status
stop
exit
```

## 5. 결과 폴더와 SQLite

기본 저장 위치는 다음과 같습니다.

```text
data/sessions/
  dirong.sqlite
  meeting_2026_05_05_210000/
    chunks/
      000001_1234567890.ogg
    stt-audio/
      000001_1234567890.webm
```

SQLite에는 다음 정보가 저장됩니다.

- `sessions`: 세션 상태, 시작자, voice channel, 저장 폴더
- `session_speakers`: userId, display name snapshot, bot 여부, chunk 수
- `chunks`: raw/STT audio path, format, byte size, duration, sha256, 변환 상태
- `stt_jobs`: 실제 STT 호출 전 단계의 durable queue job
- `connection_events`: ready, disconnect, reconnect, resume, DAVE/debug evidence
- `repair_items`: startup repair에서 발견한 오래된 `.part` 파일, 누락 job 등

SQLite는 WAL mode와 busy timeout을 사용합니다.

## 6. Startup repair가 처리하는 것

앱 시작 또는 `npm run repair` 실행 시 다음을 점검합니다.

- 오래 남은 `.part.ogg` 파일을 repair item으로 표시
- 변환 완료 chunk인데 `stt_jobs` row가 없으면 queued job 생성
- `stt_jobs` row는 있는데 input audio file이 없으면 `failed_missing_file`로 표시
- lease가 만료된 `processing` job을 다시 `queued` 상태로 되돌림
- audio file은 있는데 SQLite chunk row가 없으면 orphan repair item으로 표시

결과는 dashboard의 Repair Items와 `/dirong status`에서 확인할 수 있습니다.

## 7. Phase 1에서 아직 하지 않는 것

- Whisper/OpenAI STT 호출
- Claude/Gemini/Codex 요약
- Notion page 작성
- transcript timeline 생성
- 최종 캐릭터/디자인 dashboard
- 여러 세션 동시 녹음

Phase 1은 RecordingProducer와 durable queue 경계만 검증합니다.

## 8. Phase 0 기록

기존 `Dirong Phase0 Start.bat`와 `/dirong-test` 진단 앱은 제품 코드에서 제거되었습니다.
Phase 0의 receive/chunk/transcode 실험 기록은 Phase 0 문서에만 남아 있습니다.

## 9. 완료 보고서

Phase 1 구현 결과와 실제 수동 테스트 기록은
[`phase-1-completion-report.md`](phase-1-completion-report.md)에 정리되어 있습니다.
