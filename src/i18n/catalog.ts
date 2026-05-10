import type { DirongLocale } from "../settings/local-settings-store.js";
import { DEFAULT_DIRONG_LOCALE } from "../settings/local-settings-store.js";

export const ko = {
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
