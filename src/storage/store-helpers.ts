import { createHash } from "node:crypto";

// File-local helpers extracted from session-store.ts (lines 866-872) so the four
// new role-scoped facades can share them without duplication. Behavior is
// byte-identical to the original SessionStore source.

export function isoNow(): string {
  return new Date().toISOString();
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
