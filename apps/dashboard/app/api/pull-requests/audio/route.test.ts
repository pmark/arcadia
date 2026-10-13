import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../../../lib/arcadia-cli", () => ({ loadPullRequestDescription: vi.fn(), ArcadiaCliError: class extends Error { statusCode = 404; } }));
vi.mock("../../../../lib/pull-request-audio", () => ({
  preparePullRequestAudio: vi.fn(),
  StalePullRequestSummaryError: class extends Error {
    constructor() { super("The displayed TLDR is stale. Use Refresh TLDR before playing audio."); }
  },
}));
import { loadPullRequestDescription, ArcadiaCliError } from "../../../../lib/arcadia-cli";
import { preparePullRequestAudio, StalePullRequestSummaryError } from "../../../../lib/pull-request-audio";
import { GET, POST } from "./route";
const request = (body: unknown) => new Request("http://localhost/api/pull-requests/audio", { method: "POST", body: JSON.stringify(body) });
const validRequest = { repository: "owner/repo", number: 2, sourceRevision: "a".repeat(64), summaryJobId: "summary-job" };
beforeEach(() => vi.resetAllMocks());
describe("PR audio endpoint", () => {
  it("rejects malformed input before reading or generating", async () => {
    for (const body of [null, {}, { repository: "owner/repo/extra", number: 2 }, { repository: "owner/repo", number: "2" }]) expect((await POST(request(body))).status).toBe(400);
    expect(preparePullRequestAudio).not.toHaveBeenCalled();
  });
  it("keeps the repository boundary refusal visible", async () => {
    vi.mocked(preparePullRequestAudio).mockRejectedValue(new ArcadiaCliError("Repository is not configured", 404));
    expect((await POST(request({ ...validRequest, repository: "outside/repo" }))).status).toBe(404);
  });
  it("returns a durable job reference rather than waiting for audio bytes", async () => {
    vi.mocked(preparePullRequestAudio).mockResolvedValue({ source: { title: "PR", body: "Description", url: "https://github.com/owner/repo/pull/2" }, summary: { text: "TLDR", sourceRevision: "rev", jobId: "summary-job" }, job: { id: "audio-job", status: "queued" } } as never);
    const response = await POST(request(validRequest));
    expect(await response.json()).toMatchObject({ job: { id: "audio-job", status: "queued" }, summary: { text: "TLDR" } });
    expect(preparePullRequestAudio).toHaveBeenCalledWith("owner/repo", 2, { sourceRevision: "a".repeat(64), summaryJobId: "summary-job" });
  });
  it("does not expose provider error bodies from a terminal audio job", async () => {
    vi.mocked(preparePullRequestAudio).mockResolvedValue({ source: { title: "PR" }, summary: { text: "TLDR" }, job: { id: "audio-job", status: "failed", error: { code: "SPEECH_UNAVAILABLE", message: "SECRET provider body" } } } as never);
    const text = await (await POST(request(validRequest))).text();
    expect(text).toContain("SPEECH_UNAVAILABLE");
    expect(text).not.toContain("SECRET provider body");
  });
  it("returns useful reload feedback when current source B has no summary for displayed A", async () => {
    vi.mocked(preparePullRequestAudio).mockRejectedValue(new StalePullRequestSummaryError());
    const response = await POST(request(validRequest));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "The displayed TLDR is stale. Use Refresh TLDR before playing audio." });
  });
  it("loads the original description without model calls", async () => {
    vi.mocked(loadPullRequestDescription).mockResolvedValue({ title: "PR", body: "Description", url: "https://github.com/owner/repo/pull/2", repository: "owner/repo", number: 2, state: "MERGED" });
    const response = await GET(new Request("http://localhost/api/pull-requests/audio?repository=owner/repo&number=2"));
    expect(await response.json()).toMatchObject({ source: { body: "Description", state: "MERGED" } });
    expect(preparePullRequestAudio).not.toHaveBeenCalled();
  });
});
