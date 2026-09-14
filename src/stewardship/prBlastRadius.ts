import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { createReviewItem, getProjectBySlug, updateReviewItemStatus } from "../db/repositories.js";
import { previewAgentAskRequest } from "../ask/preview.js";
import { settleAgentAsk } from "../ask/settlement.js";
import { git } from "../git/worktrees.js";

/**
 * Paths whose changes this Project has decided are never "narrow": controller
 * safety, authority, concurrency, and canonical state-transition code, plus
 * the schema/CI surfaces a silent regression there could hide in. Matching
 * one of these never proves danger by itself -- it only means a human, not a
 * diff-size heuristic, decides whether this specific change is safe.
 */
export const BLAST_RADIUS_SAFETY_PATTERNS: readonly RegExp[] = [
  /^src\/production\//,
  /^src\/ask\//,
  /^src\/sessions\//,
  /^src\/dispatch\//,
  /^src\/db\//,
  /^src\/git\//,
  /^\.github\//,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/
];

/** Diff size alone is not a decision input per the Action's own acceptance
 * criteria -- but a diff this large is never "unambiguous [and] narrow"
 * either, so it always joins whatever other reasons apply. */
const LARGE_DIFF_LINE_THRESHOLD = 400;

export interface BlastRadiusAssessment {
  baseRevision: string;
  candidateRevision: string;
  touchedPaths: string[];
  matchedSafetyPaths: string[];
  linesChanged: number;
  escalate: boolean;
  reasons: string[];
}

/** Deterministic, zero-token: the real diff decides, never a claimed summary. */
export function computeBlastRadius(repoRoot: string, baseRevision: string, candidateRevision: string): BlastRadiusAssessment {
  const touchedPaths = git(repoRoot, ["diff", "--name-only", `${baseRevision}...${candidateRevision}`])
    .split("\n").map((line) => line.trim()).filter(Boolean);
  const shortstat = git(repoRoot, ["diff", "--shortstat", `${baseRevision}...${candidateRevision}`]);
  const linesChanged = parseShortstat(shortstat);
  const matchedSafetyPaths = touchedPaths.filter((path) => BLAST_RADIUS_SAFETY_PATTERNS.some((pattern) => pattern.test(path)));

  const reasons: string[] = [];
  if (matchedSafetyPaths.length > 0) {
    reasons.push(`Touches controller safety/authority/canonical-state paths: ${matchedSafetyPaths.join(", ")}.`);
  }
  if (linesChanged > LARGE_DIFF_LINE_THRESHOLD) {
    reasons.push(`Diff changes ${linesChanged} lines, over the ${LARGE_DIFF_LINE_THRESHOLD}-line narrow-change threshold.`);
  }
  if (touchedPaths.length === 0) {
    reasons.push("No changes were found between the base and candidate revision; evidence is missing, not proof of a no-op.");
  }

  return { baseRevision, candidateRevision, touchedPaths, matchedSafetyPaths, linesChanged, escalate: reasons.length > 0, reasons };
}

function parseShortstat(output: string): number {
  const insertions = /(\d+) insertion/.exec(output)?.[1];
  const deletions = /(\d+) deletion/.exec(output)?.[1];
  return (insertions ? parseInt(insertions, 10) : 0) + (deletions ? parseInt(deletions, 10) : 0);
}

interface PrBlastRadiusContext {
  prBlastRadius: {
    assessment: BlastRadiusAssessment;
    outcome: "proceed" | "escalated";
    decisionRequestId: string | null;
  };
}

export interface AssessPrBlastRadiusInput {
  db: Database.Database;
  projectSlug: string;
  planSlug: string;
  actionId: string;
  repoRoot: string;
  baseRevision: string;
  candidateRevision: string;
  pullRequestUrl?: string | null;
}

export interface AssessPrBlastRadiusResult {
  assessment: BlastRadiusAssessment;
  outcome: "proceed" | "escalated";
  reviewItemId: string;
  decisionRequestId: string | null;
  /** false when an existing assessment for this exact candidate revision was
   * replayed rather than newly computed -- reassessment never duplicates a
   * review record or a Decision. */
  created: boolean;
}

function findExistingAssessment(db: Database.Database, candidateRevision: string): { id: string; context: PrBlastRadiusContext } | null {
  const row = db.prepare(
    `SELECT id, context_json FROM review_items
     WHERE resolved_intent = 'PrBlastRadiusAssessment' AND json_extract(context_json, '$.prBlastRadius.assessment.candidateRevision') = ?
     ORDER BY created_at DESC LIMIT 1`
  ).get(candidateRevision) as { id: string; context_json: string } | undefined;
  if (!row) return null;
  return { id: row.id, context: JSON.parse(row.context_json) as PrBlastRadiusContext };
}

