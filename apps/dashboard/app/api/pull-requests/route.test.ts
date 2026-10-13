import { beforeEach, describe, expect, it, vi } from "vitest";

const cli = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock("../../../lib/arcadia-cli", () => ({
  loadOutstandingPullRequests: cli.load,
  ArcadiaCliError: class extends Error {
    statusCode = 500;
    details = null;
  }
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
  beforeEach(() => cli.load.mockReset());

  it("returns the cached contract immediately while a requested revalidation runs", async () => {
    cli.load.mockResolvedValueOnce({ data: { snapshot } });
    const cold = await GET(new Request("http://arcadia.test/api/pull-requests"));
    expect(cold.status).toBe(200);
    expect(cli.load).toHaveBeenCalledTimes(1);
    await expect(cold.json()).resolves.toMatchObject({ snapshot: { counts: { total: 1 } }, refreshing: false });

    cli.load.mockReturnValueOnce(new Promise(() => undefined));
    const repeated = await GET(new Request("http://arcadia.test/api/pull-requests?refresh=1"));
    expect(repeated.status).toBe(200);
    expect(repeated.headers.get("cache-control")).toBe("no-store");
    await expect(repeated.json()).resolves.toMatchObject({ snapshot: { counts: { total: 1 } }, refreshing: true });
  });
});
