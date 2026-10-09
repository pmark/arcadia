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

import type { StepReason } from "./stepReason.js";

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
  /**
   * Where to go to actually try the thing.
   *
   * The Now screen answers "am I closer?" but never answered "what do I open
   * to see it?" Without that, the operator has to remember which of several
   * surfaces is the current one to test — exactly the disorientation the one
   * screen exists to remove. Declared rather than inferred, because only the
   * operator knows which QA surface is the live one this week.
   */
  qaUrl: string | null;
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
  /** Title of the tracked Action; the split parent when `openRemainder` is set. Null when no Action resolves. */
  actionTitle: string | null;
  /** The tracked Action's declared `why`, when its plan wrote one. */
  actionWhy: string | null;
  /** True when the gate's status came from a record rather than the document. */
  derived: boolean;
  /**
   * The first unfinished remainder of a `done` Action that was split. Set only
   * then, and when set `status` is `in_progress` and `nextAction` is the
   * remainder's, because a narrowed Action reads `done` while the rest of the
   * scope it was declared for is still open.
   */
  openRemainder: OpenRemainder | null;
}

export interface OpenRemainder {
  /** The remainder's `doc_ref`, e.g. `plan/slug#action-id`. */
  ref: string;
  /** The remainder's Action id within its plan. */
  actionId: string;
  /** Null when no plan document carries the remainder. */
  workItemId: string | null;
  title: string | null;
  /** The remainder's own work-item status; null when no plan carries it. */
  status: string | null;
  /** The remainder's declared `why`, when its plan wrote one. */
  why: string | null;
}

/**
 * The one thing to do next. Exactly one, always — a screen that offers three
 * choices is a screen that gets closed.
 */
export interface TheOneThing {
  kind: "action" | "decision" | "clarify" | "declare_target" | "target_paused";
  id: string | null;
  title: string;
  /** Verb-first, concrete. This is the sentence rendered largest. */
  doThis: string;
  /** What it moves — named so the effort connects to the target. */
  unlocks: string;
  projectName: string | null;
  onTarget: boolean;
  /**
   * When this names a step (`action`, `clarify`), why that step matters and
   * where its plan declares it. Null for every kind that is not a step.
   */
  step: OneThingStep | null;
}

/** The planned work item a `TheOneThing` names, with the reason it is on the route. */
export interface OneThingStep extends StepReason {
  /** `plan/<slug>#<action-id>`; null only when no plan carries the Action. */
  docRef: string | null;
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
    /** Where to open and actually try it. See `NorthStarDocument.qaUrl`. */
    qaUrl: string | null;
    projectName: string | null;
    /**
     * True when the declared target Project is not active. The screen refuses
     * to select a "do this now" Action from it, because a paused Project
     * receives no dispatch.
     */
    paused: boolean;
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
