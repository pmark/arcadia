import type { AskCorrectData, AskData } from "../arcadia/types.js";

/** The correction hint every receipt closes with; matches `ASK_HEARD_HINT` in the CLI. */
const HEARD_HINT = "wrong? reply type: work|idea|answer|status";

/**
 * The one line every Ask reply opens with. It comes from the CLI's `heard` field; a CLI that predates it gets the
 * same line built from what the response does carry, so no reply ever opens without it.
 */
export function heardLine(data: AskData): string {
  if (data.heard?.line) {
    return data.heard.line;
  }
  const confidence = data.intake?.confidenceLabel ?? "low";
  const where = data.workItem?.project_name ?? data.intake?.project?.name ?? data.project?.name ?? null;
  const place = where ? `in ${where}` : "unscoped";
  let type: string;
  let created: string;
  if (data.backBurnerItemId) {
    type = "idea";
    created = `Back Burner item ${data.backBurnerItemId} ${place}`;
  } else if (data.workItem) {
    type = "work";
    created = `Action ${data.workItem.id} ${place}`;
  } else if (data.reviewItemId) {
    const question = data.stewardship?.recommendedExecutionPath === "Clarify First";
    type = question ? "unclear" : "work";
    created = question
      ? `question ${data.decisionSlug ?? data.reviewItemId} in Clarify First ${place}`
      : `Decision ${data.decisionSlug ?? data.reviewItemId} to review ${place}`;
  } else {
    type = "none";
    created = "nothing created";
  }
  return `Heard: ${type} (${confidence}, rule) -> ${created} . ${HEARD_HINT}`;
}

/** What the bot posts after a correction reply: the new receipt line, then what was superseded. */
export function formatAskCorrection(data: AskCorrectData): string {
  const replaced = data.previous.id ? `${data.previous.kind} ${data.previous.id}` : `Ask ${data.correctedAskId}`;
  return [
    data.heard.line,
    "**Arcadia correction applied**",
    `Ask: \`${data.newAskId}\` replaces \`${data.correctedAskId}\``,
    `Now: ${data.targetType} - ${data.created.summary}`,
    `Superseded: ${replaced} (${data.previous.disposition}); nothing was deleted`,
    "Run: Not run"
  ].join("\n");
}

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
    heardLine(data),
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

  if (data.reviewItemId) {
    lines.push(
      `Requires Review: \`${data.reviewItemId}\``,
      `Decision ID: \`${data.decisionSlug ?? data.decisionId ?? data.reviewItemId}\``,
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
  return status === "requires_review" ? "Requires Review" : status.replaceAll("_", " ");
}
