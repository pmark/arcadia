import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ProofEnvironment = "Stable" | "Candidate";
export type ProofEnvironmentKind = "local" | "lan" | "remote" | "missing";
export type ProofAccessState = "public" | "access-protected" | "local-only" | "unknown";

export interface ProofTargetConfig {
  id: string;
  project: string;
  environment: ProofEnvironment;
  label: string;
  url: string;
  environmentKind: ProofEnvironmentKind;
  accessState: ProofAccessState;
  sourceRevision: string | null;
}

interface ProofTargetFile {
  targets: ProofTargetConfig[];
}

const CONFIG_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../config/proof-targets.json");

export function loadProofTargets(): ProofTargetConfig[] {
  const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as ProofTargetFile;
  if (!Array.isArray(parsed.targets)) {
    throw new Error("Proof target configuration must contain a targets array.");
  }
  return parsed.targets;
}

export function loadProofTargetsForProject(projectSlug: string): ProofTargetConfig[] {
  return loadProofTargets().filter((target) => target.project === projectSlug);
}

export function getProofTargetById(id: string): ProofTargetConfig | null {
  return loadProofTargets().find((target) => target.id === id) ?? null;
}
