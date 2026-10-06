import { workKindFor, workKindForReviewItem } from "../classify.js";
import { timelineEvent, type TimelineEvent } from "../schema.js";
import { capped, hasTable, projectFromKey, requireDb, windowParams, type Collector, type CollectorContext } from "./context.js";

/**
 * Decisions as the workspace database records them: review items (approval
 * gates, code-review and QA verdicts, packet approvals) and Decision deferral
 * receipts. Checked-in Decision documents are read by the governed-records
 * collector from the commits that changed them, which carry exact times.
 */

interface ReviewRow {
  id: string;
  slug: string | null;
  project_id: string | null;
  status: string;
  decision_needed: string;
  created_at: string;
  decided_at: string | null;
}

interface DeferralRow {
  id: string;
  decision_id: string;
  action_key: string;
  applied: number;
  created_at: string;
}

/** A review item decided this soon after it opened was decided by machinery, never waiting on the operator. */
const INSTANT_DECISION_MS = 5_000;

function pullRequestRef(text: string): string | undefined {
  return /\b([\w.-]+\/[\w.-]+#\d+)\b/.exec(text)?.[1];
}

export function collectDecisions(context: CollectorContext): TimelineEvent[] {
  const db = requireDb(context);
  const params = windowParams(context);
  const events: TimelineEvent[] = [];
  const push = (input: Parameters<typeof timelineEvent>[0]) => {
    const event = timelineEvent(input);
    if (event) events.push(event);
  };

  if (hasTable(db, "review_items")) {
    const rows = db.prepare(`
      SELECT id, slug, project_id, status, decision_needed, created_at, decided_at FROM review_items
      WHERE created_at BETWEEN @since AND @until OR decided_at BETWEEN @since AND @until
      ORDER BY created_at DESC LIMIT @cap`).all(params) as ReviewRow[];
    capped(rows, context, events, "decisions", "review_items");
    for (const row of rows) {
      const classified = workKindForReviewItem(row.decision_needed);
      const label = row.slug ?? row.id;
      const subjects = {
        project: row.project_id ? context.projectSlugById.get(row.project_id) ?? row.project_id : undefined,
        decision: label,
        pullRequest: pullRequestRef(row.decision_needed)
      };
      const base = {
        clock: "workspace-db" as const,
        source: "decisions" as const,
        workKind: classified.workKind,
        subjects,
        evidence: [{ kind: "row" as const, value: `review_items/${row.id}` }]
      };
      // Automated verdicts are opened and decided within milliseconds: one decided event says both.
      const instant = row.decided_at !== null && Math.abs(new Date(row.decided_at).getTime() - new Date(row.created_at).getTime()) < INSTANT_DECISION_MS;
      if (!instant) {
        push({
          ...base,
          id: `decisions:review:${row.id}:opened`,
          time: row.created_at,
          kind: "decision.review_item.opened",
          summary: `${label} opened: ${row.decision_needed}`,
          // It asked the operator something when it opened; the rewind view clears it once decided.
          attention: true,
          provenance: { event: "review_items.created_at", workKind: classified.provenance, actor: "review items do not record who opened them" }
        });
      }
      if (row.decided_at) {
        push({
          ...base,
          id: `decisions:review:${row.id}:decided`,
          time: row.decided_at,
          kind: "decision.review_item.decided",
          summary: `${label} ${row.status}: ${row.decision_needed}`,
          provenance: { event: "review_items.decided_at and status", workKind: classified.provenance, actor: "review items do not record who decided them" }
        });
      }
    }
  }

  if (hasTable(db, "decision_deferral_receipts")) {
    const rows = db.prepare(`
      SELECT id, decision_id, action_key, applied, created_at FROM decision_deferral_receipts
      WHERE created_at BETWEEN @since AND @until ORDER BY created_at DESC LIMIT @cap`).all(params) as DeferralRow[];
    capped(rows, context, events, "decisions", "decision_deferral_receipts");
    for (const row of rows) {
      const target = projectFromKey(row.action_key);
      push({
        id: `decisions:deferral:${row.id}`,
        time: row.created_at,
        clock: "workspace-db",
        source: "decisions",
        kind: "decision.deferred",
        workKind: workKindFor("decision.deferred"),
        summary: `Decision ${row.decision_id} deferred for ${row.action_key}${row.applied ? "" : " (not applied)"}`,
        subjects: { project: target.project, action: target.action, decision: row.decision_id },
        evidence: [{ kind: "receipt", value: `decision_deferral_receipts/${row.id}` }],
        provenance: { event: "decision_deferral_receipts.created_at" }
      });
    }
  }
  return events;
}

export const decisionsCollector: Collector = {
  source: "decisions",
  describe: "review_items, decision_deferral_receipts",
  collect: collectDecisions
};
