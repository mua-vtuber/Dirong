import type { DirongLocale } from "../settings/local-settings-store.js";

const DEFAULT_CATALOG_LOCALE: DirongLocale = "ko";

export const ko = {
  statusDisplay: {
    action: {
      done: {
        title: "설정을 저장했어요",
        description: "방금 입력한 값이 저장되었습니다.",
      },
      ready: {
        title: "이미 준비되어 있어요",
        description: "필요한 설정이 이미 준비되어 있어 같은 작업을 다시 하지 않아도 됩니다.",
      },
      failed: {
        title: "요청을 처리하지 못했어요",
        description: "입력값이나 연결 상태를 확인해야 해서 작업을 멈췄습니다.",
        nextAction: "아래 자세히 보기를 확인한 뒤 값을 다시 입력하거나 연결을 다시 검사해 주세요.",
      },
      blocked: {
        title: "지금은 진행할 수 없어요",
        description: "먼저 확인해야 할 설정이나 안전 조건이 있어서 작업을 멈췄습니다.",
        nextAction: "설정 화면에서 상태를 확인하고 필요한 단계부터 다시 진행해 주세요.",
      },
      notConfigured: {
        title: "필요한 설정이 아직 없어요",
        description: "이 작업을 진행하기 전에 저장해야 할 설정이 남아 있습니다.",
        nextAction: "설정 위자드에서 빠진 값을 저장한 뒤 다시 시도해 주세요.",
      },
    },
    discord: {
      notConfigured: {
        title: "Discord 봇 연결이 아직 끝나지 않았어요",
        description: "디롱이가 사용할 봇 정보나 서버 선택이 빠져 있어서 Discord 기능을 잠시 멈췄습니다.",
        nextAction: "Discord 설정에서 application ID, bot token, 사용할 서버 선택을 완료해 주세요.",
      },
      ready: {
        title: "Discord 봇 연결이 준비됐어요",
        description: "녹음을 시작할 Discord 봇과 허용 서버 설정이 저장되어 있습니다.",
      },
    },
    stt: {
      notConfigured: {
        title: "STT 설정이 아직 끝나지 않았어요",
        description: "음성을 텍스트로 바꿀 provider와 모델을 아직 선택하지 않았습니다.",
        nextAction: "STT 설정에서 local faster-whisper 또는 OpenAI STT를 선택해 주세요.",
      },
      openAiApiKeyMissing: {
        title: "OpenAI STT API key가 필요해요",
        description: "OpenAI STT를 선택했지만 사용할 API key가 저장되어 있지 않습니다.",
        nextAction: "API key를 다시 입력하거나 local faster-whisper로 바꿔 주세요.",
      },
      ready: {
        title: "STT 설정이 준비됐어요",
        description: "음성을 텍스트로 바꾸기 위한 기본 설정이 저장되어 있습니다.",
      },
    },
    claude: {
      notConfigured: {
        title: "AI provider 설정이 아직 끝나지 않았어요",
        description: "회의록을 만들 AI provider 사용 방식이 아직 저장되지 않았습니다.",
        nextAction: "AI 설정에서 provider와 실행 방식을 선택하고 연결을 확인해 주세요.",
      },
      apiKeyMissing: {
        title: "Claude API key가 필요해요",
        description: "Claude API 모드를 선택했지만 사용할 API key가 저장되어 있지 않습니다.",
        nextAction: "Claude API key를 다시 입력하거나 CLI 모드로 바꿔 주세요.",
      },
      cliCommandMissing: {
        title: "AI CLI 실행 명령이 필요해요",
        description: "터미널 CLI 모드를 선택했지만 실행할 command가 저장되어 있지 않습니다.",
        nextAction: "AI CLI command를 저장한 뒤 연결 테스트를 다시 실행해 주세요.",
      },
      ready: {
        title: "AI provider 설정이 준비됐어요",
        description: "회의록 생성을 위한 AI provider 설정이 저장되어 있습니다.",
      },
      preparing: {
        title: "AI provider 준비 상태를 확인하고 있어요",
        description: "회의록 생성을 시작하기 전에 AI 실행 환경을 확인하는 중입니다.",
      },
      loginRequired: {
        title: "Claude 로그인이 필요해요",
        description: "Claude CLI를 사용할 수 있지만 로그인 상태가 준비되지 않았습니다.",
        nextAction: "터미널에서 Claude CLI 로그인을 완료한 뒤 다시 확인해 주세요.",
      },
      toolMissing: {
        title: "AI 도구를 찾지 못했어요",
        description: "디롱이가 선택한 AI CLI 또는 로컬 AI 도구를 실행하지 못했습니다.",
        nextAction: "선택한 AI 도구가 설치되어 있고 터미널에서 실행되는지 확인해 주세요.",
      },
      failed: {
        title: "AI provider 준비 확인에 실패했어요",
        description: "회의록 생성 전에 AI provider 상태를 확인하지 못했습니다. 녹음과 STT 결과는 보존됩니다.",
        nextAction: "AI 설정과 provider 상태를 확인한 뒤 다시 시도해 주세요.",
      },
      stopped: {
        title: "AI provider 준비 확인을 멈췄어요",
        description: "AI provider 준비 상태 확인이 중지되었습니다.",
      },
    },
    aiCleanup: {
      disabled: {
        title: "AI 회의록 자동화가 꺼져 있어요",
        description: "회의록 초안을 자동으로 만드는 기능이 현재 비활성화되어 있습니다.",
        nextAction: "필요하면 수동 Phase 4 CLI로 회의록 생성을 실행해 주세요.",
      },
      idle: {
        title: "AI 회의록 자동화가 대기 중이에요",
        description: "처리할 회의가 생기면 STT 상태를 확인한 뒤 회의록 초안을 만듭니다.",
      },
      waitingForFinalizedSession: {
        title: "완료된 녹음 세션을 기다리고 있어요",
        description: "회의록을 만들 수 있는 finalized 세션이 아직 없습니다.",
      },
      waitingForStt: {
        title: "STT 완료를 기다리고 있어요",
        description: "회의록을 만들기 전에 음성 텍스트 변환이 끝나야 합니다.",
      },
      waitingForAiProvider: {
        title: "AI provider 준비를 기다리고 있어요",
        description: "회의록 생성을 시작하기 전에 AI 실행 환경이 준비되어야 합니다.",
        nextAction: "AI provider 상태를 확인해 주세요. 준비되면 자동으로 다시 시도합니다.",
      },
      queued: {
        title: "AI 회의록 작업을 준비하고 있어요",
        description: "회의록 생성 job을 실행할 차례인지 확인하는 중입니다.",
      },
      running: {
        title: "회의록 초안을 만들고 있어요",
        description: "AI provider가 STT 결과를 바탕으로 회의록 초안을 생성하는 중입니다.",
      },
      done: {
        title: "회의록 초안 생성이 끝났어요",
        description: "AI 회의록 초안을 저장했습니다.",
      },
      alreadyDone: {
        title: "이미 회의록 초안이 있어요",
        description: "같은 입력으로 만든 회의록 초안이 이미 저장되어 있습니다.",
      },
      blocked: {
        title: "회의록 생성을 보류했어요",
        description: "생성할 실제 발화가 없거나 입력 조건을 만족하지 않아 회의록 생성을 멈췄습니다.",
        nextAction: "실제 STT 발화가 생기면 다시 실행됩니다.",
      },
      failed: {
        title: "회의록 생성에 실패했어요",
        description: "AI 회의록 초안을 만들지 못했습니다. 녹음과 STT 결과는 보존됩니다.",
        nextAction: "AI provider 상태와 job 오류를 확인한 뒤 필요하면 수동 Phase 4 CLI로 재시도해 주세요.",
      },
      notClaimed: {
        title: "AI 회의록 작업 순서를 기다리고 있어요",
        description: "이미 처리 중이거나 재시도 시간이 아직 오지 않아 이번에는 job을 잡지 않았습니다.",
      },
      stopped: {
        title: "AI 회의록 자동화를 멈췄어요",
        description: "AI 회의록 자동 실행 서비스가 중지되었습니다.",
      },
    },
    notion: {
      notConfigured: {
        title: "Notion 연결 설정이 아직 끝나지 않았어요",
        description: "Notion token 또는 노션 DB 관리 페이지 정보가 빠져 있어서 업로드를 시작할 수 없습니다.",
        nextAction: "Notion 설정에서 token과 노션 DB 관리 페이지 URL을 저장해 주세요.",
      },
      registryMissing: {
        title: "Notion DB 설정이 아직 만들어지지 않았어요",
        description: "Notion 연결 값은 있지만 디롱이가 만든 DB 기록이 아직 없습니다.",
        nextAction: "Notion 설정 화면에서 managed DB 생성을 진행해 주세요.",
      },
      registryPartial: {
        title: "Notion DB 설정이 완성되지 않았어요",
        description: "디롱이가 만든 Notion DB 기록 중 일부가 빠져 있어서 업로드를 멈췄습니다.",
        nextAction: "Notion 설정 화면에서 DB 상태를 확인하고, 필요하면 복구를 진행해 주세요.",
      },
      ready: {
        title: "Notion 업로드 준비가 끝났어요",
        description: "디롱이가 회의록을 올릴 Notion DB 기록을 찾았습니다.",
      },
      disabled: {
        title: "Notion 업로드가 꺼져 있어요",
        description: "회의록을 Notion으로 보내는 기능이 현재 비활성화되어 있습니다.",
        nextAction: "자동 업로드를 쓰려면 Notion 업로드 설정을 켜 주세요.",
      },
      manual: {
        title: "Notion 업로드가 수동 모드예요",
        description: "회의록은 자동으로 올라가지 않고 사용자가 업로드 버튼을 눌러야 합니다.",
        nextAction: "회의록을 확인한 뒤 상태 카드의 회의록 올리기 버튼으로 직접 업로드해 주세요. 자동 업로드를 원하면 설정에서 업로드 방식을 자동으로 바꿀 수 있습니다.",
      },
      idle: {
        title: "Notion에 올릴 회의록을 기다리고 있어요",
        description: "업로드할 준비가 끝난 회의록 초안이 생기면 자동으로 처리합니다.",
      },
      running: {
        title: "Notion 업로드를 진행하고 있어요",
        description: "회의록 초안을 Notion 페이지로 보내는 중입니다.",
      },
      done: {
        title: "Notion 업로드가 끝났어요",
        description: "회의록을 Notion에 올리는 작업을 완료했습니다.",
      },
      draftNotFound: {
        title: "Notion에 올릴 회의록을 찾지 못했어요",
        description: "업로드할 수 있는 회의록 초안이나 세션을 찾지 못했습니다.",
        nextAction: "회의 녹음과 AI 회의록 생성이 끝난 뒤 다시 시도해 주세요.",
      },
      retryWait: {
        title: "Notion 업로드를 잠시 뒤 다시 시도해요",
        description: "일시적인 Notion 오류가 있어 원본 데이터는 보존하고 재시도 시간을 기다립니다.",
        nextAction: "잠시 기다리면 자동으로 다시 시도합니다. 계속 실패하면 Notion 연결 상태를 확인해 주세요.",
      },
      blocked: {
        title: "Notion 업로드가 멈췄어요",
        description: "권한, DB 구조, registry 상태 중 확인이 필요한 문제가 있어 업로드를 멈췄습니다.",
        nextAction: "Notion 설정 화면에서 연결과 DB 상태를 확인해 주세요.",
      },
      failed: {
        title: "Notion 업로드 중 오류가 났어요",
        description: "회의록 업로드를 완료하지 못했습니다. 원본 음성과 처리 결과는 보존됩니다.",
        nextAction: "Notion 설정과 최신 write 상태를 확인한 뒤 다시 업로드해 주세요.",
      },
      notClaimed: {
        title: "Notion 업로드 순서를 기다리고 있어요",
        description: "이미 처리 중이거나 재시도 시간이 아직 오지 않아 이번에는 업로드를 잡지 않았습니다.",
      },
    },
    recording: {
      blocked: {
        title: "녹음 시작 준비가 아직 끝나지 않았어요",
        description: "Discord와 STT 설정이 준비되어야 녹음을 안전하게 시작할 수 있습니다.",
        nextAction: "Discord 봇 연결과 STT provider 설정을 먼저 완료해 주세요.",
      },
      ready: {
        title: "녹음 시작 준비가 끝났어요",
        description: "녹음을 시작하는 데 필요한 기본 설정이 준비되어 있습니다.",
      },
      disabled: {
        title: "녹음 자동 종료가 꺼져 있어요",
        description: "사람이 모두 나가도 디롱이가 자동으로 녹음을 끝내지 않습니다.",
      },
      idle: {
        title: "녹음 자동 종료가 대기 중이에요",
        description: "진행 중인 회의에서 사람이 모두 나가면 자동 종료 대기 시간을 시작합니다.",
      },
      countdown: {
        title: "디롱이가 혼자 남아 자동 종료를 기다리고 있어요",
        description: "음성 채널에 사람이 돌아오지 않으면 잠시 뒤 녹음을 자동으로 종료합니다.",
        nextAction: "회의가 계속 중이면 사람이 음성 채널에 다시 들어오면 됩니다.",
      },
      deferredReconnecting: {
        title: "재연결 중이라 자동 종료를 미뤘어요",
        description: "Discord 연결이 흔들리는 동안에는 안전하게 녹음을 바로 끝내지 않습니다.",
      },
      triggering: {
        title: "녹음을 자동으로 종료하고 있어요",
        description: "자동 종료 조건이 충족되어 녹음 종료를 실행하는 중입니다.",
      },
      finalized: {
        title: "녹음을 자동으로 종료했어요",
        description: "음성 채널에 사람이 없어 디롱이가 녹음을 정상 종료했습니다.",
      },
      skipped: {
        title: "녹음 자동 종료를 건너뛰었어요",
        description: "세션 상태나 음성 채널 정보를 안전하게 확인하지 못해 녹음은 계속됩니다.",
        nextAction: "대시보드에서 녹음 상태를 확인하고 필요하면 직접 종료해 주세요.",
      },
      failed: {
        title: "녹음 자동 종료에 실패했어요",
        description: "자동 종료를 시도했지만 녹음을 끝내지 못했습니다.",
        nextAction: "대시보드와 Discord 채널 상태를 확인하고 필요하면 직접 종료해 주세요.",
      },
      stopped: {
        title: "녹음 자동 종료 확인을 멈췄어요",
        description: "녹음 자동 종료 서비스가 중지되었습니다.",
      },
    },
    dataRetention: {
      ready: {
        title: "기본 보관 정책이 적용되어 있어요",
        description: "오디오와 텍스트 처리 결과는 설정된 보관 정책에 따라 정리됩니다.",
      },
    },
    dashboard: {
      sourceMissing: {
        title: "대시보드 상태 source가 연결되지 않았어요",
        description: "대시보드가 설정 상태를 읽을 runtime source를 찾지 못했습니다.",
        nextAction: "앱을 다시 시작하거나 dashboard runtime 구성을 확인해 주세요.",
      },
      requestInvalid: {
        title: "대시보드 요청을 처리하지 못했어요",
        description: "요청 본문이나 값이 올바르지 않아 작업을 멈췄습니다.",
        nextAction: "입력값을 확인한 뒤 다시 시도해 주세요.",
      },
    },
  },
  runtimeStatus: {
    recordingStatus: {
      noSession: "진행 중이거나 최근 생성된 녹음 세션이 없습니다.",
      heading: "녹음과 STT 상태",
      session: "세션",
      voiceChannel: "음성 채널",
      currentRecording: "현재 녹음",
      openChunks: "열려 있는 chunk",
      speakers: "참여자",
      chunks: "chunk",
      sttQueue: "STT 대기열",
      openRepairItems: "확인할 복구 항목",
      dashboard: "대시보드",
      yes: "예",
      no: "아니요",
      sessionStatus: {
        created: "녹음 세션이 만들어졌습니다.",
        active: "녹음 중입니다.",
        reconnecting: "Discord 음성 연결을 다시 확인하고 있습니다.",
        stopping: "녹음을 종료하는 중입니다.",
        finalized: "녹음이 정상 종료되었습니다.",
        failed: "녹음 처리 중 오류가 발생했습니다.",
        needsRepair: "녹음 데이터 확인이 필요합니다.",
        unknown: "녹음 상태를 확인해야 합니다.",
      },
      sttStatus: {
        queued: "대기 중",
        processing: "변환 중",
        done: "완료",
        failed: "실패",
        failedMissingFile: "음성 파일 없음",
        unknown: "확인 필요",
      },
    },
    sttAutomation: {
      disabled: {
        message: "STT 자동 실행이 꺼져 있습니다.",
        action: "필요하면 수동 Phase 3 STT CLI를 실행해 주세요.",
      },
      idle: {
        message: "STT 자동 실행 대기 중: queued job 없음",
      },
      running: {
        message: "STT queued job 확인 중",
      },
      done: {
        message: "STT batch 처리 완료",
      },
      doneMore: {
        message: "STT batch 처리 완료: 추가 queued job이 남아 있습니다.",
      },
      failed: {
        message: "STT 처리 실패. 녹음 파일과 job 상태는 보존됩니다.",
        action: "실패한 STT job은 dashboard와 로그를 확인해 주세요.",
      },
      stopped: {
        message: "STT 자동 실행 중지됨",
      },
      statusText: {
        title: "STT 자동화",
        description: "설명",
        nextAction: "STT 조치",
        batch: "STT batch",
      },
    },
    aiReadiness: {
      idle: {
        message: "AI 준비 전",
      },
      preparing: {
        message: "AI 준비 중",
      },
      ready: {
        message: "AI 준비 완료",
      },
      loginRequired: {
        message: "AI 로그인 필요",
        action: "터미널에서 AI CLI 로그인을 완료한 뒤 다시 확인해 주세요.",
      },
      authRequired: {
        message: "AI API 키 필요",
        action: "설정의 AI API key를 확인해 주세요.",
      },
      serverUnreachable: {
        message: "로컬 AI 서버가 꺼져 있음",
        action: "로컬 AI 서버를 켠 뒤 다시 확인해 주세요.",
      },
      notInstalled: {
        message: "AI 도구를 찾지 못함",
        action: "선택한 AI CLI가 설치되어 있고 터미널에서 실행되는지 확인해 주세요.",
      },
      degraded: {
        message: "AI provider를 사용할 수 있지만 일부 상태를 확인해야 합니다.",
        action: "AI provider 상태와 로그를 확인해 주세요.",
      },
      failed: {
        message: "AI 준비 확인 실패. 실패했지만 녹음/STT는 보존됩니다.",
        action: "AI 설정과 provider 상태를 확인한 뒤 다시 시도해 주세요.",
      },
      stopped: {
        message: "AI 준비 상태 확인 중지됨",
      },
      statusText: {
        title: "AI 상태",
        description: "설명",
        nextAction: "AI 조치",
      },
    },
    aiCleanupAutomation: {
      disabled: {
        message: "AI cleanup 자동 실행이 꺼져 있습니다.",
        action: "필요하면 수동 Phase 4 CLI를 실행해 주세요.",
      },
      idle: {
        message: "AI cleanup 자동 실행 대기 중",
      },
      waitingForFinalizedSession: {
        message: "AI cleanup 대기 중: finalized 세션을 기다리는 중",
      },
      waitingForStt: {
        message: "STT 완료 대기 중",
      },
      waitingForAiProvider: {
        message: "AI cleanup 대기 중: AI 준비가 필요합니다.",
        action: "AI provider 상태를 확인한 뒤 준비가 완료되면 자동으로 다시 시도합니다.",
      },
      queued: {
        message: "AI cleanup job 실행 준비 중",
      },
      running: {
        message: "회의록 생성 중",
      },
      done: {
        message: "회의록 초안 생성 완료",
      },
      alreadyDone: {
        message: "이미 회의록 초안이 있습니다.",
      },
      blocked: {
        message: "회의록 생성 보류: 생성할 실제 발화가 없거나 입력 조건을 만족하지 않습니다.",
        action: "실제 STT 발화가 생기면 다시 실행됩니다. fake/no_speech만 있는 세션은 draft 없이 보류됩니다.",
      },
      failed: {
        message: "회의록 생성 실패. 실패했지만 녹음/STT는 보존됩니다.",
        action: "AI provider 상태와 job 오류를 확인한 뒤 필요하면 수동 Phase 4 CLI로 재시도해 주세요.",
      },
      notClaimed: {
        message: "AI cleanup job을 아직 실행할 수 없습니다.",
        action: "이미 처리 중이거나 재시도 시간이 아직 오지 않았습니다.",
      },
      stopped: {
        message: "AI cleanup 자동 실행 중지됨",
      },
      retry: {
        disabledMessage: "AI 회의록 자동화가 꺼져 있어 재시도할 수 없습니다.",
        disabledAction: "AI 설정을 완료한 뒤 다시 시도해 주세요.",
        missingMessage: "재시도할 실패 job을 찾지 못했습니다.",
        missingAction: "대시보드를 새로고침한 뒤 최신 실패 job에서 다시 시도해 주세요.",
        queuedMessage: "회의록 생성을 다시 시도합니다.",
      },
      statusText: {
        automation: "AI cleanup 자동화",
        provider: "AI cleanup provider",
        session: "AI cleanup 세션",
        stt: "AI cleanup STT",
        progress: "AI cleanup 진행",
        warning: "AI cleanup 주의",
        sttLeaseRepair: "AI cleanup STT lease 복구: {count}개",
        action: "AI cleanup 조치",
      },
    },
    aiCleanupRunner: {
      sessionNotFound: "AI cleanup 대상 세션을 찾지 못했습니다: {sessionId}",
      sessionNotFinalized:
        "Phase 4 AI cleanup은 finalized 세션만 처리합니다. 현재 세션 상태: {status}",
      preparingInput: "AI cleanup 입력 준비 중",
      claimingJob: "AI cleanup job 확인 중",
      alreadyDone: "이미 회의록 초안이 있습니다.",
      blocked: "회의록 생성 보류",
      notClaimed: "AI cleanup job을 아직 실행할 수 없습니다.",
      notClaimedError:
        "AI cleanup job을 claim하지 못했습니다. 이미 처리 중이거나 재시도 시간이 아직 오지 않았습니다.",
      writingPromptArtifacts: "AI cleanup prompt artifact 저장 중",
      artifactWriteFailed: "AI cleanup artifact 저장 실패",
      startingClaude: "AI provider 요청 시작",
      claudeRequestFailed: "AI provider 요청 실패",
      writingRawArtifacts: "AI provider raw output artifact 저장 중",
      emptyOutput: "AI provider output이 비어 있습니다.",
      parsingJson: "회의록 JSON 파싱 중",
      parsingJsonFailed: "회의록 JSON 파싱 실패",
      validatingSchema: "회의록 schema 검증 중",
      repairingSchema: "회의록 schema repair 요청 중",
      repairingSchemaFailed: "회의록 schema repair 요청 실패",
      writingRepairRawArtifacts: "AI provider repair raw output artifact 저장 중",
      repairFailed: "회의록 schema repair 실패",
      validatingRepairSchema: "repair 결과 schema 검증 중",
      repairValidationFailed: "repair 결과 schema 검증 실패",
      renderingDraft: "회의록 draft 저장 중",
      completed: "회의록 초안 생성 완료",
    },
    retentionAutomation: {
      idle: {
        message: "정리할 만료 텍스트·초안이 없습니다.",
      },
      running: {
        message: "만료된 텍스트·초안을 정리하는 중입니다.",
      },
      done: {
        message: "만료된 텍스트·초안을 정리했습니다.",
      },
      failed: {
        message: "텍스트·초안 자동 정리에 실패했습니다.",
      },
      stopped: {
        message: "텍스트·초안 자동 정리를 멈췄습니다.",
      },
    },
    notionAutomation: {
      disabled: {
        message: "Notion 자동 업로드가 꺼져 있습니다.",
        action: "자동 업로드를 쓰려면 NOTION_EXPORT_ENABLED=true로 켜 주세요.",
      },
      manual: {
        message: "Notion 업로드가 수동 모드입니다.",
        action: "회의록을 확인한 뒤 상태 카드의 회의록 올리기 버튼으로 직접 업로드해 주세요.",
      },
      notConfigured: {
        message: "Notion 자동 업로드 설정이 아직 완성되지 않았습니다.",
        action: "설정 마법사에서 Notion 연결 토큰과 managed DB 설정을 완료해 주세요.",
      },
      idle: {
        message: "Notion 자동 업로드 대기 중: 업로드할 valid draft 없음",
      },
      running: {
        message: "Notion 자동 업로드 실행 중",
      },
      done: {
        message: "Notion 자동 업로드 완료",
      },
      notClaimed: {
        message: "Notion 업로드 순서를 기다리는 중",
      },
      retryWait: {
        message: "Notion 자동 업로드 재시도 대기 중",
        action: "잠시 기다리면 자동으로 다시 시도합니다. 계속 실패하면 Notion 연결 상태를 확인해 주세요.",
      },
      blocked: {
        message: "Notion 자동 업로드가 멈췄습니다.",
        action: "Notion 설정과 DB 상태를 확인해 주세요.",
      },
      failed: {
        message: "Notion 자동 업로드 중 오류가 발생했습니다. local draft는 보존됩니다.",
        action: "Notion 설정과 dashboard의 최신 Notion write 상태를 확인한 뒤 수동 Retry를 시도해 주세요.",
      },
      stopped: {
        message: "Notion 자동 업로드 중지됨",
      },
      target: {
        missingAction:
          "설정 화면에서 managed Notion DB를 생성하거나 업로드 대상을 다시 연결해 주세요.",
        invalidAction:
          "Notion 데이터베이스 또는 data source URL을 다시 복사해 붙여넣어 주세요.",
        clientMissingAction:
          "설정 마법사에 저장한 Notion 연결 토큰을 확인해 주세요.",
        multipleDataSourcesAction:
          "Notion database에 data source가 여러 개이면 업로드할 data source URL을 직접 복사해 주세요.",
        dataSourceMissingAction:
          "Notion data source URL을 다시 복사해 붙여넣어 주세요.",
      },
      statusText: {
        title: "Notion 자동 업로드",
        description: "설명",
        nextAction: "Notion 조치",
        leaseRepair: "Notion lease 복구: {count}개",
      },
    },
    aloneFinalize: {
      disabled: {
        message: "혼자 남음 자동 종료가 꺼져 있습니다.",
        action: "DIRONG_ALONE_FINALIZE_ENABLED=true로 명시 opt-in해야 동작합니다.",
      },
      idle: {
        message: "혼자 남음 자동 종료 대기 중",
      },
      countdown: {
        message: "혼자 남음 감지, {seconds}초 후 자동 종료",
        action: "grace 시간 안에 사람이 돌아오면 자동 종료가 취소됩니다.",
      },
      deferredReconnecting: {
        message: "혼자 남음 감지됨: Discord 재연결 중이라 자동 종료를 보류했습니다.",
        action: "연결이 안정되면 다시 확인합니다. 녹음 데이터는 보존됩니다.",
      },
      triggering: {
        message: "혼자 남음 grace가 끝나 녹음을 자동 종료하는 중",
      },
      finalized: {
        message: "혼자 남음으로 녹음을 자동 종료했습니다. 상태: {status}",
      },
      skipped: {
        message: "혼자 남음 자동 종료를 건너뛰었습니다. 녹음은 계속됩니다.",
        action: "자동 종료 조건을 안전하게 확인하지 못했습니다. dashboard 상태를 확인해 주세요.",
      },
      failed: {
        message: "혼자 남음 자동 종료 실패. 녹음/STT 데이터는 보존됩니다.",
        action: "dashboard와 로그를 확인한 뒤 필요하면 /dirong stop을 실행해 주세요.",
      },
      stopped: {
        message: "혼자 남음 자동 종료 중지됨",
      },
      skippedReason: {
        sessionNotFound: {
          message: "혼자 남음 자동 종료 건너뜀: 세션을 찾지 못했습니다.",
          action: "녹음 상태와 dashboard를 확인해 주세요.",
        },
        memberCountUnknown: {
          message: "혼자 남음 자동 종료 건너뜀: 음성 채널 인원을 정확히 확인하지 못했습니다.",
          action: "녹음은 계속됩니다. dashboard와 Discord 채널 상태를 확인해 주세요.",
        },
        sessionStatus: {
          message: "혼자 남음 자동 종료 건너뜀: 세션 상태가 {status}입니다.",
        },
      },
      producerStopDisplayName: "디롱이 자동 종료",
      statusText: {
        title: "녹음 자동 종료",
        description: "설명",
        nextAction: "녹음 자동 종료 조치",
        session: "혼자 남음 세션: {sessionId}",
        countdown: "자동 종료까지: {seconds}초",
      },
    },
  },
  health: {
    node: {
      available: "Node.js {version} 사용 가능",
      unsupported: "Node.js {version}은 낮습니다. 22.12.0 이상이 필요합니다.",
      installAction: "Node.js 22.12.0 이상 LTS 버전을 설치한 뒤 다시 실행해 주세요.",
    },
    dependency: {
      detected: "{name} 감지됨",
      npmInstallAction: "npm install을 다시 실행해 주세요.",
      opusMissing: "Opus 라이브러리를 찾지 못했습니다.",
      ffmpegAvailable: "{source} FFmpeg 사용 가능",
      ffmpegMissing: "FFmpeg 실행 파일을 찾지 못했습니다.",
      daveMissing:
        "@snazzah/davey를 직접 찾지 못했습니다. @discordjs/voice 내장 의존성으로 처리될 수 있습니다.",
      nodeCrcDetected: "node-crc 감지됨",
      nodeCrcMissing: "OGG/Opus 파일 작성에 필요한 node-crc를 찾지 못했습니다.",
      nodeCrcLoadFailed: "node-crc를 찾았지만 로드하지 못했습니다: {error}",
      aesAvailable: "Node crypto aes-256-gcm 사용 가능",
      aesUnavailable:
        "Node crypto aes-256-gcm 미감지. 대체 암호화 라이브러리가 필요할 수 있습니다.",
    },
    config: {
      present: "설정됨(값은 출력하지 않음)",
      missing: "아직 설정되지 않았습니다.",
      action: "대시보드 설정 마법사에서 값을 저장해 주세요.",
    },
  },
  notionClientError: {
    invalidJson: {
      message: "Notion API 응답을 JSON으로 해석하지 못했습니다.",
      action: "잠시 후 다시 시도해 주세요. 계속 실패하면 Notion 상태와 네트워크를 확인해 주세요.",
    },
    network: {
      message: "Notion API에 연결하지 못했습니다.",
      action: "네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
    },
    timeout: {
      message: "Notion API 요청 시간이 초과되었습니다.",
      action: "네트워크 상태를 확인하거나 NOTION_REQUEST_TIMEOUT_MS 값을 늘린 뒤 다시 시도해 주세요.",
    },
    auth: {
      message: "Notion 인증 또는 공유 권한이 부족합니다.",
      action:
        "Notion integration token이 올바른지, 대상 데이터베이스에서 Add connections로 Dirong integration을 공유했는지 확인해 주세요.",
    },
    notFound: {
      message: "Notion target에 접근하지 못했습니다.",
      action: "Notion URL이 올바른지 확인하고 대상 데이터베이스에 Dirong integration을 공유해 주세요.",
    },
    schemaMismatch: {
      message: "Notion 요청이 데이터베이스 schema와 맞지 않습니다.",
      action: "Dirong에 필요한 Notion 속성 이름과 타입을 확인한 뒤 연결 테스트를 다시 실행해 주세요.",
    },
    rateLimited: {
      message: "Notion API 사용량 제한으로 잠시 대기합니다.",
      action: "잠시 후 자동 재시도됩니다.",
    },
    server: {
      message: "Notion API 서버 오류가 발생했습니다.",
      action: "잠시 후 다시 시도해 주세요.",
    },
    unknown: {
      message: "Notion API 오류가 발생했습니다. HTTP {status}{code}",
      action: "오류 내용을 확인한 뒤 다시 시도해 주세요.",
    },
  },
  sessionPurge: {
    cli: {
      unknownOption: "알 수 없는 session purge 옵션입니다: {flag}",
      selectorRequired:
        "--session, --missing-audio, --all, --expired-text-artifacts 중 정확히 하나가 필요합니다.",
      sessionValueRequired: "--session 값이 필요합니다.",
    },
    backup: {
      failureLine1: "SQLite backup 생성에 실패했습니다.",
      failureLine2: "session purge를 적용하지 않고 중단합니다.",
      failureLine3: "backup이 실패했으므로 DB 상태는 변경하지 않았습니다.",
    },
    expiredTextArtifactsTitle: "디롱이 expired text artifact retention 결과",
    sessionPurgeTitle: "디롱이 session purge 결과",
    fileDeletionPlanTitle: "파일 삭제 계획",
    targetSessionsTitle: "대상 세션",
    dryRunHint: "실제 삭제하려면 같은 명령에 --confirm을 붙여 실행하세요.",
    expiredTextArtifactsDone: "기간이 만료된 텍스트/초안 artifact 파일을 삭제했습니다.",
    sessionPurgeDone:
      "session 관련 행과 계획된 로컬 파일을 삭제했습니다. Notion Property Rules는 보존했습니다.",
    none: "없음",
    fileDeletionFailed: "파일 삭제 실패",
  },
  recordingProducer: {
    alreadyRecording: "이미 녹음 중인 세션이 있습니다: {sessionId}",
    stageUnsupported: "Stage 채널은 현재 Dirong 녹음 앱에서 아직 지원하지 않습니다.",
    criticalHealthLastError: "Node/Opus/FFmpeg 필수 의존성 health check 실패",
    criticalHealthFailure: "필수 의존성 health check 실패. npm run doctor를 확인해 주세요.",
    noActiveSession: "진행 중인 녹음 세션이 없습니다.",
    chunkFinalizeTimeout: "종료 중 chunk finalize가 제한 시간 안에 끝나지 않았습니다.",
    fatalErrors: "voice fatal error {count}회 기록됨",
    softRolloverAction: "다음 silence에서 닫고 hard cap을 backstop으로 유지합니다.",
    sessionDirectoryNameFailed: "새 session directory 이름을 만들지 못했습니다.",
  },
  notionPageProperties: {
    draftTitle: "회의록 초안",
    unknown: "알 수 없음",
    uploadPending: "Notion 업로드 대기 중",
    uploadInProgress: "Notion 업로드 중",
    uploadComplete: "Notion 업로드 완료",
    taskTitle: "작업",
    taskStatusTodo: "할 일",
    noEvidence: "근거 없음",
    participantEmptyWarning: "빈 참여자 이름은 Notion Participants 속성에서 제외했습니다.",
    participantsCappedWarning: "Notion Participants 속성은 최대 100명까지만 기록했습니다.",
    meetingTimeUnknownEnd: "미정",
  },
  notionWriter: {
    disabledMessage: "Notion 업로드가 꺼져 있습니다.",
    settingsIncompleteMessage: "Notion 설정이 아직 완료되지 않았습니다.",
    clientUnavailableMessage: "Notion client를 사용할 수 없습니다.",
    draftMissingMessage: "업로드할 수 있는 회의록 초안을 찾지 못했습니다.",
    apiKeyMissingAction: "Notion 업로드를 켜려면 설정 마법사에서 Notion 연결 토큰을 저장해 주세요.",
    clientMissingAction: "Notion API key 설정을 확인해 주세요.",
    draftMissingAction: "Phase 4 AI cleanup을 먼저 완료한 뒤 다시 시도해 주세요.",
    unresolvedProjectAction:
      "프로젝트가 애매한 legacy session은 default project로 자동 업로드하지 않습니다.",
    projectMismatchAction: "프로젝트를 전환한 뒤 해당 프로젝트의 회의록만 업로드해 주세요.",
    duplicateDraftAction: "Notion 데이터베이스에서 같은 Draft ID를 가진 page를 하나만 남긴 뒤 다시 시도해 주세요.",
    duplicateSessionAction:
      "Notion 데이터베이스에서 같은 Session ID를 가진 page를 하나만 남긴 뒤 다시 시도해 주세요.",
    pageIdMissing: "Notion page id가 응답에 없습니다.",
    blockAppendMismatchAction: "Notion upload 상태를 확인한 뒤 다시 시도해 주세요.",
    managedMemberMissingWarning:
      "Notion 작업자 DB에서 Discord 참가자 \"{name}\"를 찾지 못해 참가자 relation에서 제외했습니다.",
    actionItem: {
      duplicateSourceActionId:
        "{sourceActionId}: 같은 Dirong 할 일 ID를 가진 할 일 페이지가 여러 개라 업데이트를 건너뜁니다.",
      syncFailed: "{sourceActionId}: 할 일 페이지 동기화 중 오류가 발생했습니다 ({error}).",
      unsupportedWorkerMatch:
        "{sourceActionId}: 작업자 매칭 속성 타입을 지원하지 않아 담당자 relation을 비웠습니다.",
      duplicateRemoteWorker:
        "{sourceActionId}: 작업자 \"{ownerName}\"와 일치하는 Notion page가 여러 개라 담당자 relation을 비웠습니다.",
      duplicateCachedWorker:
        "{sourceActionId}: 작업자 \"{ownerName}\"와 일치하는 roster 캐시 항목이 여러 개라 담당자 relation을 비웠습니다.",
      duplicateRoleWorker:
        "{sourceActionId}: 역할 \"{ownerName}\"와 일치하는 작업자가 여러 명이라 담당자 relation을 비웠습니다.",
      cachedWorkerMissing:
        "{sourceActionId}: 작업자 또는 역할 \"{ownerName}\"와 일치하는 roster 캐시 항목을 찾지 못해 담당자 relation을 비웠습니다.",
      remoteWorkerMissing:
        "{sourceActionId}: 작업자 \"{ownerName}\"를 Notion 작업자 DB에서 찾지 못해 담당자 relation을 비웠습니다.",
    },
  },
  notionManagedSchema: {
    error: {
      invalidPreset: "Notion schema preset이 유효하지 않습니다: {errors}",
      invalidParentPageUrl: "Notion 부모 page URL이 유효하지 않습니다: {reason}",
      relationTargetMissing: "{semanticKey} relation target이 없습니다.",
      rollupTargetMissing: "{semanticKey} rollup target이 없습니다.",
      taskMeetingPresetMissing: "task.meeting preset이 없습니다.",
      relationNotFound: "{meetingRole} Notion DB에서 {taskRole} relation을 찾지 못했습니다.",
      presetPropertyMissing: "{semanticKey} preset property를 찾지 못했습니다.",
      dataSourcePropertyMissing: "Notion data source 응답에서 {propertyName} 속성을 찾지 못했습니다.",
      propertyTypeMissing: "{propertyName} 속성 type을 찾지 못했습니다.",
      rollupRelationMissing: "{semanticKey} rollup relation을 찾지 못했습니다.",
      dataSourceIdMissing: "Notion database {databaseId}에서 data source id를 찾지 못했습니다.",
      databaseNotCreated: "{role} Notion DB가 아직 생성되지 않았습니다.",
      createdPropertyMissing: "{role}.{semanticKey} Notion 속성을 찾지 못했습니다.",
      unsupportedPropertyType: "지원하지 않는 Notion property type입니다: {type}",
      responseStringMissing: "Notion 응답에서 {label}를 찾지 못했습니다.",
    },
  },
  notionDashboardService: {
    managedSchema: {
      checkRequiresToken: "Notion token이 설정된 뒤 managed DB 상태를 확인할 수 있습니다.",
      clientMissing: "Notion client를 만들 수 없습니다. token 설정을 확인해 주세요.",
      repairPlanAction: "복구 계획을 확인한 뒤 적용할 항목을 선택해 주세요.",
      repairConfirmRequired: "managed schema repair에는 confirm=true가 필요합니다.",
      repairRequiresToken: "Notion token이 설정된 뒤 managed DB를 복구할 수 있습니다.",
      status: {
        healthy: "Managed Notion schema가 마지막 확인 기준으로 정상입니다.",
        needsRepair: "Managed Notion schema에 자동 복구 가능한 항목이 있습니다.",
        manualRequired: "Managed Notion schema에 수동 확인이 필요한 항목이 있습니다.",
        failed: "Managed Notion schema 확인 중 오류가 발생했습니다.",
        unchecked: "Managed Notion schema 확인 결과가 아직 없습니다.",
      },
    },
    managedSchemaRepair: {
      blockedNoOperations: "자동 복구할 수 없는 managed schema 항목이 있습니다.",
      noOperations: "적용할 managed schema 복구 작업이 없습니다.",
      unresolvedAfterRepair: "managed schema 복구 후에도 {count}개 항목이 남아 있습니다.",
      unresolvedAction:
        "{items} 항목이 Notion 응답에서 확인되지 않았습니다. DB 설정 화면에서 상태를 다시 확인해 주세요.",
      applied: "managed schema 복구 작업 {count}개를 적용했습니다.",
      remainingAction: "남은 항목은 Notion에서 직접 확인하거나 다시 복구 계획을 확인해 주세요.",
      reason: {
        presetSemanticMissing: "preset에서 semantic key를 찾지 못했습니다.",
        titleCreateUnsupported: "title property는 API로 새로 만들 수 없습니다.",
        relationDependencyMissing: "relation/rollup dependency를 확인할 수 없습니다.",
        statusOptionManual: "status option 보강은 Notion에서 직접 확인해야 합니다.",
        unsafeChangeManual: "기존 property의 위험한 변경은 자동 처리하지 않습니다.",
      },
      operation: {
        syncMapping: "{semanticKey} registry mapping을 remote property로 동기화",
        createProperty: "{semanticKey} Notion property 생성",
        renameProperty: "{semanticKey} Notion property 이름 복구",
        appendOptions: "{semanticKey} Notion option 보강",
      },
      error: {
        missingRegistry: "{role} managed Notion DB registry가 없습니다.",
        missingPresetProperty: "{semanticKey} preset property를 찾지 못했습니다.",
      },
    },
    managedSchemaDiff: {
      issue: {
        mappingMissing: "{semanticKey}: SQLite property mapping이 없습니다.",
        remoteMissingTitleUnsupported: "{semanticKey}: Notion title 속성은 API로 복구할 수 없습니다.",
        remoteMissing: "{semanticKey}: Notion property를 찾지 못했습니다.",
        wrongType: "{semanticKey}: Notion property type이 다릅니다 ({actual} -> {expected}).",
        nameDrift: "{semanticKey}: 연결된 Notion property 이름이 바뀌었습니다.",
        idMismatchNameCandidate:
          "{semanticKey}: registry의 property id와 일치하는 Notion property를 찾지 못했고 이름 후보만 찾았습니다.",
        relationTargetMismatch: "{semanticKey}: relation 대상 DB/data source가 다릅니다.",
        rollupTargetMismatch: "{semanticKey}: rollup relation/target property가 다릅니다.",
        optionMissing: "{semanticKey}: Notion option이 부족합니다 ({options}).",
        extra: "{propertyName}: Dirong managed registry에 없는 Notion property입니다. 자동 삭제하지 않습니다.",
      },
      uploadAction: {
        missing: "Managed Notion DB에 필요한 semantic 속성을 확인해 주세요: {items}",
        wrongType: "Managed Notion DB 속성 타입/관계를 확인해 주세요: {items}",
        missingOptions: "Managed Notion DB 옵션을 확인해 주세요: {items}",
        checkAgain: "DB 설정 화면에서 Notion 상태를 다시 확인하고 복구 계획을 적용해 주세요.",
      },
      error: {
        registrySnapshotMissing: "{role} registry snapshot을 찾지 못했습니다.",
      },
    },
    legacySchemaValidation: {
      missing: "Notion 데이터베이스에 필요한 속성을 추가해 주세요: {items}",
      wrongType: "Notion 속성 타입을 확인해 주세요: {items}",
      checkAgain: "속성을 수정한 뒤 Dirong 연결 테스트를 다시 실행해 주세요.",
      semanticMissing: "Notion managed DB에 필요한 semantic 속성을 확인해 주세요: {items}",
      semanticWrongType: "Notion managed DB 속성 타입을 확인해 주세요: {items}",
      semanticCheckAgain: "managed DB registry와 Notion schema를 확인한 뒤 다시 시도해 주세요.",
    },
    uploadTarget: {
      targetMissingMessage: "Notion 업로드 대상이 설정되지 않았습니다.",
      targetMissingAction:
        "설정 화면에서 managed Notion DB를 생성하거나 업로드 대상을 다시 연결해 주세요.",
      targetInvalidMessage: "Notion 업로드 대상 URL이 올바르지 않습니다.",
      targetInvalidAction:
        "Notion 데이터베이스 또는 data source URL을 다시 복사해 붙여넣어 주세요.",
      legacySchemaIncompatibleMessage: "Notion data source schema가 호환되지 않습니다.",
      managedMeetingSchemaIncompatibleMessage: "Managed Notion 회의록 DB schema가 호환되지 않습니다.",
      managedMemberSchemaIncompatibleMessage: "Managed Notion 작업자 DB schema가 호환되지 않습니다.",
      taskDbMissingWarning:
        "Notion 할 일 목록 DB 연결 정보가 없어 할 일 페이지 생성을 건너뜁니다.",
      taskDbUnhealthyWarning:
        "Notion 할 일 목록 DB 스키마가 건강하지 않아 할 일 페이지 생성을 건너뜁니다. {action}",
      taskDbCheckFailedWarning:
        "Notion 할 일 목록 DB 상태를 확인하지 못해 할 일 페이지 생성을 건너뜁니다 ({error}).",
      multipleDataSourcesAction:
        "Notion database에 data source가 여러 개이면 업로드할 data source URL을 직접 복사해 주세요.",
      dataSourceIdMissingAction:
        "Notion data source URL을 다시 복사해 붙여넣어 주세요.",
      partialRegistryAction:
        "일부 registry 값이 있어 legacy target으로 전환하지 않았습니다. 기존 DB/필드는 자동 수정하지 않으니 Notion 설정/복구 화면에서 registry 상태를 확인해 주세요.",
      actionItemUploadReady:
        "할 일 목록 DB가 준비되면 업로드 시 할 일 페이지를 생성하거나 갱신합니다.",
    },
    customProperties: {
      schemaRequiresSetup: "Notion 설정이 완료된 뒤 속성 스키마를 불러올 수 있습니다.",
      checkTokenAndManagedDb: "Notion token과 managed DB 설정을 확인해 주세요.",
      clientMissing: "Notion client를 만들 수 없습니다.",
      syncDone:
        "Notion 속성 {discovered}개를 확인했고 사용자 속성 {custom}개를 관리 목록에 반영했습니다.",
      connectionAction: "Notion 연결과 target 공유 상태를 확인해 주세요.",
      rulesSaved: "Notion 사용자 속성 규칙 {saved}개를 저장하고 {deleted}개를 삭제했습니다.",
      rulesIgnored: "{ignored}개 항목은 필수 속성이거나 이름이 비어 있어 건너뛰었습니다.",
      emptyRules: "이 DB의 사용자 속성 규칙은 아직 없습니다.",
      enabledRules: "사용자 속성 {rules}개 중 {enabled}개가 켜져 있습니다.",
      missingManagedDb: "선택한 managed DB 연결 정보가 없습니다.",
      createManagedDbAction: "Notion 설정에서 managed DB 세트를 먼저 생성해 주세요.",
      checkTargetOrManagedDb: "Notion target URL 또는 managed DB 설정을 확인해 주세요.",
      invalidTargetAction: "Notion 데이터베이스 또는 data source URL을 다시 복사해 붙여넣어 주세요.",
      unsupportedTypeWarning:
        "{property}: {type} 타입은 지원하지 않아 rich_text로 저장했습니다.",
      participantsSourceRequiresRelationWarning:
        "{property}: 참가자 source는 relation 속성에서만 사용할 수 있어 AI source로 저장했습니다.",
      relationNeedsTargetWarning:
        "{property}: relation은 대상 DB/data source URL 또는 대상 page URL이 있어야 켤 수 있습니다.",
      unsupportedAutoWriteWarning:
        "{property}: {type} 타입은 아직 자동 작성 대상이 아닙니다.",
      relationPageIdInvalidWarning:
        "{property}: relation 대상 page ID를 읽지 못했습니다.",
      relationPageUrlInvalidWarning:
        "{property}: relation 대상 page URL을 읽지 못했습니다.",
    },
    schema: {
      blockedApply: "자동 적용할 수 없는 Notion schema 항목이 있습니다.",
      noChanges: "Notion schema에 적용할 변경이 없습니다.",
      setupRequired: "Notion 설정이 완료된 뒤 schema를 정리할 수 있습니다.",
      setupAction: "설정 마법사에서 Notion 연결 토큰과 업로드 대상을 확인해 주세요.",
      invalidTargetAction: "Notion 데이터베이스 또는 data source URL을 다시 복사해 붙여넣어 주세요.",
      clientMissing: "Notion client를 만들 수 없습니다.",
      tokenAction: "설정 마법사에 저장한 Notion 연결 토큰을 확인해 주세요.",
      connectionAction: "Notion 연결과 target 공유 상태를 확인해 주세요.",
      extraPreservedAction: "관리 외 속성은 삭제하지 않습니다. 필요 없다면 Notion에서 직접 삭제해 주세요.",
      applyAction: "스키마 맞추기를 누르면 누락 속성과 이름 변경, select 옵션 보강을 자동 적용합니다.",
      diffMessage:
        "누락 {missing} / 이름변경 {renames} / 타입불일치 {wrongType} / 옵션누락 {missingOptions} / 관리외 {extra}",
      applyMessage:
        "생성 {create} / 이름변경 {rename} / 타입변경 {updateType} / 옵션보강 {updateOptions} / 삭제 {delete}",
    },
    schemaManager: {
      titleCreateWarning: "Notion title 속성은 API로 새로 만들 수 없습니다.",
      immutableOptionManual:
        "{propertyName}: {propertyType} 옵션은 API로 정리할 수 없어 Notion에서 직접 추가해야 합니다.",
      titleCreateBlocked: "{propertyName}: title 속성은 API로 새로 만들 수 없습니다.",
      relationTargetRequired: "{propertyName}: relation 대상 DB/data source URL이 필요합니다.",
      createMissingDisabled: "필요한 속성 만들기가 꺼져 있어 누락 속성은 그대로 둡니다.",
      typeChangeUnsupported:
        "{propertyName}: {actualType} -> {expectedType} 타입 변경은 자동 처리하지 않습니다.",
      typeUpdateDisabled: "타입 변경이 꺼져 있어 타입이 다른 속성은 그대로 둡니다.",
      statusOptionManual: "{propertyName}: status 옵션 {options}은 Notion에서 직접 추가해야 합니다.",
      deleteExtraSkipped: "관리 외 속성 삭제는 확인이 없어 건너뛰었습니다.",
      titleDeleteBlocked: "{propertyName}: title 속성은 삭제하지 않습니다.",
    },
    relationRules: {
      pageUrlInvalid: "{property}: relation 대상 page URL을 읽지 못했습니다.",
      targetUrlInvalid: "{property}: relation 대상 URL을 읽지 못했습니다.",
      targetDbAccessFailed: "{property}: relation 대상 DB에 접근하지 못했습니다 ({error}).",
    },
  },
  doctor: {
    title: "디롱이 Recording + STT doctor 결과",
    generatedAtLabel: "생성 시각",
    platformLabel: "플랫폼",
    baseEnvironmentTitle: "기본 실행 환경",
    readOnlyNotice: "이 doctor는 read-only입니다. DB repair가 필요하면 npm run repair를 실행해 주세요.",
    secretsHiddenNotice: "Discord 토큰과 API key 값은 출력하지 않았습니다.",
    failureNotice: "실패한 항목이 있습니다. 위 조치 안내를 먼저 확인해 주세요.",
    actionPrefix: "조치",
    discordVoiceOptionalName: "Discord voice channel ID (optional)",
    discordVoiceConfiguredOptional: "설정됨(값은 출력하지 않음). 일반 녹음에는 필요하지 않습니다.",
    discordVoiceNotNeeded:
      "일반 녹음에는 필요하지 않습니다. /dirong start는 사용자가 들어간 음성 채널을 사용합니다.",
    stt: {
      openAiSelected: "OpenAI STT provider 선택됨",
      openAiKeyStored: "OpenAI API key 저장됨(값은 출력하지 않음)",
      openAiKeyMissing: "OpenAI API key가 저장되지 않았습니다. OpenAI API 호출은 하지 않았습니다.",
      openAiKeyAction: "설정 마법사에서 OpenAI API key를 저장하거나 local-whisper provider를 사용해 주세요.",
      localWhisperLoading: "local-whisper 모델 로딩 검사는 시간이 걸릴 수 있습니다...",
      localWhisperSelected: "local-whisper provider 선택됨",
      localWhisperReady: "{model} 모델을 {device}/{computeType} 설정으로 로드할 수 있습니다.",
      localWhisperAction: "모델 경로와 Python 환경을 확인해 주세요. Windows에서는 먼저 cpu/int8 설정을 사용해 주세요.",
    },
    notion: {
      registryNoDb: "SQLite DB가 없어 Notion managed DB를 확인할 수 없습니다.",
      registryMissingTables: "Notion registry table이 없습니다: {tables}",
      tokenMissingRemote: "Notion 연결 토큰이 저장되지 않아 remote check를 실행하지 않았습니다.",
      remoteCheckAction: "네트워크, Notion token, parent page 공유 권한을 확인해 주세요.",
      registryTitle: "Notion managed registry",
      registryNoDbPrint: "SQLite DB가 없어 managed registry를 확인할 수 없습니다.",
      remoteOnlyHint: "remote check는 --notion-remote 옵션을 줄 때만 Notion API를 호출합니다.",
      registryMissingTablesPrint: "managed registry table 없음: {tables}",
      registrySetupHint: "setup wizard에서 Notion managed DB를 생성하면 registry가 저장됩니다.",
      latestCheckNoRecord: "latest managed schema check record: local 기록 없음",
      managedSchemaAction: "DB 설정 화면에서 복구 계획을 확인해 주세요.",
      dataSourceAction: "Notion 권한과 필수 필드/관계 상태를 확인해 주세요.",
    },
    sqlite: {
      title: "SQLite 상태",
      noDb: "아직 세션 DB가 없습니다. /dirong start로 첫 녹음을 시작하면 생성됩니다.",
      sessions: "sessions: {count}개",
      activeSessions: "active/reconnecting/stopping sessions: {count}개",
      transcriptSegments: "transcript segments: {count}개, no_speech={noSpeechCount}개",
      openRepairItems: "open repair items: {count}개",
    },
  },
  runtimeCli: {
    main: {
      dashboardHeartbeatExpired: "대시보드 heartbeat가 지연되었습니다. 서버는 계속 실행 중입니다.",
      dashboardStarted: "디롱이 Recording + STT dashboard 시작: {url}",
      setupStatusApi: "설정 상태 API: {url}",
      sttAutomationSkipped: "STT 자동 실행 대기 안 함: {message}",
      aiCleanupAutomationSkipped: "AI cleanup 자동 실행 대기 안 함: {message}",
      discordLoginSkipped: "Discord 봇 로그인 대기 안 함: {message}",
      dashboardStillOpen: "대시보드는 계속 열려 있습니다. 설정이 완료되면 앱을 다시 시작해 주세요.",
      botLoginDone: "디롱이 봇 로그인 완료: {tag}",
      configSummary: "설정 요약:",
      slashCommandAutoRegisterFailed: "Slash command 자동 등록 실패",
      discordCommandsAvailable: "Discord에서 /dirong start, /dirong stop, /dirong status를 사용할 수 있습니다.",
      consoleCommandsAvailable: "이 콘솔에서는 status, stop, exit 명령을 사용할 수 있습니다.",
      unhandledRejection: "처리되지 않은 비동기 오류",
      uncaughtException: "치명적인 오류",
      dashboardStartFailed: "Dashboard 시작 실패",
      noActiveProjectGuild: "등록할 active project Discord 서버가 없습니다. 설정 완료 후 다시 시작해 주세요.",
      guildCommandRegistered: "Guild slash command 등록/갱신 완료: {name} ({id})",
      guildCommandRegisterFailed: "Slash command 등록 실패 ({guildId})",
      noSlashCommandRegistered: "설정된 Discord 서버에 slash command를 등록하지 못했습니다.",
      guildFetchFailed: "Discord 서버 정보를 가져오지 못했습니다.",
      shortCommandsAvailable: "사용 가능 명령: /dirong start, stop, status",
      slashCommandHandleFailed: "slash command 처리 실패",
      recordingStopped: "녹음 종료: {sessionId} ({status})",
      consoleCommandsAvailableShort: "사용 가능한 콘솔 명령: status, stop, exit",
      shutdownProcessing: "종료 처리 중: {reason}",
      sttAutomationStopFailed: "STT 자동화 종료 실패",
      aiCleanupAutomationStopFailed: "AI cleanup 자동화 종료 실패",
      notionAutomationStopFailed: "Notion 자동 업로드 종료 실패",
      retentionAutomationStarted: "텍스트 보관 자동 정리를 시작했습니다.",
      retentionAutomationStopFailed: "텍스트 보관 자동 정리 중지 실패",
      aiLifecycleStopFailed: "AI lifecycle 종료 실패",
      aiPreparing: "AI 준비 중: {provider} / {model}",
      recordingCanStart: "녹음은 바로 시작할 수 있습니다.",
      aiStatus: "AI 상태: {message}",
      sttAutomationDisabled: "STT 자동 실행이 꺼져 있습니다. 수동 Phase 3 STT CLI는 계속 사용할 수 있습니다.",
      sttAutomationStarted: "STT 자동 실행 대기 시작: queued STT job을 처리합니다.",
      aiCleanupAutomationDisabled: "AI cleanup 자동 실행이 꺼져 있습니다. 수동 Phase 4 CLI는 계속 사용할 수 있습니다.",
      aiCleanupAutomationStarted: "AI cleanup 자동 실행 대기 시작: finalized 세션과 STT 완료를 기다립니다.",
      notionAutomationStarted: "Notion 자동 업로드 대기 시작: completed valid draft를 기다립니다.",
      notionAutomationWatchStarted: "Notion 자동 업로드 설정 감시 시작: {message}",
      notionSettingsApplyNextTick: "Notion 설정은 저장 후 다음 자동화 tick부터 반영됩니다.",
      aloneFinalizeDisabled: "혼자 남음 자동 종료가 꺼져 있습니다. 대시보드 설정에서 켤 수 있습니다.",
      aloneFinalizeStarted: "혼자 남음 자동 종료 대기 시작: non-bot 0명 상태가 {graceMs}ms 지속되면 finalize합니다.",
      activeGuildMissingDetail: "활성 녹음 세션의 Discord 서버 ID를 확인하지 못했습니다.",
      voiceChannelMissingDetail: "voice channel을 찾지 못했습니다: {voiceChannelId}",
      voiceMemberCacheEmptyDetail: "Discord voice member cache가 비어 있어 자동 종료하지 않았습니다.",
    },
    phaseCli: {
      phase2FakeTitle: "디롱이 Fake STT 결과",
      phase2UnknownOption: "알 수 없는 Phase 2 fake STT 옵션입니다: {flag}",
      phase3RealTitle: "디롱이 Real STT 결과",
      phase3UnknownOption: "알 수 없는 Phase 3 STT 옵션입니다: {flag}",
      phase4Title: "디롱이 Phase 4 AI cleanup 결과",
      phase4UnknownOption: "알 수 없는 Phase 4 AI cleanup 옵션입니다: {flag}",
      phase5Title: "디롱이 Phase 5 Notion upload 결과",
      phase5UnknownOption: "알 수 없는 Phase 5 Notion upload 옵션입니다: {flag}",
      sessionValueRequired: "--session 값이 필요합니다.",
      phase4SessionRequired: "--session <session-id> 값이 필요합니다.",
      modelValueRequired: "--model 값이 필요합니다.",
      draftValueRequired: "--draft 값이 필요합니다.",
      sttProviderInvalid: "--provider는 local-whisper 또는 openai여야 합니다.",
      aiProviderInvalid: "--provider 값은 settings, fake, claude-cli, claude-api, codex-cli, gemini-cli 중 하나여야 합니다.",
      smokeTestRequiresFake: "--smoke-test는 --provider fake와 함께 사용하는 명시적 smoke test 전용 옵션입니다.",
      includeFakeSttRequiresDryRun: "--include-fake-stt는 dry-run 진단 또는 --provider fake --smoke-test에서만 사용할 수 있습니다.",
      phase5SelectorRequired: "--session 또는 --draft 중 정확히 하나가 필요합니다.",
      fakeSttIncludedWarning: "주의: 테스트 전사용(fake STT) 입력이 포함되었습니다. 일반 회의록 생성 경로에서는 사용하지 마세요.",
      backupDryRunSkipped: "SQLite snapshot backup: dry-run에서는 생성하지 않음",
      realSttMissingDbBackup: "SQLite DB 파일이 아직 없어 backup을 만들지 않았습니다.",
      openAiDryRunKeyNotRequired: "OpenAI API key는 현재 provider dry-run에는 필요하지 않습니다.",
      repairTitle: "디롱이 Recording + STT repair 결과",
      repairNotice: "repair는 DB 상태를 수정할 수 있는 명시 명령입니다.",
    },
    argParser: {
      positiveIntegerRequired: "{flag} 값은 1 이상의 정수여야 합니다.",
    },
    sqliteBackup: {
      created: "SQLite snapshot backup 생성:",
    },
    media: {
      ffmpegMissing: "ffmpeg 실행 파일을 찾지 못했습니다.",
      fallbackUnknown: "알 수 없음",
      fallbackNotice: "기본 {preferredFormat} 변환 실패 후 {fallbackFormat}로 대체했습니다. 원인: {error}",
      defaultFormatFailed: "기본 포맷 실패",
      fallbackFailed: "fallback 실패",
      sttSafeFailed: "STT-safe 변환 실패: {firstError} / fallback: {fallbackError}",
      fileMissing: "파일이 없습니다.",
      fileEmpty: "파일 크기가 0바이트입니다.",
      validationFailed: "ffmpeg 검증 실패(exit={exitCode})",
    },
    discordCommands: {
      description: "디롱이 녹음과 STT pipeline",
      start: "현재 들어가 있는 음성 채널에서 녹음을 시작합니다.",
      stop: "진행 중인 녹음을 종료하고 열린 chunk를 정리합니다.",
      status: "현재 녹음, chunk, STT queue, repair 상태를 확인합니다.",
    },
    localSecretStore: {
      emptyValue: "secret value는 비워 둘 수 없습니다.",
      invalidRef: "secret ref는 영문, 숫자, 점, 밑줄, 콜론, 하이픈만 사용할 수 있습니다.",
    },
    setupGateway: {
      applicationBotMismatch: "Discord application ID와 bot token의 bot user가 서로 다릅니다.",
      botUserMissing: "Discord bot user를 확인하지 못했습니다.",
    },
    aiWorkflow: {
      fakeSttUnsafe: "fake STT는 실제 AI cleanup provider로 보낼 수 없습니다. 일반 회의록 생성에서는 Phase 3 Real STT 결과만 사용해 주세요. fake STT 검증은 dry-run 또는 --provider fake --smoke-test 경로에서만 허용됩니다.",
      emptyTimeline: "회의록으로 보낼 실제 STT 발화가 아직 없습니다. Phase 3 Real STT를 먼저 실행해 주세요. no_speech와 fake STT는 기본 Phase 4 입력에서 제외됩니다. 테스트 목적이면 dry-run에서 --include-fake-stt를 사용하거나, 명시적 smoke test로 --provider fake --smoke-test --include-fake-stt를 사용해 주세요.",
      inputTooLong: "회의 transcript가 Phase 4 MVP single-pass 한도를 초과했습니다. input={inputChars}, max={maxInputChars}. 긴 회의 map-reduce 요약은 Phase 4.1 이후 범위입니다.",
      repairFailed: "회의록 JSON schema 검증에 실패했고 자동 repair도 실패했습니다.",
    },
    fakeProvider: {
      draftTitle: "회의록 초안: {sessionId}",
      summary: "총 {entryCount}개의 transcript entry를 바탕으로 생성한 fake 회의록 초안입니다.",
      topicTitle: "회의 내용",
      removedChatterSummary: "Fake provider는 실제 잡담 제거를 수행하지 않았습니다.",
      keptBecause: "오프라인 검증용 deterministic draft입니다.",
    },
    aiProvider: {
      claudeCliMissing: "Claude CLI를 찾지 못했습니다. 터미널에서 {command} --version이 실행되는지 확인해 주세요. {error}",
      claudePreflightFailed: "Claude CLI preflight에 실패했습니다. 터미널에서 {command} --version을 확인해 주세요. {detail}",
      terminalCliMissing: "{provider}를 찾지 못했습니다. 터미널에서 {command} --version이 실행되는지 확인해 주세요. {error}",
      terminalPreflightFailed: "{provider} preflight에 실패했습니다. 터미널에서 {command} --version을 확인해 주세요. {detail}",
      streamProcessStarted: "Claude stream-json process 시작",
      firstStreamEventWaiting: "Claude 첫 stream 이벤트 대기 중",
      resultBoundaryReceived: "Claude result boundary 수신",
      streamProtocolFailed: "Claude stream-json protocol 실패",
      streamResponseReceiving: "Claude stream-json 응답 수신 중",
    },
    sttProvider: {
      localWhisperPreflightFailed: "local-whisper 실행 준비에 실패했습니다.",
      localWhisperTextMissing: "local-whisper wrapper stdout에서 JSON text 필드를 찾지 못했습니다.",
      noStdoutOrStderr: "stderr/stdout output 없음",
      openAiKeyMissing: "OpenAI API key가 저장되지 않아 실제 STT를 호출할 수 없습니다.",
      openAiFileTooLarge: "OpenAI STT 입력 파일이 25MB 제한을 초과했습니다: {bytes} bytes",
      openAiTextMissing: "OpenAI STT API 응답에 text 필드가 없습니다.",
      openAiNotCalled: "OpenAI API key가 저장되지 않아 OpenAI STT를 호출하지 않았습니다. local-whisper를 쓰려면 --provider local-whisper를 선택해 주세요.",
    },
    storage: {
      aiCleanupJobSaveFailed: "AI cleanup job 저장에 실패했습니다.",
      sttFailedCount: "STT 실패 {count}건",
      sttMissingInputCount: "STT 입력 파일 누락 {count}건",
      chunkMissingSttJobCount: "STT job 없는 chunk {count}개",
      chunkTranscodeFailedCount: "transcode 실패 chunk {count}개",
      chunkMissingSttAudioCount: "STT audio path 없는 chunk {count}개",
      chunkCreateMissing: "chunk 파일이 생성되지 않았습니다.",
      sttJobChunkMissing: "STT job의 chunk를 찾지 못했습니다: {chunkId}",
      chunkMissing: "chunk를 찾지 못했습니다: {chunkId}",
      transcriptSegmentSaveFailed: "transcript segment 저장에 실패했습니다: {jobId}",
      aiCleanupJobMissing: "AI cleanup job을 찾지 못했습니다: {jobId}",
      meetingNotesDraftSaveFailed: "meeting notes draft 저장에 실패했습니다.",
      sttInputAudioMissing: "STT input audio file이 없습니다.",
    },
    sqlite: {
      backupFailed: "SQLite backup 생성에 실패했습니다.",
      recordingRetry: "녹음 중이면 잠시 후 다시 시도해 주세요.",
      sttNotClaimed: "backup이 실패했으므로 STT job은 claim하지 않았고 attempts도 증가하지 않았습니다.",
      migrationBackupFailed: "SQLite migration backup 생성에 실패했습니다.",
      migrationAborted: "migration을 적용하지 않고 시작을 중단합니다.",
      schemaUnchanged: "backup이 실패했으므로 DB schema는 변경하지 않았습니다.",
    },
    repairScan: {
      preserveOrDeleteAction: "수동 확인 후 보존/삭제를 결정하세요.",
      ffmpegMissing: "startup repair에 필요한 FFmpeg가 없습니다.",
      stalePartOnly: "stale writing chunk에 final file은 없고 .part file만 남았습니다.",
      manualPlaybackAction: "파일을 직접 재생/보존할 수 있는지 수동 확인하세요.",
      staleFilesMissing: "stale writing chunk에 final file과 .part file이 모두 없습니다.",
      sttSafeFfmpegMissing: "STT-safe audio를 만들 FFmpeg가 없습니다.",
      finalizedRawMissing: "finalized chunk이지만 raw audio file이 없습니다.",
      orphanAudioFile: "audio file은 있지만 SQLite chunk row가 없습니다.",
    },
  },
  meetingNotesMarkdown: {
    draftTitle: "회의록 초안",
    summaryHeading: "요약",
    topicsHeading: "주요 주제",
    decisionsHeading: "결정 사항",
    actionItemsHeading: "할 일 목록",
    unresolvedHeading: "미해결/불확실한 항목",
    noiseHeading: "잡담/노이즈 처리",
    sourceTimelineHeading: "출처 타임라인",
    empty: "없음",
    decided: "확정",
    tentative: "잠정",
    ownerLabel: "담당",
    dueLabel: "기한",
    unspecified: "미지정",
    unresolvedLabel: "미해결",
    uncertainLabel: "불확실",
    reasonLabel: "이유",
    removedChatterPrefix: "제거/압축: ",
    keptBecausePrefix: "보존 이유: ",
    keptBecauseHeading: "보존 이유:",
    sourceLabel: "출처",
  },
  notionBlocks: {
    meetingInfoHeading: "회의 정보",
    meetingTimeLabel: "회의 시간",
    channelLabel: "채널",
    participantsLabel: "참여자",
    summaryHeading: "요약",
    topicsHeading: "주요 논의",
    decisionsHeading: "결정사항",
    actionItemsHeading: "할 일 목록",
    unresolvedHeading: "남은 질문",
    uncertaintyHeading: "불확실한 내용",
    noiseHeading: "노이즈 처리 메모",
    timelineHeading: "타임라인",
    dirongInfoHeading: "Dirong 정보",
    empty: "없음",
    decided: "확정",
    tentative: "잠정",
    ownerLabel: "담당",
    dueLabel: "기한",
    reasonLabel: "이유",
    removedChatterLabel: "제거/압축",
    keptBecauseLabel: "보존 이유",
    unspecified: "미지정",
    noContent: "내용 없음",
  },
  discordRuntime: {
    serverOnly: "Dirong은 Discord 서버 안에서만 사용할 수 있습니다.",
    guildNotAllowed: "이 Dirong 앱은 대시보드 설정에서 선택된 Discord 서버에서만 사용할 수 있습니다.",
    noVoiceChannel: "먼저 녹음할 Discord 음성 채널에 들어간 뒤 /dirong start를 실행해 주세요.",
    startPublicTitle: "디롱이가 이 음성 채널 녹음을 시작했습니다.",
    privacyAudioLocalDeleteAfterNotion: "음성 파일은 Dirong 실행 PC에 저장되며, Notion 업로드 완료 후 바로 삭제됩니다.",
    textRetentionDefault: "텍스트 처리 결과는 기본 30일 뒤 자동 삭제됩니다.",
    optOut: "참여를 원하지 않으면 음성 채널에서 나가 주세요.",
    startedBy: "시작자: {name}",
    sessionId: "세션 ID: {sessionId}",
    startConfirmation: "녹음을 시작했습니다.",
    session: "세션: {sessionId}",
    voiceChannel: "음성 채널: {channel}",
    dashboard: "Dashboard: {url}",
    stopPublicTitle: "디롱이가 녹음을 종료했습니다.",
    status: "상태: {status}",
    stopConfirmation: "녹음을 종료했습니다.",
    unknownSubcommand: "알 수 없는 하위 명령입니다.",
  },
  setup: {
    discord: {
      status: {
        notConfigured: {
          message: "Discord 봇 연결 설정이 아직 완료되지 않았습니다.",
          action:
            "설정에서 Discord application ID, bot token, 사용할 서버 선택을 완료해 주세요.",
        },
        ready: {
          message: "Discord 필수 설정이 저장되어 있습니다.",
        },
      },
      applicationId: {
        save: {
          done: {
            message: "Discord application ID를 저장했습니다.",
          },
        },
        error: {
          invalid: {
            message: "Discord application ID 형식이 올바르지 않습니다.",
            action: "Discord Developer Portal의 애플리케이션 ID 숫자를 다시 복사해 주세요.",
          },
        },
      },
      botToken: {
        save: {
          done: {
            message: "Discord bot token을 안전한 local secret file에 저장했습니다.",
          },
        },
        error: {
          missing: {
            message: "Discord bot token이 비어 있습니다.",
            action: "Discord Developer Portal의 Bot 화면에서 token을 다시 복사해 주세요.",
          },
        },
      },
      connection: {
        test: {
          done: {
            message:
              "애플리케이션 ID와 봇 토큰이 같은 디스코드 봇의 값인 것을 확인했습니다.",
          },
        },
        error: {
          notConfigured: {
            message: "Discord 연결 테스트에 필요한 값이 아직 없습니다.",
            action: "application ID와 bot token을 먼저 저장해 주세요.",
          },
          failed: {
            message: "Discord 연결 테스트에 실패했습니다.",
            action: "bot token을 다시 발급했는지, application ID가 같은 봇의 값인지 확인해 주세요.",
          },
        },
      },
      guilds: {
        list: {
          done: {
            message: "Dirong 봇이 들어간 Discord 서버 목록을 불러왔습니다.",
          },
          empty: {
            action: "생성된 초대 링크로 사용할 Discord 서버에 Dirong 봇을 먼저 추가해 주세요.",
          },
        },
        error: {
          notConfigured: {
            message: "Discord 서버 목록을 불러오려면 bot token이 필요합니다.",
            action: "Discord bot token을 먼저 저장해 주세요.",
          },
          failed: {
            message: "Discord 서버 목록을 불러오지 못했습니다.",
            action: "bot token이 유효한지, 봇이 서버에 초대되어 있는지 확인해 주세요.",
          },
        },
      },
      guildAllowlist: {
        save: {
          done: {
            message: "녹음을 허용할 Discord 서버를 저장했습니다.",
          },
        },
        error: {
          invalid: {
            message: "선택한 Discord 서버 값이 올바르지 않습니다.",
            action: "서버 목록에서 Dirong을 사용할 서버를 다시 선택해 주세요.",
          },
          notInBotGuilds: {
            message: "선택한 서버 중 Dirong 봇이 들어가 있지 않은 서버가 있습니다.",
            action: "초대 링크로 해당 서버에 봇을 추가한 뒤 서버 목록을 다시 불러와 주세요.",
          },
        },
      },
    },
    recording: {
      status: {
        blocked: {
          message: "녹음 시작은 Discord와 STT 설정이 끝난 뒤 사용할 수 있습니다.",
          action: "Discord 봇 연결과 STT provider 설정을 먼저 완료해 주세요.",
        },
        ready: {
          message: "녹음 시작에 필요한 기본 설정이 준비되어 있습니다.",
        },
      },
      aloneFinalize: {
        save: {
          done: {
            message: "자동 종료 대기시간을 저장했습니다.",
          },
        },
        error: {
          invalidGrace: {
            message: "자동 종료 대기시간 값이 올바르지 않습니다.",
            action: "5초 이상 3600초 이하로 입력해 주세요.",
          },
        },
      },
    },
    stt: {
      status: {
        notConfigured: {
          message: "STT provider와 모델 설정이 아직 저장되지 않았습니다.",
          action:
            "설정 위자드에서 local faster-whisper 또는 OpenAI STT를 선택해 주세요.",
        },
        openAiApiKeyMissing: {
          message: "OpenAI STT API key가 아직 저장되지 않았습니다.",
          action: "OpenAI STT를 계속 쓰려면 API key를 다시 입력해 주세요.",
        },
        ready: {
          message: "STT 기본 설정이 저장되어 있습니다.",
        },
      },
      settings: {
        save: {
          done: {
            message: "STT provider와 모델 설정을 저장했습니다.",
          },
        },
        error: {
          invalidProvider: {
            message: "지원하지 않는 STT provider입니다.",
            action: "local-whisper 또는 openai 중 하나를 선택해 주세요.",
          },
          invalidModel: {
            message: "STT 모델명이 올바르지 않습니다.",
            action: "small, medium 또는 사용할 provider의 모델명을 다시 선택해 주세요.",
          },
          invalidCommand: {
            message: "허용되지 않는 STT 실행 command입니다.",
            action: "대시보드에서는 기본 local-whisper profile만 사용할 수 있습니다.",
          },
          invalidLanguage: {
            message: "받아쓰기·회의록 언어 값이 올바르지 않습니다.",
            action: "한국어(ko) 또는 영어(en) 중 하나를 선택해 주세요.",
          },
          invalidTimeout: {
            message: "STT 처리 제한 시간 값이 올바르지 않습니다.",
            action: "5000ms부터 600000ms 사이의 값을 입력해 주세요.",
          },
        },
      },
      openAiTest: {
        done: {
          message: "OpenAI STT 연결을 확인하고 설정을 저장했습니다.",
        },
        error: {
          missingKey: {
            message: "OpenAI API key가 입력되지 않았습니다.",
            action: "OpenAI STT를 사용하려면 API key를 입력해 주세요.",
          },
          failed: {
            message: "OpenAI STT 연결 확인에 실패했습니다.",
            action: "API key, 모델, 네트워크 상태를 확인한 뒤 다시 시도해 주세요.",
          },
        },
      },
    },
    ai: {
      status: {
        notConfigured: {
          message: "AI 회의록 provider 설정이 아직 저장되지 않았습니다.",
          action: "설정 위자드에서 Claude, Codex, Gemini 중 사용할 provider를 선택해 주세요.",
        },
        claudeApiKeyMissing: {
          message: "Claude API key가 아직 저장되지 않았습니다.",
          action: "Claude API key를 다시 입력하거나 Claude CLI 모드로 바꿔 주세요.",
        },
        claudeCliCommandMissing: {
          message: "Claude CLI command가 아직 저장되지 않았습니다.",
          action: "Claude CLI 모드를 쓰려면 실행 command를 저장해 주세요.",
        },
        cliCommandMissing: {
          message: "AI provider CLI command가 아직 저장되지 않았습니다.",
          action: "터미널 provider를 쓰려면 실행 command를 저장해 주세요.",
        },
        ready: {
          message: "AI 회의록 provider 설정이 저장되어 있습니다.",
        },
      },
      claude: {
        save: {
          done: {
            message: "AI provider 설정을 저장했습니다.",
          },
        },
        test: {
          done: {
            message: "AI provider 연결 테스트를 완료했습니다.",
          },
          error: {
            notConfigured: {
              message: "AI provider 연결 테스트에 필요한 설정이 아직 없습니다.",
              action: "AI provider와 실행 방식을 먼저 저장해 주세요.",
            },
            failed: {
              message: "AI provider 연결 테스트에 실패했습니다.",
              action: "CLI command가 실행되는지 또는 API key가 유효한지 확인해 주세요.",
            },
          },
        },
        error: {
          invalidMode: {
            message: "지원하지 않는 AI provider 사용 방식입니다.",
            action: "Claude는 cli/api, Codex와 Gemini는 cli를 선택해 주세요.",
          },
          apiKeyMissing: {
            message: "Claude API key가 비어 있습니다.",
            action: "Claude API 모드를 쓰려면 API key를 입력해 주세요.",
          },
          invalidCommand: {
            message: "허용되지 않는 AI CLI command입니다.",
            action: "대시보드에서는 기본 Claude, Codex, Gemini CLI profile만 사용할 수 있습니다.",
          },
          invalidModel: {
            message: "지원하지 않는 AI provider 모델입니다.",
            action: "Claude는 haiku, sonnet, opus 중 하나를, Codex/Gemini는 default 또는 안전한 모델 이름을 선택해 주세요.",
          },
        },
      },
    },
    notion: {
      status: {
        notConfigured: {
          message: "Notion 연결 설정이 아직 완료되지 않았습니다.",
          action: "Notion internal connection token과 노션 DB 관리 페이지 URL을 저장해 주세요.",
        },
        registryMissing: {
          message: "Notion 연결 값은 있지만 managed DB registry가 아직 없습니다.",
          action:
            "위자드의 managed DB 생성 단계에서 회의록, 작업자, 할 일 목록 DB 세트를 생성해 주세요.",
        },
        registryPartial: {
          message: "Notion managed DB registry가 일부만 저장되어 업로드를 막았습니다.",
          action:
            "기존 DB나 필드는 자동 수정하지 않습니다. Notion 설정/복구 화면에서 registry 상태를 확인해 주세요.",
        },
        ready: {
          message: "Notion managed DB registry가 준비되어 있습니다.",
        },
      },
      token: {
        save: {
          done: {
            message: "Notion internal connection token을 안전한 local secret file에 저장했습니다.",
          },
        },
        error: {
          missing: {
            message: "Notion token이 비어 있습니다.",
            action: "Notion internal connection 설정에서 token을 다시 복사해 주세요.",
          },
        },
      },
      parentPage: {
        save: {
          done: {
            message: "노션 DB 관리 페이지 URL을 저장했습니다.",
          },
        },
        verify: {
          done: {
            message: "노션 DB 관리 페이지 접근 권한을 확인했습니다.",
          },
          error: {
            notConfigured: {
              message: "노션 DB 관리 페이지 검증에 필요한 값이 아직 없습니다.",
              action: "Notion token과 노션 DB 관리 페이지 URL을 먼저 저장해 주세요.",
            },
            failed: {
              message: "노션 DB 관리 페이지에 접근하지 못했습니다.",
              action: "해당 page에 Dirong internal connection을 Add connection으로 공유했는지 확인해 주세요.",
            },
          },
        },
        error: {
          invalid: {
            message: "노션 DB 관리 페이지 URL 형식이 올바르지 않습니다.",
            action: "데이터베이스 링크가 아니라 디롱이가 DB를 만들 노션 페이지 링크를 복사해 주세요.",
          },
        },
      },
      uploadMode: {
        save: {
          done: {
            message: "Notion 업로드 모드를 저장했습니다.",
          },
        },
        error: {
          invalid: {
            message: "Notion 업로드 모드 값이 올바르지 않습니다.",
            action: "자동 또는 수동 중 하나를 골라 다시 저장해 주세요.",
          },
        },
      },
      managedDatabases: {
        create: {
          done: {
            message: "Notion managed DB 세트를 생성하고 registry에 저장했습니다.",
          },
          existing: {
            message: "이미 Notion managed DB registry가 준비되어 있습니다.",
          },
        },
        error: {
          registryMissing: {
            message: "Notion registry 저장소가 dashboard에 연결되어 있지 않습니다.",
            action: "SQLite registry가 연결된 상태로 dashboard를 시작해 주세요.",
          },
          partialRegistry: {
            message: "일부 Notion registry 값이 이미 있어 새 DB 생성을 막았습니다.",
            action: "후속 복구 화면에서 registry 상태를 확인한 뒤 다시 진행해 주세요.",
          },
          localeUnsupported: {
            message: "현재 선택한 언어의 Notion schema preset은 아직 생성할 수 없습니다.",
            action: "MVP에서는 한국어 schema preset으로 먼저 진행해 주세요.",
          },
          failed: {
            message: "Notion managed DB 생성에 실패했습니다.",
            action: "노션 DB 관리 페이지 공유 권한과 Notion token을 확인한 뒤 다시 시도해 주세요.",
          },
        },
      },
    },
    project: {
      name: {
        save: {
          done: {
            message: "프로젝트 이름을 저장했습니다.",
            action:
              "디롱이를 재시작해 주세요. 대시보드를 닫아도 서버는 계속 실행됩니다. 종료하려면 실행 콘솔에서 exit를 입력해 주세요.",
          },
        },
        error: {
          invalid: {
            message: "프로젝트 이름이 올바르지 않습니다.",
            action: "1자 이상 80자 이하로 입력해 주세요.",
          },
          missingProject: {
            message: "이름을 저장할 active project가 없습니다.",
            action: "프로젝트를 만든 뒤 다시 시도해 주세요.",
          },
        },
      },
    },
    dataRetention: {
      status: {
        ready: {
          message: "기본 보관 정책이 적용되어 있습니다.",
        },
      },
      save: {
        done: {
          message: "텍스트·초안 보관 일수를 저장했습니다.",
        },
      },
      error: {
        invalidDays: {
          message: "보관 일수는 1일부터 365일 사이여야 합니다.",
          action: "1에서 365 사이의 숫자를 입력해 주세요.",
        },
      },
    },
    runtimeEffect: {
      dashboard: {
        currentProcess: {
          message: "이 설정은 현재 대시보드에 바로 반영됩니다.",
        },
      },
      discord: {
        restartRequired: {
          message: "저장은 완료됐지만 현재 Discord 봇 로그인에는 자동 반영되지 않습니다.",
          action: "진행 중인 녹음 세션을 깨지 않도록 앱을 다시 시작할 때 적용됩니다.",
        },
      },
      recording: {
        restartRequired: {
          message: "저장은 완료됐지만 현재 자동 종료 타이머에는 자동 반영되지 않습니다.",
          action: "진행 중인 녹음 세션을 보존하려면 앱을 다시 시작해 적용해 주세요.",
        },
      },
      stt: {
        restartRequired: {
          message: "저장은 완료됐지만 현재 STT 자동화 provider에는 자동 반영되지 않습니다.",
          action: "진행 중인 녹음/변환을 보존하려면 앱을 다시 시작해 적용해 주세요.",
        },
      },
      ai: {
        restartRequired: {
          message: "저장은 완료됐지만 현재 AI provider 프로세스에는 자동 반영되지 않습니다.",
          action: "진행 중인 AI 작업을 보존하려면 앱을 다시 시작해 적용해 주세요.",
        },
      },
      notion: {
        nextTick: {
          message: "Notion 설정은 다음 대시보드 작업 또는 자동화 tick부터 새 값으로 반영됩니다.",
        },
      },
    },
  },
  dashboard: {
    app: {
      title: "Dirong Dashboard",
      subtitle: "녹음부터 Notion 업로드까지 현재 상태를 확인합니다.",
      generatedAt: "업데이트",
    },
    sidebar: {
      projects: { label: "PROJECTS" },
      servers: { label: "SERVERS" },
      sections: { label: "SECTIONS" },
      quick: { label: "QUICK" },
    },
    server: {
      current: "현재 서버",
      unselected: "서버 미선택",
      add: { action: "+ 서버 추가" },
    },
    nav: {
      dashboard: "대시보드",
      databaseSettings: "DB 설정",
      logs: "로그",
      settings: "설정",
    },
    quick: {
      startRecording: "녹음 시작",
      startRecordingHint: "/dirong start는 Discord에서 실행합니다.",
      refreshStatus: "상태 다시 확인",
    },
    projects: {
      empty: "프로젝트 없음",
      add: "+ 프로젝트 추가",
      adding: "추가 중...",
      nameLabel: "프로젝트 이름",
      namePlaceholder: "예: 주간 회의",
      create: "만들기",
      cancel: "취소",
      active: "active",
      activeContext: "active project",
      noActive: "활성 프로젝트가 없습니다.",
      unavailable: "project list",
      switching: "switching",
      actionDone: "project update",
      actionBlocked: "project blocked",
      switchDone: "활성 프로젝트를 전환했습니다.",
      createDone: "새 프로젝트를 만들고 활성화했습니다.",
      createReused: "프로젝트를 활성화했습니다.",
      guildMissing: "서버 미선택",
      commandEnabled: "command on",
      commandDisabled: "command off",
      notion: {
        ready: "Notion ready",
        partial: "Notion partial",
        missing: "Notion setup",
      },
      lifecycle: {
        draft: "draft",
        ready: "ready",
        archived: "archived",
        resetting: "resetting",
      },
      blockReasons: {
        already_switching: "다른 프로젝트 전환이 진행 중입니다.",
        project_not_found: "프로젝트를 찾을 수 없습니다.",
        project_archived: "보관된 프로젝트는 활성화할 수 없습니다.",
        project_resetting: "초기화 중인 프로젝트는 활성화할 수 없습니다.",
        recording_active: "녹음 중에는 프로젝트를 전환할 수 없습니다.",
        notion_upload_in_flight: "Notion 업로드 중에는 프로젝트를 전환할 수 없습니다.",
        ai_cleanup_in_flight: "AI cleanup 중에는 프로젝트를 전환할 수 없습니다.",
      },
    },
    setupIncomplete: {
      banner: {
        title: "설정이 아직 끝나지 않았습니다.",
        description: "디롱이를 사용하려면 첫 설정을 완료해 주세요.",
        action: "이어서 설정하기",
      },
      lockedTitle: "잠긴 기능",
    },
    setupWizard: {
      title: "첫 설정 위자드",
      loading: "설정 상태 API를 기다리는 중입니다.",
      fetchFailed: "설정 상태를 불러오지 못했습니다.",
      intro:
        "처음 사용하는 사람도 토큰, 서버 선택, STT, AI provider, Notion 생성을 대시보드에서 차근차근 끝낼 수 있게 안내합니다.",
      progress: "{completed} / {total}",
      steps: {
        language: "언어 선택",
        discord: "디스코드 봇 연결",
        guild: "디스코드 서버 선택",
        stt: "STT provider/model 선택",
        ai: "AI provider 선택",
        notionToken: "Notion token 입력",
        notionParent: "노션 DB 관리 페이지 URL 입력",
        notionManaged: "managed DB 생성",
        projectName: "프로젝트 이름 설정",
      },
      actions: {
        goDashboard: "대시보드로 가기",
        skipToDashboard: "나중에 설정하고 대시보드 보기",
        next: "다음",
        continue: "계속",
        saveLanguage: "언어 저장",
        saveDiscordApplicationId: "애플리케이션 ID 저장",
        saveDiscordBotToken: "봇 토큰 저장",
        testConnection: "연결 확인",
        loadGuilds: "서버 목록 불러오기",
        saveSelectedGuild: "선택한 서버 저장",
        saveStt: "STT 설정 저장",
        saveAndInstallStt: "저장하고 설치",
        saveAndTestOpenAi: "저장하고 연결 테스트",
        saveClaude: "AI 설정 저장",
        saveNotionToken: "Notion token 저장",
        saveParentPage: "DB 관리 페이지 URL 저장",
        verifyAccess: "접근 확인",
        createManagedDb: "managed DB 생성",
        saveProjectName: "프로젝트 이름 저장",
        restartFromBeginning: "처음부터 다시 보기",
      },
      fallback: {
        defaultsMissing: "서버 기본값을 아직 불러오지 못했습니다.",
        retryLater: "잠시 후 다시 시도해 주세요.",
        checkDiscordToken: "디스코드 봇 토큰 저장 상태를 확인해 주세요.",
      },
      language: {
        title: "앱 언어를 선택해 주세요",
        description:
          "현재 버전에서는 앱 언어, 위자드 언어, Notion schema locale을 같은 값으로 저장합니다.",
        korean: {
          title: "한국어",
          description:
            "디스코드 음성 채팅방에서 진행한 회의를 노션에 자동으로 등록하고, 할 일 목록 정리를 이어갈 수 있게 돕습니다.",
        },
        english: {
          title: "English",
          description:
            "대시보드, 설정 위자드, Notion DB preset을 영어로 저장합니다.",
        },
        englishNotice:
          "English를 선택하면 Notion schema locale도 en으로 저장되어 managed Notion DB가 영어 이름으로 생성됩니다.",
      },
      discord: {
        title: "디스코드 봇을 연결합니다",
        description:
          "Discord Developer Portal(디스코드 개발자 페이지)에서 만든 애플리케이션 ID와 봇 토큰을 저장합니다. 토큰은 저장 후 다시 표시하지 않습니다.",
        applicationIdLabel: "디스코드 애플리케이션 ID",
        applicationIdPlaceholder: "숫자로 된 애플리케이션 ID",
        botTokenLabel: "디스코드 봇 토큰",
        botTokenPlaceholder: "저장 후 화면에 다시 표시되지 않습니다",
        inviteLabel: "초대 링크",
        inviteLink: "디스코드 서버에 Dirong 봇 추가",
        connectionCheck: {
          title: "연결 확인",
          description:
            "애플리케이션 ID와 봇 토큰이 같은 디스코드 봇의 값인지 확인합니다. 성공하면 다음 단계에서 봇이 들어간 서버를 선택합니다.",
          checkingTitle: "연결을 확인하고 있습니다",
          checkingDescription:
            "애플리케이션 ID와 봇 토큰이 같은 디스코드 봇의 값인지 자동으로 확인하는 중입니다.",
          verifiedTitle: "연결 확인 완료",
          verifiedDescription:
            "같은 디스코드 봇의 값인 것을 확인하였습니다. 다음으로 넘어가시면 됩니다.",
          failedTitle: "연결을 확인하지 못했습니다",
          failedDescription:
            "애플리케이션 ID와 봇 토큰이 같은 봇의 값인지 다시 확인해 주세요. 값을 다시 저장하면 자동으로 다시 확인합니다.",
        },
        guide: {
          portalLink: "Discord Developer Portal(디스코드 개발자 페이지)",
          applicationIdTitle: "애플리케이션 ID 발급 방법",
          applicationIdStep1Suffix: "에 접속합니다.",
          applicationIdStep2: "왼쪽 메뉴에서 애플리케이션을 클릭합니다.",
          applicationIdStep3: "신규 애플리케이션 버튼을 클릭해 애플리케이션을 만듭니다.",
          applicationIdStep4: "애플리케이션을 연 뒤 왼쪽 메뉴에서 일반 정보를 클릭합니다.",
          applicationIdStep5: "애플리케이션 ID 항목의 복사 버튼을 클릭합니다.",
          applicationIdStep6:
            "디롱이 페이지로 돌아와 디스코드 애플리케이션 ID 칸에 붙여넣고 저장합니다.",
          botTokenTitle: "애플리케이션 ID 발급 후 봇 토큰 복사 방법",
          botTokenStep1: "같은 애플리케이션의 왼쪽 메뉴에서 봇을 클릭합니다.",
          botTokenStep2: "토큰 초기화를 클릭해 새 봇 토큰을 발급합니다.",
          botTokenStep3:
            "다단계 인증 창이 열리면 로그인 비밀번호를 입력해 인증합니다.",
          botTokenStep4: "새로 발급된 토큰의 복사 버튼을 클릭합니다.",
          botTokenStep5:
            "디롱이 페이지로 돌아와 디스코드 봇 토큰 칸에 붙여넣고 저장합니다.",
        },
      },
      guild: {
        title: "녹음을 허용할 디스코드 서버를 선택합니다",
        description:
          "봇이 들어간 서버 이름만 보여줍니다. 서버 ID는 직접 입력하지 않습니다.",
        empty: "아직 서버 목록을 불러오지 않았습니다.",
        invite: {
          title: "서버에 봇 추가",
          description:
            "서버 목록에 원하는 서버가 보이지 않으면 초대 링크로 Dirong 봇을 먼저 추가한 뒤 서버 목록을 다시 불러와 주세요.",
          link: "디스코드 서버에 Dirong 봇 추가",
        },
      },
      stt: {
        title: "STT provider와 모델을 선택합니다",
        description:
          "기본 추천은 내 PC에서 처리하는 local faster-whisper입니다. OpenAI STT는 API 발급이 필요한 유료 고급 대안입니다.",
        localWhisper: {
          title: "추천: local faster-whisper",
          description: "무료이며 음성이 외부 STT API로 전송되지 않습니다.",
          install: {
            title: "local Whisper 준비",
            idle: "모델을 선택한 뒤 저장하고 설치를 누르면 Python, faster-whisper, 모델 파일을 확인합니다.",
            runningTitle: "local Whisper 준비 중",
            doneTitle: "local Whisper 준비 완료",
            failedTitle: "local Whisper 준비 실패",
            lastLog: "마지막 로그 보기",
            stages: {
              idle: "아직 설치를 시작하지 않았습니다.",
              checking_python: "Python 실행 환경을 확인하고 있습니다.",
              creating_venv: "앱 전용 Python 환경을 만들고 있습니다.",
              installing_package: "faster-whisper를 설치하고 있습니다.",
              checking_package: "faster-whisper 설치 상태를 확인하고 있습니다.",
              downloading_model: "선택한 Whisper 모델을 다운로드하고 있습니다.",
              checking_model: "다운로드한 모델을 로드해 확인하고 있습니다.",
              done: "local Whisper를 사용할 준비가 끝났습니다.",
              failed: "local Whisper 준비에 실패했습니다.",
            },
          },
        },
        openAi: {
          title: "고급: OpenAI STT 사용 (API 발급 필요 - 유료)",
          description:
            "처리는 쉬울 수 있지만 API 비용이 발생하고 음성이 OpenAI로 전송됩니다.",
          apiKeyLabel: "OpenAI API key",
          apiKeyPlaceholder: "API 발급 필요 - 유료",
        },
        smallModel: {
          title: "추천: 빠름",
          description: "small / cpu / int8. 대부분의 PC에 먼저 권장합니다.",
        },
        mediumModel: {
          title: "정확도 우선",
          description:
            "medium / cpu / int8. 더 느릴 수 있지만 한국어 회의 품질이 좋아질 수 있습니다.",
        },
      },
      ai: {
        title: "AI 회의록 provider를 선택합니다",
        description:
          "Claude, Codex, Gemini 터미널 provider를 사용할 수 있습니다. Claude는 API 모드도 지원합니다.",
        cli: {
          title: "터미널 CLI 사용",
          description: "로컬 Claude, Codex, Gemini command를 실행해 회의록을 만듭니다.",
        },
        api: {
          title: "Claude API 사용",
          description: "API key를 저장해 회의록을 만듭니다.",
          apiKeyLabel: "Claude API key",
        },
        apiKeyPlaceholder: "저장 후 화면에 다시 표시되지 않습니다",
        modelLabel: "Model (선택)",
        providerLabel: "Provider",
        providers: {
          claude: "Claude",
          codex: "Codex",
          gemini: "Gemini",
        },
        models: {
          default: "default",
          haiku: "haiku",
          sonnet: "sonnet",
          opus: "opus",
        },
      },
      notionToken: {
        title: "Notion 연결 액세스 토큰을 입력합니다",
        description:
          "Notion Developers에서 새 연결을 만든 뒤 액세스 토큰을 복사해 붙여넣습니다. Token은 local secret file에 저장되고 원문은 다시 표시하지 않습니다.",
        label: "Notion token",
        placeholder: "secret_ 또는 ntn_ token",
        guide: {
          title: "Notion 토큰 발급 받는 방법",
          profileLink: "Notion Developers",
          step1Suffix: "에 접속합니다.",
          step2: "메뉴에서 시작하기를 클릭합니다.",
          step3: "연결 만들기에서 + 신규 연결 버튼을 클릭합니다.",
          step4:
            "연결 이름은 헷갈리지 않도록 봇 이름으로 적고, 인증 방법은 액세스 토큰을 선택합니다.",
          step5:
            "설치 가능 워크스페이스는 회의록을 작성할 워크스페이스로 선택한 뒤 연결 생성하기를 클릭합니다.",
          step6: "메뉴에서 연결을 클릭하고 방금 만든 연결의 관리하기 버튼을 클릭합니다.",
          step7: "액세스 토큰 칸의 복사 버튼을 클릭합니다.",
          step8: "디롱이 페이지로 돌아와 Notion token 칸에 붙여넣습니다.",
        },
      },
      notionParent: {
        title: "노션 DB 관리 페이지 URL을 입력합니다",
        description:
          "디롱이가 사용하는 회의록, 작업자, 할 일 목록 DB를 만들 노션 페이지 주소를 입력해 주세요. 아직 없다면 노션에서 빈 페이지를 하나 만든 뒤 그 페이지 주소를 붙여넣어 주세요.",
        label: "노션 DB 관리 페이지 URL",
        placeholder: "https://www.notion.so/...",
      },
      notionManaged: {
        title: "Notion managed DB 세트를 생성합니다",
        description:
          "사용자는 database id, data source id, property id를 입력하지 않습니다. Dirong이 생성 결과를 registry에 저장합니다.",
        unsupportedNotice:
          "현재 앱 언어와 Notion schema locale은 {locale}입니다. 이 locale의 managed Notion DB preset을 찾지 못했습니다.",
        readyNotice:
          "이 버튼은 노션 DB 관리 페이지 안에 회의록, 작업자, 할 일 목록 DB를 만들고 registry에 내부 mapping을 저장합니다.",
        openInNotion: "Notion에서 열기",
      },
      projectName: {
        title: "디롱이 프로젝트 이름을 정합니다",
        description: "디롱이에서 사용할 프로젝트 이름을 입력해주세요.",
        label: "프로젝트 이름",
        placeholder: "예: 주간 운영 회의",
        restartTitle: "설정이 끝났습니다",
        restartDescription:
          "변경된 설정을 적용하려면 디롱이를 재시작해 주세요. 대시보드를 닫아도 서버는 계속 실행됩니다. 종료하려면 실행 콘솔에서 exit를 입력해 주세요.",
      },
      features: {
        discord: "Discord",
        recording: "Recording",
        stt: "STT",
        ai: "AI",
        notion: "Notion",
        dataRetention: "Data retention",
      },
    },
    pipeline: {
      currentSession: "현재 세션",
      noRecentSession: "최근 세션 없음",
      startsAfterRecording: "녹음이 시작되면 여기에 진행 상태가 표시됩니다.",
      recording: "녹음 중",
      draftDone: "회의록 draft 생성 완료",
      aiRunning: "회의록 생성 중",
      aiQueued: "AI cleanup job 대기 중",
      aiRetryQueued: "회의록 재시도 대기 중 ({attempts}/{maxAttempts})",
      aiBlocked: "회의록 생성 보류",
      aiFailed: "회의록 생성 실패",
      sttRunning: "STT 처리 중",
      sttNeedsAttention: "STT 확인 필요",
      aiWaiting: "AI cleanup 대기 중",
      aiJob: "AI job",
      sessionStatus: "세션 상태",
      sttCounts: "STT 상태",
    },
    automation: {
      aiReadinessMissing: "AI 준비 상태 snapshot이 아직 없습니다.",
      sttMissing: "STT 자동화 snapshot이 아직 없습니다.",
      aiCleanupMissing: "AI cleanup 자동화 snapshot이 아직 없습니다.",
      unavailable: "사용할 수 없음",
      notChecked: "아직 확인 안 됨",
      checkedAt: "확인 시각",
      runStats: "실행 결과",
      examined: "확인",
      done: "완료",
      missing: "누락",
      failed: "실패",
      more: "추가 대기",
      yes: "예",
      no: "아니요",
      progress: "진행",
      elapsed: "경과",
      lines: "줄",
      bytes: "bytes",
      last: "마지막",
      repair: "복구",
      details: "자동화 세부정보",
      retrying: "재시도 대기 중 ({attempts}/{maxAttempts})",
      retry: "다시 시도",
      retryRequested: "재시도 요청 중...",
      failureReason: "실패 원인",
      sttDone: "STT 완료",
      sttFailed: "STT 실패",
      sttMissingFile: "음성 파일 없음",
      realTranscript: "실제 발화",
    },
    notionUploadPanel: {
      unavailable: "Notion 상태를 아직 불러오지 못했습니다.",
      openPage: "Notion 페이지 열기",
      lastError: "마지막 오류",
      automation: "자동화",
      latestDetails: "최근 Notion write 자세히 보기",
      send: "Notion으로 보내기",
      retry: "다시 시도",
      failureReason: "업로드 실패 원인",
      pageReady: "페이지 준비됨",
    },
    notionManual: {
      review: "회의록 확인",
      upload: "회의록 올리기",
    },
    status: {
      recording: { label: "녹음 연결" },
      stt: { label: "텍스트 변환" },
      ai: { label: "AI" },
      notion: { label: "Notion" },
      value: {
        ready: "준비됨",
        connected: "연결됨",
        checking: "확인 중",
        processing: "처리 중",
        warning: "확인 필요",
        blocked: "막힘",
        notConfigured: "설정 필요",
        idle: "대기 중",
        recording: "녹음 중",
        done: "완료",
        failed: "실패",
        disabled: "비활성",
        manual: "수동",
      },
    },
    card: {
      participants: {
        title: "참여자",
        empty: "녹음이 시작되면 참여자가 표시됩니다.",
        botSuffix: "(봇)",
      },
      recording: {
        title: "녹음 / 텍스트 변환",
        idle: "녹음 대기 중",
        active: "녹음 중...",
        ended: "녹음 종료",
        audioFiles: "음성 파일 {count}개",
        sttSummary: "변환 성공 {done}개 · 실패 {failed}개",
      },
      aiNotes: {
        title: "AI 회의록 작성",
        waiting: "AI 회의록 대기",
        processing: "AI가 회의록을 작성 중...",
        retrying: "회의록을 다시 시도하는 중...",
        done: "회의록 작성 완료",
        failed: "회의록 작성 확인 필요",
      },
      notionUpload: {
        title: "Notion 업로드",
        waiting: "Notion 업로드 대기",
        processing: "Notion 업로드 중...",
        done: "Notion 업로드 완료",
        failed: "Notion 업로드 실패: 다시 확인 필요",
      },
    },
    audio: {
      title: "오디오 / 변환 텍스트",
      empty: "아직 표시할 오디오나 변환 텍스트가 없습니다.",
      transcriptToggle: "변환 텍스트 보기",
      playback: {
        pending: "준비 중",
        sttSafe: "변환용 오디오",
        raw: "원본 오디오",
      },
      summary: {
        speakerUtterances: "{name}님의 발화: {count}개",
        sttDone: "변환 성공: {count}개",
        sttFailed: "변환 실패: {count}개",
      },
    },
    notes: {
      title: "회의록",
      empty: "AI가 회의 내용을 정리한 회의록 초안이 생성되면 여기에 표시됩니다.",
    },
    db: {
      tabs: {
        meeting: "회의록",
        members: "작업자",
        actionItems: "할 일 목록",
        customFields: "사용자 필드",
        customDb: "+ DB 추가",
      },
      status: {
        title: "DB 상태",
      },
      registry: {
        title: "Notion DB 연결 상태",
        missing: "아직 Notion DB 연결 정보가 없습니다.",
        summary: "Notion DB {databaseCount}/{expectedDatabaseCount}개 · 필드 연결 {mappingCount}/{expectedMappingCount}개",
        parentPage: "노션 DB 관리 페이지",
        actionItemsReady: "할 일 목록 DB가 준비되면 업로드 시 할 일 페이지를 생성하거나 갱신합니다.",
        fieldMappings: "필드 연결",
      },
      requiredFields: {
        title: "필수 필드",
        info: "필수 필드는 Dirong이 회의록을 올릴 때 사용하는 연결 정보입니다. Notion에서 이름을 바꾸거나 타입을 바꾸면 업로드가 동작하지 않을 수 있습니다.",
        repairAction: "누락된 필수 필드 복구",
        repairComingSoon: "필수 필드 복구 동작은 후속 단계에서 연결됩니다. 지금은 Notion 상태 다시 확인에서 누락 항목을 확인해 주세요.",
        missingSummary: "필수 필드 {count}개가 없습니다.",
        repairHelp: "저장된 연결 정보와 실제 Notion 필드 상태를 구분해서 확인해 주세요.",
        registryLabel: "저장된 연결 정보",
        remoteLabel: "마지막 Notion 확인",
        lastChecked: "마지막 확인",
        notChecked: "아직 확인하지 않음",
        checkAction: "Notion 상태 다시 확인",
        checking: "Notion 상태를 다시 확인하는 중...",
        repairing: "필수 필드를 복구하는 중...",
        checkFailed: "Notion 확인 실패",
        planTitle: "복구 계획",
        planMissing: "Notion 상태 확인 전에는 적용할 복구 계획이 없습니다.",
        planReady: "자동 복구 작업 {count}개를 적용할 수 있습니다.",
        planEmpty: "자동 복구할 필수 필드가 없습니다.",
        planBlocked: "수동 확인이 필요한 항목이 있습니다.",
        stalePlanMessage: "Managed schema repair plan이 최신 상태가 아닙니다.",
        stalePlanAction: "Notion 상태를 다시 확인한 뒤 복구 계획을 다시 적용해 주세요.",
        operations: "적용 작업",
        blockedItems: "수동 확인",
        confirmRepair: "표시된 복구 계획을 Notion에 적용할까요?",
        locked: "잠금",
        normal: "정상",
        missing: "누락",
        remoteStatus: {
          unchecked: "아직 확인하지 않음",
          checking: "확인 중",
          healthy: "정상",
          needsRepair: "복구 필요",
          manualRequired: "수동 확인 필요",
          failed: "확인 실패",
        },
        planStatus: {
          empty: "적용할 작업 없음",
          ready: "적용 가능",
          blocked: "수동 확인 필요",
        },
        issue: {
          registryMissing: "Dirong 내부 연결 정보가 부족합니다.",
          remoteMissing: "Notion에서 필드를 찾지 못했습니다.",
          nameDrift: "연결된 필드 이름이 바뀌었습니다.",
          wrongType: "필드 종류가 다릅니다.",
          relationTarget: "관계 대상이 다른 DB를 가리킵니다.",
          rollupTarget: "롤업 대상 필드가 다릅니다.",
          optionMissing: "선택 옵션이 부족합니다.",
          extra: "Dirong 관리 대상이 아닌 필드입니다.",
          unknown: "확인이 필요한 필드 상태입니다.",
        },
        labels: {
          meeting: {
            title: "회의록",
            date: "날짜",
            time: "회의 시간",
            channel: "채널",
            memberRelation: "참가자 연결",
            participants: "참가자",
            actionItems: "할 일 목록",
            status: "상태",
            sessionId: "Dirong 세션 ID",
            draftId: "Dirong 초안 ID",
            contentHash: "Dirong 내용 해시",
            localStatus: "Dirong 상태",
          },
          member: {
            discordName: "디스코드 닉네임",
            notionPerson: "노션 연결",
            organization: "소속",
            roles: "담당",
          },
          task: {
            title: "작업",
            meeting: "회의록",
            workerRelation: "작업자 연결",
            assignee: "담당자",
            role: "담당",
            dueDate: "마감일",
            status: "상태",
            evidence: "근거",
            sourceActionId: "Dirong 할 일 ID",
          },
        },
      },
      customDb: {
        title: "사용자 추가 DB",
        label: "기본 DB 외 추가 테이블",
        body: "사용자가 기본 3개 DB 외에 관리할 추가 Notion DB를 보여줄 자리입니다.",
        notice: "MVP에서는 추가 DB 생성 기능이 아직 준비 중입니다. 회의록, 작업자, 할 일 목록의 사용자 필드는 각 DB 탭 안에서 관리해 주세요.",
      },
      memberRoster: {
        title: "작업자 DB roster",
        description: "작업자 DB의 디스코드 닉네임, 소속, 담당 역할을 로컬 캐시에 불러옵니다.",
        syncAction: "작업자 DB 내용 불러오기",
        syncing: "작업자 DB 내용을 불러오는 중...",
        lastSynced: "마지막 불러오기",
        notSynced: "아직 불러오지 않음",
        loadedCount: "불러온 작업자",
        roleCount: "역할 값",
        warningCount: "warning {count}개",
        status: {
          done: "작업자 DB 내용을 불러왔습니다.",
          notConfigured: "작업자 DB roster를 아직 불러오지 않았습니다.",
          blocked: "작업자 DB 구조를 먼저 확인해야 합니다.",
          failed: "작업자 DB 내용을 불러오지 못했습니다.",
        },
        warning: {
          emptyDiscordName: "빈 디스코드 닉네임",
          duplicateDiscordName: "중복 디스코드 닉네임",
          missingRolesProperty: "담당 역할 필드 없음",
          missingOrganizationProperty: "소속 필드 없음",
          unsupportedPropertyType: "지원하지 않는 필드 타입",
        },
        action: {
          configureNotion: "Notion token과 managed DB 설정을 확인해 주세요.",
          checkMemberDb: "작업자 DB 필드 연결과 Notion 공유 상태를 확인해 주세요.",
        },
      },
      customFields: {
        title: "사용자 필드",
        scopedTitle: "{database} 사용자 필드",
        scopeHelp: "이 섹션의 필드는 {database}에만 적용됩니다. 다른 DB에 같은 필드가 필요하면 해당 DB 탭에서 따로 관리합니다.",
        targetLabel: "대상 DB",
        target: {
          meeting: "회의록 DB",
          member: "작업자 DB",
          task: "할 일 목록 DB",
        },
        meetingScopeNotice: "현재 필드 추가/수정 동작은 회의록 DB 대상 설정으로 저장됩니다.",
        roleComingSoon: {
          title: "이 DB의 사용자 필드 관리는 준비 중입니다.",
          body: "필수 필드와 DB 상태는 확인할 수 있지만, 이 DB에 새 사용자 필드를 저장하는 기능은 후속 단계에서 연결됩니다.",
        },
        roleSchemaNotice: "이 DB의 사용자 필드는 저장/동기화할 수 있습니다. Notion 필드 생성 적용은 회의록 DB에서 먼저 제공합니다.",
        unmanagedNotice: "Notion에 등록되지 않은 필드는 삭제하지 않습니다. 필요하면 Notion에서 직접 정리해 주세요.",
        unavailable: {
          label: "사용자 필드",
          body: "Notion 사용자 필드 설정을 아직 불러오지 못했습니다.",
        },
        enabledCount: "{count}개 사용 중",
        promptPreview: "AI 프롬프트 미리보기",
        protectedDelete: "잠긴 규칙은 삭제할 수 없습니다.",
        actions: {
          refresh: "Notion 상태 다시 확인",
          add: "필드 추가",
          save: "저장",
          inspect: "Notion 상태 다시 확인",
          apply: "누락된 필드 복구",
          updateTypes: "타입 변경도 허용",
          remove: "목록에서 제거",
        },
        columns: {
          enabled: "사용",
          property: "필드",
          type: "종류",
          source: "값 출처",
          description: "설명",
          limit: "글자 제한",
          lastSeen: "마지막 확인",
          actions: "",
        },
        relation: {
          targetDatabaseUrl: "대상 DB/data source URL",
          targetPageUrl: "대상 page URL",
          matchProperty: "매칭 속성",
          autoCreate: "못 찾으면 새 페이지 만들기",
        },
        source: {
          ai: "AI가 회의 내용에서 추출",
          participants: "참가자 기반 relation",
        },
        type: {
          rich_text: "텍스트",
          select: "선택",
          multi_select: "복수 선택",
          checkbox: "체크박스",
          date: "날짜",
          relation: "관계",
        },
        status: {
          syncing: "Notion 상태를 확인하는 중...",
          saving: "저장 중...",
          checking: "Notion 상태를 다시 확인하는 중...",
          applying: "누락된 필드를 복구하는 중...",
        },
        schemaResult: {
          title: "Notion 상태 확인 결과",
          ok: "Notion 상태가 맞습니다.",
          categories: {
            missing: "누락",
            rename: "이름 변경",
            wrongType: "타입 불일치",
            missingOptions: "옵션 누락",
            extra: "관리 외",
          },
          handling: {
            autoPossible: "자동 가능",
            manualNeeded: "수동 필요",
            preserved: "보존",
          },
        },
      },
    },
    logs: {
      title: "로그",
      filters: {
        all: "전체",
        needsAttention: "확인 필요",
        recording: "녹음",
        stt: "STT",
        ai: "AI",
        notion: "Notion",
        system: "시스템",
      },
      needsAttention: {
        title: "최근 확인 필요",
        empty: "지금 확인이 필요한 이벤트가 없습니다.",
      },
      empty: {
        all: "표시할 로그가 없습니다.",
        needsAttention: "지금 확인이 필요한 로그가 없습니다.",
        recording: "녹음/오디오 관련 로그가 없습니다.",
        stt: "텍스트 변환 관련 로그가 없습니다.",
        ai: "AI 회의록 처리 관련 로그가 없습니다.",
        notion: "Notion 업로드나 DB 관련 로그가 없습니다.",
        system: "시스템 로그가 없습니다.",
      },
      timeline: {
        title: "이벤트 타임라인",
        nextAction: "다음 행동",
      },
      sttQueue: {
        title: "STT 큐",
      },
      aiCleanup: {
        title: "AI 정리",
      },
      details: { toggle: "자세히 보기" },
    },
    settings: {
      tabs: {
        language: "언어",
        general: "일반",
        discord: "Discord",
        stt: "STT",
        ai: "AI",
        notion: "Notion",
        retention: "데이터·보관",
        aloneFinalize: "자동 종료",
        reset: "초기화",
      },
      theme: {
        label: "대시보드 테마",
        system: "시스템 설정",
        light: "라이트",
        dark: "다크",
        save: "테마 저장",
      },
      credits: {
        title: "정보",
        directorLabel: "감독",
        directorName: "Mua_VTuber",
        githubLabel: "GitHub",
        githubUrl: "https://github.com/mua-vtuber/Agestra",
        madeWith: "Claude Code로 제작",
      },
      secretsHidden: "Token/key 원문은 저장 후 화면에 표시하지 않습니다.",
      editor: {
        current: "현재값",
        provider: "Provider",
        mode: "사용 방식",
        model: "모델",
        save: "저장",
        verify: "검사",
        saving: "저장 중...",
        testing: "검사 중...",
        optionalSecret: "비워 두면 저장된 key를 유지합니다.",
        language: {
          title: "대시보드 언어",
        },
        stt: {
          title: "STT provider와 모델",
          localWhisperModel: "Whisper 모델",
          openAiModel: "OpenAI STT 모델",
          openAiApiKey: "OpenAI API key",
          language: "받아쓰기·회의록 언어",
          languageHint: "받아쓰기 결과와 회의록을 어떤 언어로 정리할지 정합니다(ko/en).",
          timeoutMs: "처리 제한 시간(ms)",
          timeoutHint: "STT 한 건을 처리할 때 기다리는 최대 시간입니다. 기본 120000ms(2분).",
          test: "OpenAI 연결 테스트",
          testHint: "테스트가 성공하면 입력한 STT 설정이 함께 저장됩니다.",
        },
        discord: {
          credentialsTitle: "Discord 봇 자격증명",
          guildTitle: "녹음 허용 서버",
          currentGuild: "현재 선택된 서버",
          tokenKeepHint:
            "봇 토큰을 새로 넣거나 교체할 때만 입력하세요. 입력란을 비워 두면 기존 토큰이 그대로 유지됩니다(저장 버튼을 누르지 않으면 됩니다).",
          noActiveProject: "활성 프로젝트가 있어야 서버를 저장할 수 있습니다.",
        },
        ai: {
          title: "AI provider와 모델",
          providerClaude: "Claude",
          providerCodex: "Codex",
          providerGemini: "Gemini",
          modeCli: "터미널 CLI",
          modeApi: "Claude API",
          apiKey: "Claude API key",
          test: "AI 연결 테스트",
          testHint: "현재 저장된 AI 설정으로 테스트합니다. 바꾼 값을 테스트하려면 먼저 저장하세요.",
        },
        notion: {
          title: "Notion 페이지 URL",
          parentPageUrl: "관리 페이지 URL",
          parentPagePlaceholder: "https://www.notion.so/...",
          tokenTitle: "Notion 연결 토큰",
          tokenLabel: "Notion token",
          tokenConfigured: "토큰이 저장되어 있습니다",
          tokenMissing: "토큰이 아직 없습니다",
          tokenKeepHint: "토큰을 새로 넣거나 교체할 때만 입력하세요. 비워 두면 기존 토큰이 그대로 유지됩니다.",
          managedTitle: "관리 DB",
          managedCreate: "관리 DB 생성",
          managedRepairLink: "DB 점검·복구 화면 열기",
          managedRepairHint: "필드 누락 복구는 DB 화면에서 진행합니다.",
        },
        aloneFinalize: {
          enabled: "자동 종료 사용",
          graceSeconds: "대기시간(초)",
          help: "음성 채널에 마지막 사람까지 나간 뒤, 자동으로 녹음을 끝낼 때까지 기다리는 시간입니다. 예: 90초로 두면 모두 나간 뒤 90초 동안 아무도 안 들어오면 녹음을 종료합니다. 5초~3600초(최대 1시간) 사이로 정할 수 있습니다.",
        },
      },
      resetDanger: "삭제와 초기화는 실제 파일 확인 뒤 별도 구현합니다.",
      reset: {
        title: "설정 초기화",
        safetyLabel: "로컬 초기화",
        safetyCopy:
          "원격 Discord application, 원격 Notion DB/page, 로컬 녹음과 회의록 기록은 삭제하지 않습니다.",
        activeProject: "활성 프로젝트",
        deletesLabel: "삭제",
        keepsLabel: "보존",
        confirm: "삭제 대상을 확인했습니다",
        running: "초기화 중...",
        success:
          "초기화가 완료되었습니다. Discord 봇 로그인은 유지될 수 있지만, 활성 프로젝트 서버가 없으면 Dirong 명령은 실행되지 않습니다.",
        deletedSummary:
          "삭제한 secret {secrets}개, 차단한 Notion write {writes}개",
        deletedHeading: "정리한 항목",
        deleted: {
          secrets: "삭제한 비밀값 {count}개",
          blockedWrites: "차단한 Notion 업로드 {count}개",
          discordGuild: "Discord 서버 연결 해제",
          discordApp: "Discord 앱 ID·토큰 삭제",
          notionToken: "Notion 토큰 삭제",
          projectsArchived: "보관 처리된 프로젝트 {count}개",
          managedRecords: "Notion 관리 데이터 정리됨",
        },
        full: {
          title: "완전 초기화",
          button: "완전 초기화 실행",
          deletes:
            "Discord application ID/token, 모든 프로젝트 서버/Notion 연결, Notion registry/cache/rules/roster, AI provider 설정과 OpenAI STT key",
          keeps:
            "local-whisper 모델/언어/timeout, 대시보드 언어/테마, retention, 로컬 세션/녹음/transcript/STT job/AI draft",
        },
        currentProject: {
          title: "현재 프로젝트 연결 초기화",
          button: "현재 프로젝트 초기화",
          deletes:
            "활성 프로젝트의 Discord 서버, Notion token/page/upload mode, registry/cache/custom rules/member roster",
          keeps:
            "Discord application ID/token, STT/Whisper, AI provider 설정, 로컬 세션/녹음/transcript/draft",
        },
        conflict: {
          recording_active: "녹음 중에는 초기화할 수 없습니다.",
          notion_upload_in_flight:
            "Notion 업로드가 진행 중이라 초기화를 막았습니다.",
          ai_cleanup_in_flight:
            "AI 회의록 처리가 진행 중이라 초기화를 막았습니다.",
          reset_already_running: "이미 초기화가 진행 중입니다.",
        },
        effects: {
          discord: {
            message:
              "현재 프로세스의 active project gate가 갱신되어 이전 서버 명령 진입을 막습니다.",
            action:
              "봇이 온라인으로 보여도 활성 프로젝트 서버가 없으면 Dirong 명령은 실행되지 않습니다.",
          },
          notion: {
            message:
              "Notion 자동 업로드 후보는 project_id와 reset watermark 기준으로 다시 계산됩니다.",
          },
          ai: {
            message: "AI cleanup 런타임 설정은 다음 시작 때 새 설정을 사용합니다.",
            action: "완전 초기화 후 AI를 다시 쓰려면 Claude 설정을 다시 저장해 주세요.",
          },
        },
      },
      retention: {
        audioDeleteAfterNotion: "오디오 파일은 Notion 업로드 성공 후 삭제합니다.",
        audioKept: "오디오 파일 자동 삭제가 꺼져 있습니다.",
        textDraftDays: "STT 텍스트와 AI draft는 {days}일 동안 보관합니다.",
        editTitle: "텍스트·초안 보관",
        textDraftLabel: "보관 일수(일)",
        audioReadOnly: "오디오 자동 삭제 정책은 안전을 위해 항상 켜져 있으며 변경할 수 없습니다.",
        consumeHint: "설정한 일수가 지나면, 오래된 STT 텍스트와 AI 초안이 자동으로 정리됩니다(다음 정리 주기에 반영). 즉시 정리하려면 session-purge --expired-text-artifacts 명령도 쓸 수 있습니다.",
      },
      notionUploadMode: {
        title: "Notion 업로드 모드",
        optionAutomatic: "자동 (AI 정리 후 업로드)",
        optionManual: "수동 (사람이 확인 후 업로드)",
        save: "업로드 모드 저장",
      },
      aloneFinalize: {
        title: "자동 종료",
        countdown: "자동 종료까지 {seconds}초",
        checkedAt: "마지막 확인",
        notChecked: "아직 확인 전",
      },
    },
    common: {
      unavailable: "아직 사용할 수 없습니다.",
      none: "없음",
      openWizard: "첫 설정 위자드 열기",
      openNotion: "Notion에서 열기",
      refresh: "새로고침",
      saving: "저장 중...",
    },
    table: {
      time: "시간",
      speaker: "화자",
      status: "상태",
      playback: "재생",
      transcript: "변환 텍스트",
      text: "본문",
      updated: "업데이트",
      area: "영역",
      summary: "요약",
      nextAction: "다음 행동",
      job: "작업",
      chunk: "청크",
      attempts: "시도",
      input: "입력",
      providerModel: "provider/model",
      error: "오류",
      database: "DB",
      fields: "필드",
      notion: "Notion",
      details: "자세히 보기",
    },
    logSummary: {
      normalEvent: "상태 기록",
      attentionEvent: "확인이 필요한 이벤트",
      repairItem: "확인이 필요한 항목",
      sttJob: "텍스트 변환 작업",
      aiJob: "AI 회의록 작업",
      notionWrite: "Notion 업로드 기록",
      notionAutomation: "Notion 자동 업로드 상태",
    },
  },
  settings: {
    language: {
      current: {
        message: "현재 앱 언어 설정입니다.",
      },
      save: {
        done: {
          message: "앱 언어 설정을 저장했습니다.",
        },
      },
      error: {
        invalidLocale: {
          message: "지원하지 않는 앱 언어입니다.",
          action: "ko 또는 en 중 하나를 선택해 주세요.",
        },
      },
    },
    theme: {
      current: {
        message: "현재 대시보드 테마 설정입니다.",
      },
      save: {
        done: {
          message: "대시보드 테마 설정을 저장했습니다.",
        },
      },
      error: {
        invalidTheme: {
          message: "지원하지 않는 대시보드 테마입니다.",
          action: "system, light, dark 중 하나를 선택해 주세요.",
        },
      },
    },
    overview: {
      status: {
        notConfigured: "설정이 아직 완료되지 않았습니다.",
        ready: "설정이 준비되었습니다.",
        blocked: "설정을 완료해야 사용할 수 있습니다.",
        checking: "설정 상태를 확인하는 중입니다.",
        warning: "확인이 필요한 설정이 있습니다.",
        repairRequired: "복구가 필요한 설정이 있습니다.",
      },
    },
  },
  error: {
    common: {
      missingConfig: "제품 설정이 아직 부족합니다.",
      missingKeys: "빠진 항목: {keys}",
      copyEnvExample: "대시보드 설정 마법사에서 Discord 토큰과 ID를 저장해 주세요.",
      generic: "처리 중 문제가 생겼습니다: {message}",
      debugHint: "상세 정보가 필요하면 --debug 옵션으로 다시 실행해 주세요.",
    },
    discord: {
      token: "Discord 봇 토큰으로 로그인하지 못했습니다. 설정 마법사에 저장한 봇 토큰이 올바른지 확인하고, 필요하면 새 토큰을 발급한 뒤 다시 저장해 주세요.",
      permissions: "Discord 권한이 부족합니다. 봇이 해당 서버와 음성 채널에 초대되어 있고, View Channel / Connect 권한과 applications.commands 권한이 있는지 확인해 주세요.",
      unknownGuild: "Discord 서버를 찾지 못했습니다. 설정 마법사에 저장한 서버 ID와 봇 초대 상태를 확인해 주세요.",
      unknownChannel: "Discord 채널을 찾지 못했습니다. /dirong start를 실행한 사용자가 들어간 음성 채널과 봇 권한을 확인해 주세요.",
      voiceChannel: "선택된 채널이 음성 채널이 아닌 것 같습니다. Discord에서 음성 채널에 들어간 뒤 다시 실행해 주세요.",
      ffmpeg: "FFmpeg 실행에 실패했습니다. npm install이 끝났는지 확인하고, 계속 실패하면 npm run doctor 결과를 확인해 주세요.",
      timeout: "Discord 음성 연결이 제한 시간 안에 준비되지 않았습니다. 봇 권한, 채널 ID, 네트워크 상태, Discord 음성 서버 상태를 확인해 주세요.",
    },
    dashboard: {
      setupStatusSourceMissing: {
        message: "Product setup status source is not configured.",
        action: "Dashboard runtime source 구성을 확인해 주세요.",
      },
      settingsSourceMissing: {
        message: "Product settings source is not configured.",
        action: "앱 설정 저장소가 연결된 상태로 dashboard를 시작해 주세요.",
      },
      setupWizardSourceMissing: {
        message: "Setup wizard source is not configured.",
        action: "설정 위자드 runtime source가 연결된 상태로 dashboard를 시작해 주세요.",
      },
      requestInvalid: {
        message: "요청을 처리할 수 없습니다.",
        action: "요청 값을 확인한 뒤 다시 시도해 주세요.",
      },
      notionActionSourceMissing: {
        message: "Notion dashboard action source is not configured.",
        action: "Notion 설정을 확인해 주세요.",
      },
    },
    userFacing: {
      dashboardPortDefaultEndpoint: "설정된 dashboard 포트",
      dashboardPortInUse:
        "디롱이 dashboard 포트를 이미 사용 중입니다: {endpoint}\n\n확인할 것:\n1. 이미 실행 중인 Dirong 콘솔이 있으면 그 창에서 exit를 입력해 종료해 주세요.\n2. 다른 포트를 쓰려면 dashboard 설정에서 포트를 바꾼 뒤 다시 시작해 주세요.",
      localWhisperPreflight:
        "디롱이 local-whisper 준비에 실패했습니다.\n\n확인할 것:\n1. .venv-whisper가 만들어져 있고 faster-whisper가 설치되어 있는지 확인해 주세요.\n2. 설정 마법사에 저장한 local-whisper 모델 경로가 실제 모델 폴더인지 확인해 주세요.\n3. Windows에서는 기본값인 cpu/int8 설정을 먼저 사용해 주세요.",
      sqliteBackup:
        "디롱이 SQLite backup 생성에 실패했습니다.\n\n확인할 것:\n1. 녹음 중이면 잠시 후 다시 시도해 주세요.\n2. data 폴더를 다른 프로그램이 잠그고 있지 않은지 확인해 주세요.\n3. 디스크 여유 공간이 충분한지 확인해 주세요.\n\nbackup이 실패했으므로 STT 처리는 시작하지 않았습니다.",
      sttPreparation:
        "디롱이 STT 준비 중 문제가 생겼습니다.\n\n확인할 것:\n1. local-whisper 설정과 Python 환경을 확인해 주세요.\n2. 모델 경로와 CPU/int8 설정을 먼저 확인해 주세요.",
    },
  },
  action: {
    request: {
      retry: "요청을 다시 시도해 주세요.",
    },
    settings: {
      open: "설정을 열어 필요한 값을 저장해 주세요.",
    },
  },
} as const;

