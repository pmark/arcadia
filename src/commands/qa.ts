import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { createReviewItem, getProjectBySlug, updateReviewItemStatus } from "../db/repositories.js";
import type { ReviewItemSummary } from "../domain/types.js";
export {
  renderQaPrReviewSuccess,
  runQaPrReviewCommand,
  type QaPrReviewCommandData,
  type QaPrReviewOptions,
  type QaPrReviewDependencies
} from "../qa/prReview.js";

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
}

interface QaCandidateFile { candidates: QaCandidate[]; }

export interface QaListCommandData { candidates: QaCandidate[]; }
export interface QaRecordCommandData { candidate: QaCandidate; decision: QaDecision; review: ReviewItemSummary; }

const CONFIG_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../config/qa-candidates.json");

export function loadQaCandidates(): QaCandidate[] {
  const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as QaCandidateFile;
  if (!Array.isArray(parsed.candidates)) throw new Error("QA Candidate configuration must contain a candidates array.");
  return parsed.candidates;
}

export function runQaListCommand(options: { workspace: string }): CommandSuccess<QaListCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  return createSuccess({ command: "qa.list", workspace: workspacePath, data: { candidates: loadQaCandidates() } });
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
  const candidate = loadQaCandidates().find((item) => item.id === options.candidateId);
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
