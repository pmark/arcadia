import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { createReviewItem, getProjectBySlug, listReviewItems, updateReviewItemStatus } from "../db/repositories.js";
import type { ReviewItemSummary } from "../domain/types.js";
import { buildModelEffectivenessReport, type ModelEffectivenessReport } from "../reports/modelEffectiveness.js";
import { parsePersistedQaContext, verifyPersistedQaContextEvidence, type PrReviewRole } from "../qa/prReview.js";
import { listMonitoredProjects } from "./workMonitor.js";
import { validateSessionLedger, type SessionLedgerRow } from "../reports/sessionLedger.js";
import {
  freshnessSummary,
  loadQaTargetsFile,
  repoFreshness,
  serviceScriptPath,
  type ProofAccessState,
  type ProofEnvironmentKind
} from "../qa/targets.js";
export {
  renderQaPrReviewSuccess,
  runQaPrReviewCommand,
  type QaPrReviewCommandData,
  type QaPrReviewOptions,
  type QaPrReviewDependencies
} from "../qa/prReview.js";
export {
  renderQaFetchSuccess,
  renderQaRefreshSuccess,
  renderQaRestartSuccess,
  renderQaStatusSuccess,
  renderQaSwitchSuccess,
  renderQaVerdictSuccess,
  runQaFetchCommand,
  runQaRefreshCommand,
  runQaRestartCommand,
  runQaStatusCommand,
  runQaSwitchCommand,
  runQaVerdictCommand,
  type QaFetchCommandData,
  type QaRefreshCommandData,
  type QaRestartCommandData,
  type QaStatusCommandData,
  type QaSwitchCommandData,
  type QaVerdictCommandData
} from "../qa/refreshCommand.js";
export {
  classifyChangedPaths,
  classifyPath,
  projectVerdict,
  verdictForProject,
  VERDICT_RULES,
  type ProjectVerdictResult,
  type RestartVerdict,
  type RestartVerdictResult,
  type VerdictReason
} from "../qa/verdict.js";

export type QaDecision = "pass" | "fail" | "needs-follow-up";

export interface QaCandidate {
  id: string;
  project: string;
  label: string;
  environment: "Candidate" | "Stable";
  revision: string | null;
  pullRequestUrl: string | null;
  targetUrl: string | null;
  targetState: "ready" | "unreachable" | "missing" | "unverified";
  validation: string;
  evidenceFreshness: string;
  testProcedure: string;
  /** Where it runs, which decides whether a refresh is even meaningful. */
  environmentKind: ProofEnvironmentKind;
  accessState: ProofAccessState;
  /** True when the project declares a restart command Arcadia can invoke. */
  refreshable: boolean;
}

export interface QaListCommandData { candidates: QaCandidate[]; }
export interface QaRecordCommandData { candidate: QaCandidate; decision: QaDecision; review: ReviewItemSummary; }
export interface QaEffectivenessCommandData { report: ModelEffectivenessReport; sourceWarnings: string[]; }

