import type { PointInTimeView } from "./rewind.js";
import type { TimelineEvent } from "./schema.js";
import type { SourceReport } from "./index.js";

/** Plain text that reads the same in a terminal, a Discord message and a phone. */

function stamp(time: string): string {
  return `${time.slice(5, 10)} ${time.slice(11, 19)}Z`;
}

function pad(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);
}

export function actorLabel(event: Pick<TimelineEvent, "actor">): string {
  const { tool, name, confidence } = event.actor;
  const label = name ? `${tool}·${name}` : tool;
  // Low-confidence attribution is shown as a question, never as a fact.
  return confidence === "low" && tool !== "unknown" ? `${label}?` : label;
}

export function renderEventLine(event: TimelineEvent): string {
  const mark = event.attention ? "!" : " ";
  const more = event.alsoSeenAs.length > 0 ? `  [+${event.alsoSeenAs.length}]` : "";
  return `${mark} ${stamp(event.time)}  ${pad(event.subjects.project ?? "-", 22)}  ${pad(event.workKind, 11)}  ${pad(actorLabel(event), 26)}  ${event.summary}${more}`;
}

export function renderSources(sources: SourceReport[]): string[] {
  const failed = sources.filter((source) => source.error);
  const total = sources.reduce((sum, source) => sum + source.durationMs, 0);
  const lines = [`${sources.length} sources read in ${total} ms${failed.length ? `; ${failed.length} unreadable (shown as source_error)` : ""}.`];
  return lines;
}

export function renderPointInTime(view: PointInTimeView): string[] {
  const lines: string[] = [`As of ${view.asOf} (from events since ${view.windowStart})`, ""];
  lines.push(`Production: ${view.production.state}${view.production.since ? ` since ${view.production.since}` : " (no policy change in the window)"}`);
  lines.push("", "Active worktrees (activity in the 2 hours before):");
  if (view.activeWorktrees.length === 0) lines.push("  none");
  for (const worktree of view.activeWorktrees.slice(0, 15)) {
    lines.push(`  ${stamp(worktree.lastActivity)}  ${pad(worktree.project ?? "-", 22)}  ${pad(actorLabel({ actor: { tool: worktree.tool, name: worktree.name, confidence: worktree.confidence, tier: null, role: null, account: null } }), 26)}  ${pad(worktree.lastWorkKind, 11)}  ${worktree.action ?? worktree.branch ?? worktree.worktree}`);
  }
  lines.push("", "Running Sessions:");
  if (view.activeSessions.length === 0) lines.push("  none");
  for (const session of view.activeSessions) lines.push(`  since ${stamp(session.since)}  ${session.project ?? "-"}  ${session.tool}${session.name ? `·${session.name}` : ""}  ${session.action ?? session.session}`);
  lines.push("", "Projects (latest first):");
  for (const project of view.projects.slice(0, 15)) {
    lines.push(`  ${pad(project.project, 22)}  pointer ${project.pointer?.action ?? "unknown in window"}  · last: ${stamp(project.lastEvent.time)} ${project.lastEvent.workKind} ${project.lastEvent.summary}`.slice(0, 200));
  }
  lines.push("", "What kind of work (hour before):");
  if (view.lens.length === 0) lines.push("  nothing");
  for (const entry of view.lens.slice(0, 12)) lines.push(`  ${pad(entry.tool, 12)} ${pad(entry.workKind, 11)} ${entry.events}`);
  if (view.attention.length > 0) {
    lines.push("", "Needed attention:");
    for (const item of view.attention) lines.push(`  ${stamp(item.time)}  ${item.summary}`.slice(0, 200));
  }
  return lines;
}
