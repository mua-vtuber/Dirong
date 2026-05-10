import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
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

test("getDirongUserDataPaths keeps settings, secrets, sessions, models, and logs under root", () => {
  const paths = getDirongUserDataPaths("C:\\DirongData");

  assert.equal(paths.settingsFile, path.resolve("C:\\DirongData", "settings", "settings.json"));
  assert.equal(paths.secretsFile, path.resolve("C:\\DirongData", "secrets", "secrets.json"));
  assert.equal(paths.databasePath, path.resolve("C:\\DirongData", "sessions", "dirong.sqlite"));
  assert.equal(paths.modelsDir, path.resolve("C:\\DirongData", "models"));
  assert.equal(paths.logsDir, path.resolve("C:\\DirongData", "logs"));
});
