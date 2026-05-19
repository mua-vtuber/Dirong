import { getCiphers } from "node:crypto";
import { createRequire } from "node:module";
import process from "node:process";
import { generateDependencyReport } from "@discordjs/voice";
import { resolveFfmpegPath } from "./media.js";
import type { Phase1Config } from "./config.js";
import { redactSensitiveText } from "./errors.js";
import { formatLocaleText, t } from "./i18n/catalog.js";
import type { DirongLocale } from "./settings/local-settings-store.js";

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

export type HealthCheckOptions = {
  config?: Pick<
    Phase1Config,
    "discordBotToken" | "discordClientId" | "guildIds"
  >;
  locale?: DirongLocale;
};

export async function runHealthCheck(
  options: HealthCheckOptions = {},
): Promise<HealthReport> {
  const locale = options.locale;
  const discordConfig = readDiscordConfigStatus(options.config);
  const ffmpeg = await resolveFfmpegPath();
  const opusLibrary = detectFirstPackage([
    "@discordjs/opus",
    "opusscript",
  ]);
  const daveLibrary = detectFirstPackage(["@snazzah/davey"]);
  const nodeCrcHelper = detectNodeCrcHelper();
  const nodeOk = isNodeVersionAccepted(process.versions.node);
  const aes256GcmAvailable = getCiphers().includes("aes-256-gcm");
  const dependencyReport = redactSensitiveText(generateDependencyReport());

  const checks: HealthCheck[] = [
    {
      name: "Node.js",
      status: nodeOk ? "ok" : "fail",
      message: nodeOk
        ? formatLocaleText(locale, "health.node.available", {
            version: process.version,
          })
        : formatLocaleText(locale, "health.node.unsupported", {
            version: process.version,
          }),
      action: nodeOk
        ? undefined
        : t(locale, "health.node.installAction"),
    },
    {
      name: "Opus library",
      status: opusLibrary ? "ok" : "fail",
      message: opusLibrary
        ? formatLocaleText(locale, "health.dependency.detected", {
            name: opusLibrary,
          })
        : t(locale, "health.dependency.opusMissing"),
      action: opusLibrary ? undefined : t(locale, "health.dependency.npmInstallAction"),
    },
    {
      name: "FFmpeg",
      status: ffmpeg.path ? "ok" : "fail",
      message: ffmpeg.path
        ? formatLocaleText(locale, "health.dependency.ffmpegAvailable", {
            source: ffmpeg.source,
          })
        : t(locale, "health.dependency.ffmpegMissing"),
      action: ffmpeg.path ? undefined : t(locale, "health.dependency.npmInstallAction"),
    },
    {
      name: "DAVE library",
      status: daveLibrary ? "ok" : "warn",
      message: daveLibrary
        ? formatLocaleText(locale, "health.dependency.detected", {
            name: daveLibrary,
          })
        : t(locale, "health.dependency.daveMissing"),
    },
    {
      name: "OGG CRC helper",
      status: nodeCrcHelper.ok ? "ok" : "fail",
      message: nodeCrcHelper.ok
        ? t(locale, "health.dependency.nodeCrcDetected")
        : nodeCrcHelper.error
          ? formatLocaleText(locale, "health.dependency.nodeCrcLoadFailed", {
              error: nodeCrcHelper.error,
            })
          : t(locale, "health.dependency.nodeCrcMissing"),
      action: nodeCrcHelper.ok
        ? undefined
        : t(locale, "health.dependency.npmInstallAction"),
    },
    {
      name: "AES-256-GCM",
      status: aes256GcmAvailable ? "ok" : "warn",
      message: aes256GcmAvailable
        ? t(locale, "health.dependency.aesAvailable")
        : t(locale, "health.dependency.aesUnavailable"),
    },
    ...discordConfigChecks(discordConfig, locale),
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
    discordConfig,
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

function discordConfigChecks(
  discordConfig: HealthReport["discordConfig"],
  locale: DirongLocale | undefined,
): HealthCheck[] {
  const keys = [
    ["botToken", "Discord bot token"],
    ["clientId", "Discord client ID"],
    ["guildId", "Discord guild IDs"],
    ["voiceChannelId", "Discord voice channel ID"],
  ] as const;

  return keys.map(([key, name]) => ({
    name,
    status: discordConfig[key] === "present" ? "ok" : "not_configured",
    message: discordConfig[key] === "present"
      ? t(locale, "health.config.present")
      : t(locale, "health.config.missing"),
    action: discordConfig[key] === "present"
      ? undefined
      : t(locale, "health.config.action"),
  }));
}

function readDiscordConfigStatus(
  config: HealthCheckOptions["config"],
): HealthReport["discordConfig"] {
  return {
    botToken: config?.discordBotToken ? "present" : "missing",
    clientId: config?.discordClientId ? "present" : "missing",
    guildId: (config?.guildIds.length ?? 0) > 0 ? "present" : "missing",
    voiceChannelId: "missing",
  };
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

function detectNodeCrcHelper(): { ok: boolean; error?: string } {
  if (!getPackageVersion("node-crc")) {
    return { ok: false };
  }

  try {
    const nodeCrc = require("node-crc") as { crc?: unknown };
    if (typeof nodeCrc.crc === "function") {
      return { ok: true };
    }
    return { ok: false, error: "node-crc did not expose a crc function." };
  } catch (error) {
    return {
      ok: false,
      error: redactSensitiveText(error instanceof Error ? error.message : String(error)),
    };
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
