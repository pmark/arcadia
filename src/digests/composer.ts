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
import type {
  ComposedProjectDigest,
  DigestFact,
  DigestNarrator,
  DigestWindow,
  NarrativeDigestRecord
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

export async function composeProjectDigest(input: {
  db: Database.Database;
  workspacePath: string;
  project: Project;
  window: DigestWindow;
  narrator: DigestNarrator;
}): Promise<ComposedProjectDigest> {
  const window = normalizeWindow(input.window);
  const facts = gatherProjectDigestFacts(input.db, input.project, window);
  const narrated = await input.narrator({
    projectId: input.project.id,
    projectName: input.project.name,
    window,
    facts
  });
  const narrative = facts.length === 0
    ? `Nothing happened in ${input.project.name}'s recorded activity during this ${window.period} window.`
    : requireNarrative(narrated.narrative);

  const relativePath = digestRelativePath(input.project.slug, window);
  writeDigestAtomically(input.workspacePath, relativePath, input.project.name, window, facts, narrative);

  const timestamp = nowIso();
  const existing = input.db.prepare(
    `SELECT * FROM narrative_digests
     WHERE project_id = ? AND period = ? AND window_start = ? AND window_end = ?`
  ).get(input.project.id, window.period, window.start, window.end) as NarrativeDigestRecord | undefined;

  let artifact: Artifact;
  let digest: NarrativeDigestRecord;
  const transaction = input.db.transaction(() => {
    if (existing) {
      const updatedArtifact = updateArtifact(input.db, existing.artifact_id, {
        title: digestTitle(input.project.name, window),
        artifactType: "narrative_digest",
        status: "ready",
        path: relativePath
      });
      if (!updatedArtifact) throw new Error(`Narrative digest Artifact is missing: ${existing.artifact_id}`);
      artifact = updatedArtifact;
      input.db.prepare(
        `UPDATE narrative_digests
         SET intelligence_job_id = ?, facts_json = ?, updated_at = ?
         WHERE id = ?`
      ).run(narrated.jobId, JSON.stringify(facts), timestamp, existing.id);
      digest = input.db.prepare("SELECT * FROM narrative_digests WHERE id = ?").get(existing.id) as NarrativeDigestRecord;
      return;
    }

    artifact = createArtifactRecord(input.db, {
      projectId: input.project.id,
      title: digestTitle(input.project.name, window),
      artifactType: "narrative_digest",
      status: "ready",
      path: relativePath
    });
    const id = createId("narrativeDigest");
    input.db.prepare(
      `INSERT INTO narrative_digests (
        id, project_id, artifact_id, period, window_start, window_end,
        intelligence_job_id, facts_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, input.project.id, artifact.id, window.period, window.start, window.end,
      narrated.jobId, JSON.stringify(facts), timestamp, timestamp
    );
    digest = input.db.prepare("SELECT * FROM narrative_digests WHERE id = ?").get(id) as NarrativeDigestRecord;
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
    const request = buildNarrativeDigestRequest(input);
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
  projectName: string,
  window: DigestWindow,
  facts: DigestFact[],
  narrative: string
): void {
  const target = path.join(workspacePath, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const body = [
    "---",
    "artifact_type: narrative_digest",
    "narration: local-ai",
    `project: ${JSON.stringify(projectName)}`,
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
