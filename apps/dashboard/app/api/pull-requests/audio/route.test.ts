import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../../../lib/arcadia-cli", () => ({ loadPullRequestDescription: vi.fn(), ArcadiaCliError: class extends Error { statusCode = 404; } }));
vi.mock("../../../../lib/pull-request-audio", () => ({ preparePullRequestAudio: vi.fn() }));
import { loadPullRequestDescription, ArcadiaCliError } from "../../../../lib/arcadia-cli";
import { preparePullRequestAudio } from "../../../../lib/pull-request-audio";
import { GET, POST } from "./route";
const request = (body: unknown) => new Request("http://localhost/api/pull-requests/audio", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => vi.resetAllMocks());
describe("PR audio endpoint", () => {
  it("rejects malformed input before reading or generating", async () => {
    for (const body of [null, {}, { repository: "owner/repo/extra", number: 2 }, { repository: "owner/repo", number: "2" }]) expect((await POST(request(body))).status).toBe(400);
    expect(preparePullRequestAudio).not.toHaveBeenCalled();
  });
  it("keeps the repository boundary refusal visible", async () => {
    vi.mocked(preparePullRequestAudio).mockRejectedValue(new ArcadiaCliError("Repository is not configured", 404));
    expect((await POST(request({ repository: "outside/repo", number: 2 }))).status).toBe(404);
  });
  it("returns a durable job reference rather than waiting for audio bytes", async () => {
    vi.mocked(preparePullRequestAudio).mockResolvedValue({ source: { title: "PR", body: "Description", url: "https://github.com/owner/repo/pull/2", summary: "TLDR" }, job: { id: "audio-job", status: "queued" } } as never);
    const response = await POST(request({ repository: "owner/repo", number: 2 }));
    expect(await response.json()).toMatchObject({ job: { id: "audio-job", status: "queued" }, source: { summary: "TLDR" } });
  });
  it("loads the original description without model calls", async () => {
    vi.mocked(loadPullRequestDescription).mockResolvedValue({ title: "PR", body: "Description", url: "https://github.com/owner/repo/pull/2", repository: "owner/repo", number: 2, state: "MERGED" });
    const response = await GET(new Request("http://localhost/api/pull-requests/audio?repository=owner/repo&number=2"));
    expect(await response.json()).toMatchObject({ source: { body: "Description", state: "MERGED" } });
    expect(preparePullRequestAudio).not.toHaveBeenCalled();
  });
});
