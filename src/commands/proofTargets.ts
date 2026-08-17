import type Database from "better-sqlite3";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  getLatestProofTargetCheck,
  getProject,
  getProjectBySlug,
  listLatestProofTargetChecksForProject,
  listReviewItems,
  recordProofTargetCheck,
  type ProofTargetCheck
} from "../db/repositories.js";
import type { Project } from "../domain/types.js";
import { performProofCheck, type ProofCheckResult } from "../proofTargets/check.js";
import { resolveProofHeroState, type ProofHeroResolution, type ProofQaDecision } from "../proofTargets/hero.js";
import { getProofTargetById, loadProofTargetsForProject, type ProofTargetConfig } from "../proofTargets/targets.js";

export interface ProofTargetView {
  target: ProofTargetConfig;
  lastCheck: ProofTargetCheck | null;
}

export interface ProofTargetListCommandData {
  project: { id: string; slug: string; name: string };
  targets: ProofTargetView[];
  hero: ProofHeroResolution;
}

export interface ProofTargetCheckCommandData {
  project: { id: string; slug: string; name: string };
  target: ProofTargetConfig;
  check: ProofTargetCheck;
  hero: ProofHeroResolution;
}

function resolveProject(db: Database.Database, projectIdOrSlug: string): Project {
  const project = getProject(db, projectIdOrSlug) ?? getProjectBySlug(db, projectIdOrSlug);
  if (!project) {
    throw validationError("Project was not found.", { project: projectIdOrSlug });
  }
  return project;
}

function getLatestQaDecisionForCandidate(db: Database.Database, candidateId: string): ProofQaDecision {
  const matches = listReviewItems(db, "all")
    .filter((item) => item.resolved_intent === "CandidateQaSignoff")
    .filter((item) => {
      try {
        const context = JSON.parse(item.context_json) as { candidateId?: unknown };
        return context.candidateId === candidateId;
      } catch {
        return false;
      }
    })
    .sort((a, b) => (b.decided_at ?? b.updated_at).localeCompare(a.decided_at ?? a.updated_at));

  const latest = matches[0];
  if (!latest) return null;

  try {
    const context = JSON.parse(latest.context_json) as { decision?: unknown };
    if (context.decision === "pass" || context.decision === "fail" || context.decision === "needs-follow-up") {
      return context.decision;
    }
  } catch {
    // Malformed context is treated as no recorded decision rather than a crash.
  }
  return null;
}

function buildHero(
  db: Database.Database,
  targets: ProofTargetConfig[],
  checksByTarget: Map<string, ProofTargetCheck>
): ProofHeroResolution {
  const stable = targets.find((target) => target.environment === "Stable") ?? null;
  const candidate = targets.find((target) => target.environment === "Candidate") ?? null;
  return resolveProofHeroState({
    stable,
    candidate,
    stableCheck: stable ? (checksByTarget.get(stable.id) ?? null) : null,
    candidateCheck: candidate ? (checksByTarget.get(candidate.id) ?? null) : null,
    candidateQaDecision: candidate ? getLatestQaDecisionForCandidate(db, candidate.id) : null
  });
}

export function runProofTargetListCommand(options: { workspace: string; project: string }): CommandSuccess<ProofTargetListCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  return withDatabase(workspacePath, (db) => {
    const project = resolveProject(db, options.project);
    const targets = loadProofTargetsForProject(project.slug);
    const checks = listLatestProofTargetChecksForProject(db, project.id);
    const checksByTarget = new Map(checks.map((check) => [check.target_id, check]));

    return createSuccess({
      command: "proof-target.list",
      workspace: workspacePath,
      data: {
        project: { id: project.id, slug: project.slug, name: project.name },
        targets: targets.map((target) => ({ target, lastCheck: checksByTarget.get(target.id) ?? null })),
        hero: buildHero(db, targets, checksByTarget)
      }
    });
  });
}

export async function runProofTargetCheckCommand(
  options: { workspace: string; targetId: string },
  dependencies: { performCheck?: (url: string) => Promise<ProofCheckResult> } = {}
): Promise<CommandSuccess<ProofTargetCheckCommandData>> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const target = getProofTargetById(options.targetId);
  if (!target) {
    throw validationError("Proof target was not found in checked-in configuration.", { targetId: options.targetId });
  }

  const result = await (dependencies.performCheck ?? performProofCheck)(target.url);

  return withDatabase(workspacePath, (db) => {
    const project = resolveProject(db, target.project);
    const check = recordProofTargetCheck(db, {
      targetId: target.id,
      projectId: project.id,
      url: target.url,
      healthState: result.healthState,
      httpStatus: result.httpStatus,
      latencyMs: result.latencyMs,
      errorMessage: result.errorMessage
    });

    const siblings = loadProofTargetsForProject(project.slug);
    const checks = listLatestProofTargetChecksForProject(db, project.id);
    const checksByTarget = new Map(checks.map((entry) => [entry.target_id, entry]));

    return createSuccess({
      command: "proof-target.check",
      workspace: workspacePath,
      data: {
        project: { id: project.id, slug: project.slug, name: project.name },
        target,
        check,
        hero: buildHero(db, siblings, checksByTarget)
      }
    });
  });
}

export function renderProofTargetListSuccess(response: CommandSuccess<ProofTargetListCommandData>): string[] {
  return [
    `${response.data.hero.state}: ${response.data.hero.headline}`,
    ...response.data.targets.map(
      (view) =>
        `${view.target.environment} · ${view.target.label} — ${view.lastCheck ? view.lastCheck.health_state : "never checked"}`
    )
  ];
}

export function renderProofTargetCheckSuccess(response: CommandSuccess<ProofTargetCheckCommandData>): string[] {
  return [`${response.data.target.label}: ${response.data.check.health_state} (${response.data.check.checked_at})`];
}
