import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { resolveShellFalseCommand, runChild } from "./run-child.js";

test("runChild captures stdout, stderr, and stdin", async () => {
  const result = await runChild(
    process.execPath,
    [
      "-e",
      [
        "let input = '';",
        "process.stdin.on('data', (chunk) => input += chunk);",
        "process.stdin.on('end', () => {",
        "  process.stdout.write(`out:${input}`);",
        "  process.stderr.write('err');",
        "});",
      ].join(""),
    ],
    { stdin: "hello", timeoutMs: 1000 },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.stdout, "out:hello");
  assert.equal(result.stderr, "err");
});

test("runChild preserves the tail when output is capped", async () => {
  const result = await runChild(
    process.execPath,
    ["-e", "process.stdout.write('0123456789'); process.stderr.write('abcdefghij');"],
    { timeoutMs: 1000, maxStdoutBytes: 4, maxStderrBytes: 5 },
  );

  assert.equal(result.stdout, "6789");
  assert.equal(result.stderr, "fghij");
});

test("runChild marks timed out processes", async () => {
  const result = await runChild(
    process.execPath,
    ["-e", "setTimeout(() => {}, 1000);"],
    { timeoutMs: 20 },
  );

  assert.equal(result.timedOut, true);
});

test("runChild rejects direct spawn errors", async () => {
  await assert.rejects(
    () =>
      runChild("__dirong_missing_command__", [], {
        timeoutMs: 1000,
        windowsResolveShellFalse: false,
      }),
    /ENOENT|not found/i,
  );
});

test("resolveShellFalseCommand wraps Windows script commands", () => {
  assert.deepEqual(
    resolveShellFalseCommand("tool.cmd", ["--name", "with space"], "win32"),
    { command: "cmd.exe", args: ["/C", "tool.cmd", "--name", '"with space"'] },
  );
  assert.deepEqual(
    resolveShellFalseCommand("script.ps1", ["--flag"], "win32"),
    { command: "pwsh.exe", args: ["-NoProfile", "-File", "script.ps1", "--flag"] },
  );
  assert.deepEqual(
    resolveShellFalseCommand("tool.exe", ["--flag"], "win32"),
    { command: "tool.exe", args: ["--flag"] },
  );
});

test("resolveShellFalseCommand does not fall back to cmd.exe for unknown Windows commands", () => {
  assert.deepEqual(
    resolveShellFalseCommand("__dirong_missing_command__", ["--flag"], "win32"),
    { command: "__dirong_missing_command__", args: ["--flag"] },
  );
});
