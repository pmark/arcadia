import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { syncAcceptedPlanningArtifacts, type MemorySyncResult } from "../memory/obsidian.js";

export function runMemorySyncCommand(options: { workspace: string; dryRun?: boolean }): CommandSuccess<MemorySyncResult> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const result = withReadOnlyDatabase(workspacePath, (db) =>
    syncAcceptedPlanningArtifacts(db, workspacePath, { dryRun: options.dryRun })
  );
  return createSuccess({
    command: "memory.sync",
    workspace: workspacePath,
    data: result,
    artifacts: result.dryRun
      ? []
      : result.entries.flatMap((entry) => entry.recordPath && entry.status !== "failed" ? [entry.recordPath] : []),
    warnings: result.enabled ? [] : ["Obsidian memory export is not enabled for this workspace."]
  });
}

export function renderMemorySyncSuccess(response: CommandSuccess<MemorySyncResult>): string[] {
  const result = response.data;
  const lines = [
    `Arcadia memory sync${result.dryRun ? " dry run" : ""}`,
    `Vault: ${result.vaultPath ?? "Not configured"}`,
    `Created: ${result.counts.created}; Updated: ${result.counts.updated}; Skipped: ${result.counts.skipped}; Failed: ${result.counts.failed}`
  ];
  for (const entry of result.entries) {
    lines.push(`- ${entry.status}: ${entry.project} — ${entry.artifactTitle} (${entry.artifactId})${entry.recordPath ? ` -> ${entry.recordPath}` : ""}${entry.error ? `: ${entry.error}` : ""}`);
  }
  return lines;
}
