import { getCiphers } from "node:crypto";
import { createRequire } from "node:module";
import process from "node:process";
import { generateDependencyReport } from "@discordjs/voice";
import { resolveFfmpegPath } from "./media.js";
import { loadDotEnv } from "./config.js";
import { redactSensitiveText } from "./errors.js";

const require = createRequire(import.meta.url);

export type HealthStatus = "ok" | "warn" | "fail" | "not_configured";

export type HealthCheck = {
  name: string;
  status: HealthStatus;
  message: string;
  action?: string;
};

export type HealthReport = {
  generatedAt: string;
  nodeVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  packageVersions: Record<string, string | null>;
  ffmpeg: {
    path: string | null;
    source: string;
    version?: string;
    error?: string;
  };
  opusLibrary: string | null;
  daveLibrary: string | null;
  aes256GcmAvailable: boolean;
  discordConfig: {
    botToken: "present" | "missing";
    clientId: "present" | "missing";
    guildId: "present" | "missing";
    voiceChannelId: "present" | "missing";
  };
  checks: HealthCheck[];
  dependencyReport: string;
};

export async function runHealthCheck(): Promise<HealthReport> {
  loadDotEnv();

  const ffmpeg = await resolveFfmpegPath();
  const opusLibrary = detectFirstPackage([
    "@discordjs/opus",
    "opusscript",
  ]);
  const daveLibrary = detectFirstPackage(["@snazzah/davey"]);
  const nodeOk = isNodeVersionAccepted(process.versions.node);
  const aes256GcmAvailable = getCiphers().includes("aes-256-gcm");
  const dependencyReport = redactSensitiveText(generateDependencyReport());

  const checks: HealthCheck[] = [
    {
      name: "Node.js",
      status: nodeOk ? "ok" : "fail",
      message: nodeOk
        ? `Node.js ${process.version} 사용 가능`
        : `Node.js ${process.version}은 낮습니다. 22.12.0 이상이 필요합니다.`,
      action: nodeOk
        ? undefined
        : "Node.js 22.12.0 이상 LTS 버전을 설치한 뒤 다시 실행해 주세요.",
    },
    {
      name: "Opus library",
      status: opusLibrary ? "ok" : "fail",
      message: opusLibrary
        ? `${opusLibrary} 감지됨`
        : "Opus 라이브러리를 찾지 못했습니다.",
      action: opusLibrary ? undefined : "npm install을 다시 실행해 주세요.",
    },
    {
      name: "FFmpeg",
      status: ffmpeg.path ? "ok" : "fail",
      message: ffmpeg.path
        ? `${ffmpeg.source} FFmpeg 사용 가능`
        : "FFmpeg 실행 파일을 찾지 못했습니다.",
      action: ffmpeg.path ? undefined : "npm install을 다시 실행해 주세요.",
    },
    {
      name: "DAVE library",
      status: daveLibrary ? "ok" : "warn",
      message: daveLibrary
        ? `${daveLibrary} 감지됨`
        : "@snazzah/davey를 직접 찾지 못했습니다. @discordjs/voice 내장 의존성으로 처리될 수 있습니다.",
    },
    {
      name: "OGG CRC helper",
      status: getPackageVersion("node-crc") ? "ok" : "fail",
      message: getPackageVersion("node-crc")
        ? "node-crc 감지됨"
        : "OGG/Opus 파일 작성에 필요한 node-crc를 찾지 못했습니다.",
      action: getPackageVersion("node-crc")
        ? undefined
        : "npm install을 다시 실행해 주세요.",
    },
    {
      name: "AES-256-GCM",
      status: aes256GcmAvailable ? "ok" : "warn",
      message: aes256GcmAvailable
        ? "Node crypto aes-256-gcm 사용 가능"
        : "Node crypto aes-256-gcm 미감지. 대체 암호화 라이브러리가 필요할 수 있습니다.",
    },
    ...discordConfigChecks(),
  ];

  return {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    packageVersions: {
      "discord.js": getPackageVersion("discord.js"),
      "@discordjs/voice": getPackageVersion("@discordjs/voice"),
      "prism-media": getPackageVersion("prism-media"),
      "ffmpeg-static": getPackageVersion("ffmpeg-static"),
      "node-crc": getPackageVersion("node-crc"),
      opusscript: getPackageVersion("opusscript"),
      "@discordjs/opus": getPackageVersion("@discordjs/opus"),
      "@snazzah/davey": getPackageVersion("@snazzah/davey"),
    },
    ffmpeg,
    opusLibrary,
    daveLibrary,
    aes256GcmAvailable,
    discordConfig: {
      botToken: process.env.DISCORD_BOT_TOKEN ? "present" : "missing",
      clientId: process.env.DISCORD_CLIENT_ID ? "present" : "missing",
      guildId: process.env.DISCORD_GUILD_ID ? "present" : "missing",
      voiceChannelId: process.env.DISCORD_VOICE_CHANNEL_ID
        ? "present"
        : "missing",
    },
    checks,
    dependencyReport,
  };
}

export function criticalHealthFailed(report: HealthReport): boolean {
  return report.checks.some(
    (check) =>
      check.status === "fail" &&
      ["Node.js", "Opus library", "FFmpeg", "OGG CRC helper"].includes(
        check.name,
      ),
  );
}

function discordConfigChecks(): HealthCheck[] {
  const keys = [
    ["DISCORD_BOT_TOKEN", "Discord bot token"],
    ["DISCORD_CLIENT_ID", "Discord client ID"],
    ["DISCORD_GUILD_ID", "Discord guild ID"],
    ["DISCORD_VOICE_CHANNEL_ID", "Discord voice channel ID"],
  ] as const;

  return keys.map(([key, name]) => ({
    name,
    status: process.env[key] ? "ok" : "not_configured",
    message: process.env[key]
      ? `${key} 설정됨(값은 출력하지 않음)`
      : `${key}가 아직 설정되지 않았습니다.`,
    action: process.env[key]
      ? undefined
      : ".env.example을 .env로 복사한 뒤 값을 채워 주세요.",
  }));
}

function detectFirstPackage(packageNames: string[]): string | null {
  for (const packageName of packageNames) {
    try {
      require.resolve(packageName);
      return packageName;
    } catch {
      continue;
    }
  }
  return null;
}

function getPackageVersion(packageName: string): string | null {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const packageJson = require(packageJsonPath) as { version?: string };
    return packageJson.version ?? null;
  } catch {
    return null;
  }
}

function isNodeVersionAccepted(version: string): boolean {
  const [majorRaw, minorRaw, patchRaw] = version.split(".");
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  const patch = Number(patchRaw);

  if (major > 22) {
    return true;
  }
  if (major < 22) {
    return false;
  }
  if (minor > 12) {
    return true;
  }
  if (minor < 12) {
    return false;
  }
  return patch >= 0;
}
