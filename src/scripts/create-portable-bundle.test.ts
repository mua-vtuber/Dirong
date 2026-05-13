import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createPortableBundle,
  createWindowsLauncher,
  PORTABLE_DATA_ENV_VAR,
  PORTABLE_PYTHON_ENV_VAR,
  PORTABLE_ROOT_ENV_VAR,
  resolvePortableBundlePlan,
} from "./create-portable-bundle.js";

test("resolvePortableBundlePlan keeps the bundle under portable/Dirong", () => {
  const projectRoot = path.resolve("D:\\DirongSource");
  const plan = resolvePortableBundlePlan({
    projectRoot,
    platform: "win32",
  });

  assert.equal(plan.targetRoot, path.resolve(projectRoot, "portable", "Dirong"));
  assert.equal(plan.dataDir, path.resolve(projectRoot, "portable", "Dirong", "data"));
  assert.equal(plan.nodeExecutableName, "node.exe");
  assert.equal(plan.pythonExecutableName, "python.exe");
  assert.equal(plan.pythonDir, path.resolve(projectRoot, "portable", "Dirong", "python"));
});

test("createWindowsLauncher points runtime data at the portable data folder", () => {
  const plan = resolvePortableBundlePlan({
    projectRoot: path.resolve("D:\\DirongSource"),
    platform: "win32",
  });

  const launcher = createWindowsLauncher(plan);

  assert.match(launcher, new RegExp(`set "${PORTABLE_DATA_ENV_VAR}=%~dp0data"`));
  assert.match(launcher, new RegExp(`set "${PORTABLE_ROOT_ENV_VAR}=%~dp0"`));
  assert.match(
    launcher,
    new RegExp(`set "${PORTABLE_PYTHON_ENV_VAR}=%~dp0python\\\\python\\.exe"`),
  );
  assert.match(launcher, /set "PATH=%~dp0python;%~dp0node;%PATH%"/);
  assert.match(launcher, /"%~dp0node\\node\.exe" "%~dp0app\\dist\\app\\main\.js" %\*/);
});

test("createPortableBundle creates a clean portable folder without source data secrets", () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "dirong-portable-"));
  try {
    const projectRoot = path.join(tempRoot, "source");
    createFakeProject(projectRoot);

    const plan = createPortableBundle({
      projectRoot,
      nodeExecutable: path.join(projectRoot, "fake-node.exe"),
      pythonRuntimeDir: path.join(projectRoot, "runtime", "python"),
      platform: "win32",
    });

    assert.equal(plan.targetRoot, path.join(projectRoot, "portable", "Dirong"));
    assert.ok(existsSync(path.join(plan.appDistDir, "app", "main.js")));
    assert.ok(existsSync(path.join(plan.appDir, "node_modules", "runtime-package", "index.js")));
    assert.ok(existsSync(path.join(plan.nodeDir, "node.exe")));
    assert.ok(existsSync(path.join(plan.pythonDir, "python.exe")));
    assert.ok(existsSync(path.join(plan.pythonDir, "Lib", "site.py")));
    assert.ok(existsSync(path.join(plan.scriptsDir, "local-whisper-json.py")));
    assert.ok(existsSync(path.join(plan.dataDir, "settings")));
    assert.ok(existsSync(path.join(plan.dataDir, "secrets")));
    assert.ok(!existsSync(path.join(plan.dataDir, "secrets", "secrets.json")));
    assert.equal(
      readFileSync(plan.launcherPath, "utf8").includes(PORTABLE_DATA_ENV_VAR),
      true,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

function createFakeProject(projectRoot: string): void {
  mkdirSync(path.join(projectRoot, "dist", "app"), { recursive: true });
  mkdirSync(path.join(projectRoot, "node_modules", "runtime-package"), {
    recursive: true,
  });
  mkdirSync(path.join(projectRoot, "scripts"), { recursive: true });
  mkdirSync(path.join(projectRoot, "data", "secrets"), { recursive: true });
  mkdirSync(path.join(projectRoot, "runtime", "python", "Lib"), {
    recursive: true,
  });

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  writeFileSync(path.join(projectRoot, "package-lock.json"), "{}");
  writeFileSync(path.join(projectRoot, "dist", "app", "main.js"), "export {};\n");
  writeFileSync(
    path.join(projectRoot, "node_modules", "runtime-package", "index.js"),
    "module.exports = {};\n",
  );
  writeFileSync(path.join(projectRoot, "scripts", "local-whisper-json.py"), "");
  writeFileSync(path.join(projectRoot, "fake-node.exe"), "");
  writeFileSync(path.join(projectRoot, "runtime", "python", "python.exe"), "");
  writeFileSync(path.join(projectRoot, "runtime", "python", "Lib", "site.py"), "");
  writeFileSync(
    path.join(projectRoot, "data", "secrets", "secrets.json"),
    JSON.stringify({ secrets: { token: { value: "do-not-copy" } } }),
  );
}
