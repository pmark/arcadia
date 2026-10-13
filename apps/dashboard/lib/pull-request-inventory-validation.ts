import type { PullRequestInventoryState } from "./pull-request-inventory-cache";

// Storage is untrusted. Validate the Dashboard contract before any card reaches JSX.
export function isInventoryState(value: unknown): value is PullRequestInventoryState {
  if (!isRecord(value) || !isDate(value.checkedAt) || !isStrings(value.retainedProjectIds)
    || typeof value.incomplete !== "boolean" || typeof value.stale !== "boolean"
    || typeof value.refreshing !== "boolean" || !isNullableString(value.refreshError)) return false;
  const snapshot = value.snapshot;
  if (!isRecord(snapshot) || !isDate(snapshot.generatedAt) || !isCount(snapshot.projectsScanned)
    || !isRecord(snapshot.counts)) return false;
  const counts = snapshot.counts;
  if (!["total", "blocked", "checksFailing", "checksPending", "drafts", "ready", "mergeReady", "unknown"]
    .every(key => isCount(counts[key]))) return false;
  return Array.isArray(snapshot.pullRequests) && snapshot.pullRequests.every(isPullRequest)
    && Array.isArray(snapshot.errors) && snapshot.errors.every(error => isRecord(error)
      && [error.projectId, error.projectName, error.message].every(value => typeof value === "string")
      && isNullableString(error.repositoryPath))
    && (snapshot.repositories === undefined || (Array.isArray(snapshot.repositories)
      && snapshot.repositories.every(repository => isRecord(repository)
        && [repository.projectId, repository.projectName, repository.repository, repository.repositoryPath]
          .every(value => typeof value === "string"))));
}

function isPullRequest(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return [value.projectId, value.projectName, value.repositoryPath, value.repository, value.title, value.url,
    value.headBranch, value.baseBranch, value.readinessLabel, value.summary].every(value => typeof value === "string")
    && isCount(value.number) && value.number > 0 && value.state === "OPEN" && typeof value.isDraft === "boolean"
    && [value.author, value.reviewDecision, value.mergeStateStatus].every(isNullableString)
    && [value.createdAt, value.updatedAt].every(date => date === null || isDate(date))
    && typeof value.readiness === "string"
    && ["blocked", "checks_failing", "checks_pending", "draft", "ready", "merge_ready", "unknown"].includes(value.readiness)
    && Array.isArray(value.checks) && value.checks.every(check => isRecord(check)
      && typeof check.name === "string" && [check.status, check.conclusion, check.url].every(isNullableString))
    && (value.detailsLoaded === undefined || typeof value.detailsLoaded === "boolean")
    && isBriefing(value.briefing);
}

function isBriefing(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value) || ![value.changedFiles, value.unmentionedFiles, value.decisionFiles, value.materialFacts].every(isStrings)) return false;
  const base = value.basePullRequest;
  return base === null || (isRecord(base) && isCount(base.number) && base.number > 0
    && typeof base.title === "string" && typeof base.headBranch === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === "string");
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
