import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../../../lib/arcadia-cli", () => ({ ArcadiaCliError: class extends Error { statusCode = 404; } }));
vi.mock("../../../../lib/pull-request-summary", () => ({ loadPullRequestSummary: vi.fn(), generatePullRequestSummary: vi.fn() }));
import { generatePullRequestSummary, loadPullRequestSummary } from "../../../../lib/pull-request-summary";
import { GET, POST } from "./route";

const post = (body: unknown) => new Request("http://localhost/api/pull-requests/summary", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => vi.resetAllMocks());

describe("PR summary endpoint", () => {
  it("rejects malformed input before source or generation work", async () => {
    expect((await POST(post({ repository: "owner/repo/extra", number: 2 }))).status).toBe(400);
    expect(generatePullRequestSummary).not.toHaveBeenCalled();
  });

  it("loads cached state without generation", async () => {
    vi.mocked(loadPullRequestSummary).mockResolvedValue({ source: { title: "PR" }, sourceRevision: "rev", job: null, summary: null } as never);
    const response = await GET(new Request("http://localhost/api/pull-requests/summary?repository=owner/repo&number=2"));
    expect(response.status).toBe(200);
    expect(generatePullRequestSummary).not.toHaveBeenCalled();
  });

  it("starts generation only on POST", async () => {
    vi.mocked(generatePullRequestSummary).mockResolvedValue({ source: { title: "PR" }, sourceRevision: "rev", job: { id: "summary-job", status: "queued" }, summary: null } as never);
    const response = await POST(post({ repository: "owner/repo", number: 2 }));
    expect(await response.json()).toMatchObject({ job: { id: "summary-job", status: "queued" } });
  });
});
