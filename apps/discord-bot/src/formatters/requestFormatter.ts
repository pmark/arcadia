import type { AskData } from "../arcadia/types.js";

export function formatRequest(data: AskData): string {
  const codexInvocation = data.codexInvocations[0] ?? null;
  const packetPath = data.ask?.prompt_packet_path ?? codexInvocation?.prompt_path ?? "None";
  const gateTypes = data.approvalGates.map((gate) => gate.gate_type);
  const gateSummary = gateTypes.length > 0 ? `${gateTypes.length} (${gateTypes.join(", ")})` : "0";
  const runLine = data.run
    ? `Run: \`${data.run.id}\` ${labelStatus(data.run.status)}`
    : "Run: Not run";
  const runDetailLine = data.run
    ? `Run detail: /arcadia run id:${data.run.id}`
    : "Run detail: Use /arcadia runs after work starts.";

  const lines = [
    data.workItem ? "**Arcadia request created**" : "**Arcadia ask handled**",
    `Ask: \`${data.ask?.id ?? "None"}\``,
    `Stewardship: ${data.stewardship ? `${data.stewardship.intentType} -> ${data.stewardship.recommendedExecutionPath}` : "Unavailable"}`,
    `Stewardship reason: ${data.stewardship?.classificationReason ?? "Unavailable"}`,
    `Interpreted as: ${data.intake?.resolvedIntent ?? data.resolvedIntent.intentId}`,
    `Result: ${data.result?.summary ?? labelStatus(data.ask?.status ?? "ignored")}`,
    `Project: ${data.workItem?.project_name ?? data.project?.name ?? data.projectSummary?.name ?? data.intake?.project?.name ?? "Unresolved"}`,
    `Next action: ${data.workItem?.next_action ?? data.intake?.suggestedNextStep ?? data.resolvedIntent.nextAction ?? "Review the Arcadia response."}`,
    `Expected artifact: ${data.workItem?.expected_artifact ?? data.resolvedIntent.expectedArtifact ?? "None"}`
  ];

  if (data.workItem) {
    lines.push(
      `Action: \`${data.workItem.id}\``,
      `Plan: \`${data.plan?.id ?? "None"}\``,
      runLine,
      `Project: ${data.workItem.project_name ?? "Unresolved"}`,
      `Active milestone: ${data.workItem.milestone_title ?? "None"}`,
      `Responsibility: ${labelStatus(data.workItem.responsibility ?? data.workItem.work_classification)}`
    );
  }

  if (!data.workItem && data.reviewItemId) {
    lines.push(
      `Requires Review: \`${data.decisionId ?? data.reviewItemId}\``,
      `Decision: ${data.intake?.proposedAction ?? data.result?.summary ?? "Review required"}`
    );
  }

  if (!data.workItem && data.backBurnerItemId) {
    lines.push(
      `Back Burner: \`${data.backBurnerItemId}\``,
      `Intake category: ${data.intake?.classification ?? "IncubatingThought"}`,
      `Next step: ${data.intake?.suggestedNextStep ?? "Clarify before promoting to an Action."}`
    );
  }

  lines.push(
    `Approval gates: ${gateSummary}`,
    `Codex packet: ${packetPath}`,
    `Repo scope: ${codexInvocation?.workspace_scope ?? "Workspace scope"}`,
    runDetailLine
  );

  return lines.join("\n");
}

function labelStatus(status: string): string {
  return status === "requires_review" || status === "needs_mark" ? "Requires Review" : status.replaceAll("_", " ");
}
