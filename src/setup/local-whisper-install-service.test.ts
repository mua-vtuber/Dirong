import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getDirongUserDataPaths } from "../settings/dirong-user-data.js";
import { LocalWhisperInstallService } from "./local-whisper-install-service.js";

test("LocalWhisperInstallService runs package and model setup steps", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dirong-whisper-install-"));
  const paths = getDirongUserDataPaths(dir);
  const calls: Array<{ command: string; args: string[]; timeoutMs: number }> = [];
  let tick = 0;
  const service = new LocalWhisperInstallService({
    paths,
    env: {
      DIRONG_PORTABLE_PYTHON: "C:\\Dirong\\python\\python.exe",
    },
    now: () => new Date(1700000000000 + tick++ * 1000),
    commandRunner: async (command, args, options) => {
      calls.push({ command, args, timeoutMs: options.timeoutMs });
      return {
        stdout: args.includes("--version") ? "Python 3.12.0" : "{\"ok\":true}",
        stderr: "",
        exitCode: 0,
        timedOut: false,
      };
    },
  });

  try {
    const started = service.start({ model: "medium" });
    assert.equal(started.status, "running");
    assert.equal(started.model, "medium");

    const done = await waitForInstall(service);

    assert.equal(done.status, "done");
    assert.equal(done.stage, "done");
    assert.equal(
      done.detail,
      path.join(paths.modelsDir, "faster-whisper-medium"),
    );
    assert.deepEqual(
      calls.map((call) => call.args.slice(0, 4)),
      [
        ["--version"],
        ["-m", "pip", "install", "--upgrade"],
        ["scripts/local-whisper-json.py", "--check"],
        [
          "scripts/local-whisper-json.py",
          "--download-model",
          "--model",
          "medium",
        ],
        [
          "scripts/local-whisper-json.py",
          "--check-model",
          "--model",
          path.join(paths.modelsDir, "faster-whisper-medium"),
        ],
      ],
    );
    assert.equal(calls.every((call) => call.command === "C:\\Dirong\\python\\python.exe"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function waitForInstall(
  service: LocalWhisperInstallService,
): Promise<ReturnType<LocalWhisperInstallService["getSnapshot"]>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const snapshot = service.getSnapshot();
    if (snapshot.status !== "running") {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("install service did not finish");
}