type WidenLocaleLeaves<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : WidenLocaleLeaves<T[K]>;
};

export type LocaleCatalog = WidenLocaleLeaves<typeof ko>;

export const en = {
  statusDisplay: {
    action: {
      done: {
        title: "Settings saved",
        description: "The value you entered was saved.",
      },
      ready: {
        title: "Already ready",
        description: "The required setup is already ready, so you do not need to repeat this action.",
      },
      failed: {
        title: "The request could not be completed",
        description: "Dirong stopped because the input or connection state needs attention.",
        nextAction: "Open details below, then update the value or check the connection again.",
      },
      blocked: {
        title: "This cannot continue yet",
        description: "A required setup step or safety check must be handled first.",
        nextAction: "Check the setup screen and continue from the required step.",
      },
      notConfigured: {
        title: "Required setup is missing",
        description: "Some settings must be saved before this action can continue.",
        nextAction: "Save the missing values in the setup wizard, then try again.",
      },
    },
    discord: {
      notConfigured: {
        title: "Discord bot connection is not finished yet",
        description: "Discord features are paused because bot information or server selection is missing.",
        nextAction: "Finish the application ID, bot token, and server selection in Discord settings.",
      },
      ready: {
        title: "Discord bot connection is ready",
        description: "The Discord bot and allowed server settings required for recording are saved.",
      },
    },
    stt: {
      notConfigured: {
        title: "STT setup is not finished yet",
        description: "A provider and model for turning audio into text have not been selected yet.",
        nextAction: "Choose local faster-whisper or OpenAI STT in STT settings.",
      },
      openAiApiKeyMissing: {
        title: "OpenAI STT API key is required",
        description: "OpenAI STT is selected, but no API key is saved.",
        nextAction: "Enter the API key again or switch to local faster-whisper.",
      },
      ready: {
        title: "STT setup is ready",
        description: "The basic settings for turning audio into text are saved.",
      },
    },
    claude: {
      notConfigured: {
        title: "AI provider setup is not finished yet",
        description: "The AI provider mode for meeting notes has not been saved yet.",
        nextAction: "Choose a provider and mode in AI settings and check the connection.",
      },
      apiKeyMissing: {
        title: "Claude API key is required",
        description: "Claude API mode is selected, but no API key is saved.",
        nextAction: "Enter the Claude API key again or switch to CLI mode.",
      },
      cliCommandMissing: {
        title: "AI CLI command is required",
        description: "Terminal CLI mode is selected, but no command is saved.",
        nextAction: "Save the AI CLI command, then run the connection test again.",
      },
      ready: {
        title: "AI provider setup is ready",
        description: "The AI provider settings for meeting notes are saved.",
      },
      preparing: {
        title: "Checking AI provider readiness",
        description: "Dirong is checking the AI runtime before creating meeting notes.",
      },
      loginRequired: {
        title: "Claude login is required",
        description: "Claude CLI is available, but its login state is not ready.",
        nextAction: "Complete Claude CLI login in a terminal, then check again.",
      },
      toolMissing: {
        title: "AI tool was not found",
        description: "Dirong could not run the selected AI CLI or local AI tool.",
        nextAction: "Check that the selected AI tool is installed and runs in a terminal.",
      },
      failed: {
        title: "AI provider readiness check failed",
        description: "Dirong could not verify the AI provider before meeting-note generation. Recording and STT results are preserved.",
        nextAction: "Check AI settings and provider state, then try again.",
      },
      stopped: {
        title: "AI provider readiness check stopped",
        description: "The AI provider readiness check has stopped.",
      },
    },
    aiCleanup: {
      disabled: {
        title: "AI meeting-note automation is turned off",
        description: "Automatic meeting-note draft generation is currently disabled.",
        nextAction: "Run the manual Phase 4 CLI if you need to create notes.",
      },
      idle: {
        title: "AI meeting-note automation is waiting",
        description: "When a meeting is ready, Dirong will check STT state and create a draft.",
      },
      waitingForFinalizedSession: {
        title: "Waiting for a finalized recording session",
        description: "There is no finalized session ready for meeting-note generation yet.",
      },
      waitingForStt: {
        title: "Waiting for STT to finish",
        description: "Audio transcription must finish before meeting notes can be created.",
      },
      waitingForAiProvider: {
        title: "Waiting for the AI provider",
        description: "The AI runtime must be ready before meeting-note generation can start.",
        nextAction: "Check the AI provider state. Dirong will retry automatically when it is ready.",
      },
      queued: {
        title: "Preparing the AI meeting-note job",
        description: "Dirong is checking whether it can claim the meeting-note job.",
      },
      running: {
        title: "Creating a meeting-note draft",
        description: "The AI provider is generating a meeting-note draft from the STT result.",
      },
      done: {
        title: "Meeting-note draft created",
        description: "The AI meeting-note draft has been saved.",
      },
      alreadyDone: {
        title: "Meeting-note draft already exists",
        description: "A draft for the same input is already saved.",
      },
      blocked: {
        title: "Meeting-note generation is blocked",
        description: "Dirong stopped because there is no real speech to summarize or the input is not eligible.",
        nextAction: "Dirong will run again when real STT speech is available.",
      },
      failed: {
        title: "Meeting-note generation failed",
        description: "Dirong could not create the AI meeting-note draft. Recording and STT results are preserved.",
        nextAction: "Check the AI provider state and job error, then retry with the manual Phase 4 CLI if needed.",
      },
      notClaimed: {
        title: "Waiting for the AI meeting-note job turn",
        description: "Dirong did not claim this job because it is already processing or waiting for a retry time.",
      },
      stopped: {
        title: "AI meeting-note automation stopped",
        description: "The AI meeting-note automation service has stopped.",
      },
    },
    notion: {
      notConfigured: {
        title: "Notion connection setup is not finished yet",
        description: "Upload cannot start because the Notion token or Notion DB management page is missing.",
        nextAction: "Save the Notion token and Notion DB management page URL in Notion settings.",
      },
      registryMissing: {
        title: "Notion DB setup has not been created yet",
        description: "Notion connection values exist, but Dirong's managed DB record is missing.",
        nextAction: "Create the managed DB set from the Notion settings screen.",
      },
      registryPartial: {
        title: "Notion DB setup is incomplete",
        description: "Part of Dirong's Notion DB record is missing, so upload has stopped.",
        nextAction: "Check DB status in Notion settings and run repair if needed.",
      },
      ready: {
        title: "Notion upload is ready",
        description: "Dirong found the Notion DB record used for meeting-note uploads.",
      },
      disabled: {
        title: "Notion upload is turned off",
        description: "Sending meeting notes to Notion is currently disabled.",
        nextAction: "Turn on Notion upload if you want to use it.",
      },
      manual: {
        title: "Notion upload is in manual mode",
        description: "Meeting notes will not upload automatically; use the upload button when needed.",
        nextAction: "Review the meeting notes, then upload them yourself with the Upload notes button on the status card. Switch the upload mode to automatic in settings if you want automatic uploads.",
      },
      idle: {
        title: "Waiting for meeting notes to upload",
        description: "Dirong will process a meeting-note draft when one is ready.",
      },
      running: {
        title: "Uploading to Notion",
        description: "Dirong is sending the meeting-note draft to a Notion page.",
      },
      done: {
        title: "Notion upload finished",
        description: "The meeting notes were uploaded to Notion.",
      },
      draftNotFound: {
        title: "No meeting notes are ready for Notion",
        description: "Dirong could not find an uploadable meeting-note draft or session.",
        nextAction: "Try again after recording and AI meeting-note generation finish.",
      },
      retryWait: {
        title: "Notion upload will retry soon",
        description: "A temporary Notion issue occurred, so local data is preserved while Dirong waits to retry.",
        nextAction: "Wait for the automatic retry. If it keeps failing, check the Notion connection.",
      },
      blocked: {
        title: "Notion upload has stopped",
        description: "Upload stopped because permissions, DB structure, or registry state needs attention.",
        nextAction: "Check the Notion connection and DB status in settings.",
      },
      failed: {
        title: "Notion upload failed",
        description: "Dirong could not finish the upload. Audio and processed results are preserved.",
        nextAction: "Check Notion settings and the latest write state, then retry the upload.",
      },
      notClaimed: {
        title: "Waiting for the Notion upload turn",
        description: "Dirong did not claim this upload because it is already processing or waiting for a retry time.",
      },
    },
    recording: {
      blocked: {
        title: "Recording setup is not finished yet",
        description: "Discord and STT must be ready before recording can start safely.",
        nextAction: "Finish Discord bot connection and STT provider setup first.",
      },
      ready: {
        title: "Recording setup is ready",
        description: "The basic settings required to start recording are ready.",
      },
      disabled: {
        title: "Automatic recording stop is turned off",
        description: "Dirong will not automatically stop recording when everyone leaves.",
      },
      idle: {
        title: "Automatic recording stop is waiting",
        description: "When everyone leaves an active meeting, Dirong will start the stop countdown.",
      },
      countdown: {
        title: "Dirong is alone and waiting to stop recording",
        description: "If nobody returns to the voice channel, recording will stop automatically soon.",
        nextAction: "If the meeting is still going, someone can rejoin the voice channel.",
      },
      deferredReconnecting: {
        title: "Automatic stop was deferred during reconnect",
        description: "Dirong does not stop recording immediately while the Discord connection is unstable.",
      },
      triggering: {
        title: "Stopping the recording automatically",
        description: "The automatic stop condition was met, so Dirong is stopping the recording.",
      },
      finalized: {
        title: "Recording stopped automatically",
        description: "Dirong stopped the recording because nobody was left in the voice channel.",
      },
      skipped: {
        title: "Automatic recording stop was skipped",
        description: "Recording continues because Dirong could not safely verify session or channel state.",
        nextAction: "Check recording state in the dashboard and stop it manually if needed.",
      },
      failed: {
        title: "Automatic recording stop failed",
        description: "Dirong tried to stop the recording but could not finish the action.",
        nextAction: "Check the dashboard and Discord channel, then stop manually if needed.",
      },
      stopped: {
        title: "Automatic recording stop check stopped",
        description: "The automatic recording stop service has stopped.",
      },
    },
    dataRetention: {
      ready: {
        title: "Default retention policy is applied",
        description: "Audio and text processing results are cleaned up according to the configured retention policy.",
      },
    },
    dashboard: {
      sourceMissing: {
        title: "Dashboard status source is not connected",
        description: "The dashboard could not find the runtime source for setup status.",
        nextAction: "Restart the app or check the dashboard runtime configuration.",
      },
      requestInvalid: {
        title: "Dashboard request could not be processed",
        description: "The request body or value was invalid, so the action stopped.",
        nextAction: "Check the input values and try again.",
      },
    },
  },
  runtimeStatus: {
    recordingStatus: {
      noSession: "No recording session is active or recently created.",
      heading: "Recording and STT status",
      session: "Session",
      voiceChannel: "Voice channel",
      currentRecording: "Recording now",
      openChunks: "Open chunks",
      speakers: "Speakers",
      chunks: "Chunks",
      sttQueue: "STT queue",
      openRepairItems: "Repair items needing attention",
      dashboard: "Dashboard",
      yes: "yes",
      no: "no",
      sessionStatus: {
        created: "The recording session has been created.",
        active: "Recording is in progress.",
        reconnecting: "Checking the Discord voice connection again.",
        stopping: "Stopping the recording.",
        finalized: "Recording has ended normally.",
        failed: "An error occurred while processing the recording.",
        needsRepair: "Recording data needs review.",
        unknown: "The recording state needs review.",
      },
      sttStatus: {
        queued: "Waiting",
        processing: "Transcribing",
        done: "Done",
        failed: "Failed",
        failedMissingFile: "Audio file missing",
        unknown: "Needs review",
      },
    },
    sttAutomation: {
      disabled: {
        message: "STT automation is turned off.",
        action: "Run the manual Phase 3 STT CLI if needed.",
      },
      idle: {
        message: "STT automation is waiting: no queued jobs",
      },
      running: {
        message: "Checking queued STT jobs",
      },
      done: {
        message: "STT batch completed",
      },
      doneMore: {
        message: "STT batch completed: more queued jobs remain.",
      },
      failed: {
        message: "STT processing failed. Audio files and job state are preserved.",
        action: "Check the failed STT jobs in the dashboard and logs.",
      },
      stopped: {
        message: "STT automation stopped",
      },
      statusText: {
        title: "STT automation",
        description: "Description",
        nextAction: "STT action",
        batch: "STT batch",
      },
    },
    aiReadiness: {
      idle: {
        message: "AI is not prepared yet",
      },
      preparing: {
        message: "Preparing AI",
      },
      ready: {
        message: "AI is ready",
      },
      loginRequired: {
        message: "AI login is required",
        action: "Complete AI CLI login in a terminal, then check again.",
      },
      authRequired: {
        message: "AI API key is required",
        action: "Check the AI API key in settings.",
      },
      serverUnreachable: {
        message: "Local AI server is not running",
        action: "Start the local AI server, then check again.",
      },
      notInstalled: {
        message: "AI tool was not found",
        action: "Check that the selected AI CLI is installed and runs in a terminal.",
      },
      degraded: {
        message: "The AI provider is usable, but part of its state needs attention.",
        action: "Check the AI provider state and logs.",
      },
      failed: {
        message: "AI readiness check failed. Recording and STT results are preserved.",
        action: "Check AI settings and provider state, then try again.",
      },
      stopped: {
        message: "AI readiness check stopped",
      },
      statusText: {
        title: "AI status",
        description: "Description",
        nextAction: "AI action",
      },
    },
    aiCleanupAutomation: {
      disabled: {
        message: "AI cleanup automation is turned off.",
        action: "Run the manual Phase 4 CLI if needed.",
      },
      idle: {
        message: "AI cleanup automation is waiting",
      },
      waitingForFinalizedSession: {
        message: "AI cleanup is waiting for a finalized session",
      },
      waitingForStt: {
        message: "Waiting for STT to finish",
      },
      waitingForAiProvider: {
        message: "AI cleanup is waiting for AI readiness.",
        action: "Check the AI provider state. Dirong will retry automatically when it is ready.",
      },
      queued: {
        message: "Preparing to run the AI cleanup job",
      },
      running: {
        message: "Creating meeting notes",
      },
      done: {
        message: "Meeting-note draft created",
      },
      alreadyDone: {
        message: "A meeting-note draft already exists.",
      },
      blocked: {
        message: "Meeting-note generation is blocked because there is no real speech to summarize or the input is not eligible.",
        action: "Dirong will run again when real STT speech is available. Fake or no-speech-only sessions stay blocked without a draft.",
      },
      failed: {
        message: "Meeting-note generation failed. Recording and STT results are preserved.",
        action: "Check the AI provider state and job error, then retry with the manual Phase 4 CLI if needed.",
      },
      notClaimed: {
        message: "The AI cleanup job cannot run yet.",
        action: "It is already processing or its retry time has not arrived yet.",
      },
      stopped: {
        message: "AI cleanup automation stopped",
      },
      retry: {
        disabledMessage: "AI meeting-note automation is disabled, so retry cannot start.",
        disabledAction: "Finish AI setup, then try again.",
        missingMessage: "Could not find a failed job to retry.",
        missingAction: "Refresh the dashboard and retry from the latest failed job.",
        queuedMessage: "Retrying meeting-note generation.",
      },
      statusText: {
        automation: "AI cleanup automation",
        provider: "AI cleanup provider",
        session: "AI cleanup session",
        stt: "AI cleanup STT",
        progress: "AI cleanup progress",
        warning: "AI cleanup warning",
        sttLeaseRepair: "AI cleanup STT leases repaired: {count}",
        action: "AI cleanup action",
      },
    },
    aiCleanupRunner: {
      sessionNotFound: "Could not find the AI cleanup target session: {sessionId}",
      sessionNotFinalized:
        "Phase 4 AI cleanup only processes finalized sessions. Current session status: {status}",
      preparingInput: "Preparing AI cleanup input",
      claimingJob: "Checking the AI cleanup job",
      alreadyDone: "A meeting-note draft already exists.",
      blocked: "Meeting-note generation blocked",
      notClaimed: "The AI cleanup job cannot run yet.",
      notClaimedError:
        "Could not claim the AI cleanup job. It is already processing or its retry time has not arrived yet.",
      writingPromptArtifacts: "Writing AI cleanup prompt artifacts",
      artifactWriteFailed: "Failed to write AI cleanup artifacts",
      startingClaude: "Starting AI provider request",
      claudeRequestFailed: "AI provider request failed",
      writingRawArtifacts: "Writing AI provider raw output artifacts",
      emptyOutput: "AI provider output is empty.",
      parsingJson: "Parsing meeting-note JSON",
      parsingJsonFailed: "Failed to parse meeting-note JSON",
      validatingSchema: "Validating meeting-note schema",
      repairingSchema: "Requesting meeting-note schema repair",
      repairingSchemaFailed: "Meeting-note schema repair request failed",
      writingRepairRawArtifacts: "Writing AI provider repair raw output artifacts",
      repairFailed: "Meeting-note schema repair failed",
      validatingRepairSchema: "Validating repaired schema",
      repairValidationFailed: "Repaired schema validation failed",
      renderingDraft: "Saving meeting-note draft",
      completed: "Meeting-note draft created",
    },
    retentionAutomation: {
      idle: {
        message: "No expired text or drafts to clean up.",
      },
      running: {
        message: "Cleaning up expired text and drafts.",
      },
      done: {
        message: "Cleaned up expired text and drafts.",
      },
      failed: {
        message: "Automatic text/draft cleanup failed.",
      },
      stopped: {
        message: "Stopped automatic text/draft cleanup.",
      },
    },
    notionAutomation: {
      disabled: {
        message: "Notion auto-upload is turned off.",
        action: "Set NOTION_EXPORT_ENABLED=true to use automatic uploads.",
      },
      manual: {
        message: "Notion upload is in manual mode.",
        action: "Review the meeting notes, then upload them yourself with the Upload notes button on the status card.",
      },
      notConfigured: {
        message: "Notion automatic upload settings are incomplete.",
        action: "Complete the Notion token and managed DB setup in the setup wizard.",
      },
      idle: {
        message: "Notion auto-upload is waiting: no valid draft to upload",
      },
      running: {
        message: "Running Notion auto-upload",
      },
      done: {
        message: "Notion auto-upload completed",
      },
      notClaimed: {
        message: "Waiting for the Notion upload turn",
      },
      retryWait: {
        message: "Notion auto-upload is waiting to retry",
        action: "Wait for the automatic retry. If it keeps failing, check the Notion connection.",
      },
      blocked: {
        message: "Notion auto-upload has stopped.",
        action: "Check Notion settings and DB state.",
      },
      failed: {
        message: "Notion auto-upload failed. The local draft is preserved.",
        action: "Check Notion settings and the latest Notion write state in the dashboard, then retry manually.",
      },
      stopped: {
        message: "Notion auto-upload stopped",
      },
      target: {
        missingAction:
          "Create managed Notion DBs in Settings or reconnect the upload target.",
        invalidAction:
          "Copy and paste the Notion database or data source URL again.",
        clientMissingAction:
          "Check the Notion connection token saved in the setup wizard.",
        multipleDataSourcesAction:
          "If the Notion database has multiple data sources, copy the data source URL you want to upload to.",
        dataSourceMissingAction:
          "Copy and paste the Notion data source URL again.",
      },
      statusText: {
        title: "Notion auto-upload status",
        description: "Description",
        nextAction: "Notion action",
        leaseRepair: "Notion leases repaired: {count}",
      },
    },
    aloneFinalize: {
      disabled: {
        message: "Automatic alone stop is turned off.",
        action: "Set DIRONG_ALONE_FINALIZE_ENABLED=true to opt in.",
      },
      idle: {
        message: "Automatic alone stop is waiting",
      },
      countdown: {
        message: "Dirong is alone; recording will stop in {seconds}s",
        action: "If someone returns during the grace period, automatic stop is cancelled.",
      },
      deferredReconnecting: {
        message: "Dirong is alone, but automatic stop was deferred during Discord reconnect.",
        action: "Dirong will check again when the connection is stable. Recording data is preserved.",
      },
      triggering: {
        message: "The alone grace period ended, so Dirong is stopping the recording",
      },
      finalized: {
        message: "Recording stopped automatically because Dirong was alone. Status: {status}",
      },
      skipped: {
        message: "Automatic alone stop was skipped. Recording continues.",
        action: "Dirong could not safely verify the stop condition. Check the dashboard state.",
      },
      failed: {
        message: "Automatic alone stop failed. Recording and STT data are preserved.",
        action: "Check the dashboard and logs, then run /dirong stop if needed.",
      },
      stopped: {
        message: "Automatic alone stop stopped",
      },
      skippedReason: {
        sessionNotFound: {
          message: "Automatic alone stop skipped: session was not found.",
          action: "Check the recording state and dashboard.",
        },
        memberCountUnknown: {
          message: "Automatic alone stop skipped: voice channel members could not be counted accurately.",
          action: "Recording continues. Check the dashboard and Discord channel state.",
        },
        sessionStatus: {
          message: "Automatic alone stop skipped: session status is {status}.",
        },
      },
      producerStopDisplayName: "Dirong auto stop",
      statusText: {
        title: "Recording auto stop",
        description: "Description",
        nextAction: "Recording auto-stop action",
        session: "Alone session: {sessionId}",
        countdown: "Auto stop in: {seconds}s",
      },
    },
  },
  health: {
    node: {
      available: "Node.js {version} is available",
      unsupported: "Node.js {version} is too old. Version 22.12.0 or newer is required.",
      installAction: "Install Node.js 22.12.0 or newer LTS, then run Dirong again.",
    },
    dependency: {
      detected: "{name} detected",
      npmInstallAction: "Run npm install again.",
      opusMissing: "Could not find an Opus library.",
      ffmpegAvailable: "{source} FFmpeg is available",
      ffmpegMissing: "Could not find the FFmpeg executable.",
      daveMissing:
        "Could not find @snazzah/davey directly. It may be provided through @discordjs/voice.",
      nodeCrcDetected: "node-crc detected",
      nodeCrcMissing: "Could not find node-crc, which is required for writing OGG/Opus files.",
      nodeCrcLoadFailed: "Found node-crc, but could not load it: {error}",
      aesAvailable: "Node crypto aes-256-gcm is available",
      aesUnavailable:
        "Node crypto aes-256-gcm was not detected. A fallback encryption library may be required.",
    },
    config: {
      present: "Configured (value is not printed)",
      missing: "Not configured yet.",
      action: "Save the value in the dashboard setup wizard.",
    },
  },
  notionClientError: {
    invalidJson: {
      message: "Could not parse the Notion API response as JSON.",
      action: "Try again later. If it keeps failing, check Notion status and the network.",
    },
    network: {
      message: "Could not connect to the Notion API.",
      action: "Check the network connection and try again.",
    },
    timeout: {
      message: "The Notion API request timed out.",
      action: "Check the network state or increase NOTION_REQUEST_TIMEOUT_MS, then try again.",
    },
    auth: {
      message: "Notion authentication or sharing permission is missing.",
      action:
        "Check that the Notion integration token is correct and that the target database is shared with the Dirong integration through Add connections.",
    },
    notFound: {
      message: "Could not access the Notion target.",
      action: "Check that the Notion URL is correct and share the target database with the Dirong integration.",
    },
    schemaMismatch: {
      message: "The Notion request does not match the database schema.",
      action: "Check the Notion property names and types required by Dirong, then run the connection test again.",
    },
    rateLimited: {
      message: "Notion API rate limit reached; waiting before retry.",
      action: "Dirong will retry automatically after a short delay.",
    },
    server: {
      message: "The Notion API server returned an error.",
      action: "Try again later.",
    },
    unknown: {
      message: "Notion API error. HTTP {status}{code}",
      action: "Review the error details and try again.",
    },
  },
  sessionPurge: {
    cli: {
      unknownOption: "Unknown session purge option: {flag}",
      selectorRequired:
        "Exactly one of --session, --missing-audio, --all, or --expired-text-artifacts is required.",
      sessionValueRequired: "--session value is required.",
    },
    backup: {
      failureLine1: "Failed to create the SQLite backup.",
      failureLine2: "Session purge was not applied and has been stopped.",
      failureLine3: "Because backup failed, the database was not changed.",
    },
    expiredTextArtifactsTitle: "Dirong expired text artifact retention results",
    sessionPurgeTitle: "Dirong session purge results",
    fileDeletionPlanTitle: "File deletion plan",
    targetSessionsTitle: "Target sessions",
    dryRunHint: "To delete for real, run the same command with --confirm.",
    expiredTextArtifactsDone: "Expired text/draft artifact files were deleted.",
    sessionPurgeDone:
      "Session rows and planned local files were deleted. Notion Property Rules were preserved.",
    none: "None",
    fileDeletionFailed: "File deletion failed",
  },
  recordingProducer: {
    alreadyRecording: "A recording session is already active: {sessionId}",
    stageUnsupported: "Stage channels are not supported by the current Dirong recording app.",
    criticalHealthLastError: "Node/Opus/FFmpeg required dependency health check failed",
    criticalHealthFailure: "Required dependency health check failed. Check npm run doctor.",
    noActiveSession: "There is no active recording session.",
    chunkFinalizeTimeout: "Chunk finalization did not finish before the shutdown timeout.",
    fatalErrors: "voice fatal error recorded {count} time(s)",
    softRolloverAction: "Close on the next silence and keep the hard cap as a backstop.",
    sessionDirectoryNameFailed: "Could not create a new session directory name.",
  },
  notionPageProperties: {
    draftTitle: "Meeting notes draft",
    unknown: "Unknown",
    uploadPending: "Notion upload pending",
    uploadInProgress: "Notion upload in progress",
    uploadComplete: "Notion upload complete",
    taskTitle: "Task",
    taskStatusTodo: "To do",
    noEvidence: "No evidence",
    participantEmptyWarning: "Blank participant names were excluded from the Notion Participants property.",
    participantsCappedWarning: "Only the first 100 participants were written to the Notion Participants property.",
    meetingTimeUnknownEnd: "unknown",
  },
  notionWriter: {
    disabledMessage: "Notion upload is disabled.",
    settingsIncompleteMessage: "Notion settings are incomplete.",
    clientUnavailableMessage: "Notion client is not available.",
    draftMissingMessage: "No valid meeting notes draft was found.",
    apiKeyMissingAction: "Save a Notion connection token in the setup wizard before turning on Notion upload.",
    clientMissingAction: "Check the Notion API key setting.",
    draftMissingAction: "Complete Phase 4 AI cleanup first, then try again.",
    unresolvedProjectAction:
      "Legacy sessions with ambiguous project ownership are not automatically uploaded to the default project.",
    projectMismatchAction: "Switch projects, then upload only the meeting notes for that project.",
    duplicateDraftAction: "Leave only one page with the same Draft ID in the Notion database, then try again.",
    duplicateSessionAction:
      "Leave only one page with the same Session ID in the Notion database, then try again.",
    pageIdMissing: "The Notion response does not include a page ID.",
    blockAppendMismatchAction: "Check the Notion upload status, then try again.",
    managedMemberMissingWarning:
      "Discord participant \"{name}\" was not found in the Notion member DB, so they were excluded from the participant relation.",
    actionItem: {
      duplicateSourceActionId:
        "{sourceActionId}: Multiple task pages have the same Dirong action item ID, so the update was skipped.",
      syncFailed: "{sourceActionId}: An error occurred while syncing the task page ({error}).",
      unsupportedWorkerMatch:
        "{sourceActionId}: The worker matching property type is not supported, so the owner relation was cleared.",
      duplicateRemoteWorker:
        "{sourceActionId}: Multiple Notion pages match worker \"{ownerName}\", so the owner relation was cleared.",
      duplicateCachedWorker:
        "{sourceActionId}: Multiple roster cache entries match worker \"{ownerName}\", so the owner relation was cleared.",
      duplicateRoleWorker:
        "{sourceActionId}: Multiple workers match role \"{ownerName}\", so the owner relation was cleared.",
      cachedWorkerMissing:
        "{sourceActionId}: No roster cache entry matched worker or role \"{ownerName}\", so the owner relation was cleared.",
      remoteWorkerMissing:
        "{sourceActionId}: Worker \"{ownerName}\" was not found in the Notion member DB, so the owner relation was cleared.",
    },
  },
  notionManagedSchema: {
    error: {
      invalidPreset: "The Notion schema preset is invalid: {errors}",
      invalidParentPageUrl: "The Notion parent page URL is invalid: {reason}",
      relationTargetMissing: "{semanticKey} relation target is missing.",
      rollupTargetMissing: "{semanticKey} rollup target is missing.",
      taskMeetingPresetMissing: "task.meeting preset is missing.",
      relationNotFound: "Could not find the {taskRole} relation in the {meetingRole} Notion DB.",
      presetPropertyMissing: "{semanticKey} preset property was not found.",
      dataSourcePropertyMissing: "The Notion data source response does not include the {propertyName} property.",
      propertyTypeMissing: "The {propertyName} property type is missing.",
      rollupRelationMissing: "{semanticKey} rollup relation was not found.",
      dataSourceIdMissing: "Could not find a data source ID in Notion database {databaseId}.",
      databaseNotCreated: "{role} Notion DB has not been created yet.",
      createdPropertyMissing: "{role}.{semanticKey} Notion property was not found.",
      unsupportedPropertyType: "Unsupported Notion property type: {type}",
      responseStringMissing: "The Notion response does not include {label}.",
    },
  },
  notionDashboardService: {
    managedSchema: {
      checkRequiresToken: "Set a Notion token before checking managed DB status.",
      clientMissing: "Dirong could not create a Notion client. Check the token setting.",
      repairPlanAction: "Review the repair plan, then choose which items to apply.",
      repairConfirmRequired: "Managed schema repair requires confirm=true.",
      repairRequiresToken: "Set a Notion token before repairing managed DBs.",
      status: {
        healthy: "Managed Notion schema is healthy based on the latest check.",
        needsRepair: "Managed Notion schema has items Dirong can repair automatically.",
        manualRequired: "Managed Notion schema has items that need manual review.",
        failed: "An error occurred while checking the managed Notion schema.",
        unchecked: "Managed Notion schema has not been checked yet.",
      },
    },
    managedSchemaRepair: {
      blockedNoOperations: "Some managed schema items cannot be repaired automatically.",
      noOperations: "There are no managed schema repair operations to apply.",
      unresolvedAfterRepair: "{count} items remain after managed schema repair.",
      unresolvedAction:
        "{items} were not confirmed in the Notion response. Check the status again on the DB settings screen.",
      applied: "Applied {count} managed schema repair operations.",
      remainingAction: "Review the remaining items in Notion, or check the repair plan again.",
      reason: {
        presetSemanticMissing: "The semantic key was not found in the preset.",
        titleCreateUnsupported: "Title properties cannot be created through the API.",
        relationDependencyMissing: "The relation/rollup dependency could not be verified.",
        statusOptionManual: "Status options must be reviewed directly in Notion.",
        unsafeChangeManual: "Risky changes to existing properties are not applied automatically.",
      },
      operation: {
        syncMapping: "Sync {semanticKey} registry mapping to the remote property",
        createProperty: "Create {semanticKey} Notion property",
        renameProperty: "Repair {semanticKey} Notion property name",
        appendOptions: "Add {semanticKey} Notion options",
      },
      error: {
        missingRegistry: "{role} managed Notion DB registry does not exist.",
        missingPresetProperty: "{semanticKey} preset property was not found.",
      },
    },
    managedSchemaDiff: {
      issue: {
        mappingMissing: "{semanticKey}: SQLite property mapping is missing.",
        remoteMissingTitleUnsupported: "{semanticKey}: Notion title properties cannot be repaired through the API.",
        remoteMissing: "{semanticKey}: Notion property was not found.",
        wrongType: "{semanticKey}: Notion property type is different ({actual} -> {expected}).",
        nameDrift: "{semanticKey}: The linked Notion property name changed.",
        idMismatchNameCandidate:
          "{semanticKey}: No Notion property matched the registry property ID; only a name candidate was found.",
        relationTargetMismatch: "{semanticKey}: Relation target DB/data source is different.",
        rollupTargetMismatch: "{semanticKey}: Rollup relation/target property is different.",
        optionMissing: "{semanticKey}: Notion options are missing ({options}).",
        extra: "{propertyName}: This Notion property is not in Dirong's managed registry. It will not be deleted automatically.",
      },
      uploadAction: {
        missing: "Check the semantic properties required by the managed Notion DB: {items}",
        wrongType: "Check managed Notion DB property types/relations: {items}",
        missingOptions: "Check managed Notion DB options: {items}",
        checkAgain: "Check Notion status again on the DB settings screen, then apply the repair plan.",
      },
      error: {
        registrySnapshotMissing: "{role} registry snapshot was not found.",
      },
    },
    legacySchemaValidation: {
      missing: "Add the required properties to the Notion database: {items}",
      wrongType: "Check the Notion property types: {items}",
      checkAgain: "After updating the properties, run the Dirong connection test again.",
      semanticMissing: "Check the semantic properties required by the managed Notion DB: {items}",
      semanticWrongType: "Check the managed Notion DB property types: {items}",
      semanticCheckAgain: "Check the managed DB registry and Notion schema, then try again.",
    },
    uploadTarget: {
      targetMissingMessage: "Notion upload target is not configured.",
      targetMissingAction:
        "Create the managed Notion DBs from settings, or reconnect the upload target.",
      targetInvalidMessage: "Notion upload target URL is invalid.",
      targetInvalidAction:
        "Copy and paste the Notion database or data source URL again.",
      legacySchemaIncompatibleMessage: "Notion data source schema is not compatible.",
      managedMeetingSchemaIncompatibleMessage: "Managed Notion meeting DB schema is not compatible.",
      managedMemberSchemaIncompatibleMessage: "Managed Notion member DB schema is not compatible.",
      taskDbMissingWarning:
        "Action item page creation is skipped because the Notion Action Items DB connection is missing.",
      taskDbUnhealthyWarning:
        "Action item page creation is skipped because the Notion Action Items DB schema is unhealthy. {action}",
      taskDbCheckFailedWarning:
        "Action item page creation is skipped because Dirong could not check the Notion Action Items DB status ({error}).",
      multipleDataSourcesAction:
        "If the Notion database has multiple data sources, copy the data source URL you want to upload to.",
      dataSourceIdMissingAction:
        "Copy and paste the Notion data source URL again.",
      partialRegistryAction:
        "Some registry values already exist, so Dirong did not fall back to the legacy target. Existing DBs/properties are not modified automatically; check the registry state in Notion settings or repair.",
      actionItemUploadReady:
        "When the Action Items DB is ready, uploads create or update action item pages.",
    },
    customProperties: {
      schemaRequiresSetup: "Complete Notion setup before loading the property schema.",
      checkTokenAndManagedDb: "Check the Notion token and managed DB setup.",
      clientMissing: "Dirong could not create a Notion client.",
      syncDone:
        "Checked {discovered} Notion properties and synced {custom} custom properties into the managed list.",
      connectionAction: "Check the Notion connection and target sharing.",
      rulesSaved: "Saved {saved} Notion custom property rules and deleted {deleted}.",
      rulesIgnored: "Skipped {ignored} items because they are required properties or have empty names.",
      emptyRules: "This DB does not have custom property rules yet.",
      enabledRules: "{enabled} of {rules} custom properties are enabled.",
      missingManagedDb: "No managed DB connection info exists for the selected DB.",
      createManagedDbAction: "Create the managed DB set from Notion settings first.",
      checkTargetOrManagedDb: "Check the Notion target URL or managed DB setup.",
      invalidTargetAction: "Copy and paste the Notion database or data source URL again.",
      unsupportedTypeWarning:
        "{property}: {type} is not supported, so it was saved as rich_text.",
      participantsSourceRequiresRelationWarning:
        "{property}: participant source can only be used with relation properties, so it was saved as AI source.",
      relationNeedsTargetWarning:
        "{property}: relation properties need a target DB/data source URL or target page URL before they can be enabled.",
      unsupportedAutoWriteWarning:
        "{property}: {type} is not an automatic write target yet.",
      relationPageIdInvalidWarning:
        "{property}: Could not read the relation target page ID.",
      relationPageUrlInvalidWarning:
        "{property}: Could not read the relation target page URL.",
    },
    schema: {
      blockedApply: "Some Notion schema items cannot be applied automatically.",
      noChanges: "There are no changes to apply to the Notion schema.",
      setupRequired: "Complete Notion setup before cleaning up the schema.",
      setupAction: "Check the Notion connection token and upload target in the setup wizard.",
      invalidTargetAction: "Copy and paste the Notion database or data source URL again.",
      clientMissing: "Dirong could not create a Notion client.",
      tokenAction: "Check the Notion connection token saved in the setup wizard.",
      connectionAction: "Check the Notion connection and target sharing.",
      extraPreservedAction:
        "Unmanaged properties are not deleted. Delete them directly in Notion if you no longer need them.",
      applyAction:
        "Click Align schema to automatically add missing properties, apply renames, and fill select options.",
      diffMessage:
        "Missing {missing} / Renamed {renames} / Type mismatch {wrongType} / Missing options {missingOptions} / Unmanaged {extra}",
      applyMessage:
        "Create {create} / Rename {rename} / Type changes {updateType} / Add options {updateOptions} / Delete {delete}",
    },
    schemaManager: {
      titleCreateWarning: "Notion title properties cannot be created through the API.",
      immutableOptionManual:
        "{propertyName}: {propertyType} options cannot be cleaned up through the API and must be added directly in Notion.",
      titleCreateBlocked: "{propertyName}: Title properties cannot be created through the API.",
      relationTargetRequired: "{propertyName}: A relation target DB/data source URL is required.",
      createMissingDisabled: "Creating required properties is turned off, so missing properties are left unchanged.",
      typeChangeUnsupported:
        "{propertyName}: {actualType} -> {expectedType} type changes are not applied automatically.",
      typeUpdateDisabled: "Type updates are turned off, so mismatched properties are left unchanged.",
      statusOptionManual: "{propertyName}: Status options {options} must be added directly in Notion.",
      deleteExtraSkipped: "Unmanaged property deletion was skipped because it was not confirmed.",
      titleDeleteBlocked: "{propertyName}: Title properties are not deleted.",
    },
    relationRules: {
      pageUrlInvalid: "{property}: Could not read the relation target page URL.",
      targetUrlInvalid: "{property}: Could not read the relation target URL.",
      targetDbAccessFailed: "{property}: Could not access the relation target DB ({error}).",
    },
  },
  doctor: {
    title: "Dirong Recording + STT doctor results",
    generatedAtLabel: "Created at",
    platformLabel: "Platform",
    baseEnvironmentTitle: "Base runtime environment",
    readOnlyNotice: "This doctor is read-only. Run npm run repair if DB repair is needed.",
    secretsHiddenNotice: "Discord tokens and API key values were not printed.",
    failureNotice: "Some checks failed. Review the action guidance above first.",
    actionPrefix: "Action",
    discordVoiceOptionalName: "Discord voice channel ID (optional)",
    discordVoiceConfiguredOptional: "Configured (value is not printed). It is not required for normal recording.",
    discordVoiceNotNeeded:
      "Not required for normal recording. /dirong start uses the voice channel joined by the user.",
    stt: {
      openAiSelected: "OpenAI STT provider selected",
      openAiKeyStored: "OpenAI API key saved (value is not printed)",
      openAiKeyMissing: "OpenAI API key is not saved. No OpenAI API call was made.",
      openAiKeyAction: "Save the OpenAI API key in the setup wizard or use the local-whisper provider.",
      localWhisperLoading: "The local-whisper model loading check may take a while...",
      localWhisperSelected: "local-whisper provider selected",
      localWhisperReady: "{model} can be loaded with {device}/{computeType}.",
      localWhisperAction: "Check the model path and Python environment. On Windows, try cpu/int8 first.",
    },
    notion: {
      registryNoDb: "Cannot check Notion managed DBs because the SQLite DB does not exist.",
      registryMissingTables: "Notion registry tables are missing: {tables}",
      tokenMissingRemote: "Remote check was not run because the Notion connection token is not saved.",
      remoteCheckAction: "Check network access, the Notion token, and parent page sharing permissions.",
      registryTitle: "Notion managed registry",
      registryNoDbPrint: "Cannot check the managed registry because the SQLite DB does not exist.",
      remoteOnlyHint: "remote checks call the Notion API only with --notion-remote.",
      registryMissingTablesPrint: "managed registry tables missing: {tables}",
      registrySetupHint: "The registry is saved after the setup wizard creates managed Notion DBs.",
      latestCheckNoRecord: "latest managed schema check record: no local record",
      managedSchemaAction: "Check the repair plan on the DB settings screen.",
      dataSourceAction: "Check Notion permissions and required field/relation state.",
    },
    sqlite: {
      title: "SQLite status",
      noDb: "Session DB does not exist yet. It will be created when the first recording starts with /dirong start.",
      sessions: "sessions: {count}",
      activeSessions: "active/reconnecting/stopping sessions: {count}",
      transcriptSegments: "transcript segments: {count}, no_speech={noSpeechCount}",
      openRepairItems: "open repair items: {count}",
    },
  },
  runtimeCli: {
    main: {
      dashboardHeartbeatExpired: "Dashboard heartbeat is delayed. The server is still running.",
      dashboardStarted: "Dirong Recording + STT dashboard started: {url}",
      setupStatusApi: "Setup status API: {url}",
      sttAutomationSkipped: "STT automation not started: {message}",
      aiCleanupAutomationSkipped: "AI cleanup automation not started: {message}",
      discordLoginSkipped: "Discord bot login not started: {message}",
      dashboardStillOpen: "The dashboard remains open. Restart the app after setup is complete.",
      botLoginDone: "Dirong bot login complete: {tag}",
      configSummary: "Settings summary:",
      slashCommandAutoRegisterFailed: "Slash command auto-registration failed",
      discordCommandsAvailable: "You can use /dirong start, /dirong stop, and /dirong status in Discord.",
      consoleCommandsAvailable: "You can use status, stop, and exit in this console.",
      unhandledRejection: "Unhandled async error",
      uncaughtException: "Fatal error",
      dashboardStartFailed: "Dashboard start failed",
      noActiveProjectGuild: "No active project Discord server is available for command registration. Restart after setup is complete.",
      guildCommandRegistered: "Guild slash command registered/updated: {name} ({id})",
      guildCommandRegisterFailed: "Slash command registration failed ({guildId})",
      noSlashCommandRegistered: "Could not register slash commands in any configured Discord server.",
      guildFetchFailed: "Could not fetch Discord server information.",
      shortCommandsAvailable: "Available commands: /dirong start, stop, status",
      slashCommandHandleFailed: "slash command handling failed",
      recordingStopped: "Recording stopped: {sessionId} ({status})",
      consoleCommandsAvailableShort: "Available console commands: status, stop, exit",
      shutdownProcessing: "Shutting down: {reason}",
      sttAutomationStopFailed: "Failed to stop STT automation",
      aiCleanupAutomationStopFailed: "Failed to stop AI cleanup automation",
      notionAutomationStopFailed: "Failed to stop Notion auto-upload",
      retentionAutomationStarted: "Started automatic text retention cleanup.",
      retentionAutomationStopFailed: "Failed to stop retention cleanup",
      aiLifecycleStopFailed: "Failed to stop AI lifecycle",
      aiPreparing: "Preparing AI: {provider} / {model}",
      recordingCanStart: "Recording can start right away.",
      aiStatus: "AI status: {message}",
      sttAutomationDisabled: "STT automation is turned off. The manual Phase 3 STT CLI is still available.",
      sttAutomationStarted: "STT automation started: processing queued STT jobs.",
      aiCleanupAutomationDisabled: "AI cleanup automation is turned off. The manual Phase 4 CLI is still available.",
      aiCleanupAutomationStarted: "AI cleanup automation started: waiting for finalized sessions and completed STT.",
      notionAutomationStarted: "Notion auto-upload started: waiting for completed valid drafts.",
      notionAutomationWatchStarted: "Watching Notion auto-upload settings: {message}",
      notionSettingsApplyNextTick: "Notion settings apply from the next automation tick after saving.",
      aloneFinalizeDisabled: "Alone finalize is turned off. It can be enabled in dashboard settings.",
      aloneFinalizeStarted: "Alone finalize started: finalize after non-bot count stays 0 for {graceMs}ms.",
      activeGuildMissingDetail: "Could not determine the Discord server ID for the active recording session.",
      voiceChannelMissingDetail: "Could not find voice channel: {voiceChannelId}",
      voiceMemberCacheEmptyDetail: "Discord voice member cache was empty, so auto-finalize was skipped.",
    },
    phaseCli: {
      phase2FakeTitle: "Dirong Fake STT results",
      phase2UnknownOption: "Unknown Phase 2 fake STT option: {flag}",
      phase3RealTitle: "Dirong Real STT results",
      phase3UnknownOption: "Unknown Phase 3 STT option: {flag}",
      phase4Title: "Dirong Phase 4 AI cleanup results",
      phase4UnknownOption: "Unknown Phase 4 AI cleanup option: {flag}",
      phase5Title: "Dirong Phase 5 Notion upload results",
      phase5UnknownOption: "Unknown Phase 5 Notion upload option: {flag}",
      sessionValueRequired: "--session value is required.",
      phase4SessionRequired: "--session <session-id> is required.",
      modelValueRequired: "--model value is required.",
      draftValueRequired: "--draft value is required.",
      sttProviderInvalid: "--provider must be local-whisper or openai.",
      aiProviderInvalid: "--provider must be settings, fake, claude-cli, claude-api, codex-cli, or gemini-cli.",
      smokeTestRequiresFake: "--smoke-test is only for explicit smoke tests with --provider fake.",
      includeFakeSttRequiresDryRun: "--include-fake-stt can only be used with dry-run diagnostics or --provider fake --smoke-test.",
      phase5SelectorRequired: "Exactly one of --session or --draft is required.",
      fakeSttIncludedWarning: "Warning: fake STT input for testing is included. Do not use this path for normal meeting-note generation.",
      backupDryRunSkipped: "SQLite snapshot backup: skipped in dry-run",
      realSttMissingDbBackup: "SQLite DB does not exist yet, so no backup was created.",
      openAiDryRunKeyNotRequired: "An OpenAI API key is not required for the current provider dry-run.",
      repairTitle: "Dirong Recording + STT repair results",
      repairNotice: "repair is an explicit command that may modify DB state.",
    },
    argParser: {
      positiveIntegerRequired: "{flag} must be a positive integer.",
    },
    sqliteBackup: {
      created: "SQLite snapshot backup created:",
    },
    media: {
      ffmpegMissing: "Could not find the ffmpeg executable.",
      fallbackUnknown: "unknown",
      fallbackNotice: "Fell back to {fallbackFormat} after default {preferredFormat} transcode failed. Reason: {error}",
      defaultFormatFailed: "default format failed",
      fallbackFailed: "fallback failed",
      sttSafeFailed: "STT-safe transcode failed: {firstError} / fallback: {fallbackError}",
      fileMissing: "File does not exist.",
      fileEmpty: "File size is 0 bytes.",
      validationFailed: "ffmpeg validation failed (exit={exitCode})",
    },
    discordCommands: {
      description: "Dirong recording and STT pipeline",
      start: "Start recording in the voice channel you are currently in.",
      stop: "Stop the current recording and close open chunks.",
      status: "Check current recording, chunk, STT queue, and repair status.",
    },
    localSecretStore: {
      emptyValue: "secret value cannot be empty.",
      invalidRef: "secret ref may only contain letters, numbers, dots, underscores, colons, and hyphens.",
    },
    setupGateway: {
      applicationBotMismatch: "The Discord application ID and bot token belong to different bot users.",
      botUserMissing: "Could not verify the Discord bot user.",
    },
    aiWorkflow: {
      fakeSttUnsafe: "fake STT cannot be sent to a real AI cleanup provider. Use only Phase 3 Real STT results for normal meeting-note generation. fake STT verification is allowed only in dry-run or --provider fake --smoke-test paths.",
      emptyTimeline: "There is no real STT speech to send for meeting notes yet. Run Phase 3 Real STT first. no_speech and fake STT are excluded from Phase 4 input by default. For testing, use --include-fake-stt in dry-run, or use --provider fake --smoke-test --include-fake-stt for an explicit smoke test.",
      inputTooLong: "The meeting transcript exceeds the Phase 4 MVP single-pass limit. input={inputChars}, max={maxInputChars}. Long-meeting map-reduce summarization is out of scope until Phase 4.1.",
      repairFailed: "Meeting-note JSON schema validation failed and automatic repair also failed.",
    },
    fakeProvider: {
      draftTitle: "Meeting notes draft: {sessionId}",
      summary: "Fake meeting notes draft generated from {entryCount} transcript entries.",
      topicTitle: "Meeting content",
      removedChatterSummary: "The fake provider did not remove real chatter.",
      keptBecause: "Deterministic draft for offline verification.",
    },
    aiProvider: {
      claudeCliMissing: "Could not find Claude CLI. Check that {command} --version runs in a terminal. {error}",
      claudePreflightFailed: "Claude CLI preflight failed. Check {command} --version in a terminal. {detail}",
      terminalCliMissing: "Could not find {provider}. Check that {command} --version runs in a terminal. {error}",
      terminalPreflightFailed: "{provider} preflight failed. Check {command} --version in a terminal. {detail}",
      streamProcessStarted: "Claude stream-json process started",
      firstStreamEventWaiting: "Waiting for first Claude stream event",
      resultBoundaryReceived: "Claude result boundary received",
      streamProtocolFailed: "Claude stream-json protocol failed",
      streamResponseReceiving: "Receiving Claude stream-json response",
    },
    sttProvider: {
      localWhisperPreflightFailed: "local-whisper preflight failed.",
      localWhisperTextMissing: "Could not find the JSON text field in local-whisper wrapper stdout.",
      noStdoutOrStderr: "no stderr/stdout output",
      openAiKeyMissing: "OpenAI API key is not saved, so real STT cannot call OpenAI.",
      openAiFileTooLarge: "OpenAI STT input file exceeds the 25MB limit: {bytes} bytes",
      openAiTextMissing: "OpenAI STT API response does not include a text field.",
      openAiNotCalled: "OpenAI API key is not saved, so OpenAI STT was not called. Use --provider local-whisper for local-whisper.",
    },
    storage: {
      aiCleanupJobSaveFailed: "Failed to save AI cleanup job.",
      sttFailedCount: "STT failed: {count}",
      sttMissingInputCount: "STT input file missing: {count}",
      chunkMissingSttJobCount: "chunks without STT job: {count}",
      chunkTranscodeFailedCount: "chunks with transcode failure: {count}",
      chunkMissingSttAudioCount: "chunks without STT audio path: {count}",
      chunkCreateMissing: "chunk file was not created.",
      sttJobChunkMissing: "Could not find chunk for STT job: {chunkId}",
      chunkMissing: "Could not find chunk: {chunkId}",
      transcriptSegmentSaveFailed: "Failed to save transcript segment: {jobId}",
      aiCleanupJobMissing: "Could not find AI cleanup job: {jobId}",
      meetingNotesDraftSaveFailed: "Failed to save meeting notes draft.",
      sttInputAudioMissing: "STT input audio file does not exist.",
    },
    sqlite: {
      backupFailed: "SQLite backup failed.",
      recordingRetry: "If recording is in progress, try again shortly.",
      sttNotClaimed: "Because backup failed, the STT job was not claimed and attempts were not increased.",
      migrationBackupFailed: "SQLite migration backup failed.",
      migrationAborted: "Startup stopped without applying migrations.",
      schemaUnchanged: "Because backup failed, DB schema was not changed.",
    },
    repairScan: {
      preserveOrDeleteAction: "Manually decide whether to preserve or delete it.",
      ffmpegMissing: "FFmpeg required for startup repair is missing.",
      stalePartOnly: "stale writing chunk has no final file and only a .part file remains.",
      manualPlaybackAction: "Manually check whether the file can be played or preserved.",
      staleFilesMissing: "stale writing chunk has neither final file nor .part file.",
      sttSafeFfmpegMissing: "FFmpeg for creating STT-safe audio is missing.",
      finalizedRawMissing: "finalized chunk is missing its raw audio file.",
      orphanAudioFile: "audio file exists but no SQLite chunk row exists.",
    },
  },
  meetingNotesMarkdown: {
    draftTitle: "Meeting notes draft",
    summaryHeading: "Summary",
    topicsHeading: "Key Topics",
    decisionsHeading: "Decisions",
    actionItemsHeading: "Action Items",
    unresolvedHeading: "Unresolved / Uncertain Items",
    noiseHeading: "Chatter / Noise Handling",
    sourceTimelineHeading: "Source Timeline",
    empty: "None",
    decided: "Decided",
    tentative: "Tentative",
    ownerLabel: "Owner",
    dueLabel: "Due",
    unspecified: "Unspecified",
    unresolvedLabel: "Unresolved",
    uncertainLabel: "Uncertain",
    reasonLabel: "reason",
    removedChatterPrefix: "Removed/compressed: ",
    keptBecausePrefix: "Kept because: ",
    keptBecauseHeading: "Kept because:",
    sourceLabel: "Source",
  },
  notionBlocks: {
    meetingInfoHeading: "Meeting Info",
    meetingTimeLabel: "Meeting time",
    channelLabel: "Channel",
    participantsLabel: "Participants",
    summaryHeading: "Summary",
    topicsHeading: "Key Discussion",
    decisionsHeading: "Decisions",
    actionItemsHeading: "Action Items",
    unresolvedHeading: "Open Questions",
    uncertaintyHeading: "Uncertain Content",
    noiseHeading: "Noise Handling Notes",
    timelineHeading: "Timeline",
    dirongInfoHeading: "Dirong Info",
    empty: "None",
    decided: "Decided",
    tentative: "Tentative",
    ownerLabel: "Owner",
    dueLabel: "Due",
    reasonLabel: "reason",
    removedChatterLabel: "Removed/compressed",
    keptBecauseLabel: "Kept because",
    unspecified: "Unspecified",
    noContent: "No content",
  },
  discordRuntime: {
    serverOnly: "Dirong can only be used inside a Discord server.",
    guildNotAllowed: "This Dirong app can only be used in Discord servers selected in the dashboard settings.",
    noVoiceChannel: "Join the Discord voice channel you want to record, then run /dirong start.",
    startPublicTitle: "Dirong started recording this voice channel.",
    privacyAudioLocalDeleteAfterNotion: "Audio files are saved on the PC running Dirong and deleted after a successful Notion upload.",
    textRetentionDefault: "Text processing results are deleted automatically after 30 days by default.",
    optOut: "Leave the voice channel if you do not want to participate.",
    startedBy: "Started by: {name}",
    sessionId: "Session ID: {sessionId}",
    startConfirmation: "Recording started.",
    session: "Session: {sessionId}",
    voiceChannel: "Voice channel: {channel}",
    dashboard: "Dashboard: {url}",
    stopPublicTitle: "Dirong stopped the recording.",
    status: "Status: {status}",
    stopConfirmation: "Recording stopped.",
    unknownSubcommand: "Unknown subcommand.",
  },
  setup: {
    discord: {
      status: {
        notConfigured: {
          message: "Discord bot connection setup is not complete yet.",
          action:
            "Finish the Discord application ID, bot token, and server selection in Settings.",
        },
        ready: {
          message: "Required Discord settings are saved.",
        },
      },
      applicationId: {
        save: {
          done: {
            message: "Discord application ID has been saved.",
          },
        },
        error: {
          invalid: {
            message: "The Discord application ID format is invalid.",
            action: "Copy the numeric Application ID again from the Discord Developer Portal.",
          },
        },
      },
      botToken: {
        save: {
          done: {
            message: "Discord bot token has been saved to the local secret file.",
          },
        },
        error: {
          missing: {
            message: "Discord bot token is empty.",
            action: "Copy the token again from the Bot page in the Discord Developer Portal.",
          },
        },
      },
      connection: {
        test: {
          done: {
            message:
              "The application ID and bot token have been verified as values for the same Discord bot.",
          },
        },
        error: {
          notConfigured: {
            message: "Discord connection test values are missing.",
            action: "Save the application ID and bot token first.",
          },
          failed: {
            message: "Discord connection test failed.",
            action: "Check that the bot token was regenerated correctly and the application ID belongs to the same bot.",
          },
        },
      },
      guilds: {
        list: {
          done: {
            message: "Loaded the Discord servers that include the Dirong bot.",
          },
          empty: {
            action: "Use the generated invite link to add the Dirong bot to the Discord server first.",
          },
        },
        error: {
          notConfigured: {
            message: "A bot token is required before loading Discord servers.",
            action: "Save the Discord bot token first.",
          },
          failed: {
            message: "Could not load the Discord server list.",
            action: "Check that the bot token is valid and the bot has been invited to the server.",
          },
        },
      },
      guildAllowlist: {
        save: {
          done: {
            message: "Saved the Discord servers where recording is allowed.",
          },
        },
        error: {
          invalid: {
            message: "The selected Discord server value is invalid.",
            action: "Select the server for Dirong again from the server list.",
          },
          notInBotGuilds: {
            message: "One or more selected servers do not include the Dirong bot.",
            action: "Invite the bot to that server, then reload the server list.",
          },
        },
      },
    },
    recording: {
      status: {
        blocked: {
          message: "Recording can start after Discord and STT setup is complete.",
          action: "Finish Discord bot connection and STT provider setup first.",
        },
        ready: {
          message: "Basic settings required to start recording are ready.",
        },
      },
      aloneFinalize: {
        save: {
          done: {
            message: "Auto-stop wait time was saved.",
          },
        },
        error: {
          invalidGrace: {
            message: "Auto-stop wait time is invalid.",
            action: "Enter a value from 5 to 3600 seconds.",
          },
        },
      },
    },
    stt: {
      status: {
        notConfigured: {
          message: "STT provider and model settings have not been saved yet.",
          action:
            "Choose local faster-whisper or OpenAI STT in the setup wizard.",
        },
        openAiApiKeyMissing: {
          message: "OpenAI STT API key has not been saved yet.",
          action: "Enter the API key again to keep using OpenAI STT.",
        },
        ready: {
          message: "Basic STT settings are saved.",
        },
      },
      settings: {
        save: {
          done: {
            message: "STT provider and model settings have been saved.",
          },
        },
        error: {
          invalidProvider: {
            message: "Unsupported STT provider.",
            action: "Choose either local-whisper or openai.",
          },
          invalidModel: {
            message: "The STT model name is invalid.",
            action: "Choose small, medium, or a model name supported by the selected provider.",
          },
          invalidCommand: {
            message: "The STT command is not allowed.",
            action: "The dashboard can only use the default local-whisper profile.",
          },
          invalidLanguage: {
            message: "The transcription & notes language value is invalid.",
            action: "Choose either Korean (ko) or English (en).",
          },
          invalidTimeout: {
            message: "The STT processing timeout value is invalid.",
            action: "Enter a value between 5000ms and 600000ms.",
          },
        },
      },
      openAiTest: {
        done: {
          message: "OpenAI STT connection was verified and saved.",
        },
        error: {
          missingKey: {
            message: "OpenAI API key is missing.",
            action: "Enter an API key to use OpenAI STT.",
          },
          failed: {
            message: "OpenAI STT connection test failed.",
            action: "Check the API key, model, and network connection, then try again.",
          },
        },
      },
    },
    ai: {
      status: {
        notConfigured: {
          message: "AI meeting-notes provider settings have not been saved yet.",
          action: "Choose Claude, Codex, or Gemini in the setup wizard.",
        },
        claudeApiKeyMissing: {
          message: "Claude API key has not been saved yet.",
          action: "Enter the Claude API key again or switch to Claude CLI mode.",
        },
        claudeCliCommandMissing: {
          message: "Claude CLI command has not been saved yet.",
          action: "Save the command to use Claude CLI mode.",
        },
        cliCommandMissing: {
          message: "The AI provider CLI command has not been saved yet.",
          action: "Save the command to use a terminal provider.",
        },
        ready: {
          message: "AI meeting-notes provider settings are saved.",
        },
      },
      claude: {
        save: {
          done: {
            message: "AI provider settings have been saved.",
          },
        },
        test: {
          done: {
            message: "AI provider connection test completed.",
          },
          error: {
            notConfigured: {
              message: "AI provider connection test settings are missing.",
              action: "Save the AI provider and mode first.",
            },
            failed: {
              message: "AI provider connection test failed.",
              action: "Check that the CLI command runs or that the API key is valid.",
            },
          },
        },
        error: {
          invalidMode: {
            message: "Unsupported AI provider mode.",
            action: "Claude supports cli/api; Codex and Gemini support cli.",
          },
          apiKeyMissing: {
            message: "Claude API key is empty.",
            action: "Enter an API key to use Claude API mode.",
          },
          invalidCommand: {
            message: "The AI CLI command is not allowed.",
            action: "The dashboard can only use the default Claude, Codex, or Gemini CLI profile.",
          },
          invalidModel: {
            message: "Unsupported AI provider model.",
            action: "For Claude, choose haiku, sonnet, or opus. For Codex/Gemini, use default or a safe model name.",
          },
        },
      },
    },
    notion: {
      status: {
        notConfigured: {
          message: "Notion connection setup is not complete yet.",
          action: "Save the Notion internal connection token and Notion DB management page URL.",
        },
        registryMissing: {
          message:
            "Notion connection values exist, but the managed DB registry is missing.",
          action:
            "Create the Meeting, Member, and Action Item DB set in the managed DB step of the wizard.",
        },
        registryPartial: {
          message:
            "The Notion managed DB registry is only partially saved, so upload is blocked.",
          action:
            "Dirong will not automatically modify existing DBs or properties. Check the registry state in the Notion settings or repair screen.",
        },
        ready: {
          message: "Notion managed DB registry is ready.",
        },
      },
      token: {
        save: {
          done: {
            message: "Notion internal connection token has been saved to the local secret file.",
          },
        },
        error: {
          missing: {
            message: "Notion token is empty.",
            action: "Copy the token again from the Notion internal connection settings.",
          },
        },
      },
      parentPage: {
        save: {
          done: {
            message: "Notion DB management page URL has been saved.",
          },
        },
        verify: {
          done: {
            message: "Notion DB management page access has been verified.",
          },
          error: {
            notConfigured: {
              message: "Notion DB management page verification values are missing.",
              action: "Save the Notion token and Notion DB management page URL first.",
            },
            failed: {
              message: "Could not access the Notion DB management page.",
              action: "Check that the Dirong internal connection was shared with the page using Add connection.",
            },
          },
        },
        error: {
          invalid: {
            message: "The Notion DB management page URL format is invalid.",
            action: "Copy a Notion page link where Dirong can create DBs, not a database link.",
          },
        },
      },
      uploadMode: {
        save: {
          done: {
            message: "Notion upload mode has been saved.",
          },
        },
        error: {
          invalid: {
            message: "The Notion upload mode value is invalid.",
            action: "Pick automatic or manual and save again.",
          },
        },
      },
      managedDatabases: {
        create: {
          done: {
            message: "Notion managed DB set has been created and saved to the registry.",
          },
          existing: {
            message: "The Notion managed DB registry is already ready.",
          },
        },
        error: {
          registryMissing: {
            message: "Notion registry store is not connected to the dashboard.",
            action: "Start the dashboard with the SQLite registry connected.",
          },
          partialRegistry: {
            message: "Some Notion registry values already exist, so new DB creation was blocked.",
            action: "Check the registry state in a later repair screen before continuing.",
          },
          localeUnsupported: {
            message: "The selected language's Notion schema preset cannot be created yet.",
            action: "For the MVP, continue with the Korean schema preset first.",
          },
          failed: {
            message: "Notion managed DB creation failed.",
            action: "Check the Notion DB management page sharing permissions and Notion token, then retry.",
          },
        },
      },
    },
    project: {
      name: {
        save: {
          done: {
            message: "Project name saved.",
            action:
              "Restart Dirong. The server keeps running if the dashboard is closed; type exit in the running console to quit.",
          },
        },
        error: {
          invalid: {
            message: "The project name is invalid.",
            action: "Enter 1 to 80 characters.",
          },
          missingProject: {
            message: "There is no active project to rename.",
            action: "Create a project, then try again.",
          },
        },
      },
    },
    dataRetention: {
      status: {
        ready: {
          message: "Default retention policy is applied.",
        },
      },
      save: {
        done: {
          message: "Saved the text & draft retention period.",
        },
      },
      error: {
        invalidDays: {
          message: "Retention days must be between 1 and 365.",
          action: "Enter a number between 1 and 365.",
        },
      },
    },
    runtimeEffect: {
      dashboard: {
        currentProcess: {
          message: "This setting applies to the current dashboard immediately.",
        },
      },
      discord: {
        restartRequired: {
          message: "The value is saved, but the current Discord bot login will not reload automatically.",
          action: "Restart the app to apply it without disrupting an active recording session.",
        },
      },
      recording: {
        restartRequired: {
          message: "The value is saved, but the current auto-stop timer will not reload automatically.",
          action: "Restart the app to apply it while preserving the active recording session.",
        },
      },
      stt: {
        restartRequired: {
          message: "The value is saved, but the current STT automation provider will not reload automatically.",
          action: "Restart the app to apply it while preserving active recording or transcription work.",
        },
      },
      ai: {
        restartRequired: {
          message: "The value is saved, but the current AI provider process will not reload automatically.",
          action: "Restart the app to apply it while preserving active AI work.",
        },
      },
      notion: {
        nextTick: {
          message: "Notion settings apply to the next dashboard action or automation tick.",
        },
      },
    },
  },
  dashboard: {
    app: {
      title: "Dirong Dashboard",
      subtitle: "Check the flow from recording through Notion upload.",
      generatedAt: "Updated",
    },
    sidebar: {
      projects: { label: "PROJECTS" },
      servers: { label: "SERVERS" },
      sections: { label: "SECTIONS" },
      quick: { label: "QUICK" },
    },
    server: {
      current: "Current server",
      unselected: "No server selected",
      add: { action: "+ Add server" },
    },
    nav: {
      dashboard: "Dashboard",
      databaseSettings: "DB Settings",
      logs: "Logs",
      settings: "Settings",
    },
    quick: {
      startRecording: "Start recording",
      startRecordingHint: "Run /dirong start in Discord.",
      refreshStatus: "Check status again",
    },
    projects: {
      empty: "No projects",
      add: "+ Add project",
      adding: "Adding...",
      nameLabel: "Project name",
      namePlaceholder: "Example: Weekly sync",
      create: "Create",
      cancel: "Cancel",
      active: "active",
      activeContext: "active project",
      noActive: "No active project.",
      unavailable: "project list",
      switching: "switching",
      actionDone: "project update",
      actionBlocked: "project blocked",
      switchDone: "Switched the active project.",
      createDone: "Created and activated a new project.",
      createReused: "Activated the project.",
      guildMissing: "No server selected",
      commandEnabled: "command on",
      commandDisabled: "command off",
      notion: {
        ready: "Notion ready",
        partial: "Notion partial",
        missing: "Notion setup",
      },
      lifecycle: {
        draft: "draft",
        ready: "ready",
        archived: "archived",
        resetting: "resetting",
      },
      blockReasons: {
        already_switching: "Another project switch is already running.",
        project_not_found: "Project not found.",
        project_archived: "Archived projects cannot become active.",
        project_resetting: "Projects currently resetting cannot become active.",
        recording_active: "Projects cannot be switched while recording is active.",
        notion_upload_in_flight: "Projects cannot be switched while Notion upload is in flight.",
        ai_cleanup_in_flight: "Projects cannot be switched while AI cleanup is in flight.",
      },
    },
    setupIncomplete: {
      banner: {
        title: "Setup is not finished yet.",
        description: "Finish first setup before using Dirong.",
        action: "Continue setup",
      },
      lockedTitle: "Locked features",
    },
    setupWizard: {
      title: "First Setup Wizard",
      loading: "Waiting for the setup status API.",
      fetchFailed: "Could not load setup status.",
      intro:
        "Guides first-time users through tokens, server selection, STT, AI provider, and Notion creation from the dashboard.",
      progress: "{completed} / {total}",
      steps: {
        language: "Language",
        discord: "Connect Discord Bot",
        guild: "Select Discord Server",
        stt: "Select STT Provider/Model",
        ai: "Select AI provider",
        notionToken: "Enter Notion Token",
        notionParent: "Enter Notion DB Management Page URL",
        notionManaged: "Create Managed DBs",
        projectName: "Set Project Name",
      },
      actions: {
        goDashboard: "Go to Dashboard",
        skipToDashboard: "Set up later and view dashboard",
        next: "Next",
        continue: "Continue",
        saveLanguage: "Save language",
        saveDiscordApplicationId: "Save application ID",
        saveDiscordBotToken: "Save bot token",
        testConnection: "Check connection",
        loadGuilds: "Load server list",
        saveSelectedGuild: "Save selected server",
        saveStt: "Save STT settings",
        saveAndInstallStt: "Save and install",
        saveAndTestOpenAi: "Save and test connection",
        saveClaude: "Save AI settings",
        saveNotionToken: "Save Notion token",
        saveParentPage: "Save DB management page URL",
        verifyAccess: "Check access",
        createManagedDb: "Create managed DBs",
        saveProjectName: "Save project name",
        restartFromBeginning: "Review from the beginning",
      },
      fallback: {
        defaultsMissing: "Server defaults have not loaded yet.",
        retryLater: "Try again in a moment.",
        checkDiscordToken: "Check whether the Discord bot token has been saved.",
      },
      language: {
        title: "Choose the app language",
        description:
          "In this version, the app language, wizard language, and Notion schema locale are saved as the same value.",
        korean: {
          title: "한국어",
          description:
            "Automatically sends meetings from Discord voice channels to Notion and helps organize follow-up schedules and action items.",
        },
        english: {
          title: "English",
          description:
            "Save the dashboard, setup wizard, and Notion DB preset in English.",
        },
        englishNotice:
          "If you choose English, the Notion schema locale is also saved as en and managed Notion DBs are created with English names.",
      },
      discord: {
        title: "Connect a Discord bot",
        description:
          "Save the application ID and bot token created in the Discord Developer Portal. The token will not be shown again after it is saved.",
        applicationIdLabel: "Discord application ID",
        applicationIdPlaceholder: "Numeric application ID",
        botTokenLabel: "Discord bot token",
        botTokenPlaceholder: "This will not be shown again after saving",
        inviteLabel: "Invite link",
        inviteLink: "Add the Dirong bot to a Discord server",
        connectionCheck: {
          title: "Connection check",
          description:
            "Checks whether the application ID and bot token belong to the same Discord bot. After it succeeds, choose the server that includes the bot in the next step.",
          checkingTitle: "Checking the connection",
          checkingDescription:
            "Automatically checking whether the application ID and bot token belong to the same Discord bot.",
          verifiedTitle: "Connection verified",
          verifiedDescription:
            "These values belong to the same Discord bot. You can continue to the next step.",
          failedTitle: "Connection could not be verified",
          failedDescription:
            "Check that the application ID and bot token belong to the same bot. Save the values again to run the check again automatically.",
        },
        guide: {
          portalLink: "Discord Developer Portal",
          applicationIdTitle: "How to get the application ID",
          applicationIdStep1Suffix: ".",
          applicationIdStep2: "Open the Applications menu on the left.",
          applicationIdStep3: "Click New Application to create an application.",
          applicationIdStep4: "Open the application, then click General Information on the left.",
          applicationIdStep5: "Click Copy next to the Application ID.",
          applicationIdStep6:
            "Return to Dirong, paste it into the Discord application ID field, and save it.",
          botTokenTitle: "How to copy the bot token after creating the application ID",
          botTokenStep1: "In the same application, click Bot on the left.",
          botTokenStep2: "Click Reset Token to issue a new bot token.",
          botTokenStep3:
            "If multi-factor authentication opens, enter your login password to confirm.",
          botTokenStep4: "Click Copy for the newly issued token.",
          botTokenStep5:
            "Return to Dirong, paste it into the Discord bot token field, and save it.",
        },
      },
      guild: {
        title: "Select the Discord server where recording is allowed",
        description:
          "Only servers that already include the bot are shown. You do not need to type a server ID.",
        empty: "The server list has not been loaded yet.",
        invite: {
          title: "Add the bot to a server",
          description:
            "If the server you want is not listed, add the Dirong bot with the invite link first, then reload the server list.",
          link: "Add the Dirong bot to a Discord server",
        },
      },
      stt: {
        title: "Select an STT provider and model",
        description:
          "The default recommendation is local faster-whisper, which runs on your PC. OpenAI STT is a paid advanced option that requires an API key.",
        localWhisper: {
          title: "Recommended: local faster-whisper",
          description: "Free, and audio is not sent to an external STT API.",
          install: {
            title: "Local Whisper setup",
            idle: "Choose a model, then save and install to check Python, faster-whisper, and the model files.",
            runningTitle: "Preparing local Whisper",
            doneTitle: "Local Whisper is ready",
            failedTitle: "Local Whisper setup failed",
            lastLog: "Show last log",
            stages: {
              idle: "Setup has not started yet.",
              checking_python: "Checking Python environment.",
              creating_venv: "Creating an app-managed Python environment.",
              installing_package: "Installing faster-whisper.",
              checking_package: "Checking faster-whisper installation.",
              downloading_model: "Downloading the selected Whisper model.",
              checking_model: "Loading the downloaded model for verification.",
              done: "Local Whisper is ready to use.",
              failed: "Local Whisper setup failed.",
            },
          },
        },
        openAi: {
          title: "Advanced: OpenAI STT (API key required - paid)",
          description:
            "Processing can be easier, but API costs apply and audio is sent to OpenAI.",
          apiKeyLabel: "OpenAI API key",
          apiKeyPlaceholder: "API key required - paid",
        },
        smallModel: {
          title: "Recommended: fast",
          description: "small / cpu / int8. Recommended first for most PCs.",
        },
        mediumModel: {
          title: "Prioritize accuracy",
          description:
            "medium / cpu / int8. It can be slower, but may improve Korean meeting quality.",
        },
      },
      ai: {
        title: "Choose the AI meeting-notes provider",
        description:
          "You can use Claude, Codex, or Gemini as a terminal provider. Claude also supports API mode.",
        cli: {
          title: "Use terminal CLI",
          description: "Runs a local Claude, Codex, or Gemini command to create meeting notes.",
        },
        api: {
          title: "Use Claude API",
          description: "Stores an API key and creates meeting notes.",
          apiKeyLabel: "Claude API key",
        },
        apiKeyPlaceholder: "This will not be shown again after saving",
        modelLabel: "Model (optional)",
        providerLabel: "Provider",
        providers: {
          claude: "Claude",
          codex: "Codex",
          gemini: "Gemini",
        },
        models: {
          default: "default",
          haiku: "haiku",
          sonnet: "sonnet",
          opus: "opus",
        },
      },
      notionToken: {
        title: "Enter the Notion connection access token",
        description:
          "Create a new connection in Notion Developers, then copy and paste the access token here. The token is saved in the local secret file and the raw value is not shown again.",
        label: "Notion token",
        placeholder: "secret_ or ntn_ token",
        guide: {
          title: "How to create a Notion token",
          profileLink: "Notion Developers",
          step1Suffix: ".",
          step2: "Click Getting started in the menu.",
          step3: "Under Create a connection, click + New connection.",
          step4:
            "Enter a clear bot name for the connection, then choose Access token as the authentication method.",
          step5:
            "Choose the workspace where meeting notes will be created under Installable workspaces, then click Create connection.",
          step6: "Click Connections in the menu, then click Manage for the connection you just created.",
          step7: "Click Copy in the Access token field.",
          step8: "Return to Dirong and paste it into the Notion token field.",
        },
      },
      notionParent: {
        title: "Enter the Notion DB management page URL",
        description:
          "Enter the Notion page URL where Dirong should create the Meeting, Member, and Action Item DBs. If you do not have one yet, create a blank Notion page and paste that page URL here.",
        label: "Notion DB management page URL",
        placeholder: "https://www.notion.so/...",
      },
      notionManaged: {
        title: "Create the managed Notion DB set",
        description:
          "You do not need to type database IDs, data source IDs, or property IDs. Dirong saves the created result in the registry.",
        unsupportedNotice:
          "The current app language and Notion schema locale is {locale}. No managed Notion DB preset was found for this locale.",
        readyNotice:
          "This button creates the Meeting, Member, and Action Item DBs inside the Notion DB management page and saves the internal mapping in the registry.",
        openInNotion: "Open in Notion",
      },
      projectName: {
        title: "Name your Dirong project",
        description: "Enter the project name you want to use in Dirong.",
        label: "Project name",
        placeholder: "Example: Weekly operations meeting",
        restartTitle: "Setup is complete",
        restartDescription:
          "Restart Dirong to apply the saved setup. The server keeps running if the dashboard is closed; type exit in the running console to quit.",
      },
      features: {
        discord: "Discord",
        recording: "Recording",
        stt: "STT",
        ai: "AI",
        notion: "Notion",
        dataRetention: "Data retention",
      },
    },
    pipeline: {
      currentSession: "Current session",
      noRecentSession: "No recent session",
      startsAfterRecording: "Progress will appear here after recording starts.",
      recording: "Recording",
      draftDone: "Meeting-note draft created",
      aiRunning: "Creating meeting notes",
      aiQueued: "AI cleanup job is waiting",
      aiRetryQueued: "Meeting-note retry queued ({attempts}/{maxAttempts})",
      aiBlocked: "Meeting-note generation is blocked",
      aiFailed: "Meeting-note generation failed",
      sttRunning: "Transcription is running",
      sttNeedsAttention: "STT needs attention",
      aiWaiting: "Waiting for AI cleanup",
      aiJob: "AI job",
      sessionStatus: "Session status",
      sttCounts: "STT status",
    },
    automation: {
      aiReadinessMissing: "AI readiness snapshot is not available yet.",
      sttMissing: "STT automation snapshot is not available yet.",
      aiCleanupMissing: "AI cleanup automation snapshot is not available yet.",
      unavailable: "Unavailable",
      notChecked: "Not checked yet",
      checkedAt: "Checked",
      runStats: "Run result",
      examined: "Examined",
      done: "Done",
      missing: "Missing",
      failed: "Failed",
      more: "More queued",
      yes: "yes",
      no: "no",
      progress: "Progress",
      elapsed: "Elapsed",
      lines: "Lines",
      bytes: "bytes",
      last: "Last",
      repair: "repair",
      details: "Automation details",
      retrying: "Retry queued ({attempts}/{maxAttempts})",
      retry: "Retry",
      retryRequested: "Requesting retry...",
      failureReason: "Failure reason",
      sttDone: "STT done",
      sttFailed: "STT failed",
      sttMissingFile: "Audio file missing",
      realTranscript: "Real transcript",
    },
    notionUploadPanel: {
      unavailable: "Notion status has not loaded yet.",
      openPage: "Open Notion page",
      lastError: "Last error",
      automation: "Automation",
      latestDetails: "Recent Notion write details",
      send: "Send to Notion",
      retry: "Retry",
      failureReason: "Upload failure reason",
      pageReady: "Page ready",
    },
    notionManual: {
      review: "Review notes",
      upload: "Upload notes",
    },
    status: {
      recording: { label: "Recording" },
      stt: { label: "Transcription" },
      ai: { label: "AI" },
      notion: { label: "Notion" },
      value: {
        ready: "Ready",
        connected: "Connected",
        checking: "Checking",
        processing: "Processing",
        warning: "Needs attention",
        blocked: "Blocked",
        notConfigured: "Setup needed",
        idle: "Idle",
        recording: "Recording",
        done: "Done",
        failed: "Failed",
        disabled: "Disabled",
        manual: "Manual",
      },
    },
    card: {
      participants: {
        title: "Participants",
        empty: "Participants will appear after recording starts.",
        botSuffix: "(bot)",
      },
      recording: {
        title: "Recording / Transcription",
        idle: "Waiting to record",
        active: "Recording...",
        ended: "Recording ended",
        audioFiles: "{count} audio files",
        sttSummary: "{done} converted · {failed} failed",
      },
      aiNotes: {
        title: "AI meeting notes",
        waiting: "Waiting for AI notes",
        processing: "AI is writing meeting notes...",
        retrying: "Retrying meeting-note generation...",
        done: "Meeting notes ready",
        failed: "Meeting notes need attention",
      },
      notionUpload: {
        title: "Notion upload",
        waiting: "Waiting to upload to Notion",
        processing: "Uploading to Notion...",
        done: "Notion upload complete",
        failed: "Notion upload failed: check again",
      },
    },
    audio: {
      title: "Audio / Transcripts",
      empty: "No audio or transcript is available yet.",
      transcriptToggle: "Show transcript",
      playback: {
        pending: "Preparing",
        sttSafe: "Converted audio",
        raw: "Original audio",
      },
      summary: {
        speakerUtterances: "{name}: {count} utterances",
        sttDone: "Converted: {count}",
        sttFailed: "Failed: {count}",
      },
    },
    notes: {
      title: "Meeting Notes",
      empty: "AI-generated meeting note drafts will appear here.",
    },
    db: {
      tabs: {
        meeting: "Meeting",
        members: "Members",
        actionItems: "Action Items",
        customFields: "Custom Fields",
        customDb: "+ Add DB",
      },
      status: {
        title: "DB Status",
      },
      registry: {
        title: "Notion DB Connection",
        missing: "No Notion DB connection has been created yet.",
        summary: "{databaseCount}/{expectedDatabaseCount} Notion DBs · {mappingCount}/{expectedMappingCount} field links",
        parentPage: "Notion DB management page",
        actionItemsReady: "When the Action Items DB is ready, uploads create or update task pages.",
        fieldMappings: "Field links",
      },
      requiredFields: {
        title: "Required Fields",
        info: "Required fields are connection data Dirong uses when uploading meeting notes. Renaming them or changing their type in Notion can break uploads.",
        repairAction: "Repair missing required fields",
        repairComingSoon: "Required-field repair will be connected in a later step. For now, use Check Notion status again to review missing fields.",
        missingSummary: "{count} required fields are missing.",
        repairHelp: "Review saved connection data separately from the actual Notion field status.",
        registryLabel: "Saved connection data",
        remoteLabel: "Last Notion check",
        lastChecked: "Last checked",
        notChecked: "Not checked yet",
        checkAction: "Check Notion status again",
        checking: "Checking Notion status again...",
        repairing: "Repairing required fields...",
        checkFailed: "Notion check failed",
        planTitle: "Repair plan",
        planMissing: "No repair plan is available before checking Notion status.",
        planReady: "{count} automatic repair operations can be applied.",
        planEmpty: "There are no required fields to repair automatically.",
        planBlocked: "Some items need manual review.",
        stalePlanMessage: "The managed schema repair plan is no longer current.",
        stalePlanAction: "Check Notion status again, then apply the new repair plan.",
        operations: "Operations to apply",
        blockedItems: "Manual review",
        confirmRepair: "Apply the displayed repair plan to Notion?",
        locked: "Locked",
        normal: "OK",
        missing: "Missing",
        remoteStatus: {
          unchecked: "Not checked yet",
          checking: "Checking",
          healthy: "Healthy",
          needsRepair: "Needs repair",
          manualRequired: "Manual review needed",
          failed: "Check failed",
        },
        planStatus: {
          empty: "Nothing to apply",
          ready: "Ready to apply",
          blocked: "Manual review needed",
        },
        issue: {
          registryMissing: "Dirong's internal connection data is incomplete.",
          remoteMissing: "The field was not found in Notion.",
          nameDrift: "The linked field name changed.",
          wrongType: "The field type is different.",
          relationTarget: "The relation points to a different DB.",
          rollupTarget: "The rollup target field is different.",
          optionMissing: "Some select options are missing.",
          extra: "This field is not managed by Dirong.",
          unknown: "This field state needs review.",
        },
        labels: {
          meeting: {
            title: "Meeting Notes",
            date: "Date",
            time: "Meeting Time",
            channel: "Channel",
            memberRelation: "Participant Relation",
            participants: "Participants",
            actionItems: "Action Items",
            status: "Status",
            sessionId: "Dirong Session ID",
            draftId: "Dirong Draft ID",
            contentHash: "Dirong Content Hash",
            localStatus: "Dirong Status",
          },
          member: {
            discordName: "Discord Name",
            notionPerson: "Notion Person",
            organization: "Organization",
            roles: "Roles",
          },
          task: {
            title: "Task",
            meeting: "Meeting Notes",
            workerRelation: "Worker Relation",
            assignee: "Assignee",
            role: "Role",
            dueDate: "Due Date",
            status: "Status",
            evidence: "Evidence",
            sourceActionId: "Dirong Action ID",
          },
        },
      },
      customDb: {
        title: "User-added DBs",
        label: "Extra tables beyond the default DBs",
        body: "This area will show additional Notion DBs the user manages beyond the three default DBs.",
        notice: "Extra DB creation is not available in the MVP yet. Manage Meeting, Member, and Action Item custom fields inside each DB tab.",
      },
      memberRoster: {
        title: "Member DB roster",
        description: "Load Discord names, organizations, and role values from the Member DB into the local cache.",
        syncAction: "Load Member DB contents",
        syncing: "Loading Member DB contents...",
        lastSynced: "Last loaded",
        notSynced: "Not loaded yet",
        loadedCount: "Loaded members",
        roleCount: "Role values",
        warningCount: "{count} warning(s)",
        status: {
          done: "Member DB contents have been loaded.",
          notConfigured: "The member roster has not been loaded yet.",
          blocked: "Check the Member DB structure first.",
          failed: "Could not load Member DB contents.",
        },
        warning: {
          emptyDiscordName: "Empty Discord name",
          duplicateDiscordName: "Duplicate Discord name",
          missingRolesProperty: "Roles field missing",
          missingOrganizationProperty: "Organization field missing",
          unsupportedPropertyType: "Unsupported field type",
        },
        action: {
          configureNotion: "Check the Notion token and managed DB settings.",
          checkMemberDb: "Check the Member DB field links and Notion sharing status.",
        },
      },
      customFields: {
        title: "Custom Fields",
        scopedTitle: "{database} Custom Fields",
        scopeHelp: "Fields in this section apply only to {database}. If another DB needs the same field, manage it from that DB tab.",
        targetLabel: "Target DB",
        target: {
          meeting: "Meeting DB",
          member: "Member DB",
          task: "Action Item DB",
        },
        meetingScopeNotice: "Current add/edit actions are saved as Meeting DB field settings.",
        roleComingSoon: {
          title: "Custom field management for this DB is coming soon.",
          body: "You can check required fields and DB status now, but saving new custom fields for this DB will be connected in a later step.",
        },
        roleSchemaNotice: "Custom fields for this DB can be saved and synced. Applying new Notion fields is available on the Meeting DB first.",
        unmanagedNotice: "Dirong does not delete unmanaged Notion fields. Remove them directly in Notion if needed.",
        unavailable: {
          label: "Custom Fields",
          body: "Notion custom field settings are not loaded yet.",
        },
        enabledCount: "{count} enabled",
        promptPreview: "AI prompt preview",
        protectedDelete: "The locked rule cannot be removed.",
        actions: {
          refresh: "Check Notion status again",
          add: "Add field",
          save: "Save",
          inspect: "Check Notion status again",
          apply: "Repair missing fields",
          updateTypes: "Also allow type changes",
          remove: "Remove from list",
        },
        columns: {
          enabled: "On",
          property: "Field",
          type: "Type",
          source: "Source",
          description: "Description",
          limit: "Limit",
          lastSeen: "Last seen",
          actions: "",
        },
        relation: {
          targetDatabaseUrl: "Target DB/data source URL",
          targetPageUrl: "Target page URL",
          matchProperty: "Match property",
          autoCreate: "Create a page when no match is found",
        },
        source: {
          ai: "Extract from meeting with AI",
          participants: "Participant-based relation",
        },
        type: {
          rich_text: "Text",
          select: "Select",
          multi_select: "Multi-select",
          checkbox: "Checkbox",
          date: "Date",
          relation: "Relation",
        },
        status: {
          syncing: "Checking Notion status...",
          saving: "Saving...",
          checking: "Checking Notion status again...",
          applying: "Repairing missing fields...",
        },
        schemaResult: {
          title: "Notion status check result",
          ok: "Notion status looks correct.",
          categories: {
            missing: "Missing",
            rename: "Rename",
            wrongType: "Type mismatch",
            missingOptions: "Missing option",
            extra: "Unmanaged",
          },
          handling: {
            autoPossible: "Can repair automatically",
            manualNeeded: "Manual fix needed",
            preserved: "Preserved",
          },
        },
      },
    },
    logs: {
      title: "Logs",
      filters: {
        all: "All",
        needsAttention: "Needs Attention",
        recording: "Recording",
        stt: "STT",
        ai: "AI",
        notion: "Notion",
        system: "System",
      },
      needsAttention: {
        title: "Recent Needs Attention",
        empty: "No event currently needs attention.",
      },
      empty: {
        all: "No logs to show.",
        needsAttention: "No log currently needs attention.",
        recording: "No recording or audio logs to show.",
        stt: "No transcription logs to show.",
        ai: "No AI meeting-note logs to show.",
        notion: "No Notion upload or DB logs to show.",
        system: "No system logs to show.",
      },
      timeline: {
        title: "Event Timeline",
        nextAction: "Next Action",
      },
      sttQueue: {
        title: "STT Queue",
      },
      aiCleanup: {
        title: "AI Cleanup",
      },
      details: { toggle: "Details" },
    },
    settings: {
      tabs: {
        language: "Language",
        general: "General",
        discord: "Discord",
        stt: "STT",
        ai: "AI",
        notion: "Notion",
        retention: "Data & Retention",
        aloneFinalize: "Auto Stop",
        reset: "Reset",
      },
      theme: {
        label: "Dashboard theme",
        system: "System",
        light: "Light",
        dark: "Dark",
        save: "Save theme",
      },
      credits: {
        title: "About",
        directorLabel: "Director",
        directorName: "Mua_VTuber",
        githubLabel: "GitHub",
        githubUrl: "https://github.com/mua-vtuber/Agestra",
        madeWith: "Built with Claude Code",
      },
      secretsHidden: "Token and key values are never shown after saving.",
      editor: {
        current: "Current value",
        provider: "Provider",
        mode: "Mode",
        model: "Model",
        save: "Save",
        verify: "Verify",
        saving: "Saving...",
        testing: "Verifying...",
        optionalSecret: "Leave blank to keep the saved key.",
        language: {
          title: "Dashboard language",
        },
        stt: {
          title: "STT provider and model",
          localWhisperModel: "Whisper model",
          openAiModel: "OpenAI STT model",
          openAiApiKey: "OpenAI API key",
          language: "Transcription & notes language",
          languageHint: "Sets the language for transcription and meeting notes (ko/en).",
          timeoutMs: "Processing timeout (ms)",
          timeoutHint: "Max time to wait for one STT job. Default 120000ms (2 min).",
          test: "Test OpenAI connection",
          testHint: "If the test succeeds, the STT settings are saved too.",
        },
        discord: {
          credentialsTitle: "Discord bot credentials",
          guildTitle: "Allowed recording server",
          currentGuild: "Currently selected server",
          tokenKeepHint:
            "Enter only when adding or replacing the bot token. Leaving it blank keeps the existing token (just don't press save).",
          noActiveProject: "An active project is required to save a server.",
        },
        ai: {
          title: "AI provider and model",
          providerClaude: "Claude",
          providerCodex: "Codex",
          providerGemini: "Gemini",
          modeCli: "Terminal CLI",
          modeApi: "Claude API",
          apiKey: "Claude API key",
          test: "Test AI connection",
          testHint: "Tests the currently saved AI settings. Save first to test changes.",
        },
        notion: {
          title: "Notion page URL",
          parentPageUrl: "Management page URL",
          parentPagePlaceholder: "https://www.notion.so/...",
          tokenTitle: "Notion connection token",
          tokenLabel: "Notion token",
          tokenConfigured: "A token is saved",
          tokenMissing: "No token yet",
          tokenKeepHint: "Enter only when adding or replacing the token. Leaving it blank keeps the existing token.",
          managedTitle: "Managed databases",
          managedCreate: "Create managed DBs",
          managedRepairLink: "Open DB check & repair",
          managedRepairHint: "Field repair is handled on the DB screen.",
        },
        aloneFinalize: {
          enabled: "Use auto-stop",
          graceSeconds: "Wait time (seconds)",
          help: "How long to wait before automatically stopping the recording after the last person leaves the voice channel. Example: with 90 seconds, recording stops if nobody rejoins within 90 seconds. You can set 5 to 3600 seconds (up to 1 hour).",
        },
      },
      resetDanger: "Delete and reset actions will be implemented with file verification.",
      reset: {
        title: "Reset Settings",
        safetyLabel: "Local reset",
        safetyCopy:
          "Remote Discord applications, remote Notion DB/pages, local recordings, and local meeting history are never deleted.",
        activeProject: "Active project",
        deletesLabel: "Deletes",
        keepsLabel: "Keeps",
        confirm: "I reviewed the deletion scope",
        running: "Resetting...",
        success:
          "Reset completed. The Discord bot may stay logged in, but Dirong commands will not run without an active project server.",
        deletedSummary:
          "Deleted {secrets} secret(s), blocked {writes} Notion write(s)",
        deletedHeading: "Cleaned up",
        deleted: {
          secrets: "Deleted {count} secret(s)",
          blockedWrites: "Blocked {count} Notion write(s)",
          discordGuild: "Discord server connection cleared",
          discordApp: "Discord app ID/token deleted",
          notionToken: "Notion token deleted",
          projectsArchived: "{count} project(s) archived",
          managedRecords: "Managed Notion data cleared",
        },
        full: {
          title: "Full Reset",
          button: "Run Full Reset",
          deletes:
            "Discord application ID/token, all project server/Notion connections, Notion registry/cache/rules/roster, AI provider settings, and OpenAI STT key",
          keeps:
            "local-whisper model/language/timeout, dashboard language/theme, retention, local sessions/recordings/transcripts/STT jobs/AI drafts",
        },
        currentProject: {
          title: "Current Project Connection Reset",
          button: "Reset Current Project",
          deletes:
            "The active project's Discord server, Notion token/page/upload mode, registry/cache/custom rules/member roster",
          keeps:
            "Discord application ID/token, STT/Whisper, AI provider settings, local sessions/recordings/transcripts/drafts",
        },
        conflict: {
          recording_active: "Reset is unavailable while recording is active.",
          notion_upload_in_flight:
            "A Notion upload is in flight, so reset was blocked.",
          ai_cleanup_in_flight:
            "AI cleanup is in flight, so reset was blocked.",
          reset_already_running: "A reset is already running.",
        },
        effects: {
          discord: {
            message:
              "The active project gate in this process now blocks commands from the previous server.",
            action:
              "The bot may appear online, but Dirong commands will not run without an active project server.",
          },
          notion: {
            message:
              "Notion automatic upload candidates are recalculated with project_id and the reset watermark.",
          },
          ai: {
            message: "AI cleanup runtime settings will use the new settings on next start.",
            action: "Save Claude settings again after a full reset to use AI cleanup.",
          },
        },
      },
      retention: {
        audioDeleteAfterNotion: "Audio files are deleted after a successful Notion upload.",
        audioKept: "Audio auto-delete is currently off.",
        textDraftDays: "STT text and AI drafts are kept for {days} days.",
        editTitle: "Text & draft retention",
        textDraftLabel: "Retention days",
        audioReadOnly: "Audio auto-delete is always on for safety and cannot be changed.",
        consumeHint: "Older STT text and AI drafts are cleaned up automatically once the retention period passes (applied on the next cleanup cycle). You can also run session-purge --expired-text-artifacts to clean up immediately.",
      },
      notionUploadMode: {
        title: "Notion upload mode",
        optionAutomatic: "Automatic (after AI cleanup)",
        optionManual: "Manual (review then upload)",
        save: "Save upload mode",
      },
      aloneFinalize: {
        title: "Auto Stop",
        countdown: "{seconds}s until auto stop",
        checkedAt: "Last checked",
        notChecked: "Not checked yet",
      },
    },
    common: {
      unavailable: "Unavailable",
      none: "None",
      openWizard: "Open first setup wizard",
      openNotion: "Open in Notion",
      refresh: "Refresh",
      saving: "Saving...",
    },
    table: {
      time: "Time",
      speaker: "Speaker",
      status: "Status",
      playback: "Playback",
      transcript: "Transcript",
      text: "Text",
      updated: "Updated",
      area: "Area",
      summary: "Summary",
      nextAction: "Next Action",
      job: "Job",
      chunk: "Chunk",
      attempts: "Attempts",
      input: "Input",
      providerModel: "Provider/Model",
      error: "Error",
      database: "DB",
      fields: "Fields",
      notion: "Notion",
      details: "Details",
    },
    logSummary: {
      normalEvent: "Status event",
      attentionEvent: "Event needs attention",
      repairItem: "Item needs attention",
      sttJob: "Transcription job",
      aiJob: "AI notes job",
      notionWrite: "Notion upload record",
      notionAutomation: "Notion auto-upload status",
    },
  },
  settings: {
    language: {
      current: {
        message: "This is the current app language setting.",
      },
      save: {
        done: {
          message: "App language setting has been saved.",
        },
      },
      error: {
        invalidLocale: {
          message: "Unsupported app language.",
          action: "Choose either ko or en.",
        },
      },
    },
    theme: {
      current: {
        message: "This is the current dashboard theme setting.",
      },
      save: {
        done: {
          message: "Dashboard theme setting has been saved.",
        },
      },
      error: {
        invalidTheme: {
          message: "Unsupported dashboard theme.",
          action: "Choose system, light, or dark.",
        },
      },
    },
    overview: {
      status: {
        notConfigured: "Setup is not complete yet.",
        ready: "Setup is ready.",
        blocked: "Complete setup before using this feature.",
        checking: "Checking setup status.",
        warning: "Some settings need attention.",
        repairRequired: "Some settings need repair.",
      },
    },
  },
  error: {
    common: {
      missingConfig: "Product setup is incomplete.",
      missingKeys: "Missing keys: {keys}",
      copyEnvExample: "Save the Discord token and IDs in the dashboard setup wizard.",
      generic: "Something went wrong while processing the request: {message}",
      debugHint: "For details, run the command again with --debug.",
    },
    discord: {
      token: "Dirong could not log in with the Discord bot token. Check the token saved in the setup wizard, or issue a new bot token and save it again.",
      permissions: "Discord permissions are missing. Check that the bot is invited to the server and voice channel and has View Channel / Connect plus applications.commands permissions.",
      unknownGuild: "Discord server was not found. Check the server ID saved in the setup wizard and confirm that the Dirong bot has been invited there.",
      unknownChannel: "Discord channel was not found. Check the voice channel used by the member who ran /dirong start and the bot permissions.",
      voiceChannel: "The selected channel does not look like a voice channel. Join a Discord voice channel, then try again.",
      ffmpeg: "FFmpeg failed to run. Check that npm install has finished, then run npm run doctor if it keeps failing.",
      timeout: "Discord voice connection was not ready before the timeout. Check bot permissions, the channel ID, network state, and Discord voice server status.",
    },
    dashboard: {
      setupStatusSourceMissing: {
        message: "Product setup status source is not configured.",
        action: "Check the dashboard runtime source configuration.",
      },
      settingsSourceMissing: {
        message: "Product settings source is not configured.",
        action: "Start the dashboard with the app settings store connected.",
      },
      setupWizardSourceMissing: {
        message: "Setup wizard source is not configured.",
        action: "Start the dashboard with the setup wizard runtime source connected.",
      },
      requestInvalid: {
        message: "The request could not be processed.",
        action: "Check the request values and try again.",
      },
      notionActionSourceMissing: {
        message: "Notion dashboard action source is not configured.",
        action: "Check Notion settings.",
      },
    },
    userFacing: {
      dashboardPortDefaultEndpoint: "the configured dashboard port",
      dashboardPortInUse:
        "Dirong dashboard port is already in use: {endpoint}\n\nCheck these items:\n1. If another Dirong console is already running, type exit in that window to stop it.\n2. The product default port is 3095. Stop the other program using that port, then start Dirong again.",
      localWhisperPreflight:
        "Dirong could not prepare local-whisper.\n\nCheck these items:\n1. Make sure .venv-whisper exists and faster-whisper is installed.\n2. Make sure the local-whisper model path saved in the setup wizard points to a real model folder.\n3. On Windows, try the default cpu/int8 setting first.",
      sqliteBackup:
        "Dirong could not create the SQLite backup.\n\nCheck these items:\n1. If recording is running, wait a moment and try again.\n2. Make sure no other program is locking the data folder.\n3. Make sure there is enough free disk space.\n\nBecause the backup failed, STT processing was not started.",
      sttPreparation:
        "Dirong had a problem while preparing STT.\n\nCheck these items:\n1. Check local-whisper settings and the Python environment.\n2. Check the model path and CPU/int8 setting first.",
    },
  },
  action: {
    request: {
      retry: "Try the request again.",
    },
    settings: {
      open: "Open Settings and save the required values.",
    },
  },
} as const satisfies LocaleCatalog;

