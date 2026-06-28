import {
  execFileSync,
} from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DEFAULT_PORTABLE_APP_NAME = "Dirong";
export const DEFAULT_PORTABLE_OUTPUT_DIR = "portable";
export const DEFAULT_PORTABLE_PYTHON_NUGET_VERSION = "3.13.10";
export const PORTABLE_DATA_ENV_VAR = "DIRONG_PORTABLE_DATA_DIR";
export const PORTABLE_ROOT_ENV_VAR = "DIRONG_PORTABLE_ROOT";
export const PORTABLE_PYTHON_ENV_VAR = "DIRONG_PORTABLE_PYTHON";
export const PORTABLE_PYTHON_CACHE_ENV_VAR = "DIRONG_PORTABLE_PYTHON_CACHE_DIR";
export const PORTABLE_PYTHON_SOURCE_ENV_VAR = "DIRONG_PORTABLE_PYTHON_DIR";

type PortableDownloadFile = (url: string, targetPath: string) => void;
type PortableExtractArchive = (archivePath: string, targetDir: string) => void;

export type PortableBundleOptions = {
  projectRoot?: string;
  outputDir?: string;
  appName?: string;
  nodeExecutable?: string;
  pythonRuntimeDir?: string;
  pythonRuntimeCacheDir?: string;
  pythonNugetVersion?: string;
  downloadFile?: PortableDownloadFile;
  extractArchive?: PortableExtractArchive;
  platform?: NodeJS.Platform;
};

export type PortableBundlePlan = {
  projectRoot: string;
  targetRoot: string;
  appDir: string;
  appDistDir: string;
  nodeDir: string;
  nodeExecutableName: string;
  pythonDir: string;
  pythonExecutableName: string;
  dataDir: string;
  scriptsDir: string;
  launcherPath: string;
  notesPath: string;
};

export function createPortableBundle(
  options: PortableBundleOptions = {},
): PortableBundlePlan {
  const plan = resolvePortableBundlePlan(options);
  const pythonRuntimeDir = resolvePythonRuntimeDir(options, plan);
  assertBundleInputs(plan, pythonRuntimeDir);

  rmSync(plan.targetRoot, { recursive: true, force: true });
  mkdirSync(plan.targetRoot, { recursive: true });

  copyDirectory(path.join(plan.projectRoot, "dist"), plan.appDistDir);
  copyDirectory(path.join(plan.projectRoot, "node_modules"), path.join(plan.appDir, "node_modules"));
  copyDirectory(path.join(plan.projectRoot, "scripts"), plan.scriptsDir);
  copyPackageMetadata(plan.projectRoot, plan.appDir);
  copyOptionalReadme(plan.projectRoot, plan.targetRoot);
  copyNodeRuntime(options.nodeExecutable ?? process.execPath, plan);
  copyPythonRuntime(pythonRuntimeDir, plan);
  createCleanPortableDataDirs(plan.dataDir);

  writeFileSync(plan.launcherPath, createWindowsLauncher(plan), "utf8");
  writeFileSync(plan.notesPath, createPortableNotes(), "utf8");

  return plan;
}

export function resolvePortableBundlePlan(
  options: PortableBundleOptions = {},
): PortableBundlePlan {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const outputRoot = path.resolve(
    projectRoot,
    options.outputDir ?? DEFAULT_PORTABLE_OUTPUT_DIR,
  );
  const appName = options.appName ?? DEFAULT_PORTABLE_APP_NAME;
  const targetRoot = path.resolve(outputRoot, appName);
  const platform = options.platform ?? process.platform;
  const nodeExecutableName = platform === "win32" ? "node.exe" : "node";
  const pythonExecutableName = platform === "win32" ? "python.exe" : "python";

  if (!isPathInside(targetRoot, projectRoot)) {
    throw new Error(`portable bundle target must stay inside project root: ${targetRoot}`);
  }
  if (path.relative(projectRoot, targetRoot) === "") {
    throw new Error("portable bundle target cannot be the project root.");
  }

  const appDir = path.join(targetRoot, "app");
  return {
    projectRoot,
    targetRoot,
    appDir,
    appDistDir: path.join(appDir, "dist"),
    nodeDir: path.join(targetRoot, "node"),
    nodeExecutableName,
    pythonDir: path.join(targetRoot, "python"),
    pythonExecutableName,
    dataDir: path.join(targetRoot, "data"),
    scriptsDir: path.join(targetRoot, "scripts"),
    launcherPath: path.join(targetRoot, "Dirong Start.bat"),
    notesPath: path.join(targetRoot, "PORTABLE_NOTES.txt"),
  };
}

