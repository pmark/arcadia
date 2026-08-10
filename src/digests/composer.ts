import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { createArtifactRecord, updateArtifact } from "../db/repositories.js";
import type { Artifact, Project } from "../domain/types.js";
import { createSqliteIntelligenceArtifactStore } from "../intelligence/artifacts/store.js";
import { loadIntelligenceConfig } from "../intelligence/config/defaults.js";
import { createSqliteIntelligenceJobRepository } from "../intelligence/db/sqliteRepository.js";
import { IntelligenceWorker } from "../intelligence/jobs/worker.js";
import { createLiteLlmHttpClient } from "../intelligence/litellm/httpClient.js";
import { submitIntelligenceRequest } from "../intelligence/service/jobService.js";
import { createId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";
import { buildNarrativeDigestRequest } from "./contract.js";
import {
  PORTFOLIO_SCOPE_KEY,
  type ComposedProjectDigest,
  type DigestFact,
  type DigestNarrator,
  type DigestSubject,
  type DigestWindow,
  type NarrativeDigestRecord
} from "./types.js";

const DIGEST_TIMEOUT_MS = 180_000;

export class NarrativeDigestUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NarrativeDigestUnavailableError";
  }
}

export class NarrativeDigestInvalidResultError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NarrativeDigestInvalidResultError";
  }
}

/** Gather exactly the facts whose event instant is in [start, end). */
export function gatherProjectDigestFacts(
  db: Database.Database,
  project: Pick<Project, "id" | "slug">,
  window: DigestWindow
): DigestFact[] {
  const normalized = normalizeWindow(window);

  const missionLogs = db.prepare(
    `SELECT id,
       CASE
         WHEN doc_ref LIKE 'log/%#____-__-__--%' THEN substr(doc_ref, instr(doc_ref, '#') + 1, 10) || 'T00:00:00.000Z'
         ELSE created_at
       END AS occurred_at,
       work_performed, result, blockers, next_action, markdown_path
     FROM mission_logs
     WHERE project_id = @projectId
       AND (CASE
         WHEN doc_ref LIKE 'log/%#____-__-__--%' THEN substr(doc_ref, instr(doc_ref, '#') + 1, 10) || 'T00:00:00.000Z'
         ELSE created_at
       END) >= @start
       AND (CASE
         WHEN doc_ref LIKE 'log/%#____-__-__--%' THEN substr(doc_ref, instr(doc_ref, '#') + 1, 10) || 'T00:00:00.000Z'
         ELSE created_at
       END) < @end`
  ).all({ projectId: project.id, start: normalized.start, end: normalized.end }) as Array<Record<string, string | null>>;

  const dispatches = db.prepare(
    `SELECT id, occurred_at, command, dispatchable, blocker_count, blocker_fields, operator_question
     FROM dispatch_events
     WHERE (project_id = @projectId OR (project_id IS NULL AND lower(project_slug) = lower(@projectSlug)))
       AND occurred_at >= @start AND occurred_at < @end`
  ).all({ projectId: project.id, projectSlug: project.slug, start: normalized.start, end: normalized.end }) as Array<{
    id: string; occurred_at: string; command: string; dispatchable: number; blocker_count: number;
    blocker_fields: string; operator_question: number;
  }>;

  const decisions = db.prepare(
    `SELECT ri.id, COALESCE(ri.decided_at, ri.created_at) AS occurred_at,
       ri.status, ri.decision_needed, ri.recommendation, ri.decision_note
     FROM review_items ri
     LEFT JOIN work_items wi ON wi.id = ri.work_item_id
     WHERE COALESCE(ri.project_id, wi.project_id) = @projectId
       AND COALESCE(ri.decided_at, ri.created_at) >= @start
       AND COALESCE(ri.decided_at, ri.created_at) < @end`
  ).all({ projectId: project.id, start: normalized.start, end: normalized.end }) as Array<Record<string, string | null>>;

  return [
    ...missionLogs.map((row): DigestFact => ({
      id: `mission-log:${row.id}`,
      kind: "mission_log",
      occurredAt: row.occurred_at!,
      summary: `${row.work_performed} Result: ${row.result}`,
      detail: {
        blockers: row.blockers,
        nextAction: row.next_action,
        sourcePath: row.markdown_path
      }
    })),
    ...dispatches.map((row): DigestFact => ({
      id: `dispatch:${row.id}`,
      kind: "dispatch",
      occurredAt: row.occurred_at,
      summary: `${row.command} ${row.dispatchable === 1 ? "resolved as dispatchable" : `was refused with ${row.blocker_count} blocker(s)`}.`,
      detail: {
        command: row.command,
        dispatchable: row.dispatchable === 1,
        blockerFields: parseStringList(row.blocker_fields).join(", "),
        operatorQuestion: row.operator_question === 1
      }
    })),
    ...decisions.map((row): DigestFact => ({
      id: `decision:${row.id}`,
      kind: "decision",
      occurredAt: row.occurred_at!,
      summary: `Decision ${row.status}: ${row.decision_needed}`,
      detail: {
        status: row.status,
        recommendation: row.recommendation,
        answer: row.decision_note
      }
    }))
  ].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
}

