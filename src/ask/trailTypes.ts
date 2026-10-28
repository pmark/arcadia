import type { RunEvidence } from "../commands/runEvidence.js";
import type { DirectionView } from "./directionTypes.js";

export interface AskTrailOptions {
  workspace: string;
  id: string;
}

export interface AskTrailCapture {
  id: string;
  requestId: string;
  originalText: string;
  ingressSource: string;
  capturedAt: string;
  status: string;
  relatedReviewId: string | null;
  outcomes: AskTrailOutcome[];
}

export interface AskTrailOutcome {
  kind: "action" | "plan" | "decision" | "back_burner_item" | "run" | "approval_claim";
  id: string;
  status: string | null;
  summary: string | null;
  projectName: string | null;
  /** Set when an `ask correct` replaced this record: the Ask that replaced it and the record it created. */
  supersededBy?: { askId: string; recordId: string | null } | null;
}

/** One `arcadia ask correct` link, as the trail shows it. */
export interface AskTrailSupersession {
  /** The Ask that was replaced (for `supersededBy`) or the Ask that replaced this one (for `supersedes`). */
  askId: string;
  targetType: string;
  record: { kind: string; id: string | null };
  oldRecord: { kind: string; id: string | null; disposition: string };
  source: string;
  actor: string | null;
  at: string;
}

export interface AskTrailAsk {
  id: string;
  resolvedIntent: string;
  outputKind: string;
  status: string;
  createdAt: string;
  executionPath: string | null;
  reason: string | null;
  projectName: string | null;
  outcomes: AskTrailOutcome[];
  /** Every Run correlated through this Ask's captured Action or Review, including terminal evidence. */
  runs: RunEvidence[];
  /** Corrections that replaced this Ask, oldest first. Empty for an Ask nobody corrected. */
  supersededBy: AskTrailSupersession[];
  /** The correction that created this Ask, when it is itself a replacement. */
  supersedes: AskTrailSupersession | null;
}

export interface AskTrailData {
  capture: AskTrailCapture | null;
  asks: AskTrailAsk[];
  direction?: DirectionView;
}