export function createWindowsLauncher(plan: PortableBundlePlan): string {
  const nodePath = `%~dp0node\\${plan.nodeExecutableName}`;
  const pythonPath = `%~dp0python\\${plan.pythonExecutableName}`;
  return [
    "@echo off",
    "setlocal",
    "cd /d \"%~dp0\"",
    "",
    "echo.",
    "echo Dirong Portable",
    "echo.",
    `set "${PORTABLE_ROOT_ENV_VAR}=%~dp0"`,
    `set "${PORTABLE_DATA_ENV_VAR}=%~dp0data"`,
    `set "${PORTABLE_PYTHON_ENV_VAR}=${pythonPath}"`,
    "set \"PATH=%~dp0python;%~dp0node;%PATH%\"",
    "",
    `if not exist "${nodePath}" (`,
    "  echo [ERROR] Portable Node.js runtime was not found.",
    "  pause",
    "  exit /b 1",
    ")",
    `if not exist "${pythonPath}" (`,
    "  echo [ERROR] Portable Python runtime was not found.",
    "  pause",
    "  exit /b 1",
    ")",
    "",
    `"${nodePath}" "%~dp0app\\dist\\app\\main.js" %*`,
    "",
    "echo.",
    "echo Dirong app exited.",
    "pause",
    "",
  ].join("\r\n");
}

function assertBundleInputs(
  plan: PortableBundlePlan,
  pythonRuntimeDir: string,
): void {
  const requiredPaths = [
    path.join(plan.projectRoot, "dist", "app", "main.js"),
    path.join(plan.projectRoot, "node_modules"),
    path.join(plan.projectRoot, "scripts", "local-whisper-json.py"),
    path.join(plan.projectRoot, "scripts", "local-whisper-worker.py"),
    path.join(plan.projectRoot, "package.json"),
  ];

  for (const requiredPath of requiredPaths) {
    if (!existsSync(requiredPath)) {
      throw new Error(
        `portable bundle input missing: ${requiredPath}. Run npm install and npm run build first.`,
      );
    }
  }

  const pythonExecutable = path.join(
    pythonRuntimeDir,
    plan.pythonExecutableName,
  );
  if (!existsSync(pythonExecutable)) {
    throw new Error(
      `portable Python runtime missing: set ${PORTABLE_PYTHON_SOURCE_ENV_VAR} or place runtime/python with ${plan.pythonExecutableName}. Missing: ${pythonExecutable}`,
    );
  }

  const pipPackageDir = path.join(pythonRuntimeDir, "Lib", "site-packages", "pip");
  if (!existsSync(pipPackageDir)) {
    throw new Error(
      `portable Python runtime missing pip: ${pipPackageDir}. Use a Python runtime that includes pip, or let npm run bundle:portable download the default clean runtime.`,
    );
  }
}

function copyDirectory(source: string, target: string): void {
  cpSync(source, target, {
    recursive: true,
    force: true,
    errorOnExist: false,
    verbatimSymlinks: false,
  });
}

function copyPackageMetadata(projectRoot: string, appDir: string): void {
  mkdirSync(appDir, { recursive: true });
  copyFileSync(path.join(projectRoot, "package.json"), path.join(appDir, "package.json"));

  const lockPath = path.join(projectRoot, "package-lock.json");
  if (existsSync(lockPath)) {
    copyFileSync(lockPath, path.join(appDir, "package-lock.json"));
  }
}

function copyOptionalReadme(projectRoot: string, targetRoot: string): void {
  const readmePath = path.join(projectRoot, "README.md");
  if (existsSync(readmePath)) {
    copyFileSync(readmePath, path.join(targetRoot, "README.md"));
  }
}

function copyNodeRuntime(nodeExecutable: string, plan: PortableBundlePlan): void {
  const resolvedNodeExecutable = path.resolve(nodeExecutable);
  if (!existsSync(resolvedNodeExecutable)) {
    throw new Error(`Node.js executable not found: ${resolvedNodeExecutable}`);
  }

  mkdirSync(plan.nodeDir, { recursive: true });
  copyFileSync(
    resolvedNodeExecutable,
    path.join(plan.nodeDir, plan.nodeExecutableName),
  );

  const runtimeDir = path.dirname(resolvedNodeExecutable);
  for (const entry of readdirSync(runtimeDir)) {
    const sourcePath = path.join(runtimeDir, entry);
    if (!statSync(sourcePath).isFile() || path.extname(entry).toLowerCase() !== ".dll") {
      continue;
    }
    copyFileSync(sourcePath, path.join(plan.nodeDir, entry));
  }
}

function copyPythonRuntime(
  pythonRuntimeDir: string,
  plan: PortableBundlePlan,
): void {
  copyDirectory(pythonRuntimeDir, plan.pythonDir);
}

function createCleanPortableDataDirs(dataDir: string): void {
  for (const child of ["settings", "secrets", "sessions", "logs", "models"]) {
    mkdirSync(path.join(dataDir, child), { recursive: true });
  }
}

