import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prs: vi.fn(),
  queue: vi.fn(),
  cards: vi.fn()
}));

vi.mock("../pull-requests/route", () => ({ GET: mocks.prs }));
vi.mock("../../../lib/arcadia-cli", () => ({ loadWorkQueue: mocks.queue }));
vi.mock("../../../lib/decision-cards-server", () => ({ loadCurrentCards: mocks.cards }));
vi.mock("../../../lib/next-steps-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/next-steps-server")>()),
  ghRunner: () => async () => "[]"
}));

import * as route from "./route";

describe("/api/next-steps", () => {
  it("exports GET only and reads without writing", async () => {
    expect(Object.keys(route).filter((key) => /^(POST|PUT|PATCH|DELETE)$/.test(key))).toEqual([]);
    mocks.prs.mockResolvedValue(new Response(JSON.stringify({ snapshot: { pullRequests: [] }, stale: false })));
    mocks.queue.mockResolvedValue({ data: { ordered: [], nextActionKey: null } });
    mocks.cards.mockResolvedValue({ cards: [], targets: new Map() });
    const response = await route.GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ state: "moving", steps: [], unavailable: [] });
  });
});
