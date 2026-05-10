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
            "후속 Phase에서 managed DB 생성을 완료해야 Notion 업로드를 사용할 수 있습니다.",
        },
        ready: {
          message: "Notion managed DB registry가 준비되어 있습니다.",
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
            "Managed DB creation must be completed in a later phase before Notion upload can be used.",
        },
        ready: {
          message: "Notion managed DB registry is ready.",
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