function createPortableNotes(): string {
  return [
    "Dirong Portable Notes",
    "",
    `This bundle stores runtime data under .\\data via ${PORTABLE_DATA_ENV_VAR}.`,
    `The bundled Python runtime is exposed via ${PORTABLE_PYTHON_ENV_VAR} and placed before system Python on PATH.`,
    "The bundle intentionally starts with an empty data directory.",
    "Secrets such as Discord bot tokens, OpenAI keys, Claude API keys, and Notion tokens are saved under data\\secrets after setup.",
    "Do not share this folder after setup unless you remove data\\secrets first.",
    "",
  ].join("\r\n");
}

function resolvePythonRuntimeDir(
  options: PortableBundleOptions,
  plan: PortableBundlePlan,
): string {
  const explicitSource =
    cleanPath(options.pythonRuntimeDir) ??
    cleanPath(process.env[PORTABLE_PYTHON_SOURCE_ENV_VAR]);
  if (explicitSource) {
    return path.resolve(explicitSource);
  }

  const projectRuntimeSource = path.join(plan.projectRoot, "runtime", "python");
  if (existsSync(projectRuntimeSource)) {
    return path.resolve(projectRuntimeSource);
  }

  return prepareDefaultPythonRuntime(options, plan);
}

function prepareDefaultPythonRuntime(
  options: PortableBundleOptions,
  plan: PortableBundlePlan,
): string {
  if (plan.pythonExecutableName !== "python.exe") {
    throw new Error(
      `automatic portable Python download is only supported for Windows bundles. Set ${PORTABLE_PYTHON_SOURCE_ENV_VAR} for this platform.`,
    );
  }

  const version = options.pythonNugetVersion ?? DEFAULT_PORTABLE_PYTHON_NUGET_VERSION;
  const packageDir = path.join(resolvePythonRuntimeCacheDir(options), `python-${version}`);
  const runtimeDir = path.join(packageDir, "tools");
  const pythonExecutable = path.join(runtimeDir, plan.pythonExecutableName);
  const pipPackageDir = path.join(runtimeDir, "Lib", "site-packages", "pip");
  if (existsSync(pythonExecutable) && existsSync(pipPackageDir)) {
    return runtimeDir;
  }

  rmSync(packageDir, { recursive: true, force: true });
  mkdirSync(packageDir, { recursive: true });

  const archivePath = path.join(packageDir, `python.${version}.nupkg`);
  const url = `https://api.nuget.org/v3-flatcontainer/python/${version}/python.${version}.nupkg`;
  const downloadFile = options.downloadFile ?? downloadFileWithPowerShell;
  const extractArchive = options.extractArchive ?? extractArchiveWithPowerShell;

  console.log(`Downloading clean Python ${version} with pip for the portable bundle...`);
  try {
    downloadFile(url, archivePath);
    extractArchive(archivePath, packageDir);
  } catch (error) {
    throw new Error(
      `failed to prepare clean portable Python ${version}: ${formatError(error)}`,
    );
  }

  if (!existsSync(pythonExecutable)) {
    throw new Error(`downloaded portable Python is missing ${plan.pythonExecutableName}: ${pythonExecutable}`);
  }
  if (!existsSync(pipPackageDir)) {
    throw new Error(`downloaded portable Python is missing pip: ${pipPackageDir}`);
  }

  return runtimeDir;
}

function resolvePythonRuntimeCacheDir(options: PortableBundleOptions): string {
  const configured =
    cleanPath(options.pythonRuntimeCacheDir) ??
    cleanPath(process.env[PORTABLE_PYTHON_CACHE_ENV_VAR]);
  if (configured) {
    return path.resolve(configured);
  }

  const localAppData = cleanPath(process.env.LOCALAPPDATA);
  if (localAppData) {
    return path.join(localAppData, "DirongBuild", "runtime");
  }

  return path.join(process.cwd(), "portable", ".runtime");
}

function downloadFileWithPowerShell(url: string, targetPath: string): void {
  runPowerShell(
    `$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri ${quotePowerShell(url)} -OutFile ${quotePowerShell(targetPath)}`,
  );
}

function extractArchiveWithPowerShell(archivePath: string, targetDir: string): void {
  runPowerShell(
    `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(targetDir)} -Force`,
  );
}

function runPowerShell(command: string): void {
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function cleanPath(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

const currentFilePath = fileURLToPath(import.meta.url);
const invokedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedFilePath === currentFilePath) {
  const plan = createPortableBundle();
  console.log(`Dirong portable bundle created: ${plan.targetRoot}`);
  console.log(`Runtime data directory: ${plan.dataDir}`);
  console.log("Local secrets were not copied into the bundle.");
}
