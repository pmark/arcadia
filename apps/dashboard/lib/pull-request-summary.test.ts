import { loadIntelligenceConfig } from "../../../src/intelligence/config/defaults.js";
import { resolveIntelligenceRoute } from "../../../src/intelligence/routing/resolveRoute.js";
import { createHash } from "node:crypto";
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

  it("requests existing Fast Text Cloud with scoped paid permission and no application model pin", () => {
    const request = buildPrSummaryRequest(source);
    expect(request).toMatchObject({ capability: "text.generate", execution: "cloud-required", executionTarget: "cloud", profile: "fast", executionPolicy: { allowPaidUsage: true, maxRetries: 1 } });
    expect(request).not.toHaveProperty("model");
    const config = loadIntelligenceConfig({ ARCADIA_LITELLM_LOCAL_TEXT_ROUTE: "local-fixture", ARCADIA_LITELLM_CLOUD_TEXT_ROUTE: "arcadia-cloud-text", ARCADIA_CODEX_TEXT_ROUTE: "codex-fixture" });
    expect(resolveIntelligenceRoute(request, config.routes, request.executionPolicy)).toMatchObject({ ok: true, route: { profile: "fast", location: "cloud", executor: "litellm", liteLlmRoute: "arcadia-cloud-text", requiresPaidUsage: true } });
    expect(resolveIntelligenceRoute(request, config.routes, { allowPaidUsage: false })).toMatchObject({ ok: false, code: "paid_usage_not_allowed" });
    expect(resolveIntelligenceRoute(request, loadIntelligenceConfig({}).routes, request.executionPolicy)).toMatchObject({ ok: false });
  });

  it("keeps the v1 source hash but never loads or retries a legacy local job", async () => {
    const revision = createHash("sha256").update(JSON.stringify({ body: source.body, title: source.title, version: 1 })).digest("hex");
    expect(pullRequestSourceRevision(source)).toBe(revision);
    const legacyKey = `pr-tldr-v1-${revision}`;
    const legacy = { ...job, id: "legacy-local-job", status: "blocked", retryCount: 1, request: { ...job.request, idempotencyKey: legacyKey, execution: "local-required", profile: "standard", executionPolicy: { allowPaidUsage: false, maxRetries: 1 } } };
    mocks.byKey.mockImplementation(key => key === legacyKey ? legacy : null);
    const result = await loadPullRequestSummary("owner/repo", 2);
    expect(result).toMatchObject({ job: null, summary: null, sourceRevision: revision });
    expect(mocks.byKey).toHaveBeenCalledExactlyOnceWith(`pr-tldr-v2-fast-cloud-${revision}`);
    expect(mocks.getJob).not.toHaveBeenCalled();
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(legacy).toMatchObject({ status: "blocked", retryCount: 1 });
  });

  it("reuses the new cloud namespace across cache reloads and explicit repeated submissions", async () => {
    mocks.submit.mockResolvedValue({ job }); mocks.getJob.mockResolvedValue(job); mocks.byKey.mockResolvedValue(job);
    const first = await generatePullRequestSummary("owner/repo", 2);
    clearPullRequestSummaryCacheForTests();
    const loaded = await loadPullRequestSummary("owner/repo", 2);
    const repeated = await generatePullRequestSummary("owner/repo", 2);
    expect([first.summary?.jobId, loaded.summary?.jobId, repeated.summary?.jobId]).toEqual([job.id, job.id, job.id]);
    const keys = mocks.submit.mock.calls.map(([request]) => request.idempotencyKey);
    expect(keys).toEqual([buildPrSummaryRequest(source).idempotencyKey, buildPrSummaryRequest(source).idempotencyKey]);
    expect(keys[0]).not.toMatch(/^pr-tldr-v1-/);
    expect(mocks.retry).not.toHaveBeenCalled();
  });
});
