import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../../../lib/arcadia-cli", () => ({ loadOutstandingPullRequests: vi.fn() }));
vi.mock("../../../../lib/pull-request-audio", () => ({ generatePullRequestAudio: vi.fn(), AudioBusyError: class extends Error {} }));
import { loadOutstandingPullRequests } from "../../../../lib/arcadia-cli";
import { generatePullRequestAudio } from "../../../../lib/pull-request-audio";
import { POST } from "./route";
const request = (body: unknown) => new Request("http://localhost/api/pull-requests/audio", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => vi.resetAllMocks());
describe("PR audio endpoint", () => {
  it("rejects malformed input before reading GitHub or synthesizing", async () => {
    for (const body of [null, {}, { repository: "owner/repo/extra", number: 2 }, { repository: "owner/repo", number: "2" }]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(loadOutstandingPullRequests).not.toHaveBeenCalled();
    expect(generatePullRequestAudio).not.toHaveBeenCalled();
  });
  it("refuses repositories outside the configured open inventory", async () => {
    vi.mocked(loadOutstandingPullRequests).mockResolvedValue({ data: { snapshot: { pullRequests: [] } } } as never);
    expect((await POST(request({ repository: "owner/repo", number: 2 }))).status).toBe(404);
    expect(generatePullRequestAudio).not.toHaveBeenCalled();
  });
  it("returns playable downloadable audio for a merged PR in an allowed repository", async () => {
    vi.mocked(loadOutstandingPullRequests).mockResolvedValue({ data: { snapshot: { pullRequests: [{ repository: "owner/repo", number: 99 }] } } } as never);
    vi.mocked(generatePullRequestAudio).mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), format: "mp3" });
    const response = await POST(request({ repository: "owner/repo", number: 2 }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("content-disposition")).toContain("pr-2-body.mp3");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  });
});
