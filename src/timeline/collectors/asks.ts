import { workKindForAskIntent } from "../classify.js";
import { UNKNOWN_ACTOR, timelineEvent, type TimelineEvent } from "../schema.js";
import { capped, hasTable, projectFromKey, requireDb, windowParams, type Collector, type CollectorContext } from "./context.js";

/**
 * Agent Asks: proposals (validated previews) and settlements (accepted or
 * rejected, with the governed-record commit they produced). Only identifiers,
 * the intent and the settlement's own effect lines are read; proposal bodies
 * are never copied into the stream.
 */

interface ProposalRow {
  id: string;
  request_id: string;
  intent_kind: string;
  project_ref: string;
  created_at: string;
}

interface SettlementRow {
  id: string;
  proposal_id: string;
  request_id: string;
  disposition: string;
  project_slug: string;
  queue_action_key: string | null;
  next_action_key: string | null;
  effects_json: string;
  documents_commit: string | null;
  authority_kind: string | null;
  intent: string | null;
  proposal_request_id: string | null;
  created_at: string;
}

function firstEffect(effectsJson: string): string | null {
  try {
    const effects = JSON.parse(effectsJson) as unknown;
    return Array.isArray(effects) && typeof effects[0] === "string" ? effects[0] : null;
  } catch {
    return null;
  }
}

export function collectAsks(context: CollectorContext): TimelineEvent[] {
  const db = requireDb(context);
  const params = windowParams(context);
  const events: TimelineEvent[] = [];
  if (!hasTable(db, "agent_ask_proposals")) return events;

  const proposals = db.prepare(`
    SELECT id, request_id, intent_kind, project_ref, created_at FROM agent_ask_proposals
    WHERE created_at BETWEEN @since AND @until ORDER BY created_at DESC LIMIT @cap`).all(params) as ProposalRow[];
  capped(proposals, context, events, "asks", "agent_ask_proposals");
  for (const row of proposals) {
    const event = timelineEvent({
      id: `asks:proposal:${row.id}`,
      time: row.created_at,
      clock: "workspace-db",
      source: "asks",
      kind: "ask.proposed",
      workKind: workKindForAskIntent(row.intent_kind),
      summary: `Ask ${row.request_id} previewed (${row.intent_kind})`,
      subjects: { project: row.project_ref, ask: row.request_id },
      actor: { ...UNKNOWN_ACTOR },
      evidence: [{ kind: "row", value: `agent_ask_proposals/${row.id}` }],
      provenance: {
        event: "agent_ask_proposals.created_at (a validated preview)",
        actor: "proposal rows do not record who drafted the Ask",
        workKind: `Ask intent ${row.intent_kind}`
      },
      dedupeKeys: [`ask:${row.id}`]
    });
    if (event) events.push(event);
  }

  if (!hasTable(db, "agent_ask_settlements")) return events;
  const settlements = db.prepare(`
    SELECT s.id, s.proposal_id, s.request_id, s.disposition, s.project_slug, s.queue_action_key, s.next_action_key,
           s.effects_json, s.created_at,
           json_extract(s.receipt_json, '$.documentsCommit') AS documents_commit,
           json_extract(s.receipt_json, '$.authority.kind') AS authority_kind,
           json_extract(s.receipt_json, '$.intent') AS intent,
           p.request_id AS proposal_request_id
    FROM agent_ask_settlements s LEFT JOIN agent_ask_proposals p ON p.id = s.proposal_id
    WHERE s.created_at BETWEEN @since AND @until ORDER BY s.created_at DESC LIMIT @cap`).all(params) as SettlementRow[];
  capped(settlements, context, events, "asks", "agent_ask_settlements");
  for (const row of settlements) {
    const accepted = row.disposition === "accepted";
    const effect = firstEffect(row.effects_json);
    const target = projectFromKey(row.queue_action_key);
    const event = timelineEvent({
      id: `asks:settlement:${row.id}`,
      time: row.created_at,
      clock: "workspace-db",
      source: "asks",
      kind: accepted ? "ask.settled" : "ask.rejected",
      workKind: workKindForAskIntent(row.intent),
      summary: `Ask ${row.proposal_request_id ?? row.request_id} ${accepted ? "settled" : "rejected"} (${row.intent ?? "unknown intent"})${effect ? `: ${effect}` : ""}`,
      subjects: { project: row.project_slug, action: target.action, ask: row.proposal_request_id ?? row.request_id, commit: row.documents_commit ?? undefined },
      actor: { ...UNKNOWN_ACTOR },
      evidence: [
        { kind: "receipt", value: `agent_ask_settlements/${row.id}` },
        ...(row.documents_commit ? [{ kind: "sha" as const, value: row.documents_commit }] : [])
      ],
      provenance: {
        event: "agent_ask_settlements.created_at",
        actor: `settlement rows do not record who ran the settle (authority ${row.authority_kind ?? "unknown"}); a merged commit may name the author`,
        workKind: `Ask intent ${row.intent ?? "unknown"}`,
        ...(row.next_action_key ? { next: `next Action after settlement: ${row.next_action_key}` } : {})
      },
      dedupeKeys: [`ask:${row.proposal_id}`, `settlement:${row.request_id}`, ...(row.documents_commit ? [`commit:${row.documents_commit}`] : [])]
    });
    if (event) events.push(event);
  }
  return events;
}

export const asksCollector: Collector = {
  source: "asks",
  describe: "agent_ask_proposals, agent_ask_settlements",
  collect: collectAsks
};