/**
 * Independently assess one candidate PR's blast radius and either record a
 * clean recommendation to proceed, or escalate to the operator by opening
 * exactly one Decision -- before anything merges. Never merges, deploys, or
 * grants merge authority of its own: this produces a recommendation only.
 *
 * Idempotent by candidate revision: reassessing the same revision replays the
 * prior recommendation (and, if it escalated, the same Decision) rather than
 * computing again or opening a duplicate.
 */
export function assessPrBlastRadius(input: AssessPrBlastRadiusInput): AssessPrBlastRadiusResult {
  const { db } = input;
  const existing = findExistingAssessment(db, input.candidateRevision);
  if (existing) {
    return {
      assessment: existing.context.prBlastRadius.assessment,
      outcome: existing.context.prBlastRadius.outcome,
      reviewItemId: existing.id,
      decisionRequestId: existing.context.prBlastRadius.decisionRequestId,
      created: false
    };
  }

  const project = getProjectBySlug(db, input.projectSlug);
  if (!project) throw validationError("Blast-radius assessment Project was not found.", { project: input.projectSlug });

  const assessment = computeBlastRadius(input.repoRoot, input.baseRevision, input.candidateRevision);
  const actionKey = `${input.projectSlug}/${input.actionId}`;
  const decisionNeeded = `Blast-radius assessment for ${actionKey} at ${input.candidateRevision}${input.pullRequestUrl ? ` (${input.pullRequestUrl})` : ""}.`;

  if (!assessment.escalate) {
    const item = createReviewItem(db, {
      projectId: project.id,
      decisionNeeded,
      recommendation: "Proceed: no safety/authority/canonical-state path was touched, and the diff is narrow.",
      sourceInput: "assessPrBlastRadius",
      proposedAction: "Proceed to merge.",
      resolvedIntent: "PrBlastRadiusAssessment",
      confidenceLabel: "high",
      confidence: 1,
      context: { prBlastRadius: { assessment, outcome: "proceed", decisionRequestId: null } } satisfies PrBlastRadiusContext
    });
    updateReviewItemStatus(db, item.id, {
      status: "approved",
      decisionNote: "Automatically approved: no blast-radius escalation condition matched."
    });
    return { assessment, outcome: "proceed", reviewItemId: item.id, decisionRequestId: null, created: true };
  }

  const decisionRequestId = `assess-pr-blast-radius-${input.candidateRevision}`;
  const request = JSON.stringify({
    agent_ask: "v1",
    request_id: decisionRequestId,
    project: input.projectSlug,
    intent: "decision",
    desired_result: `Decide whether ${actionKey}'s candidate at ${input.candidateRevision} is safe to merge.`,
    rationale: `${assessment.reasons.join(" ")} Touched paths: ${assessment.touchedPaths.join(", ") || "(none)"}.`,
    options: [
      { label: "Proceed with merge", consequence: "Merges a change this assessment flagged for elevated blast radius, with no further independent review.", recommended: false },
      { label: "Review before merging", consequence: "Nothing merges until the touched paths and diff are reviewed directly; the candidate and its evidence remain exactly as they are.", recommended: true }
    ],
    requested_authority: "propose"
  });
  const proposal = previewAgentAskRequest(db, { request, requestId: decisionRequestId, project: input.projectSlug, sourcePath: null });
  const preview = settleAgentAsk(db, { proposalRef: proposal.proposal.id, settlementRequestId: decisionRequestId, disposition: "accepted" });
  settleAgentAsk(db, {
    proposalRef: proposal.proposal.id, settlementRequestId: decisionRequestId, disposition: "accepted",
    previewFingerprint: preview.previewFingerprint, apply: true
  });

  const item = createReviewItem(db, {
    projectId: project.id,
    decisionNeeded,
    recommendation: "Escalate: review before merging.",
    sourceInput: "assessPrBlastRadius",
    proposedAction: "Escalated to a Decision; do not merge until it is answered.",
    resolvedIntent: "PrBlastRadiusAssessment",
    confidenceLabel: "high",
    confidence: 1,
    context: { prBlastRadius: { assessment, outcome: "escalated", decisionRequestId } } satisfies PrBlastRadiusContext,
    missingFields: []
  });

  return { assessment, outcome: "escalated", reviewItemId: item.id, decisionRequestId, created: true };
}
