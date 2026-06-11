import type { AskData } from "../arcadia/types.js";

export function formatRequest(data: AskData): string {
  const codexInvocation = data.codexInvocations[0] ?? null;
  const packetPath = data.ask.prompt_packet_path ?? codexInvocation?.prompt_path ?? "None";
  const gateTypes = data.approvalGates.map((gate) => gate.gate_type);
  const gateSummary = gateTypes.length > 0 ? `${gateTypes.length} (${gateTypes.join(", ")})` : "0";
  const runLine = data.run
    ? `Run: \`${data.run.id}\` ${labelStatus(data.run.status)}`
    : "Run: Not run";
  const runDetailLine = data.run
    ? `Run detail: /arcadia run id:${data.run.id}`
    : "Run detail: Use /arcadia runs after work starts.";

  return [
    "**Arcadia request created**",
    `Ask: \`${data.ask.id}\``,
    `Work item: \`${data.workItem.id}\``,
    `Plan: \`${data.plan.id}\``,
    runLine,
    `Project: ${data.workItem.project_name ?? "Unresolved"}`,
    `Active milestone: ${data.workItem.milestone_title ?? "None"}`,
    `Classification: ${data.workItem.work_classification}`,
    `Approval gates: ${gateSummary}`,
    `Codex packet: ${packetPath}`,
    `Repo scope: ${codexInvocation?.workspace_scope ?? "Workspace scope"}`,
    runDetailLine
  ].join("\n");
}

function labelStatus(status: string): string {
  return status === "needs_mark" ? "Requires Review" : status.replaceAll("_", " ");
}
