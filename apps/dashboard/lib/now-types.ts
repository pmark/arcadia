/**
 * View models for the Now screen. Mirrors `src/northStar/types.ts`, following
 * the same convention as `mission-control-types.ts`: the dashboard is a
 * separate package that talks to Arcadia over the CLI's JSON contract, so it
 * declares the shape of that contract rather than reaching across the
 * repository into the CLI's own source tree.
 */

export type GateStatus = "done" | "in_progress" | "blocked" | "open" | "unknown";
export type DriftLevel = "on_target" | "drifting" | "off_target" | "unknown";

export interface ResolvedGate {
  id: string;
  title: string;
  actionRef: string | null;
  declaredStatus: GateStatus | null;
  status: GateStatus;
  workItemId: string | null;
  nextAction: string | null;
  clarification: string | null;
  derived: boolean;
}

export interface TheOneThing {
  kind: "action" | "decision" | "clarify" | "declare_target";
  id: string | null;
  title: string;
  doThis: string;
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
  distance: { total: number; done: number; remaining: number; fraction: number };
  gates: ResolvedGate[];
  theOneThing: TheOneThing;
  fifteenMinutes: TheOneThing | null;
  attention: {
    windowDays: number;
    slices: AttentionSlice[];
    targetShare: number;
    totalCommits: number;
    daysSinceTargetCommit: number | null;
  };
  owed: { onTarget: Array<{ slug: string; question: string }>; elsewhere: number };
  drift: { level: DriftLevel; line: string };
  reality: { headline: string; paragraph: string } | null;
  warnings: string[];
}
