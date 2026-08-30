import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { buildAgentQueue, type AgentQueue, type AgentQueueEntry } from "../dispatch/queue.js";

export interface AdvanceQueueCommandData extends AgentQueue {}

export function runAdvanceQueueCommand(options: { workspace: string }): CommandSuccess<AdvanceQueueCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const queue = withReadOnlyDatabase(workspacePath, (db) => buildAgentQueue(db));

  return createSuccess({
    command: "advance.queue",
    workspace: workspacePath,
    data: queue
  });
}

export function renderAdvanceQueueSuccess(response: CommandSuccess<AdvanceQueueCommandData>): string[] {
  const queue = response.data;
  return [
    "Arcadia Agent Queue",
    `Ready: ${queue.counts.ready} · Running: ${queue.counts.running} · Flagged: ${queue.counts.flagged} · Needs attention: ${queue.counts.attention}`,
    "",
    "Ready to feed:",
    ...renderEntries(queue.ready, renderReadyEntry),
    "",
    "Running or queued:",
    ...renderEntries(queue.running, renderRunningEntry),
    "",
    "Flagged for agent review:",
    ...renderEntries(queue.flagged, renderFlaggedEntry),
    "",
    "Needs attention before dispatch:",
    ...renderEntries(queue.attention, renderAttentionEntry)
  ];
}

function renderFlaggedEntry(entry: AgentQueueEntry): string[] {
  return [
    `  ? ${entry.projectName ?? "Unassigned"} / ${entry.decisionId ?? "Decision"}`,
    `    ${entry.reason}`,
    "    Status: flagged; no coding-agent Run started",
    `    Next: ${entry.nextAction}`
  ];
}

function renderEntries(entries: AgentQueueEntry[], render: (entry: AgentQueueEntry) => string[]): string[] {
  if (entries.length === 0) return ["  None"];
  return entries.flatMap((entry) => render(entry));
}

function renderReadyEntry(entry: AgentQueueEntry): string[] {
  return [
    `  ${entry.selected ? "*" : "-"} ${entry.projectName ?? "Unassigned"} / ${entry.actionId ?? entry.actionTitle ?? "Action"}`,
    `    ${entry.actionTitle ?? "Untitled Action"}${entry.planSlug ? ` · plan ${entry.planSlug}` : ""}`,
    `    ${entry.reason}`,
    ...(entry.tokenImpact || entry.tokenBudget
      ? [`    Token impact: ${entry.tokenImpact ?? "unknown"}${entry.tokenBudget ? ` · ${entry.tokenBudget}` : ""}`]
      : []),
    `    Next: ${entry.nextAction}`
  ];
}

function renderRunningEntry(entry: AgentQueueEntry): string[] {
  return [
    `  - ${entry.projectName ?? "Unassigned"} / ${entry.actionTitle ?? entry.actionId ?? "Action"}`,
    `    Status: ${entry.status}${entry.runId ? ` · Run ${entry.runId}` : ""}`,
    ...(entry.tokenImpact || entry.tokenBudget
      ? [`    Token impact: ${entry.tokenImpact ?? "unknown"}${entry.tokenBudget ? ` · ${entry.tokenBudget}` : ""}`]
      : []),
    `    Next: ${entry.nextAction}`
  ];
}

function renderAttentionEntry(entry: AgentQueueEntry): string[] {
  const lines = [
    `  ! ${entry.projectName ?? "Unassigned"} / ${entry.actionTitle ?? entry.actionId ?? "Project"}`,
    `    ${entry.reason}`,
    ...(entry.tokenImpact || entry.tokenBudget
      ? [`    Token impact: ${entry.tokenImpact ?? "unknown"}${entry.tokenBudget ? ` · ${entry.tokenBudget}` : ""}`]
      : []),
    `    Next: ${entry.nextAction}`
  ];
  for (const blocker of entry.blockers) {
    lines.push(`    Blocker: ${blocker.relativePath} [${blocker.field}] ${blocker.message}`, `    Fix: ${blocker.remedy}`);
  }
  return lines;
}
