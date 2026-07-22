/**
 * Mission Control view models.
 *
 * Proposed replacement for the /momentum "Today" screen (currently a single
 * "Today's Advantage" card — one project action, nothing else). The ask:
 * a default view that oversees the operator's whole world, where any visible
 * area can be zoomed into for its latest status, its urgent/important action
 * items, and a place to add context or ask a question.
 *
 * The key design choice: those three affordances (status / action items /
 * context channel) are the SAME at every zoom level — the system root, a
 * Tower, a life area, a single project, a single ledger entry are all the
 * same recursive shape. One generic screen component can render any node;
 * "zooming in" is just fetching the next node's detail. This is what keeps
 * an arbitrarily deep hierarchy "minimalistic" instead of one bespoke screen
 * per domain.
 *
 * These are VIEW MODELS, not the precise information architecture — which
 * tower has which children, and how many levels deep each goes, is the next
 * step (see docs/plans/mission-control-view/00-view-models.md). What's fixed
 * here is the shape every node conforms to, and a first concrete mapping of
 * that shape onto real, already-existing Arcadia data (nothing invented):
 *
 *   Life      -> the Orientation Ledger (src/orientation/*, apps/discord-bot
 *                correction loop) grouped by `area`.
 *   Projects  -> DashboardSnapshot.projects + dailyAdvantage (existing
 *                src/dashboard/snapshot.ts / lib/types.ts).
 *   Decisions -> DashboardSnapshot.requiresReviewItems / attentionItems
 *                (existing).
 *
 * A fourth tower (Capabilities: blogging, the Rebuster bridge) already exists
 * as data (DashboardBloggingSnapshot, DashboardRebusterSnapshot) but is left
 * out of the v1 tower list below as a deliberate, revisitable call — it reads
 * as automation health, not something the operator needs to be zoomed into
 * daily.
 */

// ---------------------------------------------------------------------------
// The recursive node shape
// ---------------------------------------------------------------------------

/**
 * What a node's own domain actually is. Purely a rendering discriminant
 * (icon, accent color, which detail sub-fields are meaningful) — never
 * behavior; every kind still conforms to the same MissionControlNode shape.
 */
export type MissionControlNodeKind =
  | "root"
  | "life_tower"
  | "life_area"
  | "life_entry"
  | "projects_tower"
  | "project"
  | "decisions_tower"
  | "decision";

export type UrgencyLevel = "critical" | "attention" | "quiet";

/**
 * Optional coarse time cost — the one dimension the ledger had no notion of,
 * and the thing that turns "what matters?" into "what fits the time I have?".
 * Mirrors src/orientation/types.ts; semantics live in src/orientation/effort.ts.
 * Absent means un-sized, which is a normal, fully-supported state.
 */
export type OrientationEffort = "quick" | "short" | "session" | "project";

export const EFFORT_LABELS: Record<OrientationEffort, string> = {
  quick: "≤15m",
  short: "≤1h",
  session: "1–3h",
  project: "multi-session"
};

