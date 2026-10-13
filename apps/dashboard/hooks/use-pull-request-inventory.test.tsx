import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ effects: [] as Array<() => unknown>, updates: [] as unknown[] }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, (value: unknown) => { hooks.updates.push(value); }]
}));
import { rememberInventory } from "../lib/pull-request-inventory-client";
import type { PullRequestInventoryState } from "../lib/pull-request-inventory-cache";
import { usePullRequestInventory } from "./use-pull-request-inventory";

function Consumer() { usePullRequestInventory(); return null; }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); hooks.effects.length = 0; hooks.updates.length = 0; });

describe("inventory return visits", () => {
  it("shows remembered cards before a delayed server check and does not force another scan", async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const inventory: PullRequestInventoryState = {
      snapshot: { generatedAt: new Date().toISOString(), projectsScanned: 1, counts: { total: 0, blocked: 0, checksFailing: 0, checksPending: 0, drafts: 0, ready: 0, mergeReady: 0, unknown: 0 }, pullRequests: [], errors: [] }, checkedAt: new Date().toISOString(),
      retainedProjectIds: [], incomplete: false, stale: false, refreshing: false, refreshError: null
    };
    rememberInventory(storage, inventory);
    vi.stubGlobal("window", { sessionStorage: storage });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));

    // Each fresh consumer represents navigation back or a full reload with the same session storage.
    for (let visit = 0; visit < 2; visit++) {
      hooks.effects.length = 0; hooks.updates.length = 0;
      renderToStaticMarkup(<Consumer />);
      const cleanup = hooks.effects[0]();
      expect(hooks.updates[0]).toMatchObject({ data: inventory.snapshot, loading: false, stale: true, refreshing: true });
      expect(fetchSpy.mock.calls.at(-1)?.[0]).toBe("/api/pull-requests");
      expect(typeof cleanup).toBe("function");
      (cleanup as () => void)();
      await Promise.resolve();
    }
  });
  it("refreshes visible cards once on focus or a minute tick, coalesces work, and retains cards on errors", async () => {
    vi.useFakeTimers();
    const windowTarget = Object.assign(new EventTarget(), { sessionStorage: { getItem: () => null, setItem: () => undefined }, setInterval, clearInterval });
    const documentTarget = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("window", windowTarget); vi.stubGlobal("document", documentTarget);
    const inventory = {
      snapshot: { generatedAt: new Date().toISOString(), projectsScanned: 1, counts: { total: 0, blocked: 0, checksFailing: 0, checksPending: 0, drafts: 0, ready: 0, mergeReady: 0, unknown: 0 }, pullRequests: [], errors: [] },
      checkedAt: new Date().toISOString(), retainedProjectIds: [], incomplete: false, stale: false, refreshing: false, refreshError: null
    };
    let resolve!: (value: Response) => void;
    let reject!: (error: Error) => void;
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }))
      .mockImplementationOnce(() => new Promise<Response>((_done, fail) => { reject = fail; }));
    renderToStaticMarkup(<Consumer />);
    const cleanupMount = hooks.effects[0]() as () => void;
    const cleanupRefresh = hooks.effects[1]() as () => void;
    windowTarget.dispatchEvent(new Event("focus"));
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    resolve({ ok: true, json: async () => inventory } as Response);
    await vi.advanceTimersByTimeAsync(0);
    documentTarget.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(60_000);
    windowTarget.dispatchEvent(new Event("focus"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    windowTarget.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    reject(new Error("GitHub unavailable"));
    await vi.advanceTimersByTimeAsync(0);
    const retained = hooks.updates.filter(value => typeof value === "function")
      .map(update => (update as (state: unknown) => { error?: string; data?: unknown; stale?: boolean })({ data: inventory.snapshot }))
      .find(state => state.error === "GitHub unavailable");
    expect(retained).toMatchObject({ data: inventory.snapshot, stale: true });
    cleanupRefresh(); cleanupMount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

});
