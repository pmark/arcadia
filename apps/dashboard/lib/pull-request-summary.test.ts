import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ description: vi.fn(), byKey: vi.fn(), submit: vi.fn(), retry: vi.fn(), getJob: vi.fn() }));
vi.mock("./arcadia-cli", () => ({ loadPullRequestDescription: mocks.description }));
vi.mock("./intelligence", () => ({ getIntelligenceClient: () => ({ submit: mocks.submit, retry: mocks.retry, getJob: mocks.getJob, getJobByIdempotencyKey: mocks.byKey }) }));
import { buildPrSummaryRequest, clearPullRequestSummaryCacheForTests, generatePullRequestSummary, loadPullRequestSummary, pullRequestSourceRevision, summaryFromJob } from "./pull-request-summary";

const source = { repository: "owner/repo", number: 2, title: "Draft plan", url: "https://github.com/owner/repo/pull/2", body: "An inactive draft.", state: "OPEN" };
const job = { id: "summary-job", status: "completed", request: buildPrSummaryRequest(source), retryCount: 0, createdAt: "2026-10-12T00:00:00Z", completedAt: "2026-10-12T00:00:05Z", result: { summary: "Approval remains required." } } as const;

beforeEach(() => { vi.resetAllMocks(); clearPullRequestSummaryCacheForTests(); mocks.description.mockResolvedValue(source); mocks.byKey.mockResolvedValue(null); });

describe("PR TLDR service", () => {
  it("loads source and reports no cache without starting inference", async () => {
    const result = await loadPullRequestSummary("owner/repo", 2);
    expect(result).toMatchObject({ source, job: null, summary: null });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("rediscovers a matching durable job after the process cache is empty", async () => {
    mocks.byKey.mockResolvedValue(job);
    mocks.getJob.mockResolvedValue(job);
    const result = await loadPullRequestSummary("owner/repo", 2);
    expect(result.summary?.text).toBe("Approval remains required.");
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("submits once on explicit generation and reconnects to the cached job", async () => {
    mocks.submit.mockResolvedValue({ job });
    mocks.getJob.mockResolvedValue(job);
    const generated = await generatePullRequestSummary("owner/repo", 2);
    expect(generated.summary?.text).toBe("Approval remains required.");
    const revisited = await loadPullRequestSummary("owner/repo", 2);
    expect(revisited.summary?.jobId).toBe("summary-job");
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.getJob).toHaveBeenCalledWith("summary-job");
  });

  it("binds cache identity to title and body and rejects invalid completed output", () => {
    expect(pullRequestSourceRevision(source)).not.toBe(pullRequestSourceRevision({ ...source, body: "Changed" }));
    expect(summaryFromJob({ ...job, result: { summary: "" } }, "rev")).toBeNull();
  });

  it("keeps generation local and unpaid", () => {
    expect(buildPrSummaryRequest(source)).toMatchObject({ execution: "local-required", executionPolicy: { allowPaidUsage: false, maxRetries: 1 } });
  });
});
