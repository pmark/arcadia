import type { DashboardOutstandingPullRequest } from "./types";

type DatedPullRequest = Pick<DashboardOutstandingPullRequest, "createdAt" | "updatedAt" | "repository" | "number">;

/** Display order only: keep the shared inventory and CLI readiness order intact. */
export function sortPullRequestsNewestFirst<T extends DatedPullRequest>(pullRequests: readonly T[]): T[] {
  return [...pullRequests].sort((a, b) => {
    const aTime = dateTime(a.createdAt) ?? dateTime(a.updatedAt) ?? -Infinity;
    const bTime = dateTime(b.createdAt) ?? dateTime(b.updatedAt) ?? -Infinity;
    if (aTime !== bTime) return bTime - aTime;
    if (a.repository !== b.repository) return a.repository < b.repository ? -1 : 1;
    return a.number - b.number;
  });
}

function dateTime(value: string | null): number | null {
  const time = value === null ? NaN : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}
