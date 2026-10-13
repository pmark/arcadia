import type { DashboardOutstandingPullRequests } from "./types";

export interface PullRequestInventoryState {
  snapshot: DashboardOutstandingPullRequests;
  checkedAt: string;
  stale: boolean;
  refreshing: boolean;
  refreshError: string | null;
  incomplete: boolean;
  retainedProjectIds: string[];
}

interface CachedInventory {
  snapshot: DashboardOutstandingPullRequests;
  checkedAt: string;
  incomplete: boolean;
  retainedProjectIds: string[];
}

interface PullRequestInventoryCacheOptions {
  load: () => Promise<DashboardOutstandingPullRequests>;
  now?: () => number;
  freshForMs?: number;
  retryAfterMs?: number;
}

const DEFAULT_FRESH_FOR_MS = 30_000;
const DEFAULT_RETRY_AFTER_MS = 30_000;

export function createPullRequestInventoryCache({
  load,
  now = Date.now,
  freshForMs = DEFAULT_FRESH_FOR_MS,
  retryAfterMs = DEFAULT_RETRY_AFTER_MS
}: PullRequestInventoryCacheOptions) {
  let cached: CachedInventory | null = null;
  let refreshPromise: Promise<void> | null = null;
  let refreshError: string | null = null;
  let lastRefreshStartedAt = 0;

  function startRefresh(): Promise<void> {
    if (refreshPromise) return refreshPromise;

    lastRefreshStartedAt = now();
    refreshPromise = load()
      .then((snapshot) => {
        const merged = mergePartialSnapshot(cached?.snapshot ?? null, snapshot);
        cached = {
          snapshot: merged.snapshot,
          checkedAt: new Date(now()).toISOString(),
          incomplete: snapshot.errors.length > 0,
          retainedProjectIds: merged.retainedProjectIds
        };
        refreshError = null;
      })
      .catch((error: unknown) => {
        refreshError = error instanceof Error ? error.message : String(error);
        if (!cached) throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });

    // A stale-cache request deliberately does not await the refresh. Mark the
    // rejection handled here while still returning it to cold callers.
    void refreshPromise.catch(() => undefined);
    return refreshPromise;
  }

  function state(): PullRequestInventoryState | null {
    if (!cached) return null;
    const ageMs = Math.max(0, now() - Date.parse(cached.checkedAt));
    return {
      ...cached,
      stale: ageMs >= freshForMs || cached.incomplete || refreshError !== null,
      refreshing: refreshPromise !== null,
      refreshError
    };
  }

  async function read({ refresh = false }: { refresh?: boolean } = {}): Promise<PullRequestInventoryState> {
    const current = state();
    if (!current) {
      await startRefresh();
      const loaded = state();
      if (!loaded) throw new Error(refreshError ?? "Pull-request inventory is unavailable.");
      return loaded;
    }

    const ageMs = Math.max(0, now() - Date.parse(current.checkedAt));
    const retryReady = refreshError === null || now() - lastRefreshStartedAt >= retryAfterMs;
    if (refresh || (ageMs >= freshForMs && retryReady)) void startRefresh();
    return state() ?? current;
  }

  return { read };
}

function mergePartialSnapshot(
  previous: DashboardOutstandingPullRequests | null,
  next: DashboardOutstandingPullRequests
): { snapshot: DashboardOutstandingPullRequests; retainedProjectIds: string[] } {
  if (!previous || next.errors.length === 0) return { snapshot: next, retainedProjectIds: [] };

  const repositories = next.repositories ?? [];
  const repositoriesByProjectId = new Map(repositories.map((repository) => [repository.projectId, repository]));
  const repositoriesByPath = new Map(repositories.map((repository) => [normalizePath(repository.repositoryPath), repository]));
  const repositoriesByName = new Map(repositories.map((repository) => [normalizeRepository(repository.repository), repository]));
  const errorsByPath = new Map(next.errors.flatMap((error) =>
    error.repositoryPath ? [[normalizePath(error.repositoryPath), error] as const] : []
  ));
  const failedRepositories = new Set<string>();
  for (const error of next.errors) {
    const repository = repositoriesByProjectId.get(error.projectId)
      ?? (error.repositoryPath ? repositoriesByPath.get(normalizePath(error.repositoryPath)) : undefined);
    if (repository) failedRepositories.add(normalizeRepository(repository.repository));
  }

  const currentKeys = new Set(next.pullRequests.map(pullRequestKey));
  const retained = previous.pullRequests.flatMap((pullRequest) => {
    const repositoryKey = normalizeRepository(pullRequest.repository);
    const currentRepository = repositoriesByName.get(repositoryKey);
    if (currentRepository && failedRepositories.has(repositoryKey) && !currentKeys.has(pullRequestKey(pullRequest))) {
      return [{
        ...pullRequest,
        projectId: currentRepository.projectId,
        projectName: currentRepository.projectName,
        repository: currentRepository.repository,
        repositoryPath: currentRepository.repositoryPath
      }];
    }

    // `gh repo view` can fail before the scanner knows the current repository
    // name. In that case the configured real path in the error is the only
    // current identity available. Preserve last-known cards only for that exact
    // path, and remap their Project metadata to the current error.
    const pathKey = normalizePath(pullRequest.repositoryPath);
    const currentError = errorsByPath.get(pathKey);
    if (!currentError || repositoriesByPath.has(pathKey) || currentKeys.has(pullRequestKey(pullRequest))) return [];
    return [{
      ...pullRequest,
      projectId: currentError.projectId,
      projectName: currentError.projectName,
      repositoryPath: currentError.repositoryPath ?? pullRequest.repositoryPath
    }];
  });
  if (retained.length === 0) return { snapshot: next, retainedProjectIds: [] };

  const pullRequests = [...next.pullRequests, ...retained];
  return {
    snapshot: { ...next, pullRequests, counts: countReadiness(pullRequests) },
    retainedProjectIds: [...new Set(retained.map((pullRequest) => pullRequest.projectId))]
  };
}

function normalizeRepository(repository: string): string {
  return repository.trim().replace(/\.git$/i, "").toLowerCase();
}

function normalizePath(repositoryPath: string): string {
  const normalized = repositoryPath.trim().replace(/\\/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

function pullRequestKey(pullRequest: DashboardOutstandingPullRequests["pullRequests"][number]): string {
  return `${normalizeRepository(pullRequest.repository)}:${pullRequest.number}`;
}

function countReadiness(pullRequests: DashboardOutstandingPullRequests["pullRequests"]): DashboardOutstandingPullRequests["counts"] {
  return {
    total: pullRequests.length,
    blocked: pullRequests.filter((pullRequest) => pullRequest.readiness === "blocked").length,
    checksFailing: pullRequests.filter((pullRequest) => pullRequest.readiness === "checks_failing").length,
    checksPending: pullRequests.filter((pullRequest) => pullRequest.readiness === "checks_pending").length,
    drafts: pullRequests.filter((pullRequest) => pullRequest.readiness === "draft").length,
    ready: pullRequests.filter((pullRequest) => pullRequest.readiness === "ready").length,
    mergeReady: pullRequests.filter((pullRequest) => pullRequest.readiness === "merge_ready").length,
    unknown: pullRequests.filter((pullRequest) => pullRequest.readiness === "unknown").length
  };
}
