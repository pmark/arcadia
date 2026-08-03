import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import {
  narrativeDigestInvalidResult,
  narrativeDigestUnavailable,
  projectNotFound,
  validationError
} from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { openDatabase } from "../db/connection.js";
import { getArtifact, getProject, getProjectBySlug } from "../db/repositories.js";
import {
  composeProjectDigest,
  createIntelligenceDigestNarrator,
  NarrativeDigestInvalidResultError,
  NarrativeDigestUnavailableError
} from "../digests/composer.js";
import { exportNarrativeDigest, type MemorySyncEntry } from "../memory/obsidian.js";
import {
  DIGEST_PERIODS,
  type ComposedProjectDigest,
  type DigestNarrator,
  type DigestPeriod,
  type NarrativeDigestRecord
} from "../digests/types.js";

export interface DigestComposeOptions {
  workspace: string;
  project: string;
  period: string;
  from: string;
  to: string;
  narrator?: DigestNarrator;
}

export interface DigestExportOptions {
  workspace: string;
  digestId: string;
}

export interface DigestExportData {
  digest: NarrativeDigestRecord;
  artifactId: string;
  memory: MemorySyncEntry | null;
}

export async function runDigestComposeCommand(
  options: DigestComposeOptions
): Promise<CommandSuccess<ComposedProjectDigest>> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const period = normalizePeriod(options.period);
  const start = normalizeInstant(options.from, "from");
  const end = normalizeInstant(options.to, "to");
  if (start >= end) {
    throw validationError("Digest --from must be before --to.", { from: options.from, to: options.to });
  }

  const db = openDatabase(workspacePath);
  try {
    const project = getProject(db, options.project) ?? getProjectBySlug(db, options.project);
    if (!project) throw projectNotFound(options.project);
    let result: ComposedProjectDigest;
    try {
      result = await composeProjectDigest({
        db,
        workspacePath,
        project,
        window: { period, start, end },
        narrator: options.narrator ?? createIntelligenceDigestNarrator(db, workspacePath)
      });
    } catch (error) {
      if (error instanceof NarrativeDigestUnavailableError) throw narrativeDigestUnavailable(error.message);
      if (error instanceof NarrativeDigestInvalidResultError) throw narrativeDigestInvalidResult(error.message);
      throw error;
    }
    return createSuccess({
      command: "digest.compose",
      workspace: workspacePath,
      data: result,
      artifacts: [result.artifact.id]
    });
  } finally {
    db.close();
  }
}

export function renderDigestComposeSuccess(
  response: CommandSuccess<ComposedProjectDigest>
): string[] {
  const { digest, artifact, facts, created } = response.data;
  return [
    `${created ? "Created" : "Updated"} ${artifact.title}.`,
    `Window: ${digest.window_start} ≤ activity < ${digest.window_end}`,
    `Facts: ${facts.length}`,
    `Artifact: ${artifact.id}${artifact.path ? ` (${artifact.path})` : ""}`
  ];
}

export function runDigestExportCommand(options: DigestExportOptions): CommandSuccess<DigestExportData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const digest = (db.prepare("SELECT * FROM narrative_digests WHERE id = ?").get(options.digestId) as NarrativeDigestRecord | undefined) ?? null;
    if (!digest) throw validationError("Narrative digest was not found.", { digestId: options.digestId });
    const artifact = getArtifact(db, digest.artifact_id);
    if (!artifact) throw validationError("Narrative digest is missing its Artifact.", { digestId: digest.id, artifactId: digest.artifact_id });
    const project = getProject(db, digest.project_id);
    if (!project) throw validationError("Narrative digest is missing its Project.", { digestId: digest.id, projectId: digest.project_id });
    if (artifact.project_id !== project.id || artifact.artifact_type !== "narrative_digest") {
      throw validationError("Narrative digest links inconsistent Project or Artifact data.", {
        digestId: digest.id,
        projectId: project.id,
        artifactId: artifact.id,
        artifactProjectId: artifact.project_id,
        artifactType: artifact.artifact_type
      });
    }
    const memory = exportNarrativeDigest(workspacePath, {
      digest: {
        id: digest.id,
        period: digest.period,
        windowStart: digest.window_start,
        windowEnd: digest.window_end
      },
      artifact,
      project
    });
    return createSuccess({
      command: "digest.export",
      workspace: workspacePath,
      data: { digest, artifactId: artifact.id, memory },
      artifacts: [artifact.id]
    });
  } finally {
    db.close();
  }
}

export function renderDigestExportSuccess(response: CommandSuccess<DigestExportData>): string[] {
  const { digest, memory } = response.data;
  if (!memory) return [`Vault memory is disabled; ${digest.id} was not exported.`];
  return [
    `${memory.status === "created" ? "Created" : memory.status === "updated" ? "Updated" : "Unchanged"} narrative digest vault Record.`,
    `Record: ${memory.recordPath}`
  ];
}

function normalizePeriod(value: string): DigestPeriod {
  if ((DIGEST_PERIODS as readonly string[]).includes(value)) return value as DigestPeriod;
  throw validationError(`Digest --period must be one of: ${DIGEST_PERIODS.join(", ")}.`, { period: value });
}

function normalizeInstant(value: string, field: string): string {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) {
    throw validationError(`Digest --${field} must be a valid ISO-8601 instant.`, { [field]: value });
  }
  return instant.toISOString();
}
