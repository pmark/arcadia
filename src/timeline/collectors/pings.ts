import { workKindFor } from "../classify.js";
import { actorFromName } from "../identity.js";
import { timelineEvent, type TimelineEvent } from "../schema.js";
import { hasTable, requireDb, windowParams, type Collector, type CollectorContext } from "./context.js";

/**
 * What reached the operator on Discord: `arcadia ping` nudges (operator_pings)
 * and settlement notifications (agent_ask_settlements.notified_at). A
 * notification is folded into its settlement by de-duplication.
 */
export function collectPings(context: CollectorContext): TimelineEvent[] {
  const db = requireDb(context);
  const params = windowParams(context);
  const events: TimelineEvent[] = [];
  const push = (input: Parameters<typeof timelineEvent>[0]) => {
    const event = timelineEvent(input);
    if (event) events.push(event);
  };

  if (hasTable(db, "operator_pings")) {
    const rows = db.prepare(`
      SELECT id, message, kind, channel, agent, status, created_at, sent_at FROM operator_pings
      WHERE created_at BETWEEN @since AND @until OR sent_at BETWEEN @since AND @until ORDER BY created_at DESC LIMIT @cap`).all(params) as Array<{
      id: string; message: string; kind: string; channel: string | null; agent: string | null; status: string; created_at: string; sent_at: string | null;
    }>;
    for (const row of rows) {
      const who = actorFromName(row.agent);
      push({
        id: `pings:${row.id}`,
        time: row.created_at,
        clock: "workspace-db",
        source: "pings",
        kind: "ping.created",
        workKind: workKindFor("ping.created"),
        summary: `Ping (${row.kind}${row.status === "sent" ? ", delivered" : ", pending"}): ${row.message}`,
        actor: who?.actor,
        attention: row.kind === "attention",
        evidence: [{ kind: "row", value: `operator_pings/${row.id}` }],
        provenance: {
          event: "operator_pings.created_at",
          actor: who?.provenance ?? (row.agent ? `agent "${row.agent}" is not a roster name` : "the ping names no agent"),
          ...(row.sent_at ? { delivery: `sent to Discord at ${row.sent_at}` } : {})
        }
      });
    }
  }

  if (hasTable(db, "agent_ask_settlements")) {
    const rows = db.prepare(`
      SELECT id, request_id, project_slug, notified_at FROM agent_ask_settlements
      WHERE notification_status = 'sent' AND notified_at BETWEEN @since AND @until ORDER BY notified_at DESC LIMIT @cap`).all(params) as Array<{
      id: string; request_id: string; project_slug: string; notified_at: string;
    }>;
    for (const row of rows) {
      push({
        id: `pings:settlement-notified:${row.id}`,
        time: row.notified_at,
        clock: "workspace-db",
        source: "pings",
        kind: "notification.settlement_sent",
        workKind: workKindFor("notification.settlement_sent"),
        summary: `Discord told the operator about ${row.request_id}`,
        subjects: { project: row.project_slug },
        evidence: [{ kind: "row", value: `agent_ask_settlements/${row.id}` }],
        provenance: { event: "agent_ask_settlements.notified_at" },
        dedupeKeys: [`settlement:${row.request_id}`]
      });
    }
  }
  return events;
}

export const pingsCollector: Collector = {
  source: "pings",
  describe: "operator_pings, settlement notifications",
  collect: collectPings
};
