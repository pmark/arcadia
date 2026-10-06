import { workKindFor } from "../classify.js";
import { hostWorkerActor, operatorActor, type ActorClaim } from "../identity.js";
import { UNKNOWN_ACTOR, timelineEvent, type TimelineEvent } from "../schema.js";
import { hasTable, projectFromKey, requireDb, shortSha, windowParams, type Collector, type CollectorContext } from "./context.js";

/**
 * The workspace `events` table: the managed-production tick's observations
 * (base branch advanced, packet approved, Session stalled) and the
 * orientation / Mission Control reply log.
 */

interface EventRow {
  id: string;
  event_type: string;
  source_module: string | null;
  project_id: string | null;
  payload_json: string;
  created_at: string;
}

interface Mapped {
  kind: string;
  summary: string;
  subjects: Record<string, string | undefined>;
  actor: ActorClaim | null;
  attention?: boolean;
  dedupeKeys?: string[];
}

function payload(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export function mapEventRow(row: EventRow, projectSlug: string | undefined): Mapped {
  const data = payload(row.payload_json);
  const project = str(data.projectSlug) ?? projectSlug;
  const tick = hostWorkerActor(`recorded by ${row.source_module ?? "an Arcadia module"} (the managed-production tick)`);
  switch (row.event_type) {
    case "managed_production.base_branch_advanced": {
      const sha = str(data.newSha);
      return {
        kind: "event.base_branch_advanced",
        summary: `${str(data.baseBranch) ?? "base branch"} advanced to ${shortSha(sha)} in ${project ?? "a Project"}`,
        subjects: { project, commit: sha, branch: str(data.baseBranch), repository: str(data.repositoryPath) },
        // The tick observed the move; who moved the branch is not recorded here.
        actor: { actor: { ...UNKNOWN_ACTOR }, provenance: `observed by ${row.source_module ?? "the managed-production tick"}; the row does not record who advanced the branch` },
        dedupeKeys: sha ? [`commit:${sha}`] : []
      };
    }
    case "managed_production.packet_approved": {
      const target = projectFromKey(str(data.actionKey));
      return {
        kind: "event.packet_approved",
        summary: `Build packet approved for ${str(data.actionKey) ?? "an Action"}`,
        subjects: { project: target.project ?? project, action: target.action, decision: str(data.decisionId) },
        actor: tick
      };
    }
    case "managed_production.session_stalled":
      return {
        kind: "event.session_stalled",
        summary: `Session stalled on ${str(data.actionId) ?? "an Action"}`,
        subjects: { project, action: str(data.actionId), session: str(data.sessionId) },
        actor: tick,
        attention: true,
        dedupeKeys: str(data.sessionId) ? [`session-stalled:${str(data.sessionId)}`] : []
      };
    default:
      break;
  }
  if (/^(orientation|project)\.reply\./.test(row.event_type)) {
    return {
      kind: "event.operator_reply",
      summary: `Operator reply applied: ${row.event_type.replace(/^(orientation|project)\.reply\./, "")}`,
      subjects: { project },
      actor: operatorActor(`${row.event_type} is recorded when the operator's reply is applied`)
    };
  }
  if (row.event_type.startsWith("orientation.")) {
    return { kind: "event.orientation", summary: `Orientation: ${row.event_type.slice("orientation.".length)}`, subjects: { project }, actor: null };
  }
  return { kind: `event.${row.event_type}`, summary: row.event_type, subjects: { project }, actor: null };
}

export function collectEventsTable(context: CollectorContext): TimelineEvent[] {
  const db = requireDb(context);
  if (!hasTable(db, "events")) return [];
  const rows = db.prepare(`
    SELECT id, event_type, source_module, project_id, payload_json, created_at FROM events
    WHERE created_at BETWEEN @since AND @until ORDER BY created_at DESC LIMIT @cap`).all(windowParams(context)) as EventRow[];
  const events: TimelineEvent[] = [];
  for (const row of rows) {
    const mapped = mapEventRow(row, row.project_id ? context.projectSlugById.get(row.project_id) : undefined);
    const event = timelineEvent({
      id: `events:${row.id}`,
      time: row.created_at,
      clock: "workspace-db",
      source: "events",
      kind: mapped.kind,
      workKind: workKindFor(mapped.kind),
      summary: mapped.summary,
      subjects: mapped.subjects,
      actor: mapped.actor?.actor,
      attention: mapped.attention ?? false,
      evidence: [{ kind: "row", value: `events/${row.id}` }],
      provenance: { event: `events.${row.event_type}`, actor: mapped.actor?.provenance ?? "the event row names no actor" },
      dedupeKeys: mapped.dedupeKeys
    });
    if (event) events.push(event);
  }
  return events;
}

export const eventsTableCollector: Collector = {
  source: "events",
  describe: "events table",
  collect: collectEventsTable
};
