import { afterEach, describe, expect, it, vi } from "vitest";
import type { PullRequestInventoryState } from "./pull-request-inventory-cache";
import { createInventoryRequestCoordinator, readRememberedInventory, rememberInventory } from "./pull-request-inventory-client";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function response(checkedAt: string): Response {
  const inventory = { checkedAt } as PullRequestInventoryState;
  return { ok: true, json: async () => inventory } as Response;
}

afterEach(() => vi.useRealTimers());

describe("pull-request inventory request coordinator", () => {
  it("turns a never-settling cold request into a retryable deadline error", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined));
    const coordinator = createInventoryRequestCoordinator({ fetchImpl, timeoutMs: 50 });

    const pending = coordinator.request(true);
    await vi.advanceTimersByTimeAsync(50);

    await expect(pending).resolves.toEqual({
      status: "error",
      message: "The inventory request took longer than 1 seconds. Try again."
    });
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toMatchObject({ aborted: true });
  });

  it("aborts and suppresses a request when its consumer unmounts", async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined));
    const coordinator = createInventoryRequestCoordinator({ fetchImpl });

    const pending = coordinator.request(false);
    coordinator.cancel();

    await expect(pending).resolves.toEqual({ status: "superseded" });
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toMatchObject({ aborted: true });
  });

  it("lets an explicit refresh supersede and ignore an older response", async () => {
    const oldResponse = deferred<Response>();
    const refreshedResponse = deferred<Response>();
    const fetchImpl = vi.fn()
      .mockImplementationOnce(() => oldResponse.promise)
      .mockImplementationOnce(() => refreshedResponse.promise);
    const coordinator = createInventoryRequestCoordinator({ fetchImpl });

    const older = coordinator.request(false);
    const refreshed = coordinator.request(true);
    refreshedResponse.resolve(response("new"));

    await expect(refreshed).resolves.toMatchObject({ status: "success", inventory: { checkedAt: "new" } });
    await expect(older).resolves.toEqual({ status: "superseded" });
    oldResponse.resolve(response("old"));
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(["/api/pull-requests", "/api/pull-requests?refresh=1"]);
  });
});


describe("remembered pull-request inventory", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  const inventory: PullRequestInventoryState = {
    snapshot: {
      generatedAt: new Date(now - 1000).toISOString(), projectsScanned: 1,
      counts: { total: 1, blocked: 0, checksFailing: 0, checksPending: 0, drafts: 0, ready: 1, mergeReady: 0, unknown: 0 },
      pullRequests: [{
        projectId: "project", projectName: "Project", repositoryPath: "/repo", repository: "owner/repo",
        number: 1, title: "A PR", url: "https://github.com/owner/repo/pull/1", state: "OPEN", isDraft: false,
        mergeStateStatus: null, headBranch: "candidate", baseBranch: "main", author: null, reviewDecision: null,
        createdAt: null, updatedAt: new Date(now - 1000).toISOString(), checks: [], readiness: "ready",
        readinessLabel: "Ready", summary: "Ready for review", briefing: {
          changedFiles: [], unmentionedFiles: [], decisionFiles: [], materialFacts: [], basePullRequest: null
        }
      }], errors: []
    },
    checkedAt: new Date(now - 1000).toISOString(), retainedProjectIds: [],
    incomplete: false, stale: false, refreshing: false, refreshError: null
  };

  it("restores cards across a new page instance or reload as stale display evidence", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    rememberInventory(storage, inventory);
    expect(readRememberedInventory(storage, now)).toMatchObject({
      snapshot: inventory.snapshot, checkedAt: inventory.checkedAt, stale: true, refreshing: true
    });
    expect(readRememberedInventory(storage, now + 5000)?.snapshot).toEqual(inventory.snapshot);
  });

  it("does not revive the old rich inventory storage namespace", () => {
    const requestedKeys: string[] = [];
    const restored = readRememberedInventory({ getItem: key => {
      requestedKeys.push(key);
      return key === "arcadia.pr-inventory.v1" ? JSON.stringify(inventory) : null;
    } }, now);
    expect(restored).toBeNull();
    expect(requestedKeys).toEqual(["arcadia.pr-inventory.lightweight.v2"]);
  });

  it("ignores expired, malformed, future and unavailable browser storage", () => {
    const read = (value: unknown) => readRememberedInventory({ getItem: () => JSON.stringify(value) }, now);
    expect(read({ ...inventory, checkedAt: new Date(now - 25 * 60 * 60_000).toISOString() })).toBeNull();
    expect(read({ ...inventory, checkedAt: new Date(now + 1000).toISOString() })).toBeNull();
    expect(read({ checkedAt: inventory.checkedAt })).toBeNull();
    expect(readRememberedInventory({ getItem: () => "not json" }, now)).toBeNull();
    expect(readRememberedInventory({ getItem: () => { throw new Error("disabled"); } }, now)).toBeNull();
    expect(() => rememberInventory({ setItem: () => { throw new Error("full"); } }, inventory)).not.toThrow();
  });

  const card = inventory.snapshot.pullRequests[0];
  const withCard = (changes: Record<string, unknown>) => ({ pullRequests: [{ ...card, ...changes }] });
  it.each([
    ["null card", { pullRequests: [null] }],
    ["incomplete card", { pullRequests: [{}] }],
    ["null error", { errors: [null] }],
    ["non-text error", { errors: [{ projectId: "project", projectName: {}, message: "error", repositoryPath: null }] }],
    ["missing count", { counts: { total: 1 } }],
    ["non-numeric count", { counts: { ...inventory.snapshot.counts, total: "1" } }],
    ["negative count", { counts: { ...inventory.snapshot.counts, ready: -1 } }],
    ["non-numeric project count", { projectsScanned: null }],
    ["invalid generated date", { generatedAt: "not a date" }],
    ["invalid update date", withCard({ updatedAt: "not a date" })],
    ["non-text update date", withCard({ updatedAt: {} })],
    ["invalid creation date", withCard({ createdAt: "not a date" })],
    ["non-text review", withCard({ reviewDecision: {} })],
    ["non-text title", withCard({ title: {} })],
    ["null check", withCard({ checks: [null] })],
    ["non-text conclusion", withCard({ checks: [{ name: "CI", status: null, conclusion: {}, url: null }] })],
    ["incomplete briefing", withCard({ briefing: {} })],
    ["null briefing fact", withCard({ briefing: { ...card.briefing, materialFacts: [null] } })],
    ["non-text briefing path", withCard({ briefing: { ...card.briefing, changedFiles: [{}] } })],
    ["invalid base PR", withCard({ briefing: { ...card.briefing, basePullRequest: { number: null, title: "Base", headBranch: "base" } } })],
    ["null repository", { repositories: [null] }]
  ])("rejects %s before remembered cards can reach the renderer", (_name, changes) => {
    const value = { ...inventory, snapshot: { ...inventory.snapshot, ...changes } };
    expect(readRememberedInventory({ getItem: () => JSON.stringify(value) }, now)).toBeNull();
  });

});
