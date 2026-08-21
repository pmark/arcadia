import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { auditArcadiaLaunchAgents, type LaunchAgentAuditResult } from "../runtime/launchAgents.js";

export interface RuntimeData {
  launchAgents: LaunchAgentAuditResult;
}

export function runRuntimeCommand(options: { workspace: string }): CommandSuccess<RuntimeData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  return createSuccess({
    command: "runtime",
    workspace: workspacePath,
    data: { launchAgents: auditArcadiaLaunchAgents() }
  });
}

export function renderRuntimeSuccess(response: CommandSuccess<RuntimeData>): string[] {
  const { launchAgents } = response.data;
  const lines = ["Arcadia runtime pinning", `Launch agents: ${launchAgents.directory}`, ""];

  if (launchAgents.agents.length === 0) {
    lines.push("No Arcadia launch agents are installed.");
    return lines;
  }

  for (const agent of launchAgents.agents) {
    const marker = agent.verdict === "pinned" ? "PASS" : agent.verdict === "unpinned" ? "UNPINNED" : "UNREADABLE";
    lines.push(`${marker} ${agent.label}`);
    lines.push(`  ${agent.detail}`);
    if (agent.verdict !== "pinned") {
      lines.push(`  Plist: ${agent.plistPath}`);
      lines.push(`  Fix:   ${agent.remedy}`);
    }
  }

  lines.push("");
  if (launchAgents.counts.unpinned === 0 && launchAgents.counts.unreadable === 0) {
    lines.push("Every Arcadia launch agent runs through mise.");
    return lines;
  }

  lines.push(
    `${launchAgents.counts.unpinned} agent(s) do not run through mise` +
    (launchAgents.counts.unreadable > 0 ? `, and ${launchAgents.counts.unreadable} could not be read` : "") +
    "."
  );
  lines.push("An unpinned agent runs under whatever Node its PATH happens to resolve, which is how a");
  lines.push("better-sqlite3 ABI mismatch takes a background service down silently. Each agent's own");
  lines.push("fix is listed above: launchd keys agents by label, so an installer only replaces an agent");
  lines.push("that already carries its label.");

  return lines;
}
