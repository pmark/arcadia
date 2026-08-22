/**
 * The North Star: the single dominant objective the whole portfolio is
 * currently serving, and the measured distance between it and today.
 *
 * Arcadia already knows what is ready, what is blocked, and what changed.
 * What it could not say — and what the operator actually asks every morning —
 * is "am I closer to the one thing that matters, or did I spend the week
 * somewhere else?" That question needs a declared finish line, because
 * distance is undefined without one. Private Practice Now carries nine
 * simultaneously-active Milestones; no ranking heuristic can turn that into a
 * countdown. So the finish line is declared, once, in a document the operator
 * owns, and every number on the Now screen is derived from it.
 */

export type GateStatus = "done" | "in_progress" | "blocked" | "open" | "unknown";

/**
 * One thing that must become true before the target is reached.
 *
 * A gate either tracks a real Action (`actionRef`, matched against
 * `work_items.doc_ref`) and derives its status from the database, or it is
 * operator-owned and carries a declared status. Deriving matters more than it
 * looks: a hand-maintained checklist decays into a lie within two weeks, and a
 * countdown the operator has learned to distrust is worse than no countdown.
 */
export interface NorthStarGate {
  id: string;
  title: string;
  /** `work_items.doc_ref` this gate tracks, when a real Action carries it. */
  actionRef: string | null;
  /** Declared status, used only when no `actionRef` resolves. */
  declaredStatus: GateStatus | null;
}

export interface NorthStarDocument {
  /** The objective, in the operator's own words. Short enough to shout. */
  target: string;
  /** Slug of the Project that owns the target. Drives the drift measurement. */
  projectSlug: string;
  /** Why this outranks everything else right now. One sentence. */
  why: string;
  /** The observable finish line — how the operator will know it is done. */
  looksLike: string;
  gates: NorthStarGate[];
  updated: string | null;
  /** Absolute path the document was read from. */
  path: string;
}

/** A gate after the database has been consulted. */
export interface ResolvedGate extends NorthStarGate {
  status: GateStatus;
  /** Resolved from the tracked Action, when there is one. */
  workItemId: string | null;
  nextAction: string | null;
  clarification: string | null;
  /** True when the gate's status came from a record rather than the document. */
  derived: boolean;
}

/**
 * The one thing to do next. Exactly one, always — a screen that offers three
 * choices is a screen that gets closed.
 */
export interface TheOneThing {
  kind: "action" | "decision" | "clarify" | "declare_target";
  id: string | null;
  title: string;
  /** Verb-first, concrete. This is the sentence rendered largest. */
  doThis: string;
  /** What it moves — named so the effort connects to the target. */
  unlocks: string;
  projectName: string | null;
  onTarget: boolean;
}

export interface AttentionSlice {
  projectName: string;
  projectSlug: string | null;
  commits: number;
  share: number;
  isTarget: boolean;
}

export type DriftLevel = "on_target" | "drifting" | "off_target" | "unknown";

export interface NowBrief {
  generatedAt: string;
  target: {
    declared: boolean;
    text: string;
    why: string;
    looksLike: string;
    projectName: string | null;
    documentPath: string | null;
  };
  distance: {
    total: number;
    done: number;
    remaining: number;
    /** 0..1. Endowed progress: never rendered as an empty bar when work exists. */
    fraction: number;
  };
  gates: ResolvedGate[];
  theOneThing: TheOneThing;
  /** The structured-procrastination hatch: still on target, small enough to say yes to. */
  fifteenMinutes: TheOneThing | null;
  attention: {
    windowDays: number;
    slices: AttentionSlice[];
    targetShare: number;
    totalCommits: number;
    daysSinceTargetCommit: number | null;
  };
  owed: {
    onTarget: Array<{ slug: string; question: string }>;
    elsewhere: number;
  };
  drift: {
    level: DriftLevel;
    line: string;
  };
  /** Written by local Intelligence when available; null is a supported state. */
  reality: { headline: string; paragraph: string } | null;
  warnings: string[];
}
