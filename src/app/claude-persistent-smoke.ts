import process from "node:process";
import {
  ClaudePersistentSmokeSession,
  renderCommandDisplay,
  type ClaudePersistentSmokeTurnResult,
} from "../ai/cleanup/claude-persistent-smoke.js";
import { printCliError } from "../cli/error-output.js";

type ClaudePersistentSmokeCliOptions = {
  prompt: string;
  prompt2: string;
  twoTurn: boolean;
  command: string | null;
  model: string | null;
  timeoutMs: number | null;
};

try {
  const options = parseClaudePersistentSmokeArgs(process.argv.slice(2));
  const session = new ClaudePersistentSmokeSession({
    command: options.command ?? undefined,
    model: options.model ?? undefined,
    timeoutMs: options.timeoutMs ?? undefined,
  });

  console.log("Claude persistent subprocess smoke observation");
  console.log(`requested command: ${session.requestedCommand}`);
  console.log(
    `requested args: ${renderCommandDisplay("", session.requestedArgs).trim()}`,
  );
  console.log(
    `spawned command: ${renderCommandDisplay(session.spawnedCommand, session.spawnedArgs)}`,
  );
  console.log(`model: ${session.model ?? "(omitted)"}`);
  console.log(`timeout ms: ${session.timeoutMs}`);

  session.start();
  console.log(`pid after start: ${renderNullableNumber(session.pid)}`);

  try {
    const first = await session.request(options.prompt);
    printTurnResult("turn 1", first);

    if (options.twoTurn) {
      const second = await session.request(options.prompt2);
      printTurnResult("turn 2", second);
      const samePid =
        first.pidAfterResult !== null &&
        first.pidAfterResult === second.pidBeforeWrite;
      console.log(
        `same pid across turns: ${yesNo(samePid)} (turn1 pid ${renderNullableNumber(
          first.pidAfterResult,
        )}, turn2 pid ${renderNullableNumber(second.pidBeforeWrite)})`,
      );
      console.log(
        `turn duration ms: ${first.durationMs} -> ${second.durationMs}`,
      );
    }
  } finally {
    const killResult = await session.killAndWait();
    console.log(`kill requested: ${yesNo(killResult.killRequested)}`);
    console.log(`process exited after kill: ${yesNo(killResult.exited)}`);
    console.log(`exit code: ${renderNullableNumber(killResult.exitCode)}`);
    console.log(`exit signal: ${killResult.exitSignal ?? "(none)"}`);
  }
} catch (error) {
  printCliError(error, { args: process.argv });
  process.exitCode = 1;
}

export function parseClaudePersistentSmokeArgs(
  args: string[],
): ClaudePersistentSmokeCliOptions {
  const options: ClaudePersistentSmokeCliOptions = {
    prompt: 'Return exactly {"ok":true} as JSON.',
    prompt2: 'Return exactly {"turn":2} as JSON.',
    twoTurn: false,
    command: null,
    model: null,
    timeoutMs: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      throw new Error(helpText());
    }
    if (arg === "--two-turn") {
      options.twoTurn = true;
      continue;
    }
    if (arg === "--prompt") {
      options.prompt = readRequiredValue(args[index + 1], "--prompt");
      index += 1;
      continue;
    }
    if (arg === "--prompt2") {
      options.prompt2 = readRequiredValue(args[index + 1], "--prompt2");
      index += 1;
      continue;
    }
    if (arg === "--command") {
      options.command = readRequiredValue(args[index + 1], "--command");
      index += 1;
      continue;
    }
    if (arg === "--model") {
      options.model = readRequiredValue(args[index + 1], "--model");
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = readPositiveNumber(args[index + 1], "--timeout-ms");
      index += 1;
      continue;
    }

    throw new Error(`Unknown Claude persistent smoke option: ${arg ?? ""}`);
  }

  return options;
}

function printTurnResult(
  label: string,
  result: ClaudePersistentSmokeTurnResult,
): void {
  console.log("");
  console.log(`${label}:`);
  console.log(`  prompt: ${result.prompt}`);
  console.log(`  wrote bytes: ${result.wroteBytes}`);
  console.log(`  pid before write: ${renderNullableNumber(result.pidBeforeWrite)}`);
  console.log(`  pid after result: ${renderNullableNumber(result.pidAfterResult)}`);
  console.log(`  result received: ${yesNo(result.resultReceived)}`);
  console.log(`  timed out: ${yesNo(result.timedOut)}`);
  console.log(`  output exceeded: ${yesNo(result.outputExceeded)}`);
  console.log(`  duration ms: ${result.durationMs}`);
  console.log(`  session_id: ${result.sessionId ?? "(none observed)"}`);
  console.log(
    `  process alive after result: ${yesNo(result.processAliveAfterResult)}`,
  );
  console.log(`  stdout lines observed: ${result.stdoutLines.length}`);
  console.log(`  stderr lines observed: ${result.stderrLines.length}`);
  if (result.error) {
    console.log(`  error: ${result.error}`);
  }
  console.log("  assistant text:");
  printIndentedBlock(result.assistantText || "(empty)");
  if (result.resultLine) {
    console.log(`  result line: ${truncate(result.resultLine, 800)}`);
  }
  if (result.stderrLines.length > 0) {
    console.log("  stderr:");
    printIndentedBlock(result.stderrLines.join("\n"));
  }
}

function printIndentedBlock(value: string): void {
  for (const line of value.split(/\r?\n/)) {
    console.log(`    ${line}`);
  }
}

function readRequiredValue(value: string | undefined, flag: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${flag} requires a value.`);
  }
  return trimmed;
}

function readPositiveNumber(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function renderNullableNumber(value: number | null): string {
  return value === null ? "(unknown)" : String(value);
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}... [truncated ${value.length - maxLength} chars]`;
}

function helpText(): string {
  return [
    "Claude persistent smoke options:",
    "  --prompt <text>      Prompt for turn 1",
    "  --two-turn           Send a second prompt to the same subprocess",
    "  --prompt2 <text>     Prompt for turn 2",
    "  --command <command>  Claude CLI command override",
    "  --model <model>      Claude model override; use default to omit --model",
    "  --timeout-ms <n>     Per-turn result boundary timeout",
  ].join("\n");
}
