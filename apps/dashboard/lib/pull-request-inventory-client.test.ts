import { afterEach, describe, expect, it, vi } from "vitest";
import type { PullRequestInventoryState } from "./pull-request-inventory-cache";
import { createInventoryRequestCoordinator } from "./pull-request-inventory-client";

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
