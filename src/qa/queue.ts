import type Database from "better-sqlite3";
import { listProjects } from "../db/repositories.js";
import { nowIso } from "../utils/time.js";
import type {
  ProofTargetRecord,
  QaEvidenceFreshness,
  QaPrimaryAction,
  QaQueueProjectGroup,
  QaQueueRow,
  QaQueueSnapshot,
  QaSignOffRecord
} from "./types.js";

/**
 * Project every declared, unretired proof target into the operator's QA queue.
 *
 * Deliberately does no network access. Every state here is read from what was
 * declared or recorded — the queue reports `unverified` rather than probing a
 * URL, because this Action must not require outbound communication and because
 * a queue that silently probes would make "reachable" mean "reachable when the
 * page happened to load", which is worse than plainly saying nothing is known.
 */
export function buildQaQueue(db: Database.Database, options: { now?: string } = {}): QaQueueSnapshot {
  // Deliberately not filtered by Project status. Declaring a proof target is
  // an explicit act, and `retired_at` on the target is how one leaves the
  // queue — filtering by Project lifecycle instead would silently hide the
  // most common case there is, a Candidate for work that is still incubating.
  const projects = listProjects(db);
  const targets = db.prepare(
    `SELECT * FROM proof_targets WHERE retired_at IS NULL ORDER BY kind DESC, label ASC`
  ).all() as ProofTargetRecord[];
  const signOffs = db.prepare(
    `SELECT * FROM qa_sign_offs ORDER BY signed_off_at DESC, created_at DESC`
  ).all() as QaSignOffRecord[];

  const latestByTarget = new Map<string, QaSignOffRecord>();
  for (const signOff of signOffs) {
    if (!latestByTarget.has(signOff.proof_target_id)) latestByTarget.set(signOff.proof_target_id, signOff);
  }

  const groups: QaQueueProjectGroup[] = [];
  for (const project of projects) {
    const own = targets.filter((target) => target.project_id === project.id);
    if (own.length === 0) continue;
    const rows = own.map((target) => buildRow(project, target, latestByTarget.get(target.id) ?? null));
    groups.push({
      projectId: project.id,
      projectName: project.name,
      projectSlug: project.slug,
      // Candidates first and foremost: the queue exists to get the operator
      // through what is waiting on them, not to browse what is already stable.
      candidates: sortForTesting(rows.filter((row) => row.kind === "candidate")),
      stable: rows.filter((row) => row.kind === "stable")
    });
  }

  const allRows = groups.flatMap((group) => [...group.candidates, ...group.stable]);
  const candidates = allRows.filter((row) => row.kind === "candidate");
  return {
    generatedAt: options.now ?? nowIso(),
    projects: groups,
    counts: {
      candidates: candidates.length,
      stable: allRows.length - candidates.length,
      // Only Candidates whose current revision has no verdict yet. A Candidate
      // already signed off for this exact revision is not waiting on anyone.
      awaitingSignOff: candidates.filter((row) => row.primaryAction === "test-candidate").length,
      failing: candidates.filter((row) => row.primaryAction === "inspect-failure").length,
      unconfigured: allRows.filter((row) => row.primaryAction === "configure-target").length
    }
  };
}

/**
 * Most-urgent first, so the queue reads top to bottom as a work order:
 * unconfigured (Arcadia owes proof), then failures, then follow-ups, then
 * things ready to test, then everything already signed off.
 */
const ACTION_ORDER: QaPrimaryAction[] = [
  "configure-target",
  "inspect-failure",
  "follow-up",
  "test-candidate",
  "signed-off"
];

function sortForTesting(rows: QaQueueRow[]): QaQueueRow[] {
  return [...rows].sort((a, b) => {
    const byAction = ACTION_ORDER.indexOf(a.primaryAction) - ACTION_ORDER.indexOf(b.primaryAction);
    return byAction !== 0 ? byAction : a.label.localeCompare(b.label);
  });
}

