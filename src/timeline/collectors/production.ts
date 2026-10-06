import { workKindFor } from "../classify.js";
import { hostWorkerActor, strongestActor, toolFromBranch, toolFromWorktreePath, type ActorClaim } from "../identity.js";
import { UNKNOWN_ACTOR, timelineEvent, type TimelineEvent, type TimelineEventInput } from "../schema.js";
import { hasTable, projectFromKey, requireDb, shortSha, windowParams, type Collector, type CollectorContext } from "./context.js";

/**
 * Managed-production activity: policy transitions (activate / Terminal Off),
 * admissions, operator escalations, launch refusals, repair attempts, PR
 * review steps and candidate preservation receipts; and the Action queue's
 * pointer and arrangement receipts.
 */

type Push = (input: TimelineEventInput) => void;

function pusher(events: TimelineEvent[]): Push {
  return (input) => {
    const event = timelineEvent(input);
    if (event) events.push(event);
  };
}

function prNumber(url: string | null | undefined): string | undefined {
  const match = url ? /\/pull\/(\d+)/.exec(url) : null;
  return match ? `#${match[1]}` : undefined;
}

export function collectProduction(context: CollectorContext): TimelineEvent[] {
  const db = requireDb(context);
  const params = windowParams(context);
  const events: TimelineEvent[] = [];
  const push = pusher(events);
  const worker = hostWorkerActor("recorded by the managed-production worker");

  if (hasTable(db, "production_policy_receipts")) {
    const rows = db.prepare(`
      SELECT id, request_id, transition, revision_after, epoch_after, created_at,
             json_extract(receipt_json, '$.authority.grantedBy') AS granted_by,
             json_extract(receipt_json, '$.authority.requestId') AS grant_request,
             json_extract(receipt_json, '$.reason') AS reason
      FROM production_policy_receipts WHERE created_at BETWEEN @since AND @until ORDER BY created_at DESC LIMIT @cap`).all(params) as Array<{
      id: string; request_id: string; transition: string; revision_after: number; epoch_after: number; created_at: string;
      granted_by: string | null; grant_request: string | null; reason: string | null;
    }>;
    for (const row of rows) {
      const actor: ActorClaim = row.granted_by
        ? { actor: { ...UNKNOWN_ACTOR, tool: "operator", name: row.granted_by, confidence: "high" }, provenance: `receipt authority.grantedBy "${row.granted_by}"` }
        : { actor: { ...UNKNOWN_ACTOR }, provenance: "the policy receipt names no grantor" };
      const kind = `production.policy.${row.transition}`;
      push({
        id: `production:policy:${row.id}`,
        time: row.created_at,
        clock: "workspace-db",
        source: "production",
        kind,
        workKind: workKindFor(kind),
        summary: row.transition === "activate"
          ? `Production activated (revision ${row.revision_after}, epoch ${row.epoch_after})${row.grant_request ? ` by Grant ${row.grant_request}` : ""}`
          : `Production set to Terminal Off (revision ${row.revision_after})${row.reason ? `: ${row.reason}` : ""}`,
        actor: actor.actor,
        evidence: [{ kind: "receipt", value: `production_policy_receipts/${row.id}` }],
        provenance: { event: "production_policy_receipts.created_at", actor: actor.provenance },
        dedupeKeys: row.grant_request ? [`operator-run:${row.grant_request}`] : []
      });
    }
  }

  if (hasTable(db, "production_admissions")) {
    const rows = db.prepare(`
      SELECT id, action_key, project_slug, plan_slug, provider, epoch, status, issued_at, committed_at, released_at, fenced_at, fenced_reason
      FROM production_admissions
      WHERE issued_at BETWEEN @since AND @until OR committed_at BETWEEN @since AND @until
         OR released_at BETWEEN @since AND @until OR fenced_at BETWEEN @since AND @until
      ORDER BY issued_at DESC LIMIT @cap`).all(params) as Array<{
      id: string; action_key: string; project_slug: string; plan_slug: string; provider: string; epoch: number; status: string;
      issued_at: string; committed_at: string | null; released_at: string | null; fenced_at: string | null; fenced_reason: string | null;
    }>;
    for (const row of rows) {
      const target = projectFromKey(row.action_key);
      const subjects = { project: row.project_slug, plan: row.plan_slug, action: target.action };
      const stages: Array<[string, string | null, string]> = [
        ["issued", row.issued_at, `Admission issued for ${row.action_key} on ${row.provider} (epoch ${row.epoch})`],
        ["committed", row.committed_at, `Admission committed: ${row.action_key} launching on ${row.provider}`],
        ["released", row.released_at, `Admission released for ${row.action_key}`],
        ["fenced", row.fenced_at, `Admission fenced for ${row.action_key}${row.fenced_reason ? `: ${row.fenced_reason}` : ""}`]
      ];
      for (const [stage, time, summary] of stages) {
        if (!time) continue;
        const kind = `production.admission.${stage}`;
        push({ id: `production:admission:${row.id}:${stage}`, time, clock: "workspace-db", source: "production", kind, workKind: workKindFor(kind), summary, subjects, actor: worker.actor, evidence: [{ kind: "row", value: `production_admissions/${row.id}` }], provenance: { event: `production_admissions.${stage}_at`, actor: worker.provenance } });
      }
    }
  }

  if (hasTable(db, "production_operator_escalations")) {
    const rows = db.prepare(`
      SELECT action_key, kind, message, first_detected_at, last_seen_at FROM production_operator_escalations
      WHERE first_detected_at BETWEEN @since AND @until OR last_seen_at BETWEEN @since AND @until
      ORDER BY first_detected_at DESC LIMIT @cap`).all(params) as Array<{ action_key: string; kind: string; message: string; first_detected_at: string; last_seen_at: string }>;
    for (const row of rows) {
      const target = projectFromKey(row.action_key);
      push({
        id: `production:escalation:${row.action_key}:${row.first_detected_at}`,
        time: row.first_detected_at,
        clock: "workspace-db",
        source: "production",
        kind: "production.escalation",
        workKind: workKindFor("production.escalation"),
        summary: `Escalation (${row.kind.replaceAll("_", " ")}) on ${row.action_key}: ${row.message}`,
        subjects: { project: target.project, action: target.action },
        actor: worker.actor,
        attention: true,
        evidence: [{ kind: "row", value: `production_operator_escalations/${row.action_key}` }],
        provenance: { event: `production_operator_escalations.first_detected_at (last seen ${row.last_seen_at}); the table keeps one current escalation per Action, so an earlier one for the same Action is overwritten`, actor: worker.provenance }
      });
    }
  }

  if (hasTable(db, "production_launch_refusal_log")) {
    const rows = db.prepare(`
      SELECT action_key, message, first_at, last_at FROM production_launch_refusal_log
      WHERE first_at BETWEEN @since AND @until OR last_at BETWEEN @since AND @until ORDER BY first_at DESC LIMIT @cap`).all(params) as Array<{ action_key: string; message: string; first_at: string; last_at: string }>;
    for (const row of rows) {
      const target = projectFromKey(row.action_key);
      push({ id: `production:launch-refused:${row.action_key}:${row.first_at}`, time: row.first_at, clock: "workspace-db", source: "production", kind: "production.launch_refused", workKind: workKindFor("production.launch_refused"), summary: `Launch refused for ${row.action_key}: ${row.message}`, subjects: { project: target.project, action: target.action }, actor: worker.actor, evidence: [{ kind: "row", value: `production_launch_refusal_log/${row.action_key}` }], provenance: { event: `production_launch_refusal_log.first_at (last ${row.last_at})`, actor: worker.provenance } });
    }
  }

  if (hasTable(db, "production_repair_attempts")) {
    const rows = db.prepare(`
      SELECT action_key, attempts, last_attempt_at FROM production_repair_attempts
      WHERE last_attempt_at BETWEEN @since AND @until ORDER BY last_attempt_at DESC LIMIT @cap`).all(params) as Array<{ action_key: string; attempts: number; last_attempt_at: string }>;
    for (const row of rows) {
      const target = projectFromKey(row.action_key);
      push({ id: `production:repair:${row.action_key}:${row.last_attempt_at}`, time: row.last_attempt_at, clock: "workspace-db", source: "production", kind: "production.repair_attempt", workKind: workKindFor("production.repair_attempt"), summary: `Repair attempt ${row.attempts} for ${row.action_key}`, subjects: { project: target.project, action: target.action }, actor: worker.actor, evidence: [{ kind: "row", value: `production_repair_attempts/${row.action_key}` }], provenance: { event: "production_repair_attempts.last_attempt_at (earlier attempts are not kept)", actor: worker.provenance } });
    }
  }

  if (hasTable(db, "production_review_steps")) {
    const rows = db.prepare(`
      SELECT request_id, session_id, action_key, target_head, pull_request_url, pushed_at, ready_at FROM production_review_steps
      WHERE pushed_at BETWEEN @since AND @until OR ready_at BETWEEN @since AND @until ORDER BY created_at DESC LIMIT @cap`).all(params) as Array<{
      request_id: string; session_id: string; action_key: string; target_head: string; pull_request_url: string; pushed_at: string | null; ready_at: string | null;
    }>;
    for (const row of rows) {
      const target = projectFromKey(row.action_key);
      const subjects = { project: target.project, action: target.action, session: row.session_id, commit: row.target_head, pullRequest: prNumber(row.pull_request_url) };
      if (row.pushed_at) push({ id: `production:review-step:${row.request_id}:pushed`, time: row.pushed_at, clock: "workspace-db", source: "production", kind: "production.review_step.pushed", workKind: workKindFor("production.review_step.pushed"), summary: `Pushed ${shortSha(row.target_head)} for review of ${row.action_key}`, subjects, actor: worker.actor, evidence: [{ kind: "url", value: row.pull_request_url }], provenance: { event: "production_review_steps.pushed_at", actor: worker.provenance } });
      if (row.ready_at) push({ id: `production:review-step:${row.request_id}:ready`, time: row.ready_at, clock: "workspace-db", source: "production", kind: "production.review_step.ready", workKind: workKindFor("production.review_step.ready"), summary: `PR ${prNumber(row.pull_request_url) ?? ""} marked ready for review (${row.action_key})`, subjects, actor: worker.actor, evidence: [{ kind: "url", value: row.pull_request_url }], provenance: { event: "production_review_steps.ready_at", actor: worker.provenance } });
    }
  }

  if (hasTable(db, "candidate_preservation_receipts")) {
    const rows = db.prepare(`
      SELECT id, repository_path, candidate_worktree_path, branch, action_id, commit_sha, preservation_state, pull_request_number, pull_request_url, created_at
      FROM candidate_preservation_receipts WHERE created_at BETWEEN @since AND @until ORDER BY created_at DESC LIMIT @cap`).all(params) as Array<{
      id: string; repository_path: string; candidate_worktree_path: string; branch: string; action_id: string; commit_sha: string; preservation_state: string;
      pull_request_number: number | null; pull_request_url: string | null; created_at: string;
    }>;
    for (const row of rows) {
      const who = strongestActor([toolFromWorktreePath(row.candidate_worktree_path), toolFromBranch(row.branch)]);
      const repository = context.repositories.find((candidate) => candidate.path === row.repository_path);
      push({
        id: `production:preservation:${row.id}`,
        time: row.created_at,
        clock: "workspace-db",
        source: "production",
        kind: "production.preservation",
        workKind: workKindFor("production.preservation"),
        summary: `Candidate for ${row.action_id} preserved: ${row.preservation_state}${row.pull_request_number ? ` (PR #${row.pull_request_number})` : ""}`,
        subjects: { project: repository?.projectSlug, action: row.action_id, commit: row.commit_sha, branch: row.branch, worktree: row.candidate_worktree_path, pullRequest: row.pull_request_number ? `#${row.pull_request_number}` : undefined },
        actor: who.actor,
        evidence: [{ kind: "receipt", value: `candidate_preservation_receipts/${row.id}` }, { kind: "sha", value: row.commit_sha }, ...(row.pull_request_url ? [{ kind: "url" as const, value: row.pull_request_url }] : [])],
        provenance: { event: "candidate_preservation_receipts.created_at", actor: who.provenance, ...(repository ? { project: "Project from the receipt's repository_path" } : {}) },
        dedupeKeys: [`commit:${row.commit_sha}`]
      });
    }
  }
  return events;
}

export function collectQueue(context: CollectorContext): TimelineEvent[] {
  const db = requireDb(context);
  const params = windowParams(context);
  const events: TimelineEvent[] = [];
  const push = pusher(events);

  if (hasTable(db, "action_queue_pointer_receipts")) {
    const rows = db.prepare(`
      SELECT id, request_id, action_key, head_before, created_at, json_extract(receipt_json, '$.previousAction') AS previous_action,
             json_extract(receipt_json, '$.planPath') AS plan_path
      FROM action_queue_pointer_receipts WHERE created_at BETWEEN @since AND @until ORDER BY created_at DESC LIMIT @cap`).all(params) as Array<{
      id: string; request_id: string; action_key: string; head_before: string; created_at: string; previous_action: string | null; plan_path: string | null;
    }>;
    for (const row of rows) {
      const target = projectFromKey(row.action_key);
      push({
        id: `queue:pointer:${row.id}`,
        time: row.created_at,
        clock: "workspace-db",
        source: "queue",
        kind: "queue.pointer_moved",
        workKind: workKindFor("queue.pointer_moved"),
        summary: `Pointer moved to ${row.action_key}${row.previous_action ? ` (from ${row.previous_action})` : ""}`,
        subjects: { project: target.project, action: target.action, plan: row.plan_path?.replace(/^docs\/plans\//, "").replace(/\.md$/, "") },
        evidence: [{ kind: "receipt", value: `action_queue_pointer_receipts/${row.id}` }],
        provenance: { event: "action_queue_pointer_receipts.created_at", actor: "pointer receipts do not record who moved the pointer" },
        dedupeKeys: [`pointer-after:${row.head_before}`]
      });
    }
  }

  if (hasTable(db, "action_queue_receipts")) {
    const rows = db.prepare(`
      SELECT id, request_id, revision_after, created_at, json_extract(operation_json, '$.kind') AS operation,
             json_array_length(json_extract(operation_json, '$.order')) AS order_length
      FROM action_queue_receipts WHERE created_at BETWEEN @since AND @until ORDER BY created_at DESC LIMIT @cap`).all(params) as Array<{
      id: string; request_id: string; revision_after: number; created_at: string; operation: string | null; order_length: number | null;
    }>;
    for (const row of rows) {
      const settle = /^agent-ask:(.+)$/.exec(row.request_id)?.[1];
      push({
        id: `queue:receipt:${row.id}`,
        time: row.created_at,
        clock: "workspace-db",
        source: "queue",
        kind: "queue.arranged",
        workKind: workKindFor("queue.arranged"),
        summary: `Action queue ${row.operation ?? "changed"} (revision ${row.revision_after}${row.order_length ? `, ${row.order_length} Actions` : ""})`,
        evidence: [{ kind: "receipt", value: `action_queue_receipts/${row.id}` }],
        provenance: { event: "action_queue_receipts.created_at", ...(settle ? { cause: `part of settlement ${settle}` } : {}) },
        dedupeKeys: settle ? [`settlement:${settle}`] : []
      });
    }
  }
  return events;
}

export const productionCollector: Collector = {
  source: "production",
  describe: "production_policy_receipts, production_admissions, production_operator_escalations, production_launch_refusal_log, production_repair_attempts, production_review_steps, candidate_preservation_receipts",
  collect: collectProduction
};

export const queueCollector: Collector = {
  source: "queue",
  describe: "action_queue_pointer_receipts, action_queue_receipts",
  collect: collectQueue
};
