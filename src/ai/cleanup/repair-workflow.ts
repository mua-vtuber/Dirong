import { summarizeSafeText } from "../../errors.js";
import { t } from "../../i18n/catalog.js";
import { summarizeAiCleanupError } from "./cleanup-workflow.js";

export function summarizeSchemaRepairFailure(
  initialIssues: readonly string[],
  repairError: unknown,
): string {
  const initialSummary = initialIssues.slice(0, 5).join("; ");
  const repairSummary = summarizeAiCleanupError(repairError);
  const message = [
    t("ko", "runtimeCli.aiWorkflow.repairFailed"),
    initialSummary ? `initial: ${initialSummary}` : null,
    `repair: ${repairSummary}`,
  ]
    .filter((line): line is string => line !== null)
    .join(" ");
  return summarizeSafeText(message);
}
