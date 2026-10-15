import { beforeEach, describe, expect, it, vi } from "vitest";
const getJob = vi.hoisted(() => vi.fn());
vi.mock("../../../../../lib/intelligence", () => ({ getIntelligenceClient: () => ({ getJob }) }));
import { GET } from "./route";

beforeEach(() => vi.resetAllMocks());

describe("admin Intelligence job endpoint", () => {
  it("keeps arbitrary provider text out of the phone response", async () => {
    getJob.mockResolvedValue({
      id: "ijob_1", status: "failed", retryCount: 1,
      request: { executionPolicy: { maxRetries: 1 } },
      error: { code: "LITELLM_UNAVAILABLE", message: "provider body SECRET_TOKEN=abc123" },
    });
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "ijob_1" }) });
    const text = await response.text();
    expect(text).toContain("LITELLM_UNAVAILABLE");
    expect(text).toContain("ijob_1");
    expect(text).not.toContain("SECRET_TOKEN");
    expect(text).not.toContain("provider body");
  });
});
