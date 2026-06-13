import { randomUUID } from "node:crypto";

const PREFIXES = {
  project: "proj",
  milestone: "ms",
  workItem: "work",
  missionLog: "log",
  artifact: "art",
  skill: "skill",
  executionPlan: "plan",
  executionStep: "step",
  executionRun: "run",
  executionRunStep: "rstep",
  runArtifact: "rart",
  askRequest: "ask",
  reviewItem: "review",
  reviewFeedback: "rfb",
  backBurnerItem: "bb",
  approvalGate: "gate",
  codexInvocation: "codex",
  codexTask: "ctask"
} as const;

export type IdKind = keyof typeof PREFIXES;

export function createId(kind: IdKind): string {
  return `${PREFIXES[kind]}_${randomUUID().replaceAll("-", "").slice(0, 18)}`;
}