/** Read-only effectiveness projection over existing QA/code-review Decisions; invokes no model. */
export function runQaEffectivenessCommand(options: { workspace: string }): CommandSuccess<QaEffectivenessCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const sourceWarnings: string[] = [];
  const records = withDatabase(workspacePath, db => {
    const repositoryByProject = new Map(listMonitoredProjects(db, { includeInactive: true }).map(project => [project.id, project.repositoryPath]));
    const ledgers = new Map<string, SessionLedgerRow[]>();
    const ledgerFor = (projectId: string): SessionLedgerRow[] => {
      if (ledgers.has(projectId)) return ledgers.get(projectId)!;
      const repositoryPath = repositoryByProject.get(projectId);
      const ledgerPath = repositoryPath ? path.join(repositoryPath, "docs", "reports", "session-ledger.jsonl") : null;
      if (!ledgerPath || !existsSync(ledgerPath)) return ledgers.set(projectId, []).get(projectId)!;
      const text = readFileSync(ledgerPath, "utf8");
      const ledgerErrors = validateSessionLedger(text);
      if (ledgerErrors.length > 0) {
        sourceWarnings.push(`${ledgerPath}: ignored invalid session ledger (${ledgerErrors.length} validation error${ledgerErrors.length === 1 ? "" : "s"})`);
        return ledgers.set(projectId, []).get(projectId)!;
      }
      const rows = text.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line) as SessionLedgerRow);
      ledgers.set(projectId, rows);
      return rows;
    };
    return listReviewItems(db, "all").flatMap(item => {
      const role: PrReviewRole | null = item.resolved_intent === "IndependentPullRequestQa"
        ? "qa"
        : item.resolved_intent === "IndependentPullRequestCodeReview" ? "code-review" : null;
      if (!role) return [];
      const context = parsePersistedQaContext(item.context_json, role);
      if (!context) {
        sourceWarnings.push(`${item.slug ?? item.id}: ignored invalid QA receipt context`);
        return [];
      }
      if (item.project_id !== context.candidate.projectId || item.source_input !== context.candidate.url || item.artifact_path !== context.reportPath ||
          !verifyPersistedQaContextEvidence(workspacePath, context)) {
        sourceWarnings.push(`${item.slug ?? item.id}: ignored QA receipt whose candidate identity or immutable evidence did not verify`);
        return [];
      }
      const attemptRequestId = context.effectiveness?.attemptRequestId ?? null;
      const linkedRows = attemptRequestId === null ? [] : ledgerFor(context.candidate.projectId).filter(row =>
        row.review_attempt_request_id === attemptRequestId && row.candidate_head === context.candidate.headSha);
      const distinct = (values: Array<string | null | undefined>) => [...new Set(values.filter((value): value is string => Boolean(value)))];
      const taskClasses = distinct(linkedRows.map(row => row.task_class));
      const difficulties = distinct(linkedRows.map(row => row.difficulty));
      if (taskClasses.length > 1 || difficulties.length > 1) {
        sourceWarnings.push(`${item.slug ?? item.id}: conflicting observed task classification; task class and difficulty reported as unknown`);
      }
      return [{
        id: item.id,
        role,
        context,
        observedTaskClass: taskClasses.length === 1 && difficulties.length <= 1 ? taskClasses[0] : null,
        observedDifficulty: difficulties.length === 1 && taskClasses.length <= 1 ? difficulties[0] : null,
        linkedResources: linkedRows.filter(row => row.resource_scope === "lineage-additional").map(row => ({
          id: row.session_id,
          attemptRequestId: row.review_attempt_request_id!,
          inputTokens: row.tokens_in_uncached,
          cachedInputTokens: row.tokens_in_cached,
          outputTokens: row.tokens_out,
          elapsedMs: row.wall_min === null ? null : row.wall_min * 60_000
        }))
      }];
    });
  });
  return createSuccess({ command: "qa.effectiveness", workspace: workspacePath, data: { report: buildModelEffectivenessReport(records), sourceWarnings } });
}

export function renderQaEffectivenessSuccess(response: CommandSuccess<QaEffectivenessCommandData>): string[] {
  const { report, sourceWarnings } = response.data;
  if (report.groups.length === 0) return [
    "No valid QA or code-review receipts were found.",
    ...sourceWarnings.map(warning => `Source warning: ${warning}`)
  ];
  return [
    `Review effectiveness: ${report.deduplicatedRecords} unique receipt${report.deduplicatedRecords === 1 ? "" : "s"} (${report.records - report.deduplicatedRecords} replay duplicate${report.records - report.deduplicatedRecords === 1 ? "" : "s"} ignored).`,
    ...report.groups.map(group => {
      const task = group.taskClass ?? "task class unknown";
      const effort = group.effectiveEffort ?? "effort unknown";
      const difficulty = group.difficulty ?? "difficulty unknown";
      const usage = `${group.reviewerResources.inputTokens}+${group.reviewerResources.cachedInputTokens} input, ${group.reviewerResources.outputTokens} output tokens (complete ${group.reviewerResources.samplesWithCompleteUsage}/${group.sampleSize})`;
      const billed = group.billedCostKnown ? `$${group.actualBilledCostUsd?.toFixed(4)} actual billed` : "actual billed cost unknown";
      const estimated = group.estimatedCostKnown ? `$${group.estimatedCostUsd?.toFixed(4)} estimated as of ${group.pricingAsOf}` : "pricing estimate unknown";
      const capacity = group.includedCapacityKnown ? `${group.includedCapacityConsumption} included-capacity units` : "included-capacity consumption unknown";
      const total = `${group.totalResourcesThroughOutcome.inputTokens}+${group.totalResourcesThroughOutcome.cachedInputTokens} input, ${group.totalResourcesThroughOutcome.outputTokens} output tokens, ${group.totalResourcesThroughOutcome.elapsedMs} ms`;
      return `${group.role} / ${task} / ${difficulty} / rubric ${group.rubricVersion ?? "unknown"} / ${group.provider}:${group.model} / configured ${group.configuredEffort ?? "unknown"} (${group.configuredEffortKnown}/${group.sampleSize}) / effective ${effort} (${group.effectiveEffortKnown}/${group.sampleSize}): n=${group.sampleSize}, rounds=${group.reviewRounds}, fresh=${group.freshInvocations}, retries=${group.retryCount}, repairs=${group.repairCount}, pass=${group.passes}, judgment-fail=${group.judgmentFailures}, gate-fail=${group.deterministicGateFailures}, environment-fail=${group.environmentFailures}, confirmed blockers=${group.confirmedBlockingFindings}, rejected-or-duplicate=${group.rejectedOrDuplicateRate === null ? "unknown" : group.rejectedOrDuplicateRate.toFixed(3)}, reviewer usage ${usage}; total resources through verified outcome ${total} (${group.linkedResourceReceiptCount} linked receipts); ${billed}; ${estimated}; ${capacity}; class coverage ${group.taskClassKnown}/${group.sampleSize}, difficulty coverage ${group.difficultyKnown}/${group.sampleSize}.`;
    }),
    ...sourceWarnings.map(warning => `Source warning: ${warning}`)
  ];
}

