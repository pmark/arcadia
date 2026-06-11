import type { CodexListData, CodexTask } from "../arcadia/types.js";

export function formatCodexTasks(data: CodexListData): string {
  const lines = [
    "**Codex Companion**",
    `Observed now: ${data.observedCount}`,
    `Active tasks: ${data.tasks.length}`
  ];

  if (data.tasks.length === 0) {
    lines.push("No active Codex tasks observed.");
    return lines.join("\n");
  }

  for (const task of data.tasks.slice(0, 8)) {
    lines.push(formatTaskLine(task));
  }

  return lines.join("\n");
}

export function formatCodexTaskNotification(task: CodexTask, event: "started" | "requires_review" | "completed" | "failed"): string {
  const label = {
    started: "started",
    requires_review: "requires review",
    completed: "completed",
    failed: "failed"
  }[event];
  return [
    `**Codex task ${label}**`,
    `${task.title} (${task.status})`,
    `Project: ${task.project_name ?? "Unassociated"}`,
    `Task: ${task.id}`,
    `Mission log: ${task.mission_log_path ?? "None"}`,
    task.url ? `URL: ${task.url}` : null
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function formatTaskLine(task: CodexTask): string {
  return [
    `- ${task.title} (${task.status})`,
    `  Project: ${task.project_name ?? "Unassociated"}`,
    `  Task: ${task.id}`,
    task.mission_log_path ? `  Mission log: ${task.mission_log_path}` : null
  ].filter((line): line is string => Boolean(line)).join("\n");
}
