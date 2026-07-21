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
 * Drives sort order and the badge shown at the PARENT's zoom level — never
 * rendered as prose itself; `reason` is the human-readable one-liner for
 * that.
 */
export interface UrgencySignal {
  level: UrgencyLevel;
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
  /** Absent/0 for a leaf node (nothing further to zoom into). */
  childCount: number;
  updatedAt: string;
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
  detail?: string;
  primaryAction?: MissionControlActionButton;
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
 *   life_tower / life_area / life_entry -> the existing
 *     `orientation reply` interpreter (src/orientation/interpreter.ts),
 *     scoped by the reply text alone today; a specific `entityId` here is
 *     forward-looking (see open question in the companion doc).
 *   project / decision                 -> existing `ask` / review
 *     approve|reject|defer commands.
 */
export interface MissionControlContextChannel {
  placeholder: string;
  routesTo: {
    feature: "orientation" | "ask" | "review";
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
  towers: MissionControlNodeSummary[];
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
