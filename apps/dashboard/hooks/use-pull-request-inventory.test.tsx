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
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); hooks.effects.length = 0; hooks.updates.length = 0; });

describe("inventory return visits", () => {
  it("shows remembered cards before a delayed server check and does not force another scan", async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const inventory = {
      snapshot: { counts: { total: 1 }, pullRequests: [], errors: [] }, checkedAt: new Date().toISOString(),
      retainedProjectIds: [], incomplete: false, stale: false, refreshing: false, refreshError: null
    } as unknown as PullRequestInventoryState;
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
});
