import { describe, expect, it } from "vitest";
import { buildModelEffectivenessReport, type ReviewEffectivenessTelemetry } from "../src/reports/modelEffectiveness.js";
import type { PersistedQaContext, PrReviewRole, QaReviewerProvenance } from "../src/qa/prReview.js";

const HEAD = "a".repeat(40);
const HASH = "b".repeat(64);

function provenance(overrides: Partial<QaReviewerProvenance> = {}): QaReviewerProvenance {
  return {
    profile: "reviewer", provider: "codex-cli", model: "gpt-test", modelSource: "binding launch argument", mappingId: "mapping", bindingId: "binding", exitStatus: 0,
    configuredEffort: "e2_standard", effectiveEffort: "medium", configuredEffortSource: "binding", effectiveEffortSource: "launch argument",
    usage: { inputTokens: 100, cachedInputTokens: 50, outputTokens: 10 }, usageSource: "provider events",
    modelCallElapsedMs: 250, actualBilledCostUsd: null, estimatedCostUsd: null, pricingAsOf: null,
    includedCapacityConsumption: null, ...overrides
  };
}

function telemetry(overrides: Partial<ReviewEffectivenessTelemetry> = {}): ReviewEffectivenessTelemetry {
  return {
    schemaVersion: 1, role: "code-review", projectId: "project", projectSlug: "arcadia", actionId: "action",
    taskClass: "typescript-cli", difficulty: "medium", candidateHead: HEAD, rubricVersion: HASH,
    attemptId: "attempt-1", attemptRequestId: "request-1", parentAttemptRequestId: null, attemptOrdinal: 1,
    evidenceSource: "artifacts/code-review/reviewer-events.jsonl", invocation: "fresh", findingEvidence: [],
    escapedDefects: null, linkedResourceReceipts: [], ...overrides
  };
}

function context(options: {
  role?: PrReviewRole;
  reviewer?: Partial<QaReviewerProvenance>;
  effectiveness?: ReviewEffectivenessTelemetry;
  verdict?: "pass" | "fail" | "needs-follow-up";
  unavailable?: string | null;
} = {}): PersistedQaContext {
  const role = options.role ?? "code-review";
  return {
    schemaVersion: 2,
    candidate: { projectId: "project", projectName: "Arcadia", repository: "pmark/arcadia", number: 1, title: "change", url: "https://github.com/pmark/arcadia/pull/1", headSha: HEAD, headBranch: "codex/change", baseSha: "c".repeat(40), baseBranch: "main", isDraft: false, mergeStateStatus: "CLEAN" },
    verdict: options.verdict ?? "pass", summary: "reviewed", findings: [], checks: [], residualRisks: [],
    reviewer: provenance(options.reviewer), reportPath: "report.md", evidencePath: "evidence.json", metadataPath: "metadata.json",
    evidenceFingerprint: HASH, receiptFiles: [{ path: "report.md", sha256: HASH }], role,
    effectiveness: options.effectiveness ?? telemetry({ role }), reviewerUnavailable: options.unavailable ?? null
  };
}

describe("model effectiveness report", () => {
  it("deduplicates a reused receipt by evidenced attempt identity", () => {
    const receipt = context();
    const report = buildModelEffectivenessReport([
      { id: "decision-1", role: "code-review", context: receipt },
      { id: "decision-replay", role: "code-review", context: receipt }
    ]);
    expect(report).toMatchObject({ records: 2, deduplicatedRecords: 1 });
    expect(report.groups[0]).toMatchObject({ sampleSize: 1, freshInvocations: 1, reviewRounds: 1 });
  });

  it("keeps configured and effective effort plus missing usage explicit", () => {
    const report = buildModelEffectivenessReport([{ id: "legacy", role: "qa", context: context({
      role: "qa",
      reviewer: { configuredEffort: "e3_high", effectiveEffort: null, configuredEffortSource: "binding", effectiveEffortSource: null, usage: null, usageSource: null, modelCallElapsedMs: null },
      effectiveness: telemetry({ role: "qa", taskClass: null, difficulty: null, attemptId: null, attemptRequestId: null })
    }) }]);
    expect(report.groups[0]).toMatchObject({ configuredEffortKnown: 1, effectiveEffortKnown: 0, taskClassKnown: 0, difficultyKnown: 0 });
    expect(report.groups[0].reviewerResources).toMatchObject({ samplesWithCompleteUsage: 0, samplesWithUnknownUsage: 1 });
  });

  it("aggregates retry, repair, reviewer usage, and only explicitly linked resources", () => {
    const first = context();
    const second = context({ effectiveness: telemetry({
      attemptId: "attempt-2", attemptRequestId: "request-2", parentAttemptRequestId: "request-1", attemptOrdinal: 2,
      findingEvidence: [{ findingIndex: 0, severity: "high", disposition: "required-correction", resolutionState: "repaired", validationOutcome: "confirmed", validationEvidence: "tests/fix.test.ts", repairHead: "d".repeat(40), repairEvidence: "repair receipt" }],
      linkedResourceReceipts: [{ id: "driver-1", attemptRequestId: "development-1", inputTokens: 1000, cachedInputTokens: 500, outputTokens: 100, elapsedMs: 1000 }]
    }) });
    const report = buildModelEffectivenessReport([
      { id: "decision-1", role: "code-review", context: first },
      { id: "decision-2", role: "code-review", context: second }
    ]);
    expect(report.groups[0]).toMatchObject({ sampleSize: 2, retryCount: 1, repairCount: 1, confirmedBlockingFindings: 1, linkedResourceReceiptCount: 1 });
    expect(report.groups[0].reviewerResources.inputTokens).toBe(200);
    expect(report.groups[0].totalResourcesThroughOutcome.inputTokens).toBe(1200);
  });

  it("requires source-linked validation and separates environment from judgment failures", () => {
    const unevidenced = context({ verdict: "fail", effectiveness: telemetry({
      findingEvidence: [{ findingIndex: 0, severity: "blocker", disposition: null, resolutionState: "not-actionable", validationOutcome: "rejected", validationEvidence: null, repairHead: null, repairEvidence: null }]
    }) });
    const environment = context({ verdict: "needs-follow-up", unavailable: "reviewer timed out", effectiveness: telemetry({ attemptId: "attempt-2", attemptRequestId: "request-2" }) });
    const report = buildModelEffectivenessReport([
      { id: "decision-1", role: "code-review", context: unevidenced },
      { id: "decision-2", role: "code-review", context: environment }
    ]);
    expect(report.groups[0]).toMatchObject({ judgmentFailures: 1, environmentFailures: 1, rejectedFindings: 0, unresolvedFindings: 1, rejectedOrDuplicateRate: null });
  });
});
