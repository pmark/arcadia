import type { PersistedQaContext, PrReviewRole, QaPrFinding } from "../qa/prReview.js";

export type FindingDisposition = "required-correction" | "worthwhile-improvement" | "follow-up-opportunity";
export type FindingResolutionState = "open" | "repaired" | "accepted-risk" | "not-actionable";
export type FindingValidationOutcome = "confirmed" | "rejected" | "unresolved" | "duplicate";

export interface ReviewFindingEvidence {
  findingIndex: number;
  severity: QaPrFinding["severity"];
  disposition: FindingDisposition | null;
  resolutionState: FindingResolutionState;
  validationOutcome: FindingValidationOutcome;
  validationEvidence: string | null;
  repairHead: string | null;
  repairEvidence: string | null;
}

export interface ReviewEffectivenessTelemetry {
  schemaVersion: 1;
  role: PrReviewRole;
  projectId: string;
  projectSlug: string | null;
  actionId: string | null;
  taskClass: string | null;
  difficulty: string | null;
  candidateHead: string;
  rubricVersion: string;
  attemptId: string | null;
  attemptRequestId: string | null;
  parentAttemptRequestId: string | null;
  attemptOrdinal: number | null;
  evidenceSource: string;
  invocation: "fresh";
  findingEvidence: ReviewFindingEvidence[];
  escapedDefects: Array<{ id: string; evidence: string }> | null;
  linkedResourceReceipts: Array<{
    id: string;
    attemptRequestId: string;
    inputTokens: number | null;
    cachedInputTokens: number | null;
    outputTokens: number | null;
    elapsedMs: number | null;
  }>;
}

export interface EffectivenessReviewRecord {
  id: string;
  role: PrReviewRole;
  context: PersistedQaContext;
  observedTaskClass?: string | null;
  observedDifficulty?: string | null;
  linkedResources?: ReviewEffectivenessTelemetry["linkedResourceReceipts"];
}

export interface ResourceTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  elapsedMs: number;
  samplesWithCompleteUsage: number;
  samplesWithUnknownUsage: number;
}

export interface ModelEffectivenessGroup {
  taskClass: string | null;
  difficulty: string | null;
  role: PrReviewRole;
  rubricVersion: string | null;
  provider: string;
  model: string;
  effectiveEffort: string | null;
  sampleSize: number;
  configuredEffortKnown: number;
  effectiveEffortKnown: number;
  taskClassKnown: number;
  difficultyKnown: number;
  freshInvocations: number;
  retryCount: number;
  repairCount: number;
  reviewRounds: number;
  environmentFailures: number;
  judgmentFailures: number;
  passes: number;
  confirmedBlockingFindings: number;
  rejectedFindings: number;
  duplicateFindings: number;
  validatedFindings: number;
  unresolvedFindings: number;
  dispositionsKnown: number;
  requiredCorrectionFindings: number;
  worthwhileImprovementFindings: number;
  followUpOpportunityFindings: number;
  rejectedOrDuplicateRate: number | null;
  escapedDefects: number | null;
  reviewerResources: ResourceTotals;
  totalResourcesThroughOutcome: ResourceTotals;
  linkedResourceReceiptCount: number;
  actualBilledCostUsd: number | null;
  estimatedCostUsd: number | null;
  billedCostKnown: number;
  estimatedCostKnown: number;
  includedCapacityKnown: number;
}

export interface ModelEffectivenessReport {
  schemaVersion: 1;
  records: number;
  deduplicatedRecords: number;
  groups: ModelEffectivenessGroup[];
}

const zeroResources = (): ResourceTotals => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  elapsedMs: 0,
  samplesWithCompleteUsage: 0,
  samplesWithUnknownUsage: 0
});

