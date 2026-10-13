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

  it("surfaces a cold scan failure", async () => {
    const cache = createPullRequestInventoryCache({ load: async () => { throw new Error("inventory unavailable"); } });
    await expect(cache.read()).rejects.toThrow("inventory unavailable");
  });
});