function buildRow(
  project: { id: string; name: string; slug: string },
  target: ProofTargetRecord,
  latest: QaSignOffRecord | null
): QaQueueRow {
  const testable = Boolean(target.url);
  const evidenceFreshness = resolveFreshness(target, latest);
  const primaryAction = resolvePrimaryAction(target, latest, evidenceFreshness, testable);
  return {
    targetId: target.id,
    projectId: project.id,
    projectName: project.name,
    projectSlug: project.slug,
    kind: target.kind,
    label: target.label,
    url: target.url,
    sourceRevision: target.source_revision,
    pullRequestUrl: target.pull_request_url,
    testProcedure: target.test_procedure,
    changeSummary: target.change_summary,
    healthState: target.health_state,
    healthCheckedAt: target.health_checked_at,
    testable,
    latestSignOff: latest
      ? {
        id: latest.id,
        verdict: latest.verdict,
        note: latest.note,
        sourceRevision: latest.source_revision,
        signedOffAt: latest.signed_off_at,
        reviewItemId: latest.review_item_id
      }
      : null,
    evidenceFreshness,
    primaryAction,
    statusLine: describe(target, latest, evidenceFreshness, primaryAction, testable)
  };
}

function resolveFreshness(target: ProofTargetRecord, latest: QaSignOffRecord | null): QaEvidenceFreshness {
  if (!latest) return "none";
  // Without a revision on either side there is no way to tell whether the
  // verdict still applies, and guessing "current" would be the exact false
  // claim this queue exists to avoid.
  if (!target.source_revision || !latest.source_revision) return "revision-unknown";
  return latest.source_revision === target.source_revision ? "current" : "stale";
}

function resolvePrimaryAction(
  target: ProofTargetRecord,
  latest: QaSignOffRecord | null,
  freshness: QaEvidenceFreshness,
  testable: boolean
): QaPrimaryAction {
  if (!testable) return "configure-target";
  if (target.health_state === "unreachable") return "inspect-failure";
  // Stable is what Arcadia already proved. It is shown, not judged — routing
  // it through the Candidate verdict states would ask the operator to re-QA
  // the very thing a broken Candidate is supposed to fall back to.
  if (target.kind === "stable") return "show-stable";
  if (freshness === "current") {
    if (latest?.verdict === "fail") return "inspect-failure";
    if (latest?.verdict === "follow_up") return "follow-up";
    return "signed-off";
  }
  // Evidence that is stale, absent, or unattributable all mean the same thing
  // for the operator: this revision has not been judged yet.
  return "test-candidate";
}

function describe(
  target: ProofTargetRecord,
  latest: QaSignOffRecord | null,
  freshness: QaEvidenceFreshness,
  action: QaPrimaryAction,
  testable: boolean
): string {
  if (!testable) {
    return `No target URL is configured, so there is nothing to demonstrate. Set one with \`arcadia qa target set\`.`;
  }
  if (target.health_state === "unreachable") {
    return `Last recorded as unreachable${target.health_checked_at ? ` at ${target.health_checked_at}` : ""}. Inspect the failure before asking anyone to test it.`;
  }

  const health = target.health_state === "reachable"
    ? `Last recorded as reachable${target.health_checked_at ? ` at ${target.health_checked_at}` : ""}.`
    : "Reachability has not been verified, so treat the link as unproven.";

  switch (action) {
    case "show-stable":
      return `${health} This is the known-good target to show; it is not waiting on a QA verdict.`;
    case "signed-off":
      return `${health} QA passed against this exact revision on ${latest!.signed_off_at}.`;
    case "inspect-failure":
      return `${health} QA failed against this exact revision${latest?.note ? `: ${latest.note}` : "."}`;
    case "follow-up":
      return `${health} QA asked for follow-up on this exact revision${latest?.note ? `: ${latest.note}` : "."}`;
    case "test-candidate":
    default:
      if (freshness === "stale") {
        return `${health} The newest QA verdict is against ${latest!.source_revision}, not the current revision — it does not carry over.`;
      }
      if (freshness === "revision-unknown") {
        return `${health} A QA verdict exists but no revision is recorded on ${target.source_revision ? "it" : "this target"}, so it cannot be tied to what is deployed now.`;
      }
      return `${health} No QA verdict has been recorded for this Candidate yet.`;
  }
}
