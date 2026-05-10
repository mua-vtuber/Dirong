import type { DirongLocale } from "../settings/local-settings-store.js";
import { DEFAULT_DIRONG_LOCALE } from "../settings/local-settings-store.js";

export const ko = {
  statusDisplay: {
    action: {
      done: {
        title: "설정을 저장했어요",
        description: "방금 입력한 값이 저장됐고 다음 단계로 진행할 수 있습니다.",
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
        title: "Claude 설정이 아직 끝나지 않았어요",
        description: "회의록을 만들 Claude CLI 또는 API 사용 방식이 아직 저장되지 않았습니다.",
        nextAction: "Claude 설정에서 CLI 또는 API 방식을 선택하고 연결을 확인해 주세요.",
      },
      apiKeyMissing: {
        title: "Claude API key가 필요해요",
        description: "Claude API 모드를 선택했지만 사용할 API key가 저장되어 있지 않습니다.",
        nextAction: "Claude API key를 다시 입력하거나 CLI 모드로 바꿔 주세요.",
      },
      cliCommandMissing: {
        title: "Claude CLI 실행 명령이 필요해요",
        description: "Claude CLI 모드를 선택했지만 실행할 command가 저장되어 있지 않습니다.",
        nextAction: "Claude CLI command를 저장한 뒤 연결 테스트를 다시 실행해 주세요.",
      },
      ready: {
        title: "Claude 설정이 준비됐어요",
        description: "회의록 생성을 위한 Claude provider 설정이 저장되어 있습니다.",
      },
      preparing: {
        title: "Claude 준비 상태를 확인하고 있어요",
        description: "회의록 생성을 시작하기 전에 Claude 실행 환경을 확인하는 중입니다.",
      },
      loginRequired: {
        title: "Claude 로그인이 필요해요",
        description: "Claude CLI를 사용할 수 있지만 로그인 상태가 준비되지 않았습니다.",
        nextAction: "터미널에서 Claude CLI 로그인을 완료한 뒤 다시 확인해 주세요.",
      },
      toolMissing: {
        title: "Claude 도구를 찾지 못했어요",
        description: "디롱이가 Claude CLI 또는 로컬 AI 도구를 실행하지 못했습니다.",
        nextAction: "선택한 AI 도구가 설치되어 있고 터미널에서 실행되는지 확인해 주세요.",
      },
      failed: {
        title: "Claude 준비 확인에 실패했어요",
        description: "회의록 생성 전에 Claude 상태를 확인하지 못했습니다. 녹음과 STT 결과는 보존됩니다.",
        nextAction: "Claude 설정과 provider 상태를 확인한 뒤 다시 시도해 주세요.",
      },
      stopped: {
        title: "Claude 준비 확인을 멈췄어요",
        description: "Claude provider 준비 상태 확인이 중지되었습니다.",
      },
    },
    notion: {
      notConfigured: {
        title: "Notion 연결 설정이 아직 끝나지 않았어요",
        description: "Notion token 또는 디롱이 전용 parent page 정보가 빠져 있어서 업로드를 시작할 수 없습니다.",
        nextAction: "Notion 설정에서 token과 parent page URL을 저장해 주세요.",
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
        nextAction: "자동 업로드를 원하면 Notion 업로드 방식을 자동으로 바꿔 주세요.",
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
            message: "Discord bot token과 application ID 연결을 확인했습니다.",
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
        },
      },
    },
    ai: {
      status: {
        notConfigured: {
          message: "AI 회의록 provider 설정이 아직 저장되지 않았습니다.",
          action: "설정 위자드에서 Claude CLI 또는 Claude API 사용 방식을 선택해 주세요.",
        },
        claudeApiKeyMissing: {
          message: "Claude API key가 아직 저장되지 않았습니다.",
          action: "Claude API key를 다시 입력하거나 Claude CLI 모드로 바꿔 주세요.",
        },
        claudeCliCommandMissing: {
          message: "Claude CLI command가 아직 저장되지 않았습니다.",
          action: "Claude CLI 모드를 쓰려면 실행 command를 저장해 주세요.",
        },
        ready: {
          message: "AI 회의록 provider 설정이 저장되어 있습니다.",
        },
      },
      claude: {
        save: {
          done: {
            message: "Claude 설정을 저장했습니다.",
          },
        },
        test: {
          done: {
            message: "Claude 연결 테스트를 완료했습니다.",
          },
          error: {
            notConfigured: {
              message: "Claude 연결 테스트에 필요한 설정이 아직 없습니다.",
              action: "Claude CLI 또는 API 방식을 먼저 저장해 주세요.",
            },
            failed: {
              message: "Claude 연결 테스트에 실패했습니다.",
              action: "CLI command가 실행되는지 또는 API key가 유효한지 확인해 주세요.",
            },
          },
        },
        error: {
          invalidMode: {
            message: "지원하지 않는 Claude 사용 방식입니다.",
            action: "cli 또는 api 중 하나를 선택해 주세요.",
          },
          apiKeyMissing: {
            message: "Claude API key가 비어 있습니다.",
            action: "Claude API 모드를 쓰려면 API key를 입력해 주세요.",
          },
        },
      },
    },
    notion: {
      status: {
        notConfigured: {
          message: "Notion 연결 설정이 아직 완료되지 않았습니다.",
          action: "Notion internal connection token과 parent page URL을 저장해 주세요.",
        },
        registryMissing: {
          message: "Notion 연결 값은 있지만 managed DB registry가 아직 없습니다.",
          action:
            "위자드의 managed DB 생성 단계에서 회의록, 작업자, 액션 아이템 DB 세트를 생성해 주세요.",
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
            message: "Notion parent page URL을 저장했습니다.",
          },
        },
        verify: {
          done: {
            message: "Notion parent page 접근 권한을 확인했습니다.",
          },
          error: {
            notConfigured: {
              message: "Notion parent page 검증에 필요한 값이 아직 없습니다.",
              action: "Notion token과 parent page URL을 먼저 저장해 주세요.",
            },
            failed: {
              message: "Notion parent page에 접근하지 못했습니다.",
              action: "해당 page에 Dirong internal connection을 Add connection으로 공유했는지 확인해 주세요.",
            },
          },
        },
        error: {
          invalid: {
            message: "Notion parent page URL 형식이 올바르지 않습니다.",
            action: "데이터베이스가 아니라 Dirong 전용 상위 page 링크를 복사해 주세요.",
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
            action: "parent page 공유 권한과 Notion token을 확인한 뒤 disposable parent page에서 다시 시도해 주세요.",
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
        description: "The value you entered was saved, and you can continue to the next step.",
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
        title: "Claude setup is not finished yet",
        description: "The Claude CLI or API mode for meeting notes has not been saved yet.",
        nextAction: "Choose CLI or API mode in Claude settings and check the connection.",
      },
      apiKeyMissing: {
        title: "Claude API key is required",
        description: "Claude API mode is selected, but no API key is saved.",
        nextAction: "Enter the Claude API key again or switch to CLI mode.",
      },
      cliCommandMissing: {
        title: "Claude CLI command is required",
        description: "Claude CLI mode is selected, but no command is saved.",
        nextAction: "Save the Claude CLI command, then run the connection test again.",
      },
      ready: {
        title: "Claude setup is ready",
        description: "The Claude provider settings for meeting notes are saved.",
      },
      preparing: {
        title: "Checking Claude readiness",
        description: "Dirong is checking the Claude runtime before creating meeting notes.",
      },
      loginRequired: {
        title: "Claude login is required",
        description: "Claude CLI is available, but its login state is not ready.",
        nextAction: "Complete Claude CLI login in a terminal, then check again.",
      },
      toolMissing: {
        title: "Claude tool was not found",
        description: "Dirong could not run the Claude CLI or local AI tool.",
        nextAction: "Check that the selected AI tool is installed and runs in a terminal.",
      },
      failed: {
        title: "Claude readiness check failed",
        description: "Dirong could not verify Claude before meeting-note generation. Recording and STT results are preserved.",
        nextAction: "Check Claude settings and provider state, then try again.",
      },
      stopped: {
        title: "Claude readiness check stopped",
        description: "The Claude provider readiness check has stopped.",
      },
    },
    notion: {
      notConfigured: {
        title: "Notion connection setup is not finished yet",
        description: "Upload cannot start because the Notion token or Dirong parent page is missing.",
        nextAction: "Save the Notion token and parent page URL in Notion settings.",
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
        nextAction: "Switch the upload mode to automatic if you want automatic uploads.",
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
            message: "Discord bot token and application ID connection has been verified.",
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
        },
      },
    },
    ai: {
      status: {
        notConfigured: {
          message: "AI meeting-notes provider settings have not been saved yet.",
          action: "Choose Claude CLI or Claude API in the setup wizard.",
        },
        claudeApiKeyMissing: {
          message: "Claude API key has not been saved yet.",
          action: "Enter the Claude API key again or switch to Claude CLI mode.",
        },
        claudeCliCommandMissing: {
          message: "Claude CLI command has not been saved yet.",
          action: "Save the command to use Claude CLI mode.",
        },
        ready: {
          message: "AI meeting-notes provider settings are saved.",
        },
      },
      claude: {
        save: {
          done: {
            message: "Claude settings have been saved.",
          },
        },
        test: {
          done: {
            message: "Claude connection test completed.",
          },
          error: {
            notConfigured: {
              message: "Claude connection test settings are missing.",
              action: "Save the Claude CLI or API mode first.",
            },
            failed: {
              message: "Claude connection test failed.",
              action: "Check that the CLI command runs or that the API key is valid.",
            },
          },
        },
        error: {
          invalidMode: {
            message: "Unsupported Claude mode.",
            action: "Choose either cli or api.",
          },
          apiKeyMissing: {
            message: "Claude API key is empty.",
            action: "Enter an API key to use Claude API mode.",
          },
        },
      },
    },
    notion: {
      status: {
        notConfigured: {
          message: "Notion connection setup is not complete yet.",
          action: "Save the Notion internal connection token and parent page URL.",
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
            message: "Notion parent page URL has been saved.",
          },
        },
        verify: {
          done: {
            message: "Notion parent page access has been verified.",
          },
          error: {
            notConfigured: {
              message: "Notion parent page verification values are missing.",
              action: "Save the Notion token and parent page URL first.",
            },
            failed: {
              message: "Could not access the Notion parent page.",
              action: "Check that the Dirong internal connection was shared with the page using Add connection.",
            },
          },
        },
        error: {
          invalid: {
            message: "The Notion parent page URL format is invalid.",
            action: "Copy the link to a dedicated parent page, not a database.",
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
            action: "Check the parent page sharing permissions and Notion token, then retry on a disposable parent page.",
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
  const catalog = catalogs[locale ?? DEFAULT_DIRONG_LOCALE] ?? catalogs.ko;
  return lookupLocaleValue(catalog, key) ?? lookupLocaleValue(catalogs.ko, key) ?? key;
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
