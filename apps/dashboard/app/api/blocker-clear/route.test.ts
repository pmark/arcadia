import { beforeEach, describe, expect, it, vi } from "vitest";

const cli = vi.hoisted(() => ({ clearPinnedBlocker: vi.fn() }));

vi.mock("../../../lib/arcadia-cli", () => ({
  ArcadiaCliError: class ArcadiaCliError extends Error {
    statusCode: number;
    details: unknown;
    constructor(message: string, statusCode: number, details: unknown = null) {
      super(message);
      this.statusCode = statusCode;
      this.details = details;
    }
  },
  ...cli
}));
vi.mock("../../../lib/approvals-feed", () => ({ invalidateApprovalsCache: vi.fn() }));

import { POST } from "./route";
import { ArcadiaCliError } from "../../../lib/arcadia-cli";

function post(body: unknown, origin = "http://localhost:3000"): Request {
  return new Request("http://localhost:3000/api/blocker-clear", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, Host: "localhost:3000" },
    body: JSON.stringify(body)
  });
}

describe("POST /api/blocker-clear", () => {
  beforeEach(() => {
    cli.clearPinnedBlocker.mockReset();
  });

  it("runs the pinned reset for a one-click kind and returns the receipt", async () => {
    cli.clearPinnedBlocker.mockResolvedValue({ data: { actionKey: "alpha/a1", attemptsCleared: 2, lastError: null, reviewStepsCleared: 0, pinnedKind: "environment_wall", alreadyClear: false } });
    const response = await POST(post({ actionKey: "alpha/a1", kind: "environment_wall" }));
    expect(response.status).toBe(200);
    expect(cli.clearPinnedBlocker).toHaveBeenCalledWith({ actionKey: "alpha/a1", kind: "environment_wall" });
    expect(await response.json()).toMatchObject({ receipt: { pinnedKind: "environment_wall" } });
  });

  it("refuses a kind with no one-click clear and a cross-origin request, running nothing", async () => {
    expect((await POST(post({ actionKey: "alpha/a1", kind: "scope_successor_held" }))).status).toBe(400);
    expect((await POST(post({ actionKey: "alpha/a1", kind: "environment_wall" }, "https://evil.example"))).status).toBe(403);
    expect((await POST(post({ actionKey: "no-slash", kind: "environment_wall" }))).status).toBe(400);
    expect(cli.clearPinnedBlocker).not.toHaveBeenCalled();
  });

  it("passes the CLI refusal for a different blocker through as a conflict", async () => {
    cli.clearPinnedBlocker.mockImplementation(async () => {
      throw new ArcadiaCliError("alpha/a1 is held by a budget_exhausted blocker, not environment_wall; nothing was reset.", 409);
    });
    const response = await POST(post({ actionKey: "alpha/a1", kind: "environment_wall" }));
    expect(cli.clearPinnedBlocker).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(409);
  });
});
