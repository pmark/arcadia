import type { AskData } from "../arcadia/types.js";

export function formatRequest(data: AskData): string {
  const packetPath = data.ask.prompt_packet_path ?? data.codexInvocations[0]?.prompt_path ?? "None";

  return [
    "**Arcadia request created**",
    `Ask: \`${data.ask.id}\``,
    `Work item: \`${data.workItem.id}\``,
    `Plan: \`${data.plan.id}\``,
    `Classification: ${data.workItem.work_classification}`,
    `Approval gates: ${data.approvalGates.length}`,
    `Codex packet: ${packetPath}`
  ].join("\n");
}
