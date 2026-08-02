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
import { getProject, getProjectBySlug } from "../db/repositories.js";
import {
  composeProjectDigest,
  createIntelligenceDigestNarrator,
  NarrativeDigestInvalidResultError,
  NarrativeDigestUnavailableError
} from "../digests/composer.js";
import { DIGEST_PERIODS, type ComposedProjectDigest, type DigestNarrator, type DigestPeriod } from "../digests/types.js";

export interface DigestComposeOptions {
  workspace: string;
  project: string;
  period: string;
  from: string;
  to: string;
  narrator?: DigestNarrator;
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
