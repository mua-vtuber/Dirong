import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  getDirongManagedPythonPath,
  getDirongUserDataPaths,
  resolveDirongUserDataPath,
} from "./dirong-user-data.js";

test("resolveDirongUserDataPath uses Windows LocalAppData Dirong folder", () => {
  const root = resolveDirongUserDataPath({
    platform: "win32",
    env: {
      LOCALAPPDATA: "C:\\Users\\Taniar\\AppData\\Local",
    } as NodeJS.ProcessEnv,
    homedir: "C:\\Users\\Taniar",
  });

  assert.equal(root, path.resolve("C:\\Users\\Taniar\\AppData\\Local", "Dirong"));
});

test("resolveDirongUserDataPath uses explicit portable data directory first", () => {
  const root = resolveDirongUserDataPath({
    platform: "win32",
    env: {
      DIRONG_PORTABLE_DATA_DIR: "D:\\Tools\\Dirong\\data",
      DIRONG_USER_DATA_DIR: "D:\\OtherDirongData",
      LOCALAPPDATA: "C:\\Users\\Taniar\\AppData\\Local",
    } as NodeJS.ProcessEnv,
    homedir: "C:\\Users\\Taniar",
  });

  assert.equal(root, path.resolve("D:\\Tools\\Dirong\\data"));
});

test("resolveDirongUserDataPath supports explicit user data directory", () => {
  const root = resolveDirongUserDataPath({
    platform: "linux",
    env: {
      DIRONG_USER_DATA_DIR: "/portable/Dirong/data",
      XDG_DATA_HOME: "/home/taniar/.local/share",
    } as NodeJS.ProcessEnv,
    homedir: "/home/taniar",
  });

  assert.equal(root, path.resolve("/portable/Dirong/data"));
});

test("getDirongUserDataPaths keeps settings, secrets, sessions, models, and logs under root", () => {
  const paths = getDirongUserDataPaths("C:\\DirongData");

  assert.equal(paths.settingsFile, path.resolve("C:\\DirongData", "settings", "settings.json"));
  assert.equal(paths.secretsFile, path.resolve("C:\\DirongData", "secrets", "secrets.json"));
  assert.equal(paths.databasePath, path.resolve("C:\\DirongData", "sessions", "dirong.sqlite"));
  assert.equal(paths.modelsDir, path.resolve("C:\\DirongData", "models"));
  assert.equal(paths.logsDir, path.resolve("C:\\DirongData", "logs"));
});

test("getDirongManagedPythonPath stays under the user data root", () => {
  assert.equal(
    getDirongManagedPythonPath("C:\\DirongData", "win32"),
    path.resolve("C:\\DirongData", "python-venv", "Scripts", "python.exe"),
  );
  assert.equal(
    getDirongManagedPythonPath("/tmp/dirong", "linux"),
    path.resolve("/tmp/dirong", "python-venv", "bin", "python"),
  );
});
