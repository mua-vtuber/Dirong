# Dirong Discord Record Bot

> 디롱이가 도움이 되셨다면 저에게 팁으로 응원해주세요. 여러분의 팁은 다음 창작 활동을 이어가는 에너지가 됩니다.
> If Dirong has been helpful, please consider supporting me with a tip. Your support helps fuel my next creative projects.

[한국어 설명서](#korean-guide)

Dirong is a local-first Discord voice recording bot for meeting workflows. It records a Discord voice session, turns audio into transcripts, prepares cleaned meeting notes, and can publish the final draft to Notion.

The app is designed to be run on your own machine. Settings, secrets, recordings, transcripts, drafts, and the SQLite database are stored locally, not in a hosted service.

## Quick Start

### Portable release

For most Windows users, download `Dirong_portable.zip` from the [latest GitHub release](https://github.com/mua-vtuber/Dirong/releases/latest), extract it, and double-click:

```bat
Dirong Start.bat
```

The portable release includes the app, Node.js, Python with pip, helper scripts, and an empty `data/` folder. Complete the setup wizard on first launch. After setup, do not share the portable folder unless you remove `data/secrets/` first.

### Windows launcher

Double-click:

```bat
Dirong Start.bat
```

The launcher installs Node dependencies, builds the TypeScript app, starts Dirong, and opens the local dashboard. It does not create the local Whisper Python environment; the setup wizard does that when you choose local Whisper and start installation.

Default dashboard:

```text
http://127.0.0.1:3095/
```

The dashboard is a status and control screen. Dirong keeps running if the dashboard tab is closed, minimized, or covered; keep the launcher console running, and type `exit` there when you want to quit the app.

### Manual start

```bash
npm install
npm run build
npm start
```

For a rebuild-and-run cycle:

```bash
npm run dev
```

## Requirements

- Node.js 22.12.0 or newer.
- For a normal git/manual run with local Whisper, Python with `venv` support must be available to bootstrap the app-managed environment.
- A Discord application and bot token.
- A Discord server where the bot has been invited.
- For STT, either:
  - local Whisper through the bundled `scripts/local-whisper-json.py` wrapper, or
  - OpenAI STT with an API key.
- For AI meeting-note cleanup, Claude Code CLI is currently the only supported runtime path.
- For Notion upload, a Notion integration token and a parent page are needed.

For local Whisper, the setup wizard creates an app-managed `python-venv`, installs `faster-whisper`, and downloads the selected model. The portable release uses its bundled Python runtime instead of requiring Python on the user's computer. OpenAI STT does not require local Python.

## First-Time Setup Workflow

1. Start the app with `Dirong Start.bat` or `npm start`.
2. Open the dashboard at `http://127.0.0.1:3095/`.
3. Complete the setup wizard:
   - choose language and dashboard theme,
   - save the Discord application ID,
   - save the Discord bot token,
   - select the Discord guild allowlist,
   - choose the STT provider,
   - for local Whisper, click save and install, then wait for the Python environment, package, and model checks to finish,
   - for OpenAI STT, enter the API key and run the connection test,
   - configure Claude Code CLI for AI meeting-note cleanup,
   - configure Notion if you want uploads,
   - create or verify the managed Notion databases.
4. Restart the app after Discord, STT, or AI settings that require a restart.
5. In Discord, join a voice channel and run:

```text
/dirong start
```

## Recording Workflow

Use these Discord slash commands:

```text
/dirong start
/dirong stop
/dirong status
```

Typical flow:

1. A meeting participant joins a voice channel.
2. They run `/dirong start`.
3. Dirong joins that voice channel and records per-speaker audio chunks.
4. During or after the meeting, use `/dirong status` or the dashboard to check recording, queue, and automation state.
5. Run `/dirong stop` when the meeting is done.
6. Dirong finalizes the session and queues the processing pipeline.

The console also accepts:

```text
status
stop
exit
```

## Processing Workflow

After a session is finalized, Dirong can run these steps:

1. STT converts recorded audio chunks into transcript segments.
2. Transcript timeline building prepares the input for meeting-note generation.
3. AI cleanup creates a validated meeting-note draft and Markdown preview. Currently, this step supports Claude Code CLI only.
4. Notion upload publishes a completed draft when Notion settings and schema are ready.
5. Retention cleanup can remove audio after successful Notion upload, depending on settings.

When the app is running and configured, STT, AI cleanup, and Notion automation can process ready work in the background. The dashboard is the easiest way to see what is waiting, blocked, or complete.

## Dashboard Workflow

Use the dashboard for day-to-day operation:

- complete setup,
- switch or create projects for different Discord servers/workspaces,
- monitor the active recording,
- inspect recent sessions and chunks,
- play local audio through signed local links,
- watch STT, AI cleanup, and Notion queue status,
- manually send or retry Notion uploads,
- inspect and repair managed Notion schema issues,
- reset local settings when needed.

If multiple projects are configured, only the active project's Discord guild should be used for Dirong commands. The command gate prevents inactive projects from starting, stopping, or querying the wrong recording.

## Operations and Troubleshooting Commands

These commands are mainly for diagnostics, recovery, cleanup, and manual pipeline retries.

```bash
npm run doctor
npm run doctor -- --notion-remote
npm run repair
npm run sessions:purge -- --missing-audio
```

Manual pipeline commands:

```bash
npm run phase3:stt -- --limit 1
npm run phase4:ai-cleanup -- --session <session-id>
npm run phase5:notion-upload -- --session <session-id>
```

Safe dry-run examples:

```bash
npm run phase3:stt -- --dry-run --limit 1
npm run phase4:ai-cleanup -- --dry-run --session <session-id>
npm run phase5:notion-upload -- --dry-run --session <session-id>
npm run sessions:purge -- --all --dry-run
```

`npm run doctor` is read-only. `npm run repair` may update local database state to recover stale chunks, leases, or queue records.

## Local Data

Runtime data is stored outside the repository by default:

- Windows: `%LOCALAPPDATA%\Dirong`
- macOS: `~/Library/Application Support/Dirong`
- Linux: `~/.local/share/dirong`

Important local files include:

- `settings/settings.json`
- `secrets/secrets.json`
- `sessions/dirong.sqlite`
- `sessions/`
- `python-venv/`
- `models/`
- `logs/`

Secrets are stored locally and dashboard/API status responses expose only redacted snapshots.

In the portable release, these files live under `portable/Dirong/data/` instead. After setup, do not share the portable folder unless you remove `data/secrets/` first.

## License / Usage

Dirong is source-available for personal, educational, and non-commercial self-hosted use. See [LICENSE](./LICENSE).

This project is designed for self-hosting because Discord voice data and meeting notes can contain sensitive information. It is not offered as a hosted service, and commercial use is not permitted.

## Development

Build before running tests:

```bash
npm run build
npm test
```

The project uses TypeScript, native Node.js test runner, Discord.js, SQLite, local dashboard assets, and local processing scripts.

---

<a id="korean-guide"></a>

# 디롱 Discord 녹음 봇

디롱은 Discord 음성 회의 흐름을 위한 로컬 우선 녹음 봇입니다. Discord 음성 세션을 녹음하고, 음성을 전사하고, AI로 회의록 초안을 정리한 뒤, 필요하면 Notion에 업로드합니다.

이 앱은 사용자의 PC에서 실행되는 것을 전제로 합니다. 설정, 비밀값, 녹음 파일, 전사 결과, 초안, SQLite 데이터베이스는 호스팅 서비스가 아니라 로컬에 저장됩니다.

## 빠른 시작

### 포터블 릴리즈

대부분의 Windows 사용자는 [최신 GitHub 릴리즈](https://github.com/mua-vtuber/Dirong/releases/latest)에서 `Dirong_portable.zip`을 받은 뒤 압축을 풀고 다음 파일을 더블클릭하면 됩니다.

```bat
Dirong Start.bat
```

포터블 릴리즈에는 앱, Node.js, pip가 포함된 Python, 보조 스크립트, 빈 `data/` 폴더가 들어 있습니다. 첫 실행 때 설정 마법사를 완료하세요. 설정 후에는 `data/secrets/`를 제거하지 않은 상태로 포터블 폴더를 공유하지 마세요.

### Windows 실행 파일

다음 파일을 더블클릭하세요.

```bat
Dirong Start.bat
```

이 실행 파일은 Node 의존성 설치, TypeScript 빌드, 앱 시작, 로컬 대시보드 열기를 순서대로 처리합니다. local Whisper용 Python 환경은 여기서 만들지 않고, 설정 마법사에서 local Whisper를 선택해 설치를 시작할 때 만듭니다.

기본 대시보드 주소:

```text
http://127.0.0.1:3095/
```

대시보드는 상태 확인과 조작 화면입니다. 대시보드 탭을 닫거나 최소화하거나 다른 화면에 가려도 디롱이는 계속 실행됩니다. 앱을 계속 쓰려면 실행 콘솔을 열어두고, 종료하려면 그 콘솔에서 `exit`를 입력해 주세요.

### 수동 실행

```bash
npm install
npm run build
npm start
```

빌드 후 바로 실행하려면:

```bash
npm run dev
```

## 필요 조건

- Node.js 22.12.0 이상.
- 일반 git/manual 실행에서 local Whisper를 쓰려면 앱 전용 환경을 만들 수 있는 `venv` 지원 Python이 필요합니다.
- Discord application과 bot token.
- 봇이 초대된 Discord 서버.
- STT용 설정 중 하나:
  - 기본 제공 `scripts/local-whisper-json.py` 래퍼를 사용하는 local Whisper,
  - OpenAI STT와 API key.
- AI 회의록 정리는 현재 Claude Code CLI만 지원합니다.
- Notion 업로드에는 Notion integration token과 parent page가 필요합니다.

local Whisper를 선택하면 설정 마법사가 앱 전용 `python-venv`를 만들고, `faster-whisper`와 선택한 모델을 설치합니다. 포터블 릴리즈는 포함된 Python runtime을 사용하므로 사용자 PC에 Python이 없어도 됩니다. OpenAI STT는 로컬 Python이 필요하지 않습니다.

## 최초 설정 워크플로우

1. `Dirong Start.bat` 또는 `npm start`로 앱을 실행합니다.
2. `http://127.0.0.1:3095/` 대시보드를 엽니다.
3. 설정 마법사를 완료합니다:
   - 언어와 대시보드 테마 선택,
   - Discord application ID 저장,
   - Discord bot token 저장,
   - Discord guild allowlist 선택,
   - STT provider 선택,
   - local Whisper는 저장하고 설치를 눌러 Python 환경, 패키지, 모델 확인이 끝날 때까지 대기,
   - OpenAI STT는 API key를 입력하고 연결 테스트 실행,
   - AI 회의록 정리용 Claude Code CLI 설정,
   - Notion 업로드가 필요하면 Notion 설정,
   - 관리형 Notion 데이터베이스 생성 또는 검증.
4. Discord, STT, AI처럼 재시작이 필요한 설정을 바꿨다면 앱을 다시 시작합니다.
5. Discord 음성 채널에 들어간 뒤 다음 명령을 실행합니다.

```text
/dirong start
```

## 녹음 워크플로우

Discord에서 사용하는 명령:

```text
/dirong start
/dirong stop
/dirong status
```

일반적인 흐름:

1. 회의 참가자가 음성 채널에 들어갑니다.
2. `/dirong start`를 실행합니다.
3. 디롱이 해당 음성 채널에 들어가 화자별 오디오 chunk를 녹음합니다.
4. 회의 중이거나 회의 후에 `/dirong status` 또는 대시보드로 녹음, queue, 자동화 상태를 확인합니다.
5. 회의가 끝나면 `/dirong stop`을 실행합니다.
6. 디롱이 세션을 finalize하고 처리 파이프라인에 작업을 넣습니다.

콘솔에서도 다음 명령을 사용할 수 있습니다.

```text
status
stop
exit
```

## 처리 워크플로우

세션이 finalize되면 디롱은 다음 단계를 처리할 수 있습니다.

1. STT가 녹음된 오디오 chunk를 전사 segment로 변환합니다.
2. transcript timeline이 회의록 생성 입력을 준비합니다.
3. AI cleanup이 검증된 회의록 초안과 Markdown preview를 생성합니다. 현재 이 단계는 Claude Code CLI만 지원합니다.
4. Notion 설정과 schema 상태가 준비되어 있으면 Notion upload가 완료된 초안을 게시합니다.
5. 설정에 따라 Notion 업로드 성공 후 오디오 보존/삭제 정책이 적용됩니다.

앱이 실행 중이고 설정이 준비되어 있으면 STT, AI cleanup, Notion 자동화가 백그라운드에서 준비된 작업을 처리합니다. 대시보드에서 대기, 차단, 완료 상태를 확인하는 것이 가장 편합니다.

## 대시보드 워크플로우

대시보드는 운영의 중심 화면입니다.

- 최초 설정 완료,
- Discord 서버/워크스페이스별 프로젝트 생성 및 전환,
- 현재 녹음 상태 확인,
- 최근 세션과 chunk 확인,
- signed local link로 로컬 오디오 재생,
- STT, AI cleanup, Notion queue 상태 확인,
- Notion 수동 전송 또는 재시도,
- 관리형 Notion schema 점검과 복구,
- 필요 시 로컬 설정 초기화.

여러 프로젝트를 설정했다면 active project의 Discord guild에서만 디롱 명령을 사용하는 흐름입니다. command gate가 inactive project에서 잘못된 녹음이 시작/중지/조회되지 않도록 막습니다.

## 운영/문제 해결 명령

이 명령들은 주로 진단, 복구, 정리, 파이프라인 수동 재시도에 사용합니다.

```bash
npm run doctor
npm run doctor -- --notion-remote
npm run repair
npm run sessions:purge -- --missing-audio
```

파이프라인 수동 실행:

```bash
npm run phase3:stt -- --limit 1
npm run phase4:ai-cleanup -- --session <session-id>
npm run phase5:notion-upload -- --session <session-id>
```

안전한 dry-run 예시:

```bash
npm run phase3:stt -- --dry-run --limit 1
npm run phase4:ai-cleanup -- --dry-run --session <session-id>
npm run phase5:notion-upload -- --dry-run --session <session-id>
npm run sessions:purge -- --all --dry-run
```

`npm run doctor`는 read-only 점검입니다. `npm run repair`는 stale chunk, lease, queue record 복구를 위해 로컬 DB 상태를 수정할 수 있습니다.

## 로컬 데이터

런타임 데이터는 기본적으로 repository 바깥에 저장됩니다.

- Windows: `%LOCALAPPDATA%\Dirong`
- macOS: `~/Library/Application Support/Dirong`
- Linux: `~/.local/share/dirong`

주요 로컬 파일:

- `settings/settings.json`
- `secrets/secrets.json`
- `sessions/dirong.sqlite`
- `sessions/`
- `python-venv/`
- `models/`
- `logs/`

비밀값은 로컬에 저장되며, 대시보드/API 상태 응답에서는 redacted snapshot만 노출됩니다.

포터블 릴리즈에서는 이 파일들이 `portable/Dirong/data/` 아래에 저장됩니다. 설정 후에는 `data/secrets/`를 제거하지 않은 상태로 포터블 폴더를 공유하지 마세요.

## 라이선스 / 사용 범위

디롱이는 개인 사용, 학습, 비상업적 자가 호스팅 용도로 공개됩니다. 자세한 조건은 [LICENSE](./LICENSE)를 확인해 주세요.

Discord 음성 데이터와 회의록은 민감한 정보를 포함할 수 있으므로, 디롱이는 호스팅 서비스가 아니라 사용자가 직접 운영하는 자가 호스팅 도구로 제공됩니다. 상업적 이용은 허용하지 않습니다.

## 개발

테스트 전에 빌드하세요.

```bash
npm run build
npm test
```

이 프로젝트는 TypeScript, Node.js 기본 test runner, Discord.js, SQLite, 로컬 대시보드 asset, 로컬 처리 스크립트를 사용합니다.
