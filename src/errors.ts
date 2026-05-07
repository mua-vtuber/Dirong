const SENSITIVE_KEY_PATTERN = /token|authorization|api[_-]?key|secret|password/i;

export class MissingRequiredConfigError extends Error {
  constructor(public readonly missingKeys: string[]) {
    super(`Missing required configuration: ${missingKeys.join(", ")}`);
    this.name = "MissingRequiredConfigError";
  }
}

export class DirongError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DirongError";
  }
}

export type SafeErrorInfo = {
  name: string;
  message: string;
  code?: unknown;
  status?: unknown;
};

export function redactSensitiveText(value: string): string {
  let redacted = value;
  const token = process.env.DISCORD_BOT_TOKEN;
  const openAiApiKey = process.env.OPENAI_API_KEY;
  const notionApiKey = process.env.NOTION_API_KEY;

  if (token && token.length > 0) {
    redacted = redacted.split(token).join("[REDACTED_DISCORD_BOT_TOKEN]");
  }
  if (openAiApiKey && openAiApiKey.length > 0) {
    redacted = redacted.split(openAiApiKey).join("[REDACTED_OPENAI_API_KEY]");
  }
  if (notionApiKey && notionApiKey.length > 0) {
    redacted = redacted.split(notionApiKey).join("[REDACTED_NOTION_API_KEY]");
  }

  redacted = redacted.replace(
    /Bot\s+[A-Za-z0-9._-]+/gi,
    "Bot [REDACTED]",
  );
  redacted = redacted.replace(
    /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g,
    "[REDACTED_OPENAI_API_KEY]",
  );
  redacted = redacted.replace(
    /\bntn_[A-Za-z0-9_-]{10,}\b/g,
    "[REDACTED_NOTION_API_KEY]",
  );
  redacted = redacted.replace(
    /([A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,})/g,
    "[REDACTED_DISCORD_TOKEN_LIKE_VALUE]",
  );
  redacted = redacted.replace(
    /(authorization|token|secret|api[_-]?key)(["'\s:=]+)([^"',\s}]+)/gi,
    "$1$2[REDACTED]",
  );

  return redacted;
}

export function redactForJson(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return "[MAX_DEPTH]";
  }

  if (typeof value === "string") {
    return redactSensitiveText(value);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactForJson(item, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? "[REDACTED]"
      : redactForJson(entry, depth + 1);
  }

  return output;
}

export function safeErrorInfo(error: unknown): SafeErrorInfo {
  if (error instanceof Error) {
    const maybeError = error as Error & {
      code?: unknown;
      status?: unknown;
      rawError?: unknown;
    };

    return {
      name: maybeError.name,
      message: redactSensitiveText(maybeError.message),
      code: maybeError.code,
      status: maybeError.status,
    };
  }

  return {
    name: "UnknownError",
    message: redactSensitiveText(String(error)),
  };
}

export function toKoreanErrorMessage(error: unknown): string {
  if (error instanceof MissingRequiredConfigError) {
    return [
      ".env 설정이 아직 부족합니다.",
      `빠진 항목: ${error.missingKeys.join(", ")}`,
      ".env.example을 .env로 복사한 뒤 Discord 토큰과 ID를 채워 주세요.",
    ].join(" ");
  }

  const info = safeErrorInfo(error);
  const message = info.message.toLowerCase();
  const code = String(info.code ?? "").toLowerCase();

  if (
    message.includes("token") ||
    message.includes("unauthorized") ||
    code.includes("token_invalid") ||
    code === "50014" ||
    code === "401"
  ) {
    return "Discord 봇 토큰으로 로그인하지 못했습니다. .env의 DISCORD_BOT_TOKEN이 올바른지, 봇 토큰을 새로 발급한 뒤 그대로 붙여넣었는지 확인해 주세요.";
  }

  if (
    message.includes("missing access") ||
    message.includes("missing permissions") ||
    code === "50001" ||
    code === "50013"
  ) {
    return "Discord 권한이 부족합니다. 봇이 해당 서버와 음성 채널에 초대되어 있고, View Channel / Connect 권한과 applications.commands 권한이 있는지 확인해 주세요.";
  }

  if (message.includes("unknown guild") || code === "10004") {
    return "Discord 서버를 찾지 못했습니다. .env의 DISCORD_GUILD_ID가 테스트 서버 ID인지 확인하고, 디롱이 봇이 그 서버에 초대되어 있는지 확인해 주세요.";
  }

  if (message.includes("unknown channel") || code === "10003") {
    return "Discord 채널을 찾지 못했습니다. .env의 DISCORD_VOICE_CHANNEL_ID가 테스트 서버 안의 음성 채널 ID인지 확인해 주세요.";
  }

  if (message.includes("voice channel") || message.includes("not voice")) {
    return "설정한 DISCORD_VOICE_CHANNEL_ID가 음성 채널이 아닌 것 같습니다. Discord 개발자 모드에서 테스트 음성 채널 ID를 다시 복사해 주세요.";
  }

  if (message.includes("ffmpeg")) {
    return "FFmpeg 실행에 실패했습니다. npm install이 끝났는지 확인하고, 계속 실패하면 npm run doctor 결과를 확인해 주세요.";
  }

  if (message.includes("timed out") || message.includes("timeout")) {
    return "Discord 음성 연결이 제한 시간 안에 준비되지 않았습니다. 봇 권한, 채널 ID, 네트워크 상태, Discord 음성 서버 상태를 확인해 주세요.";
  }

  return `처리 중 문제가 생겼습니다: ${info.message}`;
}
