import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildModelEffectivenessReport, type ReviewEffectivenessTelemetry } from "../src/reports/modelEffectiveness.js";
import { effectivenessParentRequestId, parsePersistedQaContext, verifyPersistedQaContextEvidence, type PersistedQaContext, type PrReviewRole, type QaReviewerProvenance } from "../src/qa/prReview.js";
import { renderQaEffectivenessSuccess } from "../src/commands/qa.js";

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
    evidenceSource: "artifacts/code-review/reviewer-events.jsonl", invocation: "fresh", modelVerdict: "pass",
    deterministicGateVerdict: null, deterministicGateReasons: [], findingEvidence: [],
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
  const effectiveness = options.effectiveness ?? telemetry({ role });
  return {
    schemaVersion: 2,
    candidate: { projectId: "project", projectName: "Arcadia", repository: "pmark/arcadia", number: 1, title: "change", url: "https://github.com/pmark/arcadia/pull/1", headSha: HEAD, headBranch: "codex/change", baseSha: "c".repeat(40), baseBranch: "main", isDraft: false, mergeStateStatus: "CLEAN" },
    verdict: options.verdict ?? "pass", summary: "reviewed", findings: [], checks: [], residualRisks: [],
    reviewer: provenance(options.reviewer), reportPath: "report.md", evidencePath: "evidence.json", metadataPath: "metadata.json",
    evidenceFingerprint: HASH, receiptFiles: [{ path: "report.md", sha256: HASH }, { path: "evidence.json", sha256: HASH }, { path: "metadata.json", sha256: HASH }, { path: effectiveness.evidenceSource, sha256: HASH }], role,
    effectiveness, reviewerUnavailable: options.unavailable ?? null
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

  it("does not compare distinct receipts whose task classification is incomplete", () => {
    const first = context({ effectiveness: telemetry({ taskClass: null, difficulty: null, attemptId: "attempt-1", attemptRequestId: "request-1" }) });
    const second = context({ effectiveness: telemetry({ taskClass: null, difficulty: null, attemptId: "attempt-2", attemptRequestId: "request-2" }) });
    const report = buildModelEffectivenessReport([
      { id: "decision-1", role: "code-review", context: first },
      { id: "decision-2", role: "code-review", context: second }
    ]);
    expect(report.groups).toHaveLength(2);
    expect(report.groups.map(group => group.sampleSize)).toEqual([1, 1]);
  });

  it("treats provider usage from a legacy unbound event stream as unknown", () => {
    const legacy = context({ reviewer: { actualBilledCostUsd: 1, estimatedCostUsd: 2, pricingAsOf: "2026-01-01", includedCapacityConsumption: 3 } });
    legacy.receiptFiles = legacy.receiptFiles.filter(file => file.path !== legacy.effectiveness!.evidenceSource);
    const report = buildModelEffectivenessReport([{ id: "legacy", role: "code-review", context: legacy }]);
    expect(report.groups[0].reviewerResources).toMatchObject({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, elapsedMs: 0, inputTokensKnown: 0, cachedInputTokensKnown: 0, outputTokensKnown: 0, elapsedMsKnown: 0, samplesWithUnknownUsage: 1 });
    expect(report.groups[0]).toMatchObject({ actualBilledCostUsd: null, estimatedCostUsd: null, billedCostKnown: 0, estimatedCostKnown: 0, includedCapacityKnown: 0, includedCapacityConsumption: null });
  });

  it("keeps legacy combined verdicts explicit unknown instead of attributing them to a model or gate", () => {
    const legacy = context({ verdict: "fail" });
    delete legacy.effectiveness;
    const report = buildModelEffectivenessReport([{ id: "legacy", role: "code-review", context: legacy }]);
    expect(report.groups[0]).toMatchObject({ freshInvocations: 0, candidateModelReviewFailures: 0, modelJudgmentKnown: 0, deterministicGateKnown: 0, invocationKnown: 0, reviewRounds: 1 });

    const preSplit = context({ verdict: "fail", effectiveness: telemetry() });
    delete preSplit.effectiveness!.modelVerdict;
    delete preSplit.effectiveness!.deterministicGateVerdict;
    delete preSplit.effectiveness!.deterministicGateReasons;
    expect(buildModelEffectivenessReport([{ id: "pre-split", role: "code-review", context: preSplit }]).groups[0])
      .toMatchObject({ modelJudgmentKnown: 0, deterministicGateKnown: 0, candidateModelReviewFailures: 0, deterministicGateFailures: 0 });
  });

  it("aggregates retry, repair, reviewer usage, and only explicitly linked resources", () => {
    const first = context();
    const second = context({ effectiveness: telemetry({
      attemptId: "attempt-2", attemptRequestId: "request-2", parentAttemptRequestId: "request-1", attemptOrdinal: 2,
      findingEvidence: [{ findingIndex: 0, severity: "high", disposition: "required-correction", resolutionState: "repaired", validationOutcome: "confirmed", validationEvidence: "metadata.json", repairHead: HEAD, repairEvidence: "metadata.json" }]
    }) });
    second.findings = [{ severity: "high", title: "fix", evidence: "evidence", recommendation: "repair" }];
    const linked = [{ id: "driver-1", attemptRequestId: "development-1", inputTokens: 1000, cachedInputTokens: 500, outputTokens: 100, elapsedMs: 1000, terminalOutcome: true, resourceEvidenceVerified: false }];
    const report = buildModelEffectivenessReport([
      { id: "decision-1", role: "code-review", context: first },
      { id: "decision-2", role: "code-review", context: second, linkedResources: linked }
    ]);
    expect(report.groups[0]).toMatchObject({ sampleSize: 2, retryCount: 1, repairCount: 0, repairReferences: 1, repairOutcomeEvidenceKnown: 0, confirmedBlockingFindings: 0, findingOutcomeEvidenceKnown: 0, linkedResourceReceiptCount: 1, verifiedLinkedResourceReceiptCount: 0, verifiedOutcomeResources: null });
    expect(report.groups[0].reviewerResources.inputTokens).toBe(200);
    expect(report.groups[0].observedResourcesThroughOutcome.inputTokens).toBe(1200);
  });

  it("does not count a skipped reviewer or deterministic gate failure as model judgment", () => {
    const skipped = context({ verdict: "needs-follow-up", effectiveness: telemetry({ invocation: "not-invoked", modelVerdict: "needs-follow-up" }) });
    const gated = context({ verdict: "needs-follow-up", effectiveness: telemetry({
      attemptId: "attempt-2", attemptRequestId: "request-2", modelVerdict: "pass",
      deterministicGateVerdict: "needs-follow-up", deterministicGateReasons: ["required check failed"]
    }) });
    const report = buildModelEffectivenessReport([
      { id: "skipped", role: "code-review", context: skipped },
      { id: "gated", role: "code-review", context: gated }
    ]);
    expect(report.groups[0]).toMatchObject({ freshInvocations: 1, passes: 1, candidateModelReviewFailures: 0, deterministicGateFailures: 1 });
  });

  it("deduplicates a linked resource receipt across attempts in one lineage group", () => {
    const linked = [{ id: "shared-repair", attemptRequestId: "repair-1", inputTokens: 20, cachedInputTokens: 5, outputTokens: 2, elapsedMs: 30, terminalOutcome: true, resourceEvidenceVerified: false }];
    const report = buildModelEffectivenessReport([
      { id: "one", role: "code-review", context: context(), linkedResources: linked },
      { id: "two", role: "code-review", context: context({ effectiveness: telemetry({ attemptId: "attempt-2", attemptRequestId: "request-2" }) }), linkedResources: linked }
    ]);
    expect(report.groups[0].linkedResourceReceiptCount).toBe(1);
    expect(report.groups[0].observedResourcesThroughOutcome.inputTokens).toBe(220);
  });

  it("rejects telemetry that does not match the candidate and unique finding indexes", () => {
    const valid = context();
    delete valid.reviewerUnavailable;
    valid.findings = [{ severity: "high", title: "one", evidence: "line", recommendation: "fix" }];
    valid.effectiveness = telemetry({ findingEvidence: [{ findingIndex: 0, severity: "high", disposition: null, resolutionState: "open", validationOutcome: "unresolved", validationEvidence: null, repairHead: null, repairEvidence: null }] });
    expect(parsePersistedQaContext(JSON.stringify(valid), "code-review")).not.toBeNull();
    const wrongHead = structuredClone(valid);
    wrongHead.effectiveness!.candidateHead = "f".repeat(40);
    expect(parsePersistedQaContext(JSON.stringify(wrongHead), "code-review")).toBeNull();
    const duplicate = structuredClone(valid);
    duplicate.effectiveness!.findingEvidence.push({ ...duplicate.effectiveness!.findingEvidence[0] });
    expect(parsePersistedQaContext(JSON.stringify(duplicate), "code-review")).toBeNull();
    const outOfRange = structuredClone(valid);
    outOfRange.effectiveness!.findingEvidence[0].findingIndex = 999;
    expect(parsePersistedQaContext(JSON.stringify(outOfRange), "code-review")).toBeNull();
    const missingFindingCoverage = structuredClone(valid);
    missingFindingCoverage.effectiveness!.findingEvidence = [];
    expect(parsePersistedQaContext(JSON.stringify(missingFindingCoverage), "code-review")).toBeNull();
  });

  it("requires source-linked validation and separates environment from judgment failures", () => {
    const unevidenced = context({ verdict: "fail", effectiveness: telemetry({ modelVerdict: "fail",
      findingEvidence: [{ findingIndex: 0, severity: "blocker", disposition: null, resolutionState: "not-actionable", validationOutcome: "rejected", validationEvidence: null, repairHead: null, repairEvidence: null }]
    }) });
    const environment = context({ verdict: "needs-follow-up", unavailable: "reviewer timed out", effectiveness: telemetry({ attemptId: "attempt-2", attemptRequestId: "request-2" }) });
    const report = buildModelEffectivenessReport([
      { id: "decision-1", role: "code-review", context: unevidenced },
      { id: "decision-2", role: "code-review", context: environment }
    ]);
    expect(report.groups[0]).toMatchObject({ candidateModelReviewFailures: 1, environmentFailures: 1, rejectedFindings: 0, unresolvedFindings: 1, rejectedOrDuplicateRate: null });
  });

  it("renders comparison coverage, rounds, findings, and resources without inventing pricing", () => {
    const report = buildModelEffectivenessReport([{ id: "decision", role: "code-review", context: context() }]);
    const rendered = renderQaEffectivenessSuccess({
      ok: true, command: "qa.effectiveness", workspace: "/workspace", artifacts: [], warnings: [],
      data: { report, sourceWarnings: [] }
    }).join("\n");
    expect(rendered).toContain("typescript-cli / medium / rubric");
    expect(rendered).toContain("configured e2_standard (1/1) / effective medium (1/1)");
    expect(rendered).toContain("rounds=1, fresh=1 (invocation coverage 1/1), retries=0, repairs=0");
    expect(rendered).toContain("confirmed blockers=0, rejected-or-duplicate=unknown (trusted finding outcomes 0/0)");
    expect(rendered).toContain("verified outcome resources unknown");
    expect(rendered).toContain("pricing estimate unknown");
    expect(rendered).toContain("included-capacity consumption unknown");
  });

  it("does not call a high-severity improvement a confirmed blocker", () => {
    const reviewed = context({ effectiveness: telemetry({
      findingEvidence: [{ findingIndex: 0, severity: "high", disposition: "worthwhile-improvement", resolutionState: "open", validationOutcome: "confirmed", validationEvidence: "metadata.json", repairHead: null, repairEvidence: null }]
    }) });
    reviewed.findings = [{ severity: "high", title: "improve", evidence: "line", recommendation: "consider" }];
    const report = buildModelEffectivenessReport([{ id: "decision", role: "code-review", context: reviewed }]);
    expect(report.groups[0]).toMatchObject({ confirmedBlockingFindings: 0, worthwhileImprovementFindings: 0, dispositionsKnown: 0, findingCount: 1 });
  });

  it("does not make a resumed unfinished lineage attempt its own retry parent", () => {
    expect(effectivenessParentRequestId({ request_id: "same-attempt" }, { request_id: "same-attempt" })).toBeNull();
    expect(effectivenessParentRequestId({ request_id: "earlier-attempt" }, { request_id: "new-attempt" })).toBe("earlier-attempt");
  });

  it("keeps pricing dates and configured-effort conflicts inside one accepted cohort", () => {
    const first = context({ reviewer: { estimatedCostUsd: 1, pricingAsOf: "2026-01-01", configuredEffort: "e2_standard" } });
    const second = context({ reviewer: { estimatedCostUsd: 2, pricingAsOf: "2026-02-01", configuredEffort: "e3_high" }, effectiveness: telemetry({ attemptId: "attempt-2", attemptRequestId: "request-2" }) });
    const report = buildModelEffectivenessReport([
      { id: "one", role: "code-review", context: first },
      { id: "two", role: "code-review", context: second }
    ]);
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]).toMatchObject({ sampleSize: 2, configuredEffort: null, configuredEffortConflict: true, pricingAsOf: null, pricingDateConflict: true, estimatedCostUsd: 3, estimatedCostKnown: 2 });
  });

  it("requires the immutable file list to match the canonical captured result", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-effectiveness-proof-"));
    try {
      const receipt = context();
      receipt.reportPath = "report.md";
      receipt.evidencePath = "evidence.json";
      receipt.metadataPath = "metadata.json";
      receipt.effectiveness!.evidenceSource = "reviewer-events.jsonl";
      writeFileSync(path.join(workspace, receipt.reportPath), "report\n");
      writeFileSync(path.join(workspace, receipt.evidencePath), "evidence\n");
      writeFileSync(path.join(workspace, receipt.effectiveness!.evidenceSource), "provider events\n", { flag: "w" });
      writeFileSync(path.join(workspace, receipt.metadataPath), JSON.stringify({ candidate: receipt.candidate, verdict: receipt.verdict, effectiveness: receipt.effectiveness }));
      const sha = (name: string) => createHash("sha256").update(readFileSync(path.join(workspace, name))).digest("hex");
      receipt.receiptFiles = [receipt.reportPath, receipt.evidencePath, receipt.metadataPath, receipt.effectiveness!.evidenceSource].map(file => ({ path: file, sha256: sha(file) }));
      const canonical = { version: 6, evidenceFingerprint: receipt.evidenceFingerprint, artifactId: "artifact-1", decisionId: "decision-1", requiredFiles: receipt.receiptFiles };
      writeFileSync(path.join(workspace, "result.json"), JSON.stringify(canonical));
      expect(verifyPersistedQaContextEvidence(workspace, receipt, { decisionId: "decision-1", artifactId: "artifact-1" })).toBe(true);
      writeFileSync(path.join(workspace, receipt.effectiveness!.evidenceSource), "tampered provider events\n");
      expect(verifyPersistedQaContextEvidence(workspace, receipt, { decisionId: "decision-1", artifactId: "artifact-1" })).toBe(false);
      rmSync(path.join(workspace, receipt.effectiveness!.evidenceSource));
      expect(verifyPersistedQaContextEvidence(workspace, receipt, { decisionId: "decision-1", artifactId: "artifact-1" })).toBe(false);
      writeFileSync(path.join(workspace, receipt.effectiveness!.evidenceSource), "provider events\n");
      writeFileSync(path.join(workspace, "result.json"), JSON.stringify({ ...canonical, requiredFiles: canonical.requiredFiles.slice(1) }));
      expect(verifyPersistedQaContextEvidence(workspace, receipt, { decisionId: "decision-1", artifactId: "artifact-1" })).toBe(false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("shows source warnings when every receipt is excluded", () => {
    const rendered = renderQaEffectivenessSuccess({
      ok: true, command: "qa.effectiveness", workspace: "/workspace", artifacts: [], warnings: [],
      data: { report: { schemaVersion: 1, records: 0, deduplicatedRecords: 0, groups: [] }, sourceWarnings: ["decision-1: ignored invalid QA receipt context"] }
    });
    expect(rendered).toEqual([
      "No valid QA or code-review receipts were found.",
      "Source warning: decision-1: ignored invalid QA receipt context"
    ]);
  });
});
