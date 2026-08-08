import { readFileSync } from "node:fs";
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
import { getArtifact, getProject, getProjectBySlug, listProjects } from "../db/repositories.js";
import {
  composePortfolioDigest,
  composeProjectDigest,
  createIntelligenceDigestNarrator,
  NarrativeDigestInvalidResultError,
  NarrativeDigestUnavailableError
} from "../digests/composer.js";
import { describeWindow, dueDigestWindows } from "../digests/schedule.js";
import { exportNarrativeDigest, safeWorkspaceFile, type MemorySyncEntry } from "../memory/obsidian.js";
import {
  DIGEST_PERIODS,
  PORTFOLIO_SCOPE_KEY,
  type ComposedProjectDigest,
  type DigestNarrator,
  type DigestPeriod,
  type DigestScope,
  type DigestWindow,
  type NarrativeDigestRecord
} from "../digests/types.js";
import { nowIso } from "../utils/time.js";

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
    const { artifactId, memory } = exportDigestRecord(db, workspacePath, digest);
    return createSuccess({
      command: "digest.export",
      workspace: workspacePath,
      data: { digest, artifactId, memory },
      artifacts: [artifactId]
    });
  } finally {
    db.close();
  }
}

/**
 * Shared by `digest export` and the scheduled run, so a scheduled digest and a
 * hand-exported one land in the vault through exactly one code path.
 */
function exportDigestRecord(
  db: ReturnType<typeof openDatabase>,
  workspacePath: string,
  digest: NarrativeDigestRecord
): { artifactId: string; memory: MemorySyncEntry | null } {
  const artifact = getArtifact(db, digest.artifact_id);
  if (!artifact) throw validationError("Narrative digest is missing its Artifact.", { digestId: digest.id, artifactId: digest.artifact_id });

  // The roll-up has no Project row by design; it exports under a synthetic
  // subject so the vault layout stays one shape for both scopes.
  const subject = digest.scope === "portfolio"
    ? { id: PORTFOLIO_SCOPE_KEY, name: "Portfolio", slug: PORTFOLIO_SCOPE_KEY }
    : digestProjectSubject(db, digest);
  if (artifact.artifact_type !== "narrative_digest"
    || (digest.scope === "project" && artifact.project_id !== digest.project_id)
    || (digest.scope === "portfolio" && artifact.project_id !== null)) {
    throw validationError("Narrative digest links inconsistent Project or Artifact data.", {
      digestId: digest.id,
      scope: digest.scope,
      projectId: digest.project_id,
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
    project: subject,
    scope: digest.scope
  });
  return { artifactId: artifact.id, memory };
}

function digestProjectSubject(
  db: ReturnType<typeof openDatabase>,
  digest: NarrativeDigestRecord
): { id: string; name: string; slug: string } {
  const project = digest.project_id ? getProject(db, digest.project_id) : null;
  if (!project) throw validationError("Narrative digest is missing its Project.", { digestId: digest.id, projectId: digest.project_id });
  return { id: project.id, name: project.name, slug: project.slug };
}

export function renderDigestExportSuccess(response: CommandSuccess<DigestExportData>): string[] {
  const { digest, memory } = response.data;
  if (!memory) return [`Vault memory is disabled; ${digest.id} was not exported.`];
  return [
    `${memory.status === "created" ? "Created" : memory.status === "updated" ? "Updated" : "Unchanged"} narrative digest vault Record.`,
    `Record: ${memory.recordPath}`
  ];
}

// ---------------------------------------------------------------------------
// Scheduled cadences
// ---------------------------------------------------------------------------

export interface DigestRunOptions {
  workspace: string;
  narrator?: DigestNarrator;
  now?: Date;
}

/** One due (scope, period, window) the run produced, or failed to produce. */
export interface DigestRunEntry {
  scope: DigestScope;
  scopeKey: string;
  subject: string;
  period: DigestPeriod;
  windowStart: string;
  windowEnd: string;
  windowLabel: string;
  digestId: string | null;
  artifactId: string | null;
  factCount: number | null;
  /**
   * `composed` -- newly narrated and stored on this run.
   * `pending-delivery` -- already stored but never posted, so the caller should
   *   still deliver it (a process that died between compose and post).
   * `skipped` -- already stored and already delivered.
   * `failed` -- this one subject failed; every other subject still ran.
   */
  status: "composed" | "pending-delivery" | "skipped" | "failed";
  /** Delivery body for `composed` and `pending-delivery`; null otherwise. */
  body: string | null;
  memoryRecordPath: string | null;
  error: string | null;
}

export interface DigestRunData {
  now: string;
  windows: DigestWindow[];
  entries: DigestRunEntry[];
  /** The subset the caller still has to deliver, in composition order. */
  pending: DigestRunEntry[];
}

/**
 * Compose, store, and export every digest that is due and not already stored,
 * for every active Project and the collective portfolio roll-up.
 *
 * Isolation is the point of the per-subject try/catch: one Project whose local
 * narration fails must not cost every other Project its digest, and a daily
 * failure must not take the weekly and monthly cadences with it. A failure is
 * reported as an entry, never thrown.
 *
 * There is no force-recompose mode, deliberately. Re-narrating a window that
 * already has a digest would spend tokens to overwrite a record the operator
 * may already have read, and `digest compose` covers any explicit window on
 * demand — a flag that only sometimes skips work is a flag someone eventually
 * passes by accident.
 */
export async function runDigestRunCommand(options: DigestRunOptions): Promise<CommandSuccess<DigestRunData>> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const now = options.now ?? new Date();
  const db = openDatabase(workspacePath);
  try {
    const windows = dueDigestWindows(now);
    const projects = listProjects(db).filter((project) => project.status === "active");
    const narrator = options.narrator ?? createIntelligenceDigestNarrator(db, workspacePath);
    const entries: DigestRunEntry[] = [];

    for (const window of windows) {
      for (const project of projects) {
        entries.push(await runOneDigest(db, workspacePath, window, {
          scope: "project",
          scopeKey: project.id,
          subject: project.name,
          compose: () => composeProjectDigest({ db, workspacePath, project, window, narrator })
        }));
      }
      entries.push(await runOneDigest(db, workspacePath, window, {
        scope: "portfolio",
        scopeKey: PORTFOLIO_SCOPE_KEY,
        subject: "Portfolio",
        compose: () => composePortfolioDigest({ db, workspacePath, projects, window, narrator })
      }));
    }

    return createSuccess({
      command: "digest.run",
      workspace: workspacePath,
      data: {
        now: now.toISOString(),
        windows,
        entries,
        pending: entries.filter((entry) => entry.status === "composed" || entry.status === "pending-delivery")
      },
      artifacts: entries.map((entry) => entry.artifactId).filter((id): id is string => Boolean(id)),
      warnings: entries
        .filter((entry) => entry.status === "failed")
        .map((entry) => `${entry.subject} ${entry.period} digest failed: ${entry.error}`)
    });
  } finally {
    db.close();
  }
}

