import type { Artifact } from "../domain/types.js";

export const DIGEST_PERIODS = ["day", "week", "month"] as const;
export type DigestPeriod = (typeof DIGEST_PERIODS)[number];

export interface DigestWindow {
  period: DigestPeriod;
  /** Inclusive ISO-8601 instant. */
  start: string;
  /** Exclusive ISO-8601 instant. */
  end: string;
}

export const DIGEST_SCOPES = ["project", "portfolio"] as const;
export type DigestScope = (typeof DIGEST_SCOPES)[number];

/** The deduplication identity of the collective roll-up, which has no Project. */
export const PORTFOLIO_SCOPE_KEY = "portfolio";

/** The subject a digest narrates: one Project, or the portfolio as a whole. */
export interface DigestSubject {
  scope: DigestScope;
  /** Unique per subject: the Project id, or PORTFOLIO_SCOPE_KEY. */
  scopeKey: string;
  /** Null for the portfolio roll-up. */
  projectId: string | null;
  name: string;
  slug: string;
}

export type DigestFactKind = "mission_log" | "dispatch" | "decision" | "completed_action" | "merged";

export interface DigestFact {
  id: string;
  kind: DigestFactKind;
  occurredAt: string;
  summary: string;
  detail: Record<string, string | number | boolean | null>;
}

/** What the summarizer returns: 1-3 plain sentences built only from the computed facts. */
export interface DigestNarration {
  summary: string;
  jobId: string | null;
}

/**
 * Writes the digest's headline. It receives only the facts the report already
 * computed (`DigestSummaryFacts`), never the raw activity records, so it has
 * nothing to restate except what the deterministic sections also show.
 */
export type DigestNarrator = (input: {
  subject: DigestSubject;
  window: DigestWindow;
  facts: DigestSummaryFacts;
}) => Promise<DigestNarration>;

/** One goal's progress: a Milestone and the Actions recorded against it. */
export interface DigestGoalProgress {
  milestoneId: string;
  title: string;
  project: string;
  projectSlug: string;
  /** `plan/<slug>` when the Milestone names its Plan, else null. */
  plan: string | null;
  status: "active" | "paused" | "completed";
  done: number;
  total: number;
  completedInWindow: number;
  mergedInWindow: number;
  /** The Milestone reached completed status inside the window. */
  reachedInWindow: boolean;
  /** Actions done per day over the pace lookback, or null when too few records support a pace. */
  pacePerDay: number | null;
  paceLookbackDays: number;
  /** Rough days left at that pace; null whenever pacePerDay is null or nothing remains. */
  daysLeftAtPace: number | null;
  /** Latest recorded completion on this goal, inside or before the window. */
  lastCompletedAt: string | null;
}

/** One operator item, ranked: what to do, where, and what waiting costs. */
export interface DigestNeedsYouItem {
  key: string;
  kind: string;
  project: string;
  title: string;
  /** The existing command that answers it. */
  action: string;
  /** Dashboard deep link, or null when no dashboard URL is configured. */
  link: string | null;
  consequence: string;
  /** Production is stopped on this item (an escalation). */
  stopped: boolean;
  createdAt: string;
}

export interface DigestNeedsYou {
  items: DigestNeedsYouItem[];
  /** Why the operator to-do could not be read; null when it was. */
  unavailable: string | null;
  /** The to-do list link, when a dashboard URL is configured. */
  listLink: string | null;
}

export interface DigestActivityShare {
  area: string;
  events: number;
  /** Whole-number share of all in-window events, 0-100. */
  percent: number;
  completed: number;
  merged: number;
}

export interface DigestRisk {
  kind: "red_alert" | "stopped_on_operator" | "stalled_goal" | "refused_dispatch";
  text: string;
}

/** One time the operator had to act. */
export interface DigestOperatorInteraction {
  at: string;
  source: "card_press" | "production_off" | "recorded";
  project: string | null;
  /** What the operator did, or their exact words for a recorded interaction. */
  what: string;
  unlocked: string;
  /** required: only the operator's authority could do it. avoidable: the system could have done without it. */
  necessity: "required" | "avoidable";
  ref: string | null;
  waitedMinutes: number | null;
}

export interface DigestOperatorInteractions {
  count: number;
  required: number;
  avoidable: number;
  /** Interactions per merged Action in the window; null when nothing merged. */
  perMerged: number | null;
  /** Minutes work waited on the operator (recorded waits plus Actions stopped on them). */
  waitedMinutes: number;
  items: DigestOperatorInteraction[];
  limitations: string[];
}

/** Everything the digest shows, computed deterministically from records. */
export interface DigestReport {
  subject: DigestSubject;
  window: DigestWindow;
  totals: {
    events: number;
    completed: number;
    merged: number;
    decisions: number;
    goalsReached: number;
  };
  /** Goals that moved in the window, most progress first. */
  goals: DigestGoalProgress[];
  /** Active goals with remaining work that did not move. */
  quietActiveGoals: number;
  needsYou: DigestNeedsYou;
  operatorInteractions: DigestOperatorInteractions;
  activity: DigestActivityShare[];
  risks: DigestRisk[];
}

/**
 * The exact, bounded input the AI summary sees: numbers and names the report
 * computed, and nothing else. No raw Log text, no Decision bodies.
 */
export interface DigestSummaryFacts {
  subject: string;
  scope: DigestScope;
  period: DigestPeriod;
  windowLabel: string;
  totals: DigestReport["totals"];
  goals: Array<{
    goal: string;
    project: string;
    done: number;
    total: number;
    completedInWindow: number;
    mergedInWindow: number;
    reached: boolean;
    daysLeftAtPace: number | null;
  }>;
  quietActiveGoals: number;
  needsYou: { count: number; stopped: number; top: string[]; unavailable: boolean };
  operatorInteractions: { count: number; required: number; avoidable: number; perMergedAction: number | null; waitedMinutes: number };
  activity: Array<{ area: string; percent: number }>;
  risks: string[];
}

/** Where the headline came from, so the page can label it truthfully. */
export interface DigestSummary {
  text: string;
  source: "ai" | "deterministic";
  /** Why the AI summary was not used; null when it was, or when none was attempted. */
  fallbackReason: string | null;
  jobId: string | null;
}

export interface NarrativeDigestRecord {
  id: string;
  scope: DigestScope;
  scope_key: string;
  project_id: string | null;
  artifact_id: string;
  period: DigestPeriod;
  window_start: string;
  window_end: string;
  intelligence_job_id: string | null;
  facts_json: string;
  posted_message_id: string | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ComposedProjectDigest {
  digest: NarrativeDigestRecord;
  artifact: Artifact;
  facts: DigestFact[];
  /** The rendered report sections (no header or footer). */
  narrative: string;
  report: DigestReport;
  summary: DigestSummary;
  created: boolean;
}
