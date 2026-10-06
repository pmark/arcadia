/**
 * The unified operator timeline event (docs/proposals/operator-timeline.md).
 *
 * One shape for everything that happens across a workspace and all its
 * Projects: a commit in an agent worktree, an Agent Ask settlement, a Session
 * launch, a production admission, an operator script run. Every derived field
 * carries its provenance, and anything that cannot be recovered from evidence
 * is `unknown`, never guessed.
 */

export const TIMELINE_EVENT_SCHEMA = "arcadia-timeline-event-v1" as const;

/** Who did it, by tool. `operator` is the human principal; `host-worker` is Arcadia's own machinery. */
export const AGENT_TOOLS = ["opencode", "claude-code", "codex", "operator", "host-worker", "unknown"] as const;
export type AgentTool = (typeof AGENT_TOOLS)[number];

/**
 * What kind of work an event is. Deliberately small: each value answers the
 * operator's question "what is that agent doing?" with one word, and every
 * source kind maps to exactly one (src/timeline/classify.ts).
 */
export const WORK_KINDS = [
  "plan-design",
  "implement",
  "review",
  "verify",
  "integrate",
  "govern",
  "operate",
  "observe",
  "unknown"
] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

export const TIMELINE_SOURCES = [
  "git",
  "governed-records",
  "sessions",
  "asks",
  "decisions",
  "events",
  "production",
  "queue",
  "operator-scripts",
  "pings",
  "pull-requests",
  "timeline"
] as const;
export type TimelineSource = (typeof TIMELINE_SOURCES)[number];

/** Where the event's time came from, so a reader can judge how far to trust it. */
export const TIME_CLOCKS = [
  "git-committer-date",
  "git-reflog",
  "workspace-db",
  "receipt-file",
  "file-mtime",
  "github-api",
  "collector"
] as const;
export type TimeClock = (typeof TIME_CLOCKS)[number];

export type Confidence = "high" | "medium" | "low" | "none";

export interface TimelineActor {
  tool: AgentTool;
  /** Semantic agent name, e.g. "Claudia Atlas", when evidence names one. */
  name: string | null;
  /** Model tier (light | standard | heavy) when derivable. */
  tier: string | null;
  /** Identity role (builder | critic) or a Session role (planner, qa, ...). */
  role: string | null;
  /** The account the action was recorded under when it differs from the actor (e.g. the operator's GitHub login). */
  account: string | null;
  confidence: Confidence;
}

export interface TimelineSubjects {
  workspace?: string;
  project?: string;
  plan?: string;
  action?: string;
  session?: string;
  ask?: string;
  decision?: string;
  pullRequest?: string;
  commit?: string;
  branch?: string;
  worktree?: string;
  repository?: string;
}

export interface TimelineEvidence {
  kind: "sha" | "path" | "receipt" | "url" | "row";
  value: string;
}

/** Another record of the same fact, folded into this event by de-duplication. */
export interface TimelineAlias {
  id: string;
  source: TimelineSource;
  kind: string;
  time: string;
  summary: string;
}

export interface TimelineEvent {
  schema: typeof TIMELINE_EVENT_SCHEMA;
  /** Stable across runs: `<source>:<native key>`. */
  id: string;
  /** UTC ISO-8601 with milliseconds. */
  time: string;
  clock: TimeClock;
  source: TimelineSource;
  /** Dotted source-level kind, e.g. `git.commit`, `ask.settled`, `session.started`. */
  kind: string;
  workKind: WorkKind;
  summary: string;
  subjects: TimelineSubjects;
  actor: TimelineActor;
  /** True when the event asks something of the operator (an escalation, an open Decision, an attention ping, a failure). */
  attention: boolean;
  evidence: TimelineEvidence[];
  /** How the event and each derived field were obtained, keyed by field name. */
  provenance: Record<string, string>;
  /** Keys shared by records of the same fact; events sharing one are merged. Internal to the merge. */
  dedupeKeys?: string[];
  alsoSeenAs: TimelineAlias[];
}

export const UNKNOWN_ACTOR: TimelineActor = Object.freeze({
  tool: "unknown",
  name: null,
  tier: null,
  role: null,
  account: null,
  confidence: "none"
});

export interface TimelineWindow {
  since: Date;
  until: Date;
}

export interface TimelineEventInput {
  id: string;
  time: string | Date;
  clock: TimeClock;
  source: TimelineSource;
  kind: string;
  workKind: WorkKind;
  summary: string;
  subjects?: TimelineSubjects;
  actor?: TimelineActor;
  attention?: boolean;
  evidence?: TimelineEvidence[];
  provenance: Record<string, string>;
  dedupeKeys?: string[];
}

const MAX_SUMMARY = 240;

/** Builds a well-formed event, normalising time to UTC and bounding the summary. Returns null for an unparseable time. */
export function timelineEvent(input: TimelineEventInput): TimelineEvent | null {
  const time = normalizeTime(input.time);
  if (!time) return null;
  const subjects: TimelineSubjects = {};
  for (const [key, value] of Object.entries(input.subjects ?? {})) {
    if (typeof value === "string" && value.length > 0) (subjects as Record<string, string>)[key] = value;
  }
  return {
    schema: TIMELINE_EVENT_SCHEMA,
    id: input.id,
    time,
    clock: input.clock,
    source: input.source,
    kind: input.kind,
    workKind: input.workKind,
    summary: boundSummary(input.summary),
    subjects,
    actor: input.actor ? { ...input.actor } : { ...UNKNOWN_ACTOR },
    attention: input.attention ?? false,
    evidence: input.evidence ?? [],
    provenance: input.provenance,
    ...(input.dedupeKeys && input.dedupeKeys.length > 0 ? { dedupeKeys: [...new Set(input.dedupeKeys)] } : {}),
    alsoSeenAs: []
  };
}

export function normalizeTime(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? date.toISOString() : null;
}

export function boundSummary(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_SUMMARY ? `${flat.slice(0, MAX_SUMMARY - 1)}…` : flat;
}

export function isAgentTool(value: string): value is AgentTool {
  return (AGENT_TOOLS as readonly string[]).includes(value);
}

export function isWorkKind(value: string): value is WorkKind {
  return (WORK_KINDS as readonly string[]).includes(value);
}

export function inWindow(time: string, window: TimelineWindow): boolean {
  const ms = new Date(time).getTime();
  return ms >= window.since.getTime() && ms <= window.until.getTime();
}

/** Locale-independent ordering by UTF-16 code unit, so the stream's total order is the same on every host. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
