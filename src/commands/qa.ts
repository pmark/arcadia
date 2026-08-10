import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { projectNotFound, validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { openDatabase } from "../db/connection.js";
import { createReviewItem, getProject, getProjectBySlug, updateReviewItemStatus } from "../db/repositories.js";
import { buildQaQueue } from "../qa/queue.js";
import {
  PROOF_HEALTH_STATES,
  PROOF_TARGET_KINDS,
  QA_VERDICTS,
  type ProofHealthState,
  type ProofTargetKind,
  type ProofTargetRecord,
  type QaQueueSnapshot,
  type QaSignOffRecord,
  type QaVerdict
} from "../qa/types.js";
import { createId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";

// ---------------------------------------------------------------------------
// Declaring proof targets
// ---------------------------------------------------------------------------

export interface QaTargetSetOptions {
  workspace: string;
  project: string;
  kind: string;
  label: string;
  url?: string;
  revision?: string;
  pullRequest?: string;
  procedure?: string;
  summary?: string;
  health?: string;
  retire?: boolean;
}

export interface QaTargetSetData {
  target: ProofTargetRecord;
  created: boolean;
}

/**
 * Declare or update one Stable or Candidate target for a Project.
 *
 * Keyed on (Project, kind, label) so re-declaring a Candidate as a new
 * revision lands on the same row: the QA queue's whole notion of stale
 * evidence depends on a target that moves while its identity holds still.
 */
export function runQaTargetSetCommand(options: QaTargetSetOptions): CommandSuccess<QaTargetSetData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const kind = normalizeKind(options.kind);
  const label = requireText(options.label, "label");
  const health = options.health === undefined ? undefined : normalizeHealth(options.health);

  const db = openDatabase(workspacePath);
  try {
    const project = getProject(db, options.project) ?? getProjectBySlug(db, options.project);
    if (!project) throw projectNotFound(options.project);

    const existing = db.prepare(
      "SELECT * FROM proof_targets WHERE project_id = ? AND kind = ? AND label = ?"
    ).get(project.id, kind, label) as ProofTargetRecord | undefined;
    const timestamp = nowIso();

    if (existing) {
      db.prepare(
        `UPDATE proof_targets SET
           url = COALESCE(@url, url),
           source_revision = COALESCE(@revision, source_revision),
           pull_request_url = COALESCE(@pullRequest, pull_request_url),
           test_procedure = COALESCE(@procedure, test_procedure),
           change_summary = COALESCE(@summary, change_summary),
           health_state = COALESCE(@health, health_state),
           health_checked_at = CASE WHEN @health IS NULL THEN health_checked_at ELSE @timestamp END,
           retired_at = CASE WHEN @retire = 1 THEN @timestamp ELSE NULL END,
           updated_at = @timestamp
         WHERE id = @id`
      ).run({
        id: existing.id,
        url: options.url ?? null,
        revision: options.revision ?? null,
        pullRequest: options.pullRequest ?? null,
        procedure: options.procedure ?? null,
        summary: options.summary ?? null,
        health: health ?? null,
        retire: options.retire ? 1 : 0,
        timestamp
      });
      return createSuccess({
        command: "qa.target.set",
        workspace: workspacePath,
        data: { target: readTarget(db, existing.id), created: false }
      });
    }

    const id = createId("proofTarget");
    db.prepare(
      `INSERT INTO proof_targets (
         id, project_id, kind, label, url, source_revision, pull_request_url,
         test_procedure, change_summary, health_state, health_checked_at,
         retired_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, project.id, kind, label, options.url ?? null, options.revision ?? null,
      options.pullRequest ?? null, options.procedure ?? null, options.summary ?? null,
      health ?? "unverified", health ? timestamp : null,
      options.retire ? timestamp : null, timestamp, timestamp
    );
    return createSuccess({
      command: "qa.target.set",
      workspace: workspacePath,
      data: { target: readTarget(db, id), created: true }
    });
  } finally {
    db.close();
  }
}

export function renderQaTargetSetSuccess(response: CommandSuccess<QaTargetSetData>): string[] {
  const { target, created } = response.data;
  return [
    `${created ? "Declared" : "Updated"} ${target.kind} target "${target.label}".`,
    `URL: ${target.url ?? "(none configured — nothing to demonstrate)"}`,
    `Revision: ${target.source_revision ?? "(unknown)"}`,
    `Health: ${target.health_state}${target.health_checked_at ? ` as of ${target.health_checked_at}` : ""}`,
    ...(target.retired_at ? [`Retired at ${target.retired_at}.`] : [])
  ];
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export interface QaQueueOptions {
  workspace: string;
}

export function runQaQueueCommand(options: QaQueueOptions): CommandSuccess<{ snapshot: QaQueueSnapshot }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    return createSuccess({
      command: "qa.queue",
      workspace: workspacePath,
      data: { snapshot: buildQaQueue(db) }
    });
  } finally {
    db.close();
  }
}

export function renderQaQueueSuccess(response: CommandSuccess<{ snapshot: QaQueueSnapshot }>): string[] {
  const { snapshot } = response.data;
  if (snapshot.projects.length === 0) {
    return ["No Project declares a proof target yet. Declare one with `arcadia qa target set`."];
  }
  const lines = [
    `Candidates: ${snapshot.counts.candidates} · Stable: ${snapshot.counts.stable} · ` +
    `Awaiting judgement: ${snapshot.counts.awaitingSignOff} · Failing: ${snapshot.counts.failing} · ` +
    `Unconfigured: ${snapshot.counts.unconfigured}`
  ];
  for (const group of snapshot.projects) {
    lines.push("", group.projectName);
    for (const row of [...group.candidates, ...group.stable]) {
      lines.push(`  [${row.kind.toUpperCase()}] ${row.label} — ${PRIMARY_ACTION_LABELS[row.primaryAction]}`);
      lines.push(`      ${row.statusLine}`);
      if (row.url) lines.push(`      Test: ${row.url}`);
      if (row.testProcedure) lines.push(`      How: ${row.testProcedure}`);
    }
  }
  return lines;
}

const PRIMARY_ACTION_LABELS: Record<string, string> = {
  "configure-target": "Configure target",
  "test-candidate": "Test Candidate",
  "signed-off": "Signed off",
  "show-stable": "Show Stable",
  "inspect-failure": "Inspect failure",
  "follow-up": "Follow up"
};

// ---------------------------------------------------------------------------
// Sign-off
// ---------------------------------------------------------------------------

export interface QaSignOffOptions {
  workspace: string;
  targetId: string;
  verdict: string;
  revision?: string;
  note?: string;
}

export interface QaSignOffData {
  signOff: QaSignOffRecord;
  target: ProofTargetRecord;
  reviewItemId: string;
}

/**
 * Record one operator judgement against one exact Candidate revision.
 *
 * The verdict is written twice on purpose: as a `qa_sign_offs` row, which is
 * what the queue reads to answer "has *this* revision been judged", and as a
 * resolved Decision, so QA history shows up wherever Decisions already do
 * instead of being invisible outside this one tab.
 *
 * It deliberately does not merge, deploy, promote the Candidate to Stable, or
 * mark anything delivered. A verdict is evidence for those transitions, not
 * authorization to perform them.
 */
export function runQaSignOffCommand(options: QaSignOffOptions): CommandSuccess<QaSignOffData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const verdict = normalizeVerdict(options.verdict);
  const db = openDatabase(workspacePath);
  try {
    const target = (db.prepare("SELECT * FROM proof_targets WHERE id = ?").get(options.targetId) as ProofTargetRecord | undefined) ?? null;
    if (!target) throw validationError("Proof target was not found.", { targetId: options.targetId });

    // Prefer the explicitly supplied revision; fall back to what the target
    // currently points at. Signing off with neither is allowed but recorded
    // as unknown, and the queue then refuses to treat the verdict as current.
    const revision = options.revision ?? target.source_revision ?? null;
    const project = getProject(db, target.project_id);
    if (!project) throw validationError("Proof target is missing its Project.", { targetId: target.id });

    const timestamp = nowIso();
    const id = createId("qaSignOff");
    let reviewItemId = "";
    const transaction = db.transaction(() => {
      const review = createReviewItem(db, {
        projectId: project.id,
        decisionNeeded: `QA verdict for ${project.name} ${target.kind} "${target.label}" at ${revision ?? "an unrecorded revision"}`,
        recommendation: null,
        sourceInput: `arcadia qa sign-off ${target.id} --verdict ${verdict}`,
        proposedAction: VERDICT_ACTIONS[verdict],
        resolvedIntent: "qa.sign-off",
        confidenceLabel: "operator-stated",
        confidence: 1,
        missingFields: revision ? [] : ["source_revision"],
        context: {
          proofTargetId: target.id,
          proofTargetKind: target.kind,
          proofTargetLabel: target.label,
          sourceRevision: revision,
          url: target.url,
          pullRequestUrl: target.pull_request_url,
          verdict
        }
      });
      reviewItemId = review.id;
      updateReviewItemStatus(db, review.id, {
        status: verdict === "pass" ? "approved" : verdict === "fail" ? "rejected" : "deferred",
        decisionNote: options.note ?? null
      });
      db.prepare(
        `INSERT INTO qa_sign_offs (
           id, proof_target_id, project_id, source_revision, verdict, note,
           review_item_id, signed_off_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, target.id, project.id, revision, verdict, options.note ?? null, review.id, timestamp, timestamp);
    });
    transaction();

    return createSuccess({
      command: "qa.sign-off",
      workspace: workspacePath,
      data: {
        signOff: db.prepare("SELECT * FROM qa_sign_offs WHERE id = ?").get(id) as QaSignOffRecord,
        target: readTarget(db, target.id),
        reviewItemId
      }
    });
  } finally {
    db.close();
  }
}

