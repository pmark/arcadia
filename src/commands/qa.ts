import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { createReviewItem, getProjectBySlug, updateReviewItemStatus } from "../db/repositories.js";
import type { ReviewItemSummary } from "../domain/types.js";
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
  renderQaRefreshSuccess,
  renderQaStatusSuccess,
  runQaRefreshCommand,
  runQaStatusCommand,
  type QaRefreshCommandData,
  type QaStatusCommandData
} from "../qa/refreshCommand.js";

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
