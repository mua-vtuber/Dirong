import os from "node:os";
import path from "node:path";

export type DirongUserDataPathOptions = {
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  platform?: NodeJS.Platform;
};

export type DirongUserDataPaths = {
  root: string;
  settingsDir: string;
  settingsFile: string;
  secretsDir: string;
  secretsFile: string;
  modelsDir: string;
  sessionsDir: string;
  logsDir: string;
  databasePath: string;
};

export function resolveDirongUserDataPath(
  options: DirongUserDataPathOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.homedir ?? os.homedir();
  const explicitDataDir =
    cleanPath(env.DIRONG_PORTABLE_DATA_DIR) ??
    cleanPath(env.DIRONG_USER_DATA_DIR);
  if (explicitDataDir) {
    return path.resolve(explicitDataDir);
  }

  if (platform === "win32") {
    const base =
      cleanPath(env.LOCALAPPDATA) ??
      cleanPath(env.APPDATA) ??
      path.join(home, "AppData", "Local");
    return path.resolve(base, "Dirong");
  }

  if (platform === "darwin") {
    return path.resolve(home, "Library", "Application Support", "Dirong");
  }

  const base = cleanPath(env.XDG_DATA_HOME) ?? path.join(home, ".local", "share");
  return path.resolve(base, "dirong");
}

export function getDirongUserDataPaths(root: string): DirongUserDataPaths {
  const resolvedRoot = path.resolve(root);
  const settingsDir = path.join(resolvedRoot, "settings");
  const secretsDir = path.join(resolvedRoot, "secrets");
  const sessionsDir = path.join(resolvedRoot, "sessions");

  return {
    root: resolvedRoot,
    settingsDir,
    settingsFile: path.join(settingsDir, "settings.json"),
    secretsDir,
    secretsFile: path.join(secretsDir, "secrets.json"),
    modelsDir: path.join(resolvedRoot, "models"),
    sessionsDir,
    logsDir: path.join(resolvedRoot, "logs"),
    databasePath: path.join(sessionsDir, "dirong.sqlite"),
  };
}

function cleanPath(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