/**
 * Candidates, with the three freshness fields computed rather than declared.
 *
 * `revision`, `validation`, and `evidenceFreshness` used to be strings typed
 * into a config file by hand. They went stale for three weeks and nobody could
 * tell, because a stale sentence looks exactly like a fresh one. They are now
 * derived from the project's actual checkout, so the worst they can be is out
 * of date by the age of the last `git fetch` — which they also say.
 */
export function loadQaCandidates(workspacePath?: string): QaCandidate[] {
  const file = loadQaTargetsFile(workspacePath);
  const freshnessByProject = new Map<string, ReturnType<typeof repoFreshness>>();

  return file.targets.map((target): QaCandidate => {
    const project = file.projects[target.project] ?? null;
    if (project && !freshnessByProject.has(target.project)) {
      freshnessByProject.set(target.project, repoFreshness(project));
    }
    const freshness = project ? freshnessByProject.get(target.project) : undefined;

    return {
      id: target.id,
      project: target.project,
      label: target.label,
      environment: target.environment,
      revision: freshness?.head ? `${freshness.head} (${project?.baseBranch ?? "?"})` : null,
      pullRequestUrl: target.pullRequestUrl ?? null,
      targetUrl: target.url,
      // Reachability needs the network, so the synchronous listing reports only
      // what it can prove without it.
      targetState: target.url ? "unverified" : "missing",
      validation: freshness ? freshnessSummary(freshness) : "No repository configured for this project.",
      evidenceFreshness: freshness?.fetchedAt ? `Refs fetched ${freshness.fetchedAt}` : "Refs never fetched",
      testProcedure: target.testProcedure,
      environmentKind: target.environmentKind,
      accessState: target.accessState,
      refreshable: project ? serviceScriptPath(project) !== null : false
    };
  });
}

export function runQaListCommand(options: { workspace: string }): CommandSuccess<QaListCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  return createSuccess({
    command: "qa.list",
    workspace: workspacePath,
    data: { candidates: loadQaCandidates(workspacePath) }
  });
}

export function runQaRecordCommand(options: {
  workspace: string;
  candidateId: string;
  decision: QaDecision;
  note?: string;
}): CommandSuccess<QaRecordCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  if (!(["pass", "fail", "needs-follow-up"] as const).includes(options.decision)) {
    throw validationError("QA decision must be pass, fail, or needs-follow-up.", { decision: options.decision });
  }
  const candidate = loadQaCandidates(workspacePath).find((item) => item.id === options.candidateId);
  if (!candidate) throw validationError("QA Candidate was not found in checked-in configuration.", { candidateId: options.candidateId });

  const review = withDatabase(workspacePath, (db) => {
    const project = getProjectBySlug(db, candidate.project);
    if (!project) throw validationError("QA Candidate Project was not found.", { project: candidate.project });
    return db.transaction(() => {
      const created = createReviewItem(db, {
        projectId: project.id,
        decisionNeeded: `QA ${options.decision} recorded for ${candidate.label} at ${candidate.revision ?? "unknown revision"}.`,
        recommendation: null,
        sourceInput: `Dashboard QA queue: ${candidate.id}`,
        proposedAction: "Preserve this operator QA result; it does not merge, deploy, or release the Candidate.",
        resolvedIntent: "CandidateQaSignoff",
        confidenceLabel: "high",
        confidence: 1,
        missingFields: [],
        context: { schemaVersion: 1, candidateId: candidate.id, candidateLabel: candidate.label, revision: candidate.revision, decision: options.decision, note: options.note?.trim() || null }
      });
      return updateReviewItemStatus(db, created.id, {
        status: options.decision === "pass" ? "approved" : options.decision === "fail" ? "rejected" : "deferred",
        decisionNote: options.note?.trim() || `QA ${options.decision} recorded for revision ${candidate.revision ?? "unknown"}.`
      })!;
    })();
  });
  return createSuccess({ command: "qa.record", workspace: workspacePath, data: { candidate, decision: options.decision, review } });
}

export function renderQaListSuccess(response: CommandSuccess<QaListCommandData>): string[] {
  return response.data.candidates.map((candidate) => `${candidate.project} / ${candidate.label} — ${candidate.environment}`);
}

export function renderQaRecordSuccess(response: CommandSuccess<QaRecordCommandData>): string[] {
  return [`Recorded QA ${response.data.decision} for ${response.data.candidate.label} (${response.data.review.slug}).`];
}