/** The subject describing one Project. */
export function projectDigestSubject(project: Pick<Project, "id" | "name" | "slug">): DigestSubject {
  return { scope: "project", scopeKey: project.id, projectId: project.id, name: project.name, slug: project.slug };
}

/** The subject describing the collective roll-up, which belongs to no Project. */
export function portfolioDigestSubject(): DigestSubject {
  return {
    scope: "portfolio",
    scopeKey: PORTFOLIO_SCOPE_KEY,
    projectId: null,
    name: "Portfolio",
    slug: PORTFOLIO_SCOPE_KEY
  };
}

/**
 * Gather every active Project's in-window facts as one stream.
 *
 * Each fact keeps its per-Project id namespaced by Project so two Projects'
 * rows can never collide, and carries the Project name in `detail` so the
 * narrator can attribute each claim without being told to guess.
 */
export function gatherPortfolioDigestFacts(
  db: Database.Database,
  projects: Array<Pick<Project, "id" | "slug" | "name">>,
  window: DigestWindow
): DigestFact[] {
  return projects
    .flatMap((project) =>
      gatherProjectDigestFacts(db, project, window).map((fact): DigestFact => ({
        ...fact,
        id: `${project.slug}/${fact.id}`,
        summary: `${project.name}: ${fact.summary}`,
        detail: { ...fact.detail, project: project.name, projectSlug: project.slug }
      }))
    )
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
}

export async function composeProjectDigest(input: {
  db: Database.Database;
  workspacePath: string;
  project: Project;
  window: DigestWindow;
  narrator: DigestNarrator;
}): Promise<ComposedProjectDigest> {
  const window = normalizeWindow(input.window);
  return persistDigest({
    ...input,
    window,
    subject: projectDigestSubject(input.project),
    facts: gatherProjectDigestFacts(input.db, input.project, window)
  });
}

/** Compose the one collective story across every supplied (active) Project. */
export async function composePortfolioDigest(input: {
  db: Database.Database;
  workspacePath: string;
  projects: Project[];
  window: DigestWindow;
  narrator: DigestNarrator;
}): Promise<ComposedProjectDigest> {
  const window = normalizeWindow(input.window);
  return persistDigest({
    ...input,
    window,
    subject: portfolioDigestSubject(),
    facts: gatherPortfolioDigestFacts(input.db, input.projects, window)
  });
}

