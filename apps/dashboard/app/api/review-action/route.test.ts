import { beforeEach, describe, expect, it, vi } from "vitest";

const cli = vi.hoisted(() => ({
  runReviewAction: vi.fn(),
  reviewApproveWithExecute: vi.fn()
}));

vi.mock("../../../lib/arcadia-cli", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/arcadia-cli")>("../../../lib/arcadia-cli");
  return { ...actual, ...cli };
});

import { POST } from "./route";

function request(body: unknown, site: "same-origin" | "cross-site" = "same-origin"): Request {
  return new Request("http://arcadia.test/api/review-action", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": site },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  cli.runReviewAction.mockResolvedValue({ data: { result: { status: "approved", summary: "Build packet approved." } } });
});

describe("POST /api/review-action", () => {
  it("refuses a cross-origin request before running anything", async () => {
    const response = await POST(request({ id: "rv1", action: "approve", noExecute: true }, "cross-site"));
    expect(response.status).toBe(403);
    expect(cli.runReviewAction).not.toHaveBeenCalled();
    expect(cli.reviewApproveWithExecute).not.toHaveBeenCalled();
  });

  it("approves with noExecute, never through the executing path", async () => {
    const response = await POST(request({ id: "rv1", action: "approve", noExecute: true }));
    expect(response.status).toBe(200);
    expect(cli.runReviewAction).toHaveBeenCalledWith(expect.objectContaining({ id: "rv1", action: "approve", noExecute: true }));
    expect(cli.reviewApproveWithExecute).not.toHaveBeenCalled();
  });

  it("refuses noExecute combined with execute", async () => {
    const response = await POST(request({ id: "rv1", action: "approve", noExecute: true, execute: true }));
    expect(response.status).toBe(400);
    expect(cli.reviewApproveWithExecute).not.toHaveBeenCalled();
  });

  it("does not pass noExecute for a reject", async () => {
    await POST(request({ id: "rv1", action: "reject", noExecute: true }));
    expect(cli.runReviewAction).toHaveBeenCalledWith(expect.objectContaining({ action: "reject", noExecute: false }));
  });
});
