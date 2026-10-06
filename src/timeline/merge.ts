import type { Confidence, TimelineEvent, TimelineSource } from "./schema.js";

/**
 * De-duplication and ordering.
 *
 * The same fact is often recorded more than once: a settlement row, the
 * governed-record commit it produced, the facts that commit changed, the
 * worker noticing main advanced, the Discord notification. Records sharing a
 * dedupe key (`commit:<sha>`, `settlement:<request id>`, `pointer-after:<sha>`,
 * `operator-run:<id>`, ...) are one fact: the most semantic record becomes the
 * event, the others are listed in `alsoSeenAs`, their evidence is kept, and
 * the strongest actor evidence among them wins.
 */

/** Lower wins: the record that says the most about what the fact means. */
const SOURCE_PRIORITY: readonly TimelineSource[] = [
  "asks",
  "governed-records",
  "operator-scripts",
  "production",
  "queue",
  "pull-requests",
  "sessions",
  "decisions",
  "git",
  "events",
  "pings",
  "timeline"
];

/** Within one source, the more consequential fact leads. */
const KIND_PRIORITY: readonly string[] = [
  "record.action.done",
  "record.project.plan_activated",
  "record.plan.status_changed",
  "record.decision.answered",
  "record.decision.raised",
  "record.action.created",
  "record.plan.created",
  "record.project.pointer_moved",
  "record.plan.pointer_moved",
  "decision.review_item.decided",
  "ask.settled",
  "ask.rejected"
];

const CONFIDENCE_RANK: Record<Confidence, number> = { none: 0, low: 1, medium: 2, high: 3 };

function rank(list: readonly string[], value: string): number {
  const index = list.indexOf(value);
  return index < 0 ? list.length : index;
}

function comparePrimary(a: TimelineEvent, b: TimelineEvent): number {
  return (
    rank(SOURCE_PRIORITY, a.source) - rank(SOURCE_PRIORITY, b.source) ||
    rank(KIND_PRIORITY, a.kind) - rank(KIND_PRIORITY, b.kind) ||
    a.time.localeCompare(b.time) ||
    a.id.localeCompare(b.id)
  );
}

/** Stream order: time, then source priority, then id — total and stable across runs. */
export function compareEvents(a: TimelineEvent, b: TimelineEvent): number {
  return a.time.localeCompare(b.time) || rank(SOURCE_PRIORITY, a.source) - rank(SOURCE_PRIORITY, b.source) || a.id.localeCompare(b.id);
}

class DisjointSet {
  private readonly parent: number[];
  public constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }
  public find(index: number): number {
    while (this.parent[index] !== index) {
      this.parent[index] = this.parent[this.parent[index]];
      index = this.parent[index];
    }
    return index;
  }
  public union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent[rootB] = rootA;
  }
}

function mergeGroup(group: TimelineEvent[]): TimelineEvent {
  const ordered = [...group].sort(comparePrimary);
  const primary: TimelineEvent = { ...ordered[0], subjects: { ...ordered[0].subjects }, actor: { ...ordered[0].actor }, evidence: [...ordered[0].evidence], provenance: { ...ordered[0].provenance }, alsoSeenAs: [...ordered[0].alsoSeenAs] };
  delete primary.dedupeKeys;
  const evidence = new Map(primary.evidence.map((item) => [`${item.kind}:${item.value}`, item]));
  for (const other of ordered.slice(1)) {
    primary.alsoSeenAs.push({ id: other.id, source: other.source, kind: other.kind, time: other.time, summary: other.summary });
    for (const [key, value] of Object.entries(other.subjects)) {
      const subjects = primary.subjects as Record<string, string>;
      if (!subjects[key] && typeof value === "string") subjects[key] = value;
    }
    for (const item of other.evidence) evidence.set(`${item.kind}:${item.value}`, item);
    primary.attention ||= other.attention;
    if (CONFIDENCE_RANK[other.actor.confidence] > CONFIDENCE_RANK[primary.actor.confidence]) {
      primary.actor = { ...other.actor };
      primary.provenance.actor = `${other.provenance.actor ?? "from a merged record"} (from merged ${other.source} record ${other.id})`;
    }
  }
  primary.evidence = [...evidence.values()];
  if (primary.alsoSeenAs.length > 0) {
    primary.provenance.dedupe = `merged ${primary.alsoSeenAs.length} other record(s) of the same fact by shared key`;
  }
  return primary;
}

/** Merges records of the same fact and returns the stream in deterministic order. */
export function mergeTimeline(events: TimelineEvent[]): TimelineEvent[] {
  const byId = new Map<string, TimelineEvent>();
  for (const event of events) if (!byId.has(event.id)) byId.set(event.id, event);
  const unique = [...byId.values()];
  const sets = new DisjointSet(unique.length);
  const owner = new Map<string, number>();
  unique.forEach((event, index) => {
    for (const key of event.dedupeKeys ?? []) {
      const seen = owner.get(key);
      if (seen === undefined) owner.set(key, index);
      else sets.union(seen, index);
    }
  });
  const groups = new Map<number, TimelineEvent[]>();
  unique.forEach((event, index) => {
    const root = sets.find(index);
    const group = groups.get(root);
    if (group) group.push(event);
    else groups.set(root, [event]);
  });
  return [...groups.values()].map(mergeGroup).sort(compareEvents);
}