/** Mirrors src/orientation/types.ts's DailyCapacity. Null numbers mean unknown, not zero. */
export interface DailyCapacity {
  localDate: string;
  note: string;
  sessionBlocks: number | null;
  fragmentMinutes: number | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The scale-of-time picture. Mirrors src/orientation/timeline.ts: every sized
 * item measured on one scale, against how much time the day actually holds.
 * `unbounded` items are multi-session and deliberately carry no length.
 */
export interface TimelineItem {
  id: string;
  title: string;
  effort: OrientationEffort;
  minutes: number;
  area: string | null;
  urgencyScore: number;
  startMinute: number;
}

export interface Timeline {
  items: TimelineItem[];
  unbounded: Array<{ id: string; title: string; area: string | null; urgencyScore: number }>;
  totalMinutes: number;
  unsizedCount: number;
  capacity: { note: string; minutes: number; sessionBlocks: number | null; fragmentMinutes: number | null } | null;
  daysAtCurrentCapacity: number | null;
}

export interface TimelineResponse {
  timeline: Timeline;
  lines: string[];
}

/**
 * Non-hierarchical relationships between nodes — independent of the
 * containment tree (`children`/`childCount` below). A pure tree cannot
 * express "this one thing matters to two towers" (e.g. a Life-ledger
 * concern that is also, once promoted, a tracked Project); edges can,
 * without forcing a single canonical home. Inert until a graph-shaped view
 * reads it — see docs/plans/mission-control-view/02-graph-and-3d-vision.md.
 */
export type MissionControlEdgeType = "blocks" | "relates_to" | "same_area" | "depends_on";

export interface MissionControlEdge {
  targetId: string;
  type: MissionControlEdgeType;
  label?: string;
}

/**
 * Drives sort order and the badge shown at the PARENT's zoom level — never
 * rendered as prose itself; `reason` is the human-readable one-liner for
 * that. `score` is the continuous 0..1 value the spatial view maps to
 * distance (see mission-control-math.ts / 03-urgency-and-force-model.md);
 * `level` stays a coarse label derived from it for badges/sort ties, not the
 * spatial input itself — three discrete levels would produce three flat
 * shells rather than a gradient.
 */
export interface UrgencySignal {
  level: UrgencyLevel;
  score: number;
  reason: string;
}

/**
 * What's shown for a node while still zoomed out at its parent level: one
 * line of identity, one line of truth, and enough to sort/badge it. This is
 * the "hierarchical sections" list-row shape.
 */
export interface MissionControlNodeSummary {
  id: string;
  kind: MissionControlNodeKind;
  label: string;
  statusHeadline: string;
  urgency: UrgencySignal;
  /** Absent when the node carries no size. Un-sized nodes render exactly as before. */
  effort?: OrientationEffort;
  /** Absent/0 for a leaf node (nothing further to zoom into). */
  childCount: number;
  updatedAt: string;
  /** Non-hierarchical links to other nodes. Optional, additive, inert today. */
  relations?: MissionControlEdge[];
}

/**
 * A single urgent/important thing this node wants the operator to act on
 * *now* — not a full list of everything, just what earns a place in this
 * node's action-item list. Mirrors the existing DashboardAttentionItem /
 * DashboardAttentionAction shape closely on purpose (same underlying
 * concept, generalized to also cover Life-tower entries).
 */
export interface MissionControlActionItem {
  id: string;
  title: string;
  urgency: UrgencySignal;
  dueAt?: string;
  effort?: OrientationEffort;
  detail?: string;
  primaryAction?: MissionControlActionButton;
  updatedAt: string;
}

export interface MissionControlActionButton {
  label: string;
  kind: "approve" | "reject" | "defer" | "view" | "complete" | "command";
  href?: string;
  command?: string;
}

/**
 * The "add context or ask a question" affordance. One free-text box per
 * node, scoped to that node's own entity — replying about a single ledger
 * entry never has to disambiguate which entry, replying at the Life tower
 * level can add a brand-new entry. `routesTo` is what actually receives the
 * submitted text; it reuses existing capabilities rather than inventing new
 * ones:
 *
 *   life_tower / life_entry -> the real `orientation reply` interpreter
 *     (src/orientation/interpreter.ts), scoped by the reply text alone
 *     today, not yet by entityId (see open question in the companion doc).
 *   project                 -> the real `project reply` interpreter
 *     (src/projects/interpreter.ts) — full parity with Life.
 *   decisions_tower / decision -> "none" for now; Decisions stays
 *     Approve/Reject/Defer only until it earns the same interpreter loop.
 */
export interface MissionControlContextChannel {
  placeholder: string;
  routesTo: {
    feature: "orientation" | "project" | "none";
    entityId: string;
  };
}

/**
 * The full detail for one zoomed-in node: its own status/actions/context,
 * plus one level of children to zoom into next. Children are fetched as
 * MissionControlNodeSummary only — zooming into one of them is a separate
 * request for *its* MissionControlNodeDetail. Lazy, one level at a time.
 */
export interface MissionControlNodeDetail extends MissionControlNodeSummary {
  status: {
    headline: string;
    detail?: string;
  };
  actionItems: MissionControlActionItem[];
  contextChannel: MissionControlContextChannel;
  children: MissionControlNodeSummary[];
  /** Present only for kind === "life_entry". */
  orientationEntry?: MissionControlOrientationEntry;
  /** Present only for kind === "project". Reuses the existing DashboardProject shape (lib/types.ts). */
  project?: import("./types").DashboardProject;
  /** Present only for kind === "decision". Reuses the existing DashboardReviewItem shape (lib/types.ts). */
  decision?: import("./types").DashboardReviewItem;
}

/** Mirrors src/orientation/types.ts's OrientationEntry, plus the derived `stale` flag. */
export interface MissionControlOrientationEntry {
  id: string;
  entryType: string;
  title: string;
  detail: string | null;
  area: string | null;
  priority: string;
  horizon: string;
  dueAt: string | null;
  effort: OrientationEffort | null;
  status: string;
  lastConfirmedAt: string;
  source: string;
  stale: boolean;
}

// ---------------------------------------------------------------------------
// The root screen (replaces /momentum "Today")
// ---------------------------------------------------------------------------

/**
 * The default landing view. `needsYouNow` is a cross-cutting aggregate —
 * the most urgent action items from ANY tower, surfaced once at the very
 * top so the operator never has to open all three towers just to find out
 * what's on fire. `towers` are the top-level zoomable sections underneath.
 */
export interface MissionControlOverview {
  generatedAt: string;
  headline: string;
  needsYouNow: MissionControlActionItem[];
  /** Most recently updated items across every tower — the sidebar's "Recent" section. */
  recentlyUpdated: MissionControlActionItem[];
  towers: MissionControlNodeSummary[];
  /** What the operator said today holds; null until they say something. */
  capacity: DailyCapacity | null;
}

/**
 * The answer to "I have N minutes — what fits?". Produced entirely
 * deterministically by the CLI (a filter over effort, a sort by the existing
 * urgency score) — no model call, so it returns instantly and identically.
 */
export interface MissionControlFits {
  availableMinutes: number;
  items: Array<MissionControlActionItem & { effort: OrientationEffort; effortLabel: string; stale: boolean }>;
  /** Live entries carrying no size yet: why the answer may be thinner than expected. */
  unsizedCount: number;
}

// ---------------------------------------------------------------------------
// Concrete v1 tower identities (the "best guess" starting IA)
// ---------------------------------------------------------------------------

/** Stable top-level node ids — fixed, not data-driven, since there are only three. */
export const MISSION_CONTROL_TOWER_IDS = {
  life: "tower:life",
  projects: "tower:projects",
  decisions: "tower:decisions"
} as const;

export type MissionControlTowerId =
  (typeof MISSION_CONTROL_TOWER_IDS)[keyof typeof MISSION_CONTROL_TOWER_IDS];

// ---------------------------------------------------------------------------
// Camera / navigation state (see 04-camera-and-navigation.md)
// ---------------------------------------------------------------------------

/**
 * "ground" = full leaf-node detail, walking within one lane.
 * "overview" = coarse, aggregate markers across lanes — a higher level of
 * the same node tree, not a different data source.
 */
export type MissionControlAltitude = "ground" | "overview";

/** A position on the ground plane within a lane. Only meaningful at "ground" altitude. */
export interface MissionControlGroundPosition {
  x: number;
  y: number;
}

export interface MissionControlCameraState {
  laneId: MissionControlTowerId;
  altitude: MissionControlAltitude;
  position: MissionControlGroundPosition;
}

/**
 * Shared by every view (graph and list alike — see 05-list-view-parity.md):
 * exactly one current camera state, plus a remembered ground position per
 * lane so re-entering restores where you left off. `rememberedPositionByLane`
 * is a default only — the override rule (land near a newly-more-urgent item
 * instead, when one has appeared since the last visit) is a runtime decision
 * made when descending, not encoded in this state shape itself.
 */
export interface MissionControlViewState {
  current: MissionControlCameraState;
  rememberedPositionByLane: Partial<Record<MissionControlTowerId, MissionControlGroundPosition>>;
}
