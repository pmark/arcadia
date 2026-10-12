import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ description: vi.fn(), submit: vi.fn(), wait: vi.fn(), speech: vi.fn() }));
vi.mock("./arcadia-cli", () => ({ loadPullRequestDescription: mocks.description }));
vi.mock("./intelligence", () => ({ getIntelligenceClient: () => ({ submit: mocks.submit, waitForCompletion: mocks.wait }) }));
vi.mock("./read-aloud", () => ({ submitReadAloud: mocks.speech }));
import { buildPrSummaryRequest, preparePullRequestAudio } from "./pull-request-audio";
const source = { title: "Draft plan", url: "https://github.com/owner/repo/pull/2", body: "# What\nA **draft** Plan.\n\n## Authority\nNothing is activated." };
beforeEach(() => { vi.resetAllMocks(); mocks.description.mockResolvedValue({ ...source }); mocks.submit.mockResolvedValue({ job: { id: "summary-job" } }); mocks.speech.mockResolvedValue({ id: "audio-job", status: "queued" }); });
describe("PR read-aloud preparation", () => {
  it("uses a bounded local summary and submits summary before the original body", async () => {
    mocks.wait.mockResolvedValue({ status: "completed", result: { summary: "An inactive draft; approval remains required." } });
    const result = await preparePullRequestAudio("owner/repo", 2);
    expect(result.job.id).toBe("audio-job");
    expect(result.source.summary).toBe("An inactive draft; approval remains required.");
    expect(mocks.speech).toHaveBeenCalledWith("Summary. An inactive draft; approval remains required.\n\nFull pull request description.\n\nWhat\nA draft Plan.\nAuthority\nNothing is activated.");
    expect(mocks.submit.mock.calls[0][0]).toMatchObject({ capability: "text.generate", execution: "local-required", executionPolicy: { allowPaidUsage: false } });
  });
  it("keeps body audio usable and labels TLDR failure without cloud escalation", async () => {
    mocks.wait.mockResolvedValue({ status: "blocked", error: { message: "No local route" } });
    const result = await preparePullRequestAudio("owner/repo", 2);
    expect(result.source.summary).toBeUndefined();
    expect(result.source.summaryError).toContain("body only");
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.speech.mock.calls[0][0]).toContain("Nothing is activated.");
  });
  it("changes cached summary identity when source text changes", () => {
    const first = buildPrSummaryRequest(source);
    expect(buildPrSummaryRequest({ ...source }).idempotencyKey).toBe(first.idempotencyKey);
    expect(buildPrSummaryRequest({ ...source, body: "Activated instead" }).idempotencyKey).not.toBe(first.idempotencyKey);
  });
});