async function persistDigest(input: {
  db: Database.Database;
  workspacePath: string;
  subject: DigestSubject;
  window: DigestWindow;
  facts: DigestFact[];
  narrator: DigestNarrator;
}): Promise<ComposedProjectDigest> {
  const { db, subject, window, facts } = input;
  const narrated = await input.narrator({ subject, window, facts });
  const narrative = facts.length === 0
    ? `Nothing happened in ${subject.name}'s recorded activity during this ${window.period} window.`
    : requireNarrative(narrated.narrative);

  const relativePath = digestRelativePath(subject.slug, window);
  writeDigestAtomically(input.workspacePath, relativePath, subject, window, facts, narrative);

  const timestamp = nowIso();
  const existing = db.prepare(
    `SELECT * FROM narrative_digests
     WHERE scope_key = ? AND period = ? AND window_start = ? AND window_end = ?`
  ).get(subject.scopeKey, window.period, window.start, window.end) as NarrativeDigestRecord | undefined;

  let artifact: Artifact;
  let digest: NarrativeDigestRecord;
  const transaction = db.transaction(() => {
    if (existing) {
      const updatedArtifact = updateArtifact(db, existing.artifact_id, {
        title: digestTitle(subject.name, window),
        artifactType: "narrative_digest",
        status: "ready",
        path: relativePath
      });
      if (!updatedArtifact) throw new Error(`Narrative digest Artifact is missing: ${existing.artifact_id}`);
      artifact = updatedArtifact;
      db.prepare(
        `UPDATE narrative_digests
         SET intelligence_job_id = ?, facts_json = ?, updated_at = ?
         WHERE id = ?`
      ).run(narrated.jobId, JSON.stringify(facts), timestamp, existing.id);
      digest = db.prepare("SELECT * FROM narrative_digests WHERE id = ?").get(existing.id) as NarrativeDigestRecord;
      return;
    }

    artifact = createArtifactRecord(db, {
      projectId: subject.projectId ?? undefined,
      title: digestTitle(subject.name, window),
      artifactType: "narrative_digest",
      status: "ready",
      path: relativePath
    });
    const id = createId("narrativeDigest");
    db.prepare(
      `INSERT INTO narrative_digests (
        id, scope, scope_key, project_id, artifact_id, period, window_start, window_end,
        intelligence_job_id, facts_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, subject.scope, subject.scopeKey, subject.projectId, artifact.id,
      window.period, window.start, window.end,
      narrated.jobId, JSON.stringify(facts), timestamp, timestamp
    );
    digest = db.prepare("SELECT * FROM narrative_digests WHERE id = ?").get(id) as NarrativeDigestRecord;
  });
  transaction();

  return { digest: digest!, artifact: artifact!, facts, narrative, created: !existing };
}

/** Real local-preferred narrator, using the durable queue and in-process worker. */
export function createIntelligenceDigestNarrator(
  db: Database.Database,
  workspacePath: string
): DigestNarrator {
  const repository = createSqliteIntelligenceJobRepository(db);
  const artifactStore = createSqliteIntelligenceArtifactStore(db, workspacePath);
  const config = loadIntelligenceConfig(process.env);
  const worker = new IntelligenceWorker(repository, createLiteLlmHttpClient({
    baseUrl: config.liteLlmBaseUrl,
    apiKey: config.liteLlmApiKey,
    timeoutMs: DIGEST_TIMEOUT_MS
  }), config, artifactStore);

  return async (input) => {
    const request = buildNarrativeDigestRequest({ subject: input.subject, window: input.window, facts: input.facts });
    const { job: submitted } = await submitIntelligenceRequest(repository, request);
    const deadline = Date.now() + DIGEST_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const current = await repository.findById(submitted.id);
      if (!current) throw new NarrativeDigestUnavailableError(`Digest job disappeared: ${submitted.id}`);
      if (current.status === "completed") {
        return { narrative: normalizeNarrative(current.result), jobId: current.id };
      }
      if (current.status === "blocked") {
        throw new NarrativeDigestUnavailableError(
          `Cannot reach the local model (${current.error?.code ?? "UNKNOWN"}): ${current.error?.message ?? "no detail"}`
        );
      }
      if (current.status === "failed") {
        throw new NarrativeDigestInvalidResultError(
          `Digest narration failed (${current.error?.code ?? "UNKNOWN"}): ${current.error?.message ?? "no detail"}`
        );
      }
      await worker.runOnce();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new NarrativeDigestUnavailableError(`Timed out waiting for digest job ${submitted.id}.`);
  };
}

function normalizeNarrative(raw: unknown): string {
  const narrative = raw && typeof raw === "object" && "narrative" in raw
    ? (raw as { narrative?: unknown }).narrative
    : undefined;
  return requireNarrative(narrative);
}

function requireNarrative(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new NarrativeDigestInvalidResultError("Digest result must contain a non-empty narrative.");
  }
  return value.trim();
}

function normalizeWindow(window: DigestWindow): DigestWindow {
  const start = new Date(window.start);
  const end = new Date(window.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start.getTime() >= end.getTime()) {
    throw new Error("Digest window must have valid ISO start/end instants with start before end.");
  }
  return { period: window.period, start: start.toISOString(), end: end.toISOString() };
}

function digestRelativePath(projectSlug: string, window: DigestWindow): string {
  const key = `${window.period}-${safeInstant(window.start)}-${safeInstant(window.end)}.md`;
  return path.join("artifacts", "narrative-digests", projectSlug, key);
}

function safeInstant(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function digestTitle(projectName: string, window: DigestWindow): string {
  return `${projectName} ${window.period} digest — ${window.start} to ${window.end}`;
}

function writeDigestAtomically(
  workspacePath: string,
  relativePath: string,
  subject: DigestSubject,
  window: DigestWindow,
  facts: DigestFact[],
  narrative: string
): void {
  const projectName = subject.name;
  const target = path.join(workspacePath, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const body = [
    "---",
    "artifact_type: narrative_digest",
    "narration: local-ai",
    `scope: ${subject.scope}`,
    // The roll-up is not any one Project's; naming a `project` for it would be
    // the first false claim in a document whose whole point is not making any.
    ...(subject.scope === "project" ? [`project: ${JSON.stringify(projectName)}`] : []),
    `subject: ${JSON.stringify(projectName)}`,
    `period: ${window.period}`,
    `window_start: ${window.start}`,
    `window_end: ${window.end}`,
    `fact_count: ${facts.length}`,
    "---",
    "",
    `# ${projectName} ${window.period} digest`,
    "",
    narrative,
    ""
  ].join("\n");
  writeFileSync(temporary, body, "utf8");
  renameSync(temporary, target);
}

function parseStringList(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}
