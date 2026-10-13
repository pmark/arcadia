import { beforeEach, describe, expect, it, vi } from "vitest";

const cli = vi.hoisted(() => ({ load: vi.fn(), scope: vi.fn(), read: vi.fn(), write: vi.fn() }));

vi.mock("../../../lib/arcadia-cli", () => ({
  loadOutstandingPullRequests: cli.load,
  findRepoRoot: () => "/checkout",
  ArcadiaCliError: class extends Error {
    statusCode = 500;
    details = null;
  }
}));

vi.mock("../../../lib/pull-request-inventory-persistence", () => ({
  inventoryPersistenceScope: cli.scope,
  createInventoryPersistence: (scope: { identity: string }) => ({ read: cli.read, write: (value: unknown) => cli.write(scope.identity, value) })
}));

import { GET } from "./route";

const snapshot = {
  generatedAt: "2026-10-13T00:00:00.000Z",
  projectsScanned: 1,
  repositories: [],
  pullRequests: [],
  errors: [],
  counts: { total: 1, blocked: 0, checksFailing: 0, checksPending: 0, drafts: 0, ready: 1, mergeReady: 0, unknown: 0 }
};

describe("GET /api/pull-requests", () => {
  beforeEach(() => { cli.load.mockReset(); cli.write.mockReset(); cli.read.mockResolvedValue(null); cli.scope.mockResolvedValue({ identity: "test", directory: "/cache", workspacePath: "/workspace" }); (globalThis as typeof globalThis & { arcadiaPrInventoryCaches?: Map<string, unknown> }).arcadiaPrInventoryCaches?.clear(); });

  it("returns the cached contract immediately while a requested revalidation runs", async () => {
    cli.load.mockResolvedValueOnce({ data: { snapshot } });
    const cold = await GET(new Request("http://arcadia.test/api/pull-requests"));
    expect(cold.status).toBe(200);
    expect(cli.load).toHaveBeenCalledTimes(1);
    expect(cli.load).toHaveBeenCalledWith({ workspace: "/workspace", scopeIdentity: "test" });
    await expect(cold.json()).resolves.toMatchObject({ snapshot: { counts: { total: 1 } }, refreshing: false });

    cli.load.mockReturnValueOnce(new Promise(() => undefined));
    const repeated = await GET(new Request("http://arcadia.test/api/pull-requests?refresh=1"));
    expect(repeated.status).toBe(200);
    expect(repeated.headers.get("cache-control")).toBe("no-store");
    await expect(repeated.json()).resolves.toMatchObject({ snapshot: { counts: { total: 1 } }, refreshing: true });
  });
  it("returns a saved snapshot before a remote scan completes, including warm reads", async () => {
    vi.useFakeTimers();
    try {
      cli.read.mockResolvedValue({ snapshot, checkedAt: snapshot.generatedAt, incomplete: false, retainedProjectIds: [], stale: true, refreshing: false, refreshError: null });
      cli.load.mockReturnValue(new Promise(() => undefined));
      const response = await GET(new Request("http://arcadia.test/api/pull-requests?warm=1"));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ stale: true, refreshing: true, snapshot: { counts: { total: 1 } } });
      expect(cli.load).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(65001);
    } finally { vi.useRealTimers(); }
  });
  it("warms the route without waiting for a missing cache's remote scan", async () => {
    vi.useFakeTimers();
    try {
      cli.load.mockReturnValue(new Promise(() => undefined));
      const response = await GET(new Request("http://arcadia.test/api/pull-requests?warm=1"));
      expect(response.status).toBe(202); expect(cli.load).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(65001);
    } finally { vi.useRealTimers(); }
  });
  it("refuses unverifiable scope without exposing another workspace's cached data", async () => {
    cli.scope.mockRejectedValue(new Error("Workspace identity unavailable"));
    const response = await GET(new Request("http://arcadia.test/api/pull-requests"));
    expect(response.status).toBe(503); expect(cli.load).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ error: "Workspace identity unavailable" });
  });

  it("returns and persists the new identity's snapshot independently of a pending old scan", async () => {
    let resolveOld!: (value: { data: { snapshot: typeof snapshot } }) => void;
    const oldScan = new Promise<{ data: { snapshot: typeof snapshot } }>(resolve => { resolveOld = resolve; });
    const currentSnapshot = { ...snapshot, counts: { ...snapshot.counts, total: 2 } };
    cli.scope.mockResolvedValueOnce({ identity: "A", directory: "/cache", workspacePath: "/workspace" });
    cli.load.mockImplementation((options: { scopeIdentity?: string }) => options.scopeIdentity === "B" ? Promise.resolve({ data: { snapshot: currentSnapshot } }) : oldScan);
    const old = GET(new Request("http://arcadia.test/api/pull-requests"));
    await vi.waitFor(() => expect(cli.load).toHaveBeenCalledTimes(1));
    cli.scope.mockResolvedValue({ identity: "B", directory: "/cache", workspacePath: "/workspace" });
    const current = GET(new Request("http://arcadia.test/api/pull-requests"));
    await vi.waitFor(() => expect(cli.write).toHaveBeenCalledWith("B", expect.objectContaining({ snapshot: currentSnapshot })));
    expect(await (await current).json()).toMatchObject({ snapshot: { counts: { total: 2 } }, stale: false });
    expect(cli.write).not.toHaveBeenCalledWith("B", expect.objectContaining({ snapshot }));
    resolveOld({ data: { snapshot } });
    expect(await (await old).json()).toMatchObject({ snapshot: { counts: { total: 1 } } });
    expect(cli.write).toHaveBeenCalledWith("A", expect.objectContaining({ snapshot }));
  });

});