async function runOneDigest(
  db: ReturnType<typeof openDatabase>,
  workspacePath: string,
  window: DigestWindow,
  subject: {
    scope: DigestScope;
    scopeKey: string;
    subject: string;
    compose: () => Promise<ComposedProjectDigest>;
  }
): Promise<DigestRunEntry> {
  const base = {
    scope: subject.scope,
    scopeKey: subject.scopeKey,
    subject: subject.subject,
    period: window.period,
    windowStart: window.start,
    windowEnd: window.end,
    windowLabel: describeWindow(window)
  };

  try {
    // The stored (scope, period, window) row is the once-per-period guard.
    // No separate schedule ledger exists, and none should: a second record of
    // "did this already happen" is a second thing that can disagree.
    const existing = db.prepare(
      `SELECT * FROM narrative_digests
       WHERE scope_key = ? AND period = ? AND window_start = ? AND window_end = ?`
    ).get(subject.scopeKey, window.period, window.start, window.end) as NarrativeDigestRecord | undefined;

    if (existing) {
      if (existing.posted_message_id) {
        return { ...base, digestId: existing.id, artifactId: existing.artifact_id, factCount: null, status: "skipped", body: null, memoryRecordPath: null, error: null };
      }
      // Composed but never delivered — hand it back for the send rather than
      // losing it forever behind the once-per-period guard, exactly as the
      // orientation packet does.
      return {
        ...base,
        digestId: existing.id,
        artifactId: existing.artifact_id,
        factCount: (JSON.parse(existing.facts_json) as unknown[]).length,
        status: "pending-delivery",
        body: renderDigestBody(base.subject, window, readDigestNarrative(db, workspacePath, existing)),
        memoryRecordPath: null,
        error: null
      };
    }

    const composed = await subject.compose();
    let memoryRecordPath: string | null = null;
    let exportError: string | null = null;
    try {
      memoryRecordPath = exportDigestRecord(db, workspacePath, composed.digest).memory?.recordPath ?? null;
    } catch (error) {
      // The vault is a projection. A vault that cannot be written is worth a
      // warning, not the loss of a digest that composed and can still be posted.
      exportError = `Vault export failed: ${describeError(error)}`;
    }

    return {
      ...base,
      digestId: composed.digest.id,
      artifactId: composed.artifact.id,
      factCount: composed.facts.length,
      status: "composed",
      body: renderDigestBody(base.subject, window, composed.narrative),
      memoryRecordPath,
      error: exportError
    };
  } catch (error) {
    return { ...base, digestId: null, artifactId: null, factCount: null, status: "failed", body: null, memoryRecordPath: null, error: describeError(error) };
  }
}

