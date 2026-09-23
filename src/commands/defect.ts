import { readFileSync } from "node:fs";
import path from "node:path";
import { validationError, projectNotFound } from "../cli/errors.js";
import { enclosingProjectRoot, invocationRoot } from "../cli/invocation.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase, writeTransaction } from "../db/connection.js";
import {
  createDefectSignal,
  getDefectSignal,
  getProject,
  getProjectBySlug,
  listDefectSignals
} from "../db/repositories.js";
import type { DefectSignalSummary } from "../domain/types.js";
import { parseDoc } from "../docs/parse.js";
import { summarySimilarity, LIKELY_DUPLICATE_THRESHOLD } from "../defect/signal.js";
import { tryGit } from "../git/worktrees.js";

/**
 * The one-line defect intake Decision 0049 approved.
 *
 * The whole point is that filing a defect is cheaper than deciding to file one:
 * one argument, no governance ceremony, and no model call. Classification is
 * deterministic — a report filed here is a `BugReport` — and the durable record
 * is a Back Burner item, so the defect lands on a surface every other command
 * already knows how to read. Everything triage needs later (the fingerprint
 * that makes a retry idempotent, the repository revision, the reporter's
 * evidence) is captured now, at zero token cost.
 */
export interface DefectIntakeOptions {
  workspace: string;
  summary: string;
  project?: string;
  source?: string;
  evidence?: string[];
  revision?: string;
}

export interface DefectListOptions {
  workspace: string;
  project?: string;
}

export interface DefectShowOptions {
  workspace: string;
  id: string;
}

export interface DefectDuplicateCandidate {
  id: string;
  summary: string;
  project_name: string | null;
}

export interface DefectIntakeData {
  signal: DefectSignalSummary;
  /** False when an exact retry resolved to the record already filed. */
  created: boolean;
  duplicateCandidates: DefectDuplicateCandidate[];
}

export interface DefectListData {
  count: number;
  signals: DefectSignalSummary[];
}

export interface DefectShowData {
  signal: DefectSignalSummary;
}

export function runDefectIntakeCommand(options: DefectIntakeOptions): CommandSuccess<DefectIntakeData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const result = withDatabase(workspacePath, (db) =>
    writeTransaction(db, () => {
      const projectId = resolveProjectId(db, options.project);
      const source = options.source?.trim() || "cli.defect";
      const recorded = createDefectSignal(db, {
        summary: options.summary,
        source,
        projectId,
        repositoryRevision: options.revision ?? captureRepositoryRevision(),
        evidence: options.evidence ?? []
      });
      return {
        ...recorded,
        duplicateCandidates: findLikelyDuplicates(db, recorded.signal)
      };
    })
  );

  return createSuccess({
    command: "defect.record",
    workspace: workspacePath,
    data: {
      signal: result.signal,
      created: result.created,
      duplicateCandidates: result.duplicateCandidates
    }
  });
}

export function runDefectListCommand(options: DefectListOptions): CommandSuccess<DefectListData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const signals = withDatabase(workspacePath, (db) => {
    const projectId = options.project ? resolveProjectId(db, options.project) : undefined;
    return listDefectSignals(db, { project: projectId ?? undefined });
  });

  return createSuccess({
    command: "defect.list",
    workspace: workspacePath,
    data: { count: signals.length, signals }
  });
}

export function runDefectShowCommand(options: DefectShowOptions): CommandSuccess<DefectShowData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const signal = withDatabase(workspacePath, (db) => getDefectSignal(db, options.id));
  if (!signal) {
    throw validationError("Defect signal was not found.", { id: options.id });
  }

  return createSuccess({
    command: "defect.show",
    workspace: workspacePath,
    data: { signal }
  });
}

export function renderDefectIntakeSuccess(response: CommandSuccess<DefectIntakeData>): string[] {
  const { signal, created, duplicateCandidates } = response.data;
  const lines = [
    created ? "Arcadia defect recorded." : "Arcadia defect already recorded — evidence merged.",
    `ID: ${signal.id}`,
    `Summary: ${signal.summary}`,
    `Project: ${signal.project_name ?? "Unscoped"}`,
    `Source: ${signal.source}`,
    `Revision: ${signal.repository_revision ?? "unavailable"}`,
    `Evidence: ${signal.evidence.length} item(s)`,
    `Recorded: ${signal.created_at}`
  ];
  if (duplicateCandidates.length > 0) {
    lines.push("Likely duplicates (kept as distinct reports):");
    for (const candidate of duplicateCandidates) {
      lines.push(`- ${candidate.id}: ${candidate.summary}${candidate.project_name ? ` (${candidate.project_name})` : ""}`);
    }
  }
  return lines;
}

