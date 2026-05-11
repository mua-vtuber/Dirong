import path from "node:path";

const FORBIDDEN_DASHBOARD_COMMANDS = new Set([
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "wscript",
  "wscript.exe",
  "cscript",
  "cscript.exe",
  "bash",
  "sh",
]);

const FORBIDDEN_SCRIPT_EXTENSIONS = [".bat", ".cmd", ".ps1"];

export type CommandPolicyResult =
  | { ok: true }
  | { ok: false; reason: "forbidden-executor" | "forbidden-script" };

export function validateDashboardCommandInput(input: {
  command: string | null;
}): CommandPolicyResult {
  if (!input.command) {
    return { ok: true };
  }

  const normalized = normalizeCommandName(input.command);
  if (FORBIDDEN_DASHBOARD_COMMANDS.has(normalized)) {
    return { ok: false, reason: "forbidden-executor" };
  }
  if (
    FORBIDDEN_SCRIPT_EXTENSIONS.some((extension) =>
      normalized.endsWith(extension),
    )
  ) {
    return { ok: false, reason: "forbidden-script" };
  }

  return { ok: true };
}

function normalizeCommandName(command: string): string {
  const trimmed = command.trim().replace(/^["']|["']$/g, "");
  return path.basename(trimmed).toLowerCase();
}