export const catalogs = {
  ko,
  en,
} as const satisfies Record<DirongLocale, LocaleCatalog>;

export type LocaleKey = LeafKey<LocaleCatalog>;

export function t(locale: DirongLocale | undefined, key: LocaleKey): string {
  const catalog = catalogs[locale ?? DEFAULT_CATALOG_LOCALE] ?? catalogs.ko;
  return lookupLocaleValue(catalog, key) ?? lookupLocaleValue(catalogs.ko, key) ?? key;
}

export function formatLocaleText(
  locale: DirongLocale | undefined,
  key: LocaleKey,
  values: Record<string, string | number | boolean | null | undefined>,
): string {
  return t(locale, key).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => {
    const value = values[name];
    return value === null || value === undefined ? match : String(value);
  });
}

export function listLocaleKeys(catalog: LocaleCatalog): LocaleKey[] {
  return collectLocaleKeys(catalog).sort() as LocaleKey[];
}

type LeafKey<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : `${K}.${LeafKey<T[K]>}`;
}[keyof T & string];

function lookupLocaleValue(catalog: LocaleCatalog, key: LocaleKey): string | undefined {
  let cursor: unknown = catalog;
  for (const segment of key.split(".")) {
    if (!isRecord(cursor)) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

function collectLocaleKeys(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") {
    return prefix ? [prefix] : [];
  }
  if (!isRecord(value)) {
    return [];
  }
  return Object.keys(value).flatMap((key) =>
    collectLocaleKeys(value[key], prefix ? `${prefix}.${key}` : key),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