export function renderDefectListSuccess(response: CommandSuccess<DefectListData>): string[] {
  const lines = ["Arcadia defect signals", `Signals: ${response.data.count}`];
  if (response.data.signals.length === 0) {
    lines.push("None");
    return lines;
  }
  for (const signal of response.data.signals) {
    lines.push(`- ${signal.id}: ${signal.summary}`);
    lines.push(`  Project: ${signal.project_name ?? "Unscoped"} · Source: ${signal.source}`);
    lines.push(`  Revision: ${signal.repository_revision ?? "unavailable"} · Recorded: ${signal.created_at}`);
    if (signal.evidence.length > 0) {
      lines.push(`  Evidence: ${signal.evidence.join(" | ")}`);
    }
  }
  return lines;
}

export function renderDefectShowSuccess(response: CommandSuccess<DefectShowData>): string[] {
  const signal = response.data.signal;
  const lines = [
    "Arcadia defect signal",
    `ID: ${signal.id}`,
    `Summary: ${signal.summary}`,
    `Project: ${signal.project_name ?? "Unscoped"}`,
    `Source: ${signal.source}`,
    `Fingerprint: ${signal.fingerprint}`,
    `Revision: ${signal.repository_revision ?? "unavailable"}`,
    `Back Burner item: ${signal.back_burner_item_id}`,
    `Recorded: ${signal.created_at}`,
    `Updated: ${signal.updated_at}`,
    "Evidence:"
  ];
  lines.push(...(signal.evidence.length > 0 ? signal.evidence.map((entry) => `- ${entry}`) : ["None"]));
  return lines;
}

/**
 * Resolve the Project a report belongs to: the operator's explicit choice, or
 * the managed Project whose `PROJECT.md` encloses the invocation. Resolution is
 * by slug rather than by repository path so a report filed from an agent
 * worktree — a different path from the main checkout — still lands on the right
 * Project.
 *
 * Only the enclosing `PROJECT.md` is read. A full-tree document scan could pick
 * a nested Project doc instead of the enclosing one, and the Project is part of
 * the report's fingerprint, so the wrong choice would silently change both its
 * scope and its retry identity.
 */
function resolveProjectId(db: Parameters<typeof getProject>[0], project: string | undefined): string | null {
  if (project?.trim()) {
    const resolved = getProject(db, project) ?? getProjectBySlug(db, project);
    if (!resolved) throw projectNotFound(project);
    return resolved.id;
  }
  const root = enclosingProjectRoot();
  if (!root) return null;
  const projectFile = path.join(root, "PROJECT.md");
  try {
    const { doc } = parseDoc("PROJECT.md", projectFile, readFileSync(projectFile, "utf8"));
    return doc?.type === "project" ? getProjectBySlug(db, doc.slug)?.id ?? null : null;
  } catch {
    return null;
  }
}

/** The revision the report was filed against, when the invocation is in Git. */
function captureRepositoryRevision(): string | null {
  return tryGit(invocationRoot(), ["rev-parse", "HEAD"])?.trim() || null;
}

/**
 * Reports whose summaries share most of their significant words. A candidate is
 * shown to the reporter; it is never an automatic merge, because a distinct
 * report that reads like an earlier one is still a distinct report.
 */
function findLikelyDuplicates(
  db: Parameters<typeof listDefectSignals>[0],
  signal: DefectSignalSummary
): DefectDuplicateCandidate[] {
  return listDefectSignals(db)
    .filter((candidate) => candidate.id !== signal.id)
    .map((candidate) => ({ candidate, score: summarySimilarity(signal.summary, candidate.summary) }))
    .filter((entry) => entry.score >= LIKELY_DUPLICATE_THRESHOLD)
    .sort((left, right) => right.score - left.score)
    .map(({ candidate }) => ({
      id: candidate.id,
      summary: candidate.summary,
      project_name: candidate.project_name
    }));
}