const VERDICT_ACTIONS: Record<QaVerdict, string> = {
  pass: "Record that this exact revision passed operator QA. This does not merge, deploy, or release it.",
  fail: "Record that this exact revision failed operator QA. The Candidate stays Candidate.",
  follow_up: "Record that this exact revision needs follow-up before a QA verdict can be reached."
};

export function renderQaSignOffSuccess(response: CommandSuccess<QaSignOffData>): string[] {
  const { signOff, target, reviewItemId } = response.data;
  return [
    `Recorded QA ${signOff.verdict} for ${target.kind} "${target.label}".`,
    `Revision: ${signOff.source_revision ?? "(unknown — the queue will not treat this verdict as current)"}`,
    `Decision: ${reviewItemId}`,
    ...(signOff.note ? [`Note: ${signOff.note}`] : []),
    "No merge, deployment, promotion to Stable, or delivery was performed."
  ];
}

// ---------------------------------------------------------------------------

function readTarget(db: ReturnType<typeof openDatabase>, id: string): ProofTargetRecord {
  return db.prepare("SELECT * FROM proof_targets WHERE id = ?").get(id) as ProofTargetRecord;
}

function normalizeKind(value: string): ProofTargetKind {
  if ((PROOF_TARGET_KINDS as readonly string[]).includes(value)) return value as ProofTargetKind;
  throw validationError(`QA target --kind must be one of: ${PROOF_TARGET_KINDS.join(", ")}.`, { kind: value });
}

function normalizeHealth(value: string): ProofHealthState {
  if ((PROOF_HEALTH_STATES as readonly string[]).includes(value)) return value as ProofHealthState;
  throw validationError(`QA target --health must be one of: ${PROOF_HEALTH_STATES.join(", ")}.`, { health: value });
}

function normalizeVerdict(value: string): QaVerdict {
  const normalized = value === "follow-up" ? "follow_up" : value;
  if ((QA_VERDICTS as readonly string[]).includes(normalized)) return normalized as QaVerdict;
  throw validationError("QA --verdict must be one of: pass, fail, follow-up.", { verdict: value });
}

function requireText(value: string, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw validationError(`QA target --${field} is required.`, { [field]: value });
  return trimmed;
}
