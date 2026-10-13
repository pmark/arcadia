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
  invocation: "fresh" | "not-invoked";
  /** The reviewer's own judgment, before deterministic repository gates. */
  modelVerdict?: "pass" | "fail" | "needs-follow-up";
  /** Repository evidence outcome, kept separate from model judgment. */
  deterministicGateVerdict?: "pass" | "fail" | "needs-follow-up" | null;
  deterministicGateReasons?: string[];
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
  linkedResources?: Array<ReviewEffectivenessTelemetry["linkedResourceReceipts"][number] & {
    terminalOutcome: boolean;
    resourceEvidenceVerified: boolean;
  }>;
}

export interface ResourceTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  elapsedMs: number;
  samples: number;
  inputTokensKnown: number;
  cachedInputTokensKnown: number;
  outputTokensKnown: number;
  elapsedMsKnown: number;
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
  configuredEffort: string | null;
  configuredEffortValues: string[];
  configuredEffortConflict: boolean;
  effectiveEffort: string | null;
  sampleSize: number;
  configuredEffortKnown: number;
  effectiveEffortKnown: number;
  taskClassKnown: number;
  difficultyKnown: number;
  invocationKnown: number;
  modelJudgmentKnown: number;
  deterministicGateKnown: number;
  environmentOutcomeKnown: number;
  freshInvocations: number;
  retryCount: number;
  repairCount: number;
  repairReferences: number;
  repairOutcomeEvidenceKnown: number;
  reviewRounds: number;
  environmentFailures: number;
  candidateModelReviewFailures: number;
  deterministicGateFailures: number;
  passes: number;
  findingCount: number;
  findingOutcomeEvidenceKnown: number;
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
  observedResourcesThroughOutcome: ResourceTotals;
  verifiedOutcomeResources: ResourceTotals | null;
  linkedResourceReceiptCount: number;
  verifiedLinkedResourceReceiptCount: number;
  actualBilledCostUsd: number | null;
  estimatedCostUsd: number | null;
  billedCostKnown: number;
  estimatedCostKnown: number;
  pricingAsOf: string | null;
  pricingDates: string[];
  pricingDateConflict: boolean;
  includedCapacityKnown: number;
  includedCapacityConsumption: number | null;
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
  samples: 0,
  inputTokensKnown: 0,
  cachedInputTokensKnown: 0,
  outputTokensKnown: 0,
  elapsedMsKnown: 0,
  samplesWithCompleteUsage: 0,
  samplesWithUnknownUsage: 0
});

function addResources(target: ResourceTotals, value: {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  elapsedMs: number | null;
}): void {
  target.samples += 1;
  const complete = value.inputTokens !== null && value.cachedInputTokens !== null && value.outputTokens !== null && value.elapsedMs !== null;
  if (complete) target.samplesWithCompleteUsage += 1;
  else target.samplesWithUnknownUsage += 1;
  if (value.inputTokens !== null) { target.inputTokens += value.inputTokens; target.inputTokensKnown += 1; }
  if (value.cachedInputTokens !== null) { target.cachedInputTokens += value.cachedInputTokens; target.cachedInputTokensKnown += 1; }
  if (value.outputTokens !== null) { target.outputTokens += value.outputTokens; target.outputTokensKnown += 1; }
  if (value.elapsedMs !== null) { target.elapsedMs += value.elapsedMs; target.elapsedMsKnown += 1; }
}

function deduplicationKey(record: EffectivenessReviewRecord): string {
  const telemetry = record.context.effectiveness;
  return telemetry?.attemptRequestId
    ? `attempt:${telemetry.projectId}:${telemetry.candidateHead}:${record.role}:${telemetry.attemptRequestId}`
    : `decision:${record.id}`;
}

/**
 * Builds a deterministic report only from persisted receipts. It never calls a
 * reviewer. Unknown task class/difficulty stay unknown and coverage remains
 * explicit; no missing value is inferred from a combined verdict.
 */
