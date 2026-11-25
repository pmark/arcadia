import { workKindFor } from "../classify.js";
import { operatorActor } from "../identity.js";
import { timelineEvent, type TimelineEvent } from "../schema.js";
import { capped, hasTable, requireDb, windowParams, type Collector, type CollectorContext } from "./context.js";

const MAX_WORDS = 200;

/**
 * What the operator's own words unlocked (operator_interactions, written by
 * `src/operatorInteractions/store.ts`): one event per recorded interaction,
 * with whether the operator was truly required and how long the work waited.
 */
export function collectOperatorInteractions(context: CollectorContext): TimelineEvent[] {
  const db = requireDb(context);
  if (!hasTable(db, "operator_interactions")) return [];
  const rows = db.prepare(`
    SELECT id, at, words, unlocked, necessity, ref, project, waiting_since FROM operator_interactions
    WHERE at >= @since AND at < @until ORDER BY at DESC LIMIT @cap`).all(windowParams(context)) as Array<{
    id: string; at: string; words: string; unlocked: string; necessity: string; ref: string | null; project: string | null; waiting_since: string | null;
  }>;
  const events: TimelineEvent[] = [];
  capped(rows, context, events, "operator-interactions", "operator_interactions");
  for (const row of rows) {
    const waitedMs = row.waiting_since ? Date.parse(row.at) - Date.parse(row.waiting_since) : Number.NaN;
    const event = timelineEvent({
      id: `operator-interactions:${row.id}`,
      time: row.at,
      clock: "workspace-db",
      source: "operator-interactions",
      kind: "operator.interaction",
      workKind: workKindFor("operator.interaction"),
      summary: `Operator unlocked ${row.unlocked} (${row.necessity})`,
      subjects: { project: row.project ?? undefined },
      actor: operatorActor("operator_interactions rows record the operator's own words").actor,
      evidence: [{ kind: "row", value: `operator_interactions/${row.id}` }],
      provenance: {
        event: "operator_interactions.at",
        words: row.words.slice(0, MAX_WORDS),
        necessity: row.necessity,
        ...(row.ref ? { ref: row.ref } : {}),
        ...(Number.isFinite(waitedMs) && waitedMs >= 0 ? { waited: `${Math.round(waitedMs / 60_000)} min since ${row.waiting_since}` } : {})
      }
    });
    if (event) events.push(event);
  }
  return events;
}

export const operatorInteractionsCollector: Collector = {
  source: "operator-interactions",
  describe: "operator_interactions",
  collect: collectOperatorInteractions
};
