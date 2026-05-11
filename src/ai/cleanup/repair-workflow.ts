import { summarizeSafeText } from "../../errors.js";
import { summarizeAiCleanupError } from "./cleanup-workflow.js";

export function summarizeSchemaRepairFailure(
  initialIssues: readonly string[],
  repairError: unknown,
): string {
  const initialSummary = initialIssues.slice(0, 5).join("; ");
  const repairSummary = summarizeAiCleanupError(repairError);
  const message = [
    "회의록 JSON schema 검증에 실패했고 자동 repair도 실패했습니다.",
    initialSummary ? `initial: ${initialSummary}` : null,
    `repair: ${repairSummary}`,
  ]
    .filter((line): line is string => line !== null)
    .join(" ");
  return summarizeSafeText(message);
}
