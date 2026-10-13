import { describe, expect, it, vi } from "vitest";
import type { DashboardOutstandingPullRequest, DashboardOutstandingPullRequests } from "./types";
import { createPullRequestInventoryCache } from "./pull-request-inventory-cache";

function snapshot(total: number): DashboardOutstandingPullRequests {
  return {
    generatedAt: "2026-10-13T00:00:00.000Z",
    projectsScanned: 1,
    repositories: [],
    pullRequests: [],
    errors: [],
    counts: { total, blocked: 0, checksFailing: 0, checksPending: 0, drafts: 0, ready: 0, mergeReady: 0, unknown: 0 }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("pull-request inventory cache", () => {
  it("coalesces concurrent cold scans", async () => {
    const scan = deferred<DashboardOutstandingPullRequests>();
    const load = vi.fn(() => scan.promise);
    const cache = createPullRequestInventoryCache({ load, now: () => Date.parse("2026-10-13T00:00:00.000Z") });

    const first = cache.read();
    const second = cache.read();
    expect(load).toHaveBeenCalledTimes(1);

    scan.resolve(snapshot(2));
    await expect(first).resolves.toMatchObject({ snapshot: { counts: { total: 2 } }, refreshing: false });
    await expect(second).resolves.toMatchObject({ snapshot: { counts: { total: 2 } }, refreshing: false });
  });

  it("returns prior inventory immediately while a forced refresh runs", async () => {
    const refresh = deferred<DashboardOutstandingPullRequests>();
    const load = vi.fn()
      .mockResolvedValueOnce(snapshot(1))
      .mockImplementationOnce(() => refresh.promise);
    const cache = createPullRequestInventoryCache({ load });
    await cache.read();

    await expect(cache.read({ refresh: true })).resolves.toMatchObject({
      snapshot: { counts: { total: 1 } },
      refreshing: true
    });

    refresh.resolve(snapshot(3));
    await refresh.promise;
    await vi.waitFor(async () => {
      await expect(cache.read()).resolves.toMatchObject({ snapshot: { counts: { total: 3 } }, refreshing: false });
    });
  });

  it("preserves prior cards and bounds automatic retries after refresh failure", async () => {
    let now = Date.parse("2026-10-13T00:00:00.000Z");
    const load = vi.fn()
      .mockResolvedValueOnce(snapshot(4))
      .mockRejectedValueOnce(new Error("GitHub scan timed out"));
    const cache = createPullRequestInventoryCache({ load, now: () => now, freshForMs: 1, retryAfterMs: 30_000 });
    await cache.read();
    now += 2;

    await cache.read({ refresh: true });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => {
      expect((await cache.read()).refreshing).toBe(false);
    });
    await expect(cache.read()).resolves.toMatchObject({
      snapshot: { counts: { total: 4 } },
      stale: true,
      refreshing: false,
      refreshError: "GitHub scan timed out"
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("retains cards from projects whose refresh scan is incomplete", async () => {
    const previous = snapshot(1);
    previous.pullRequests = [{
      projectId: "project-a",
      repository: "owner/project-a",
      number: 42,
      readiness: "ready"
    } as DashboardOutstandingPullRequest];
    previous.counts.ready = 1;

    const partial = snapshot(0);
    partial.repositories = [{
      projectId: "project-a",
      projectName: "Project A",
      repository: "owner/project-a",
      repositoryPath: "/project-a"
    }];
    partial.errors = [{
      projectId: "project-a",
      projectName: "Project A",
      repositoryPath: "/project-a",
      message: "GitHub request timed out"
    }];

    const load = vi.fn().mockResolvedValueOnce(previous).mockResolvedValueOnce(partial);
    const cache = createPullRequestInventoryCache({ load });
    await cache.read();
    await cache.read({ refresh: true });
    await vi.waitFor(async () => expect((await cache.read()).refreshing).toBe(false));

    await expect(cache.read()).resolves.toMatchObject({
      snapshot: {
        pullRequests: [{ projectId: "project-a", number: 42 }],
        counts: { total: 1, ready: 1 },
        errors: [{ projectId: "project-a" }]
      },
      incomplete: true,
      stale: true,
      retainedProjectIds: ["project-a"]
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not retain cards for a repository removed from a reconfigured project", async () => {
    const previous = snapshot(1);
    previous.repositories = [{ projectId: "project-a", projectName: "Project A", repository: "owner/old", repositoryPath: "/old" }];
    previous.pullRequests = [{
      projectId: "project-a",
      projectName: "Project A",
      repository: "owner/old",
      repositoryPath: "/old",
      number: 42,
      readiness: "ready"
    } as DashboardOutstandingPullRequest];

    const reconfigured = snapshot(0);
    reconfigured.repositories = [{ projectId: "project-a", projectName: "Project A", repository: "owner/new", repositoryPath: "/new" }];
    reconfigured.errors = [{ projectId: "project-a", projectName: "Project A", repositoryPath: "/new", message: "scan failed" }];

    const load = vi.fn().mockResolvedValueOnce(previous).mockResolvedValueOnce(reconfigured);
    const cache = createPullRequestInventoryCache({ load });
    await cache.read();
    await cache.read({ refresh: true });
    await vi.waitFor(async () => expect((await cache.read()).refreshing).toBe(false));

    await expect(cache.read()).resolves.toMatchObject({
      snapshot: { pullRequests: [], counts: { total: 0 } },
      retainedProjectIds: []
    });
  });

  it("retains a failed repository across project identity changes and discards it after recovery", async () => {
    const previous = snapshot(1);
    previous.repositories = [{ projectId: "project-old", projectName: "Old Project", repository: "OWNER/repo.git", repositoryPath: "/old/repo" }];
    previous.pullRequests = [{
      projectId: "project-old",
      projectName: "Old Project",
      repository: "OWNER/repo.git",
      repositoryPath: "/old/repo",
      number: 42,
      readiness: "ready"
    } as DashboardOutstandingPullRequest];

    const failed = snapshot(0);
    failed.repositories = [{ projectId: "project-new", projectName: "New Project", repository: "owner/repo", repositoryPath: "/new/repo/" }];
    failed.errors = [{ projectId: "project-new", projectName: "New Project", repositoryPath: "/new/repo", message: "scan failed" }];
    const recovered = snapshot(0);
    recovered.repositories = failed.repositories;

    const load = vi.fn().mockResolvedValueOnce(previous).mockResolvedValueOnce(failed).mockResolvedValueOnce(recovered);
    const cache = createPullRequestInventoryCache({ load });
    await cache.read();
    await cache.read({ refresh: true });
    await vi.waitFor(async () => expect((await cache.read()).refreshing).toBe(false));

    await expect(cache.read()).resolves.toMatchObject({
      snapshot: {
        pullRequests: [{ projectId: "project-new", projectName: "New Project", repository: "owner/repo", repositoryPath: "/new/repo/", number: 42 }],
        counts: { total: 1, ready: 1 }
      },
      retainedProjectIds: ["project-new"]
    });

    await cache.read({ refresh: true });
    await vi.waitFor(async () => expect((await cache.read()).refreshing).toBe(false));
    await expect(cache.read()).resolves.toMatchObject({
      snapshot: { pullRequests: [], counts: { total: 0 } },
      incomplete: false,
      retainedProjectIds: []
    });
  });

  it("retains last-known cards by the current configured path when repository identification fails", async () => {
    const previous = snapshot(1);
    previous.repositories = [{ projectId: "project-old", projectName: "Old Project", repository: "owner/repo", repositoryPath: "/Repos/Arcadia" }];
    previous.pullRequests = [{
      projectId: "project-old",
      projectName: "Old Project",
      repository: "owner/repo",
      repositoryPath: "/Repos/Arcadia",
      number: 42,
      readiness: "ready"
    } as DashboardOutstandingPullRequest];

    const unidentified = snapshot(0);
    unidentified.repositories = [];
    unidentified.errors = [{
      projectId: "project-new",
      projectName: "New Project",
      repositoryPath: "/Repos/Arcadia/",
      message: "GitHub repository could not be identified."
    }];

    const load = vi.fn().mockResolvedValueOnce(previous).mockResolvedValueOnce(unidentified);
    const cache = createPullRequestInventoryCache({ load });
    await cache.read();
    await cache.read({ refresh: true });
    await vi.waitFor(async () => expect((await cache.read()).refreshing).toBe(false));

    await expect(cache.read()).resolves.toMatchObject({
      snapshot: {
        pullRequests: [{
          projectId: "project-new",
          projectName: "New Project",
          repository: "owner/repo",
          repositoryPath: "/Repos/Arcadia/",
          number: 42
        }],
        counts: { total: 1, ready: 1 }
      },
      incomplete: true,
      retainedProjectIds: ["project-new"]
    });
  });

  it("does not collapse case-distinct repository paths", async () => {
    const previous = snapshot(1);
    previous.pullRequests = [{
      projectId: "project-old",
      repository: "owner/repo",
      repositoryPath: "/Repos/Arcadia",
      number: 42,
      readiness: "ready"
    } as DashboardOutstandingPullRequest];

    const differentPath = snapshot(0);
    differentPath.errors = [{
      projectId: "project-new",
      projectName: "New Project",
      repositoryPath: "/repos/arcadia",
      message: "GitHub repository could not be identified."
    }];

    const load = vi.fn().mockResolvedValueOnce(previous).mockResolvedValueOnce(differentPath);
    const cache = createPullRequestInventoryCache({ load });
    await cache.read();
    await cache.read({ refresh: true });
    await vi.waitFor(async () => expect((await cache.read()).refreshing).toBe(false));
    await expect(cache.read()).resolves.toMatchObject({
      snapshot: { pullRequests: [], counts: { total: 0 } },
      retainedProjectIds: []
    });
  });

  it("surfaces a cold scan failure", async () => {
    const cache = createPullRequestInventoryCache({ load: async () => { throw new Error("inventory unavailable"); } });
    await expect(cache.read()).rejects.toThrow("inventory unavailable");
  });
});
