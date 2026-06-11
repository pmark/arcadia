import type { StatusData } from "../arcadia/types.js";

export function formatStatus(data: StatusData): string {
  return [
    "**Arcadia status**",
    `Active projects: ${data.activeProjectCount}`,
    `Running work: ${data.runningWorkCount}`,
    `Queued work: ${data.queuedWorkCount}`,
    `Requires Review: ${data.requiresReviewCount}`,
    `Recent artifacts: ${data.recentArtifactCount}`
  ].join("\n");
}
