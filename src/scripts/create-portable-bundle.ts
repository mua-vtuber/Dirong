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
export const PORTABLE_DATA_ENV_VAR = "DIRONG_PORTABLE_DATA_DIR";
export const PORTABLE_ROOT_ENV_VAR = "DIRONG_PORTABLE_ROOT";
export const PORTABLE_PYTHON_ENV_VAR = "DIRONG_PORTABLE_PYTHON";
export const PORTABLE_PYTHON_SOURCE_ENV_VAR = "DIRONG_PORTABLE_PYTHON_DIR";

export type PortableBundleOptions = {
  projectRoot?: string;
  outputDir?: string;
  appName?: string;
  nodeExecutable?: string;
  pythonRuntimeDir?: string;
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
  const source =
    cleanPath(options.pythonRuntimeDir) ??
    cleanPath(process.env[PORTABLE_PYTHON_SOURCE_ENV_VAR]) ??
    path.join(plan.projectRoot, "runtime", "python");
  return path.resolve(source);
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
