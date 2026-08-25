/**
 * Mirrors `src/northStar/path.ts`. The dashboard shells out to the CLI, so
 * these are the wire shapes of `arcadia path --json`, not a second model.
 */
import type { GateStatus } from "./now-types";

export type PathStepState = "done" | "in_progress" | "blocked" | "planned";

export type PathGapReason = "operator_owned" | "missing_action" | "undefined_next_move" | "no_declared_work";

export interface PathStep {
  kind: "action";
  workItemId: string;
  docRef: string | null;
  title: string;
  state: PathStepState;
  nextAction: string | null;
  clarification: string | null;
  responsibility: string | null;
  projectName: string | null;
  depth: number;
}

export interface PathGap {
  kind: "gap";
  reason: PathGapReason;
  detail: string;
  /** Set only for `undefined_next_move`: the Action a resolution screen needs. */
  workItemId?: string;
}

export type PathNode = PathStep | PathGap;

export interface PathLeg {
  gateId: string;
  gateTitle: string;
  gateStatus: GateStatus;
  actionRef: string | null;
  derived: boolean;
  nodes: PathNode[];
  done: number;
  remaining: number;
}

export interface PathBrief {
  generatedAt: string;
  target: {
    declared: boolean;
    text: string;
    looksLike: string;
    projectSlug: string | null;
    documentPath: string | null;
  };
  legs: PathLeg[];
  totals: { gates: number; gatesDone: number; steps: number; stepsDone: number; remaining: number; gaps: number };
  warnings: string[];
}
