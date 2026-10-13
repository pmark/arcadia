import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ summary: vi.fn(), speech: vi.fn() }));
vi.mock("./pull-request-summary", () => ({ requirePullRequestSummary: mocks.summary }));
vi.mock("./read-aloud", () => ({ submitReadAloud: mocks.speech }));
import { preparePullRequestAudio, StalePullRequestSummaryError } from "./pull-request-audio";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.summary.mockResolvedValue({ source: { title: "Draft plan", body: "Do not narrate this body." }, summary: { text: "An inactive draft; approval remains required.", sourceRevision: "rev", jobId: "summary-job", generatedAt: "2026-10-12T00:00:00Z" } });
  mocks.speech.mockResolvedValue({ id: "audio-job", status: "queued" });
});

describe("PR TLDR audio preparation", () => {
  it("submits only the completed TLDR for speech", async () => {
    const result = await preparePullRequestAudio("owner/repo", 2, { sourceRevision: "rev", summaryJobId: "summary-job" });
    expect(result.job.id).toBe("audio-job");
    expect(result.summary.text).toBe("An inactive draft; approval remains required.");
    expect(mocks.speech).toHaveBeenCalledWith("An inactive draft; approval remains required.");
    expect(mocks.speech.mock.calls[0][0]).not.toContain("Do not narrate this body.");
  });

  it("does not submit speech when no completed TLDR exists", async () => {
    mocks.summary.mockRejectedValue(new Error("Generate the TLDR successfully before preparing its audio."));
    await expect(preparePullRequestAudio("owner/repo", 2, { sourceRevision: "rev", summaryJobId: "summary-job" })).rejects.toThrow("Generate the TLDR");
    expect(mocks.speech).not.toHaveBeenCalled();
  });

  it("refuses stale displayed TLDR A when current source resolves TLDR B", async () => {
    mocks.summary.mockResolvedValue({ source: { title: "Changed" }, summary: { text: "Current B", sourceRevision: "revision-b", jobId: "summary-b" } });
    await expect(preparePullRequestAudio("owner/repo", 2, { sourceRevision: "revision-a", summaryJobId: "summary-a" })).rejects.toBeInstanceOf(StalePullRequestSummaryError);
    expect(mocks.speech).not.toHaveBeenCalled();
  });

  it("submits speech when the displayed revision and summary job pin both match", async () => {
    await preparePullRequestAudio("owner/repo", 2, { sourceRevision: "rev", summaryJobId: "summary-job" });
    expect(mocks.speech).toHaveBeenCalledWith("An inactive draft; approval remains required.");
  });
});