export interface DigestMarkPostedOptions {
  workspace: string;
  digestId: string;
  messageId: string;
}

export interface DigestMarkPostedData {
  digest: NarrativeDigestRecord;
}

/** Record that a composed digest reached its delivery surface. */
export function runDigestMarkPostedCommand(
  options: DigestMarkPostedOptions
): CommandSuccess<DigestMarkPostedData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const changed = db.prepare(
      "UPDATE narrative_digests SET posted_message_id = ?, posted_at = ?, updated_at = ? WHERE id = ?"
    ).run(options.messageId, nowIso(), nowIso(), options.digestId);
    if (changed.changes === 0) {
      throw validationError("Narrative digest was not found.", { digestId: options.digestId });
    }
    const digest = db.prepare("SELECT * FROM narrative_digests WHERE id = ?").get(options.digestId) as NarrativeDigestRecord;
    return createSuccess({
      command: "digest.mark-posted",
      workspace: workspacePath,
      data: { digest }
    });
  } finally {
    db.close();
  }
}

export function renderDigestRunSuccess(response: CommandSuccess<DigestRunData>): string[] {
  const { entries, pending } = response.data;
  const composed = entries.filter((entry) => entry.status === "composed").length;
  const failed = entries.filter((entry) => entry.status === "failed");
  const lines = [
    `Composed ${composed} digest(s); ${pending.length} awaiting delivery; ${entries.length - composed - failed.length} already current.`
  ];
  for (const entry of pending) {
    lines.push(`  ${entry.subject} — ${entry.period} (${entry.windowLabel}), ${entry.factCount ?? "?"} fact(s)`);
  }
  for (const entry of failed) {
    lines.push(`  FAILED ${entry.subject} — ${entry.period} (${entry.windowLabel}): ${entry.error}`);
  }
  return lines;
}

export function renderDigestMarkPostedSuccess(response: CommandSuccess<DigestMarkPostedData>): string[] {
  return [`Recorded delivery of ${response.data.digest.id} as message ${response.data.digest.posted_message_id}.`];
}

function renderDigestBody(subject: string, window: DigestWindow, narrative: string): string {
  return `**${subject} — ${window.period} digest (${describeWindow(window)})**\n\n${narrative}`;
}

/**
 * Re-read a stored digest's narrative from its Artifact for a retried delivery.
 *
 * The Artifact's own recorded path is the source of truth rather than a
 * rebuilt one: recomputing the filename here would be a second copy of the
 * composer's naming scheme, and the two would eventually disagree.
 */
function readDigestNarrative(
  db: ReturnType<typeof openDatabase>,
  workspacePath: string,
  digest: NarrativeDigestRecord
): string {
  const artifact = getArtifact(db, digest.artifact_id);
  if (!artifact?.path) {
    throw validationError("Narrative digest Artifact has no stored path.", { digestId: digest.id });
  }
  const source = readFileSync(safeWorkspaceFile(workspacePath, artifact.path, "narrative digest Artifact"), "utf8");
  return source.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^#[^\n]*\n/, "").trim();
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