export function buildModelEffectivenessReport(records: EffectivenessReviewRecord[]): ModelEffectivenessReport {
  const unique = new Map<string, EffectivenessReviewRecord>();
  for (const record of records) if (!unique.has(deduplicationKey(record))) unique.set(deduplicationKey(record), record);
  const groups = new Map<string, ModelEffectivenessGroup>();
  const linkedResourceIds = new Map<string, Set<string>>();
  const configuredEffortValues = new Map<string, Set<string>>();
  const pricingDateValues = new Map<string, Set<string>>();
  const verifiedOutcomePossible = new Map<string, boolean>();
  for (const record of unique.values()) {
    const context = record.context;
    const telemetry = context.effectiveness ?? null;
    const role: PrReviewRole = context.role ?? record.role;
    const taskClass = telemetry?.taskClass ?? record.observedTaskClass ?? null;
    const difficulty = telemetry?.difficulty ?? record.observedDifficulty ?? null;
    const effectiveEffort = context.reviewer.effectiveEffort ?? null;
    const configuredEffort = context.reviewer.configuredEffort ?? null;
    const rubricVersion = telemetry?.rubricVersion ?? null;
    const comparisonIdentity = taskClass === null || difficulty === null ? deduplicationKey(record) : null;
    const key = JSON.stringify([taskClass, difficulty, role, rubricVersion, context.reviewer.provider, context.reviewer.model, effectiveEffort, comparisonIdentity]);
    let group = groups.get(key);
    if (!group) {
      group = {
        taskClass, difficulty, role, rubricVersion,
        provider: context.reviewer.provider,
        model: context.reviewer.model,
        configuredEffort: null, configuredEffortValues: [], configuredEffortConflict: false,
        effectiveEffort,
        sampleSize: 0, configuredEffortKnown: 0, effectiveEffortKnown: 0, taskClassKnown: 0, difficultyKnown: 0,
        invocationKnown: 0, modelJudgmentKnown: 0, deterministicGateKnown: 0, environmentOutcomeKnown: 0,
        freshInvocations: 0, retryCount: 0, repairCount: 0, repairReferences: 0, repairOutcomeEvidenceKnown: 0, reviewRounds: 0,
        environmentFailures: 0, candidateModelReviewFailures: 0, deterministicGateFailures: 0, passes: 0,
        findingCount: 0, findingOutcomeEvidenceKnown: 0,
        confirmedBlockingFindings: 0, rejectedFindings: 0, duplicateFindings: 0, validatedFindings: 0,
        unresolvedFindings: 0, dispositionsKnown: 0, requiredCorrectionFindings: 0,
        worthwhileImprovementFindings: 0, followUpOpportunityFindings: 0,
        rejectedOrDuplicateRate: null, escapedDefects: null,
        reviewerResources: zeroResources(), observedResourcesThroughOutcome: zeroResources(), verifiedOutcomeResources: null,
        linkedResourceReceiptCount: 0, verifiedLinkedResourceReceiptCount: 0,
        actualBilledCostUsd: null, estimatedCostUsd: null, billedCostKnown: 0, estimatedCostKnown: 0,
        pricingAsOf: null, pricingDates: [], pricingDateConflict: false,
        includedCapacityKnown: 0, includedCapacityConsumption: null
      };
      groups.set(key, group);
      linkedResourceIds.set(key, new Set());
      configuredEffortValues.set(key, new Set());
      pricingDateValues.set(key, new Set());
      verifiedOutcomePossible.set(key, true);
    }
    group.sampleSize += 1;
    group.reviewRounds += 1;
    if (configuredEffort !== null) {
      group.configuredEffortKnown += 1;
      configuredEffortValues.get(key)!.add(configuredEffort);
    }
    group.effectiveEffortKnown += effectiveEffort !== null ? 1 : 0;
    group.taskClassKnown += taskClass !== null ? 1 : 0;
    group.difficultyKnown += difficulty !== null ? 1 : 0;
    if (telemetry !== null) {
      group.invocationKnown += 1;
      group.freshInvocations += telemetry.invocation === "fresh" ? 1 : 0;
      if (telemetry.parentAttemptRequestId && telemetry.parentAttemptRequestId !== telemetry.attemptRequestId) group.retryCount += 1;
      if (telemetry.invocation === "fresh" && telemetry.modelVerdict !== undefined && !context.reviewerUnavailable) {
        group.modelJudgmentKnown += 1;
        if (telemetry.modelVerdict === "pass") group.passes += 1;
        else group.candidateModelReviewFailures += 1;
      }
      if (Object.prototype.hasOwnProperty.call(telemetry, "deterministicGateVerdict")) {
        group.deterministicGateKnown += 1;
        if (telemetry.deterministicGateVerdict && telemetry.deterministicGateVerdict !== "pass") group.deterministicGateFailures += 1;
      }
    }
    if (telemetry !== null || Object.prototype.hasOwnProperty.call(context, "reviewerUnavailable")) {
      group.environmentOutcomeKnown += 1;
      if (context.reviewerUnavailable) group.environmentFailures += 1;
    }

    const findingEvidence = telemetry?.findingEvidence ?? context.findings.map((finding, findingIndex) => ({
      findingIndex, severity: finding.severity, disposition: null,
      resolutionState: "open" as const, validationOutcome: "unresolved" as const, validationEvidence: null, repairHead: null, repairEvidence: null
    }));
    group.findingCount += findingEvidence.length;
    group.unresolvedFindings += findingEvidence.length;
    group.repairReferences += findingEvidence.filter(finding => finding.repairHead !== null || finding.repairEvidence !== null).length;
    // A path repeated in the same review context (including metadata.json) is
    // neither independent validation nor evidence of a later repair. Retain
    // the references, but leave outcome, disposition, repair and escape scores
    // unknown until a separate trusted outcome receipt exists.

    // New receipts bind the provider event stream into their canonical file
    // list. Older receipts remain reportable, but their unbound usage, timing,
    // and accounting values are not evidence and therefore stay unknown.
    const providerEvidenceBound = telemetry !== null && context.receiptFiles.some(file => file.path === telemetry.evidenceSource);
    const reviewerUsage = providerEvidenceBound ? context.reviewer.usage ?? null : null;
    if (providerEvidenceBound && context.reviewer.actualBilledCostUsd !== null && context.reviewer.actualBilledCostUsd !== undefined) {
      group.actualBilledCostUsd = (group.actualBilledCostUsd ?? 0) + context.reviewer.actualBilledCostUsd;
      group.billedCostKnown += 1;
    }
    if (providerEvidenceBound && context.reviewer.estimatedCostUsd !== null && context.reviewer.estimatedCostUsd !== undefined && context.reviewer.pricingAsOf) {
      group.estimatedCostUsd = (group.estimatedCostUsd ?? 0) + context.reviewer.estimatedCostUsd;
      group.estimatedCostKnown += 1;
      pricingDateValues.get(key)!.add(context.reviewer.pricingAsOf);
    }
    if (providerEvidenceBound && context.reviewer.includedCapacityConsumption !== null && context.reviewer.includedCapacityConsumption !== undefined) {
      group.includedCapacityKnown += 1;
      group.includedCapacityConsumption = (group.includedCapacityConsumption ?? 0) + context.reviewer.includedCapacityConsumption;
    }
    addResources(group.reviewerResources, {
      inputTokens: reviewerUsage?.inputTokens ?? null,
      cachedInputTokens: reviewerUsage?.cachedInputTokens ?? null,
      outputTokens: reviewerUsage?.outputTokens ?? null,
      elapsedMs: providerEvidenceBound ? context.reviewer.modelCallElapsedMs ?? null : null
    });
    addResources(group.observedResourcesThroughOutcome, {
      inputTokens: reviewerUsage?.inputTokens ?? null,
      cachedInputTokens: reviewerUsage?.cachedInputTokens ?? null,
      outputTokens: reviewerUsage?.outputTokens ?? null,
      elapsedMs: providerEvidenceBound ? context.reviewer.modelCallElapsedMs ?? null : null
    });
    const linkedResources = new Map((record.linkedResources ?? []).map(linked => [linked.id, linked]));
    const seenLinked = linkedResourceIds.get(key)!;
    let recordHasVerifiedOutcomeResource = linkedResources.size > 0;
    for (const linked of linkedResources.values()) {
      if (seenLinked.has(linked.id)) continue;
      seenLinked.add(linked.id);
      addResources(group.observedResourcesThroughOutcome, linked);
      group.linkedResourceReceiptCount += 1;
      const complete = linked.inputTokens !== null && linked.cachedInputTokens !== null && linked.outputTokens !== null && linked.elapsedMs !== null;
      if (linked.terminalOutcome && linked.resourceEvidenceVerified && complete) group.verifiedLinkedResourceReceiptCount += 1;
      else recordHasVerifiedOutcomeResource = false;
    }
    if (!recordHasVerifiedOutcomeResource || group.reviewerResources.samplesWithUnknownUsage > 0) verifiedOutcomePossible.set(key, false);
  }
  for (const [key, group] of groups) {
    const effortValues = [...configuredEffortValues.get(key)!].sort();
    group.configuredEffortValues = effortValues;
    group.configuredEffort = effortValues.length === 1 ? effortValues[0] : null;
    group.configuredEffortConflict = effortValues.length > 1;
    const dates = [...pricingDateValues.get(key)!].sort();
    group.pricingDates = dates;
    group.pricingAsOf = dates.length === 1 ? dates[0] : null;
    group.pricingDateConflict = dates.length > 1;
    if (verifiedOutcomePossible.get(key) && group.linkedResourceReceiptCount > 0 &&
        group.verifiedLinkedResourceReceiptCount === group.linkedResourceReceiptCount) {
      group.verifiedOutcomeResources = structuredClone(group.observedResourcesThroughOutcome);
    }
  }
  return { schemaVersion: 1, records: records.length, deduplicatedRecords: unique.size, groups: [...groups.values()] };
}
