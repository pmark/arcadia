import { loadQaTargetsFile } from "../qa/targets.js";

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

/**
 * Proof targets are a projection of the QA target list, not a second list.
 *
 * These were two config files holding the same URLs — `proof-targets.json` and
 * `qa-candidates.json` — with nothing keeping them in step. Both drifted, and
 * proof-targets drifted furthest: it still named a Copy Studio milestone three
 * weeks after that milestone ended. One list, two views.
 *
 * `sourceRevision` is always null here. It used to be a hand-typed string;
 * the real revision is now computed from the project's checkout by
 * `repoFreshness`, and a second, staler copy of it would be a lie waiting to
 * happen.
 */
export function loadProofTargets(workspacePath?: string): ProofTargetConfig[] {
  return loadQaTargetsFile(workspacePath).targets.map((target) => ({
    id: target.id,
    project: target.project,
    environment: target.environment,
    label: target.label,
    url: target.url,
    environmentKind: target.environmentKind,
    accessState: target.accessState,
    sourceRevision: null
  }));
}

export function loadProofTargetsForProject(projectSlug: string, workspacePath?: string): ProofTargetConfig[] {
  return loadProofTargets(workspacePath).filter((target) => target.project === projectSlug);
}

export function getProofTargetById(id: string, workspacePath?: string): ProofTargetConfig | null {
  return loadProofTargets(workspacePath).find((target) => target.id === id) ?? null;
}
