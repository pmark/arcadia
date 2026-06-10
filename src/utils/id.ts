import { randomUUID } from "node:crypto";

const PREFIXES = {
  project: "proj",
  milestone: "ms",
  workItem: "work",
  missionLog: "log",
  artifact: "art"
} as const;

export type IdKind = keyof typeof PREFIXES;

export function createId(kind: IdKind): string {
  return `${PREFIXES[kind]}_${randomUUID().replaceAll("-", "").slice(0, 18)}`;
}