function addResources(target: ResourceTotals, value: {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  elapsedMs: number | null;
}): void {
  const complete = value.inputTokens !== null && value.cachedInputTokens !== null && value.outputTokens !== null && value.elapsedMs !== null;
  if (complete) target.samplesWithCompleteUsage += 1;
  else target.samplesWithUnknownUsage += 1;
  target.inputTokens += value.inputTokens ?? 0;
  target.cachedInputTokens += value.cachedInputTokens ?? 0;
  target.outputTokens += value.outputTokens ?? 0;
  target.elapsedMs += value.elapsedMs ?? 0;
}

function deduplicationKey(record: EffectivenessReviewRecord): string {
  const telemetry = record.context.effectiveness;
  return telemetry?.attemptRequestId
    ? `attempt:${telemetry.attemptRequestId}`
    : `decision:${record.id}`;
}

/**
 * Builds a deterministic report only from persisted receipts. It never calls a
 * reviewer. Unknown task class/difficulty stay unknown and therefore never
 * masquerade as comparable samples.
 */
export function buildModelEffectivenessReport(records: EffectivenessReviewRecord[]): ModelEffectivenessReport {
  const unique = new Map<string, EffectivenessReviewRecord>();
  for (const record of records) if (!unique.has(deduplicationKey(record))) unique.set(deduplicationKey(record), record);
  const groups = new Map<string, ModelEffectivenessGroup>();
  for (const record of unique.values()) {
    const context = record.context;
    const telemetry = context.effectiveness ?? null;
    const role: PrReviewRole = context.role ?? record.role;
    const taskClass = telemetry?.taskClass ?? record.observedTaskClass ?? null;
    const difficulty = telemetry?.difficulty ?? record.observedDifficulty ?? null;
    const effectiveEffort = context.reviewer.effectiveEffort ?? null;
    const rubricVersion = telemetry?.rubricVersion ?? null;
    // Unknown class or difficulty is not a comparable cohort: retain it as a
    // one-receipt group instead of silently comparing unrelated changes.
    const comparabilityKey = taskClass === null || difficulty === null ? record.id : `${taskClass}:${difficulty}`;
    const key = JSON.stringify([comparabilityKey, role, rubricVersion, context.reviewer.provider, context.reviewer.model, effectiveEffort]);
    let group = groups.get(key);
    if (!group) {
      group = {
        taskClass, difficulty, role, rubricVersion,
        provider: context.reviewer.provider,
        model: context.reviewer.model,
        effectiveEffort,
        sampleSize: 0, configuredEffortKnown: 0, effectiveEffortKnown: 0, taskClassKnown: 0, difficultyKnown: 0,
        freshInvocations: 0, retryCount: 0, repairCount: 0, reviewRounds: 0,
        environmentFailures: 0, judgmentFailures: 0, passes: 0,
        confirmedBlockingFindings: 0, rejectedFindings: 0, duplicateFindings: 0, validatedFindings: 0,
        unresolvedFindings: 0, dispositionsKnown: 0, requiredCorrectionFindings: 0,
        worthwhileImprovementFindings: 0, followUpOpportunityFindings: 0,
        rejectedOrDuplicateRate: null, escapedDefects: 0,
        reviewerResources: zeroResources(), totalResourcesThroughOutcome: zeroResources(), linkedResourceReceiptCount: 0,
        actualBilledCostUsd: null, estimatedCostUsd: null, billedCostKnown: 0, estimatedCostKnown: 0, includedCapacityKnown: 0
      };
      groups.set(key, group);
    }
    group.sampleSize += 1;
    group.reviewRounds += 1;
    group.freshInvocations += telemetry?.invocation === "fresh" ? 1 : 0;
    group.configuredEffortKnown += context.reviewer.configuredEffort !== null && context.reviewer.configuredEffort !== undefined ? 1 : 0;
    group.effectiveEffortKnown += effectiveEffort !== null ? 1 : 0;
    group.taskClassKnown += taskClass !== null ? 1 : 0;
    group.difficultyKnown += difficulty !== null ? 1 : 0;
    group.retryCount += telemetry?.parentAttemptRequestId ? 1 : 0;
    group.repairCount += telemetry?.findingEvidence.filter(finding => finding.repairHead !== null && finding.repairEvidence !== null).length ?? 0;
    if (context.reviewerUnavailable) group.environmentFailures += 1;
    else if (context.verdict !== "pass") group.judgmentFailures += 1;
    else group.passes += 1;

    const findingEvidence = telemetry?.findingEvidence ?? context.findings.map((finding, findingIndex) => ({
      findingIndex, severity: finding.severity, disposition: null,
      resolutionState: "open" as const, validationOutcome: "unresolved" as const, validationEvidence: null, repairHead: null, repairEvidence: null
    }));
    for (const finding of findingEvidence) {
      if (finding.disposition !== null) group.dispositionsKnown += 1;
      if (finding.disposition === "required-correction") group.requiredCorrectionFindings += 1;
      if (finding.disposition === "worthwhile-improvement") group.worthwhileImprovementFindings += 1;
      if (finding.disposition === "follow-up-opportunity") group.followUpOpportunityFindings += 1;
      if (finding.validationOutcome === "confirmed" && finding.validationEvidence && (finding.severity === "blocker" || finding.severity === "high")) {
        group.confirmedBlockingFindings += 1;
      }
      if (finding.validationOutcome === "rejected" && finding.validationEvidence) group.rejectedFindings += 1;
      if (finding.validationOutcome === "duplicate" && finding.validationEvidence) group.duplicateFindings += 1;
      if (finding.validationOutcome === "unresolved" || !finding.validationEvidence) group.unresolvedFindings += 1;
      else group.validatedFindings += 1;
    }
    group.rejectedOrDuplicateRate = group.validatedFindings > 0
      ? (group.rejectedFindings + group.duplicateFindings) / group.validatedFindings
      : null;
    if (telemetry?.escapedDefects === null || telemetry === null) group.escapedDefects = null;
    else if (group.escapedDefects !== null) group.escapedDefects += telemetry.escapedDefects.length;

    const reviewerUsage = context.reviewer.usage ?? null;
    if (context.reviewer.actualBilledCostUsd !== null && context.reviewer.actualBilledCostUsd !== undefined) {
      group.actualBilledCostUsd = (group.actualBilledCostUsd ?? 0) + context.reviewer.actualBilledCostUsd;
      group.billedCostKnown += 1;
    }
    if (context.reviewer.estimatedCostUsd !== null && context.reviewer.estimatedCostUsd !== undefined) {
      group.estimatedCostUsd = (group.estimatedCostUsd ?? 0) + context.reviewer.estimatedCostUsd;
      group.estimatedCostKnown += 1;
    }
    if (context.reviewer.includedCapacityConsumption !== null && context.reviewer.includedCapacityConsumption !== undefined) {
      group.includedCapacityKnown += 1;
    }
    addResources(group.reviewerResources, {
      inputTokens: reviewerUsage?.inputTokens ?? null,
      cachedInputTokens: reviewerUsage?.cachedInputTokens ?? null,
      outputTokens: reviewerUsage?.outputTokens ?? null,
      elapsedMs: context.reviewer.modelCallElapsedMs ?? null
    });
    addResources(group.totalResourcesThroughOutcome, {
      inputTokens: reviewerUsage?.inputTokens ?? null,
      cachedInputTokens: reviewerUsage?.cachedInputTokens ?? null,
      outputTokens: reviewerUsage?.outputTokens ?? null,
      elapsedMs: context.reviewer.modelCallElapsedMs ?? null
    });
    const linkedResources = new Map([...(telemetry?.linkedResourceReceipts ?? []), ...(record.linkedResources ?? [])].map(linked => [linked.id, linked]));
    for (const linked of linkedResources.values()) {
      addResources(group.totalResourcesThroughOutcome, linked);
      group.linkedResourceReceiptCount += 1;
    }
  }
  return { schemaVersion: 1, records: records.length, deduplicatedRecords: unique.size, groups: [...groups.values()] };
}
