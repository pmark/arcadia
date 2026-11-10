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
  buildDigestReport,
  checkAiSummary,
  deterministicSummary,
  DIGEST_DETAIL_MARKER,
  needsYouUnavailable,
  renderDigestDetail,
  renderDigestSections,
  reportIsEmpty,
  summaryFacts
} from "./report.js";
import {
  PORTFOLIO_SCOPE_KEY,
  type ComposedProjectDigest,
  type DigestFact,
  type DigestNarrator,
  type DigestNeedsYou,
  type DigestReport,
  type DigestSummary,
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
    `SELECT id, occurred_at, command, plan_slug, dispatchable, blocker_count, blocker_fields, operator_question
     FROM dispatch_events
     WHERE (project_id = @projectId OR (project_id IS NULL AND lower(project_slug) = lower(@projectSlug)))
       AND occurred_at >= @start AND occurred_at < @end`
  ).all({ projectId: project.id, projectSlug: project.slug, start: normalized.start, end: normalized.end }) as Array<{
    id: string; occurred_at: string; command: string; plan_slug: string | null; dispatchable: number; blocker_count: number;
    blocker_fields: string; operator_question: number;
  }>;

  /*
   * Actions finished in the window.
   *
   * Without these a digest can only narrate telemetry — which commands ran and
   * which Decisions opened — so a day of real delivery reads as a handful of
   * dispatch events and nothing else. What the operator did is the story; the
   * commands they typed to do it are not.
   *
   * `work_items` records no completion instant, only `updated_at`, so that is
   * the completion proxy: an Action counts for the window it was last touched
   * in while already done. A later edit therefore moves a completed Action into
   * a newer window, and re-narrates it there. That is the honest limit of the
   * present schema; a real `completed_at` column would need a migration.
   */
  const completedActions = db.prepare(
    `SELECT wi.id, wi.updated_at AS occurred_at, wi.title, wi.next_action, wi.expected_artifact,
       wi.work_classification, wi.milestone_id, m.title AS milestone_title
     FROM work_items wi
     LEFT JOIN milestones m ON m.id = wi.milestone_id
     WHERE wi.project_id = @projectId
       AND wi.status = 'done'
       AND wi.updated_at >= @start AND wi.updated_at < @end`
  ).all({ projectId: project.id, start: normalized.start, end: normalized.end }) as Array<Record<string, string | null>>;

  const decisions = db.prepare(
    `SELECT ri.id, COALESCE(ri.decided_at, ri.created_at) AS occurred_at,
       ri.status, ri.decision_needed, ri.recommendation, ri.decision_note
     FROM review_items ri
     LEFT JOIN work_items wi ON wi.id = ri.work_item_id
     WHERE COALESCE(ri.project_id, wi.project_id) = @projectId
       AND COALESCE(ri.decided_at, ri.created_at) >= @start
       AND COALESCE(ri.decided_at, ri.created_at) < @end`
  ).all({ projectId: project.id, start: normalized.start, end: normalized.end }) as Array<Record<string, string | null>>;

  const merges = gatherMergedActions(db, project, normalized);

  return [
    ...completedActions.map((row): DigestFact => ({
      id: `completed-action:${row.id}`,
      kind: "completed_action",
      occurredAt: row.occurred_at!,
      summary: `Completed: ${row.title}`,
      detail: {
        milestone: row.milestone_title,
        milestoneId: row.milestone_id,
        responsibility: row.work_classification,
        expectedArtifact: row.expected_artifact,
        nextAction: row.next_action
      }
    })),
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
        plan: row.plan_slug,
        dispatchable: row.dispatchable === 1,
        blockerFields: parseStringList(row.blocker_fields).join(", "),
        operatorQuestion: row.operator_question === 1
      }
    })),
    ...merges,
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

/**
 * Pull requests the production worker merged in the window, matched to the
 * Action (and so the goal) they delivered. `action_key` is `<project>/<action
 * id>` and an Action's `doc_ref` is `plan/<plan>#<action id>`; an action id
 * shared by two Plans is ambiguous, so it keeps no goal rather than a guessed one.
 */
function gatherMergedActions(
  db: Database.Database,
  project: Pick<Project, "id" | "slug">,
  window: DigestWindow
): DigestFact[] {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'production_worker_merges'").get()) return [];
  const prefix = `${project.slug}/`;
  const rows = db.prepare(
    `SELECT request_id, action_key, pull_request_url, head, updated_at
     FROM production_worker_merges
     WHERE outcome = 'merged' AND substr(action_key, 1, length(@prefix)) = @prefix
       AND updated_at >= @start AND updated_at < @end`
  ).all({ prefix, start: window.start, end: window.end }) as Array<{
    request_id: string; action_key: string; pull_request_url: string | null; head: string; updated_at: string;
  }>;
  const actionsFor = db.prepare(
    `SELECT wi.id, wi.title, wi.milestone_id, m.title AS milestone_title
     FROM work_items wi
     LEFT JOIN milestones m ON m.id = wi.milestone_id
     WHERE wi.project_id = ? AND wi.archived_at IS NULL
       AND instr(wi.doc_ref, '#') > 0 AND substr(wi.doc_ref, instr(wi.doc_ref, '#') + 1) = ?`
  );
  return rows.map((row): DigestFact => {
    const actionId = row.action_key.slice(prefix.length);
    const matches = actionsFor.all(project.id, actionId) as Array<{ id: string; title: string; milestone_id: string | null; milestone_title: string | null }>;
    const action = matches.length === 1 ? matches[0] : null;
    return {
      id: `merged:${row.request_id}`,
      kind: "merged",
      occurredAt: row.updated_at,
      summary: `Merged: ${action?.title ?? actionId}`,
      detail: {
        actionId,
        milestone: action?.milestone_title ?? null,
        milestoneId: action?.milestone_id ?? null,
        head: row.head,
        url: row.pull_request_url
      }
    };
  });
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

export interface DigestReportInputs {
  /** Ranked operator items; when omitted the page says the to-do list was not read. */
  needsYou?: DigestNeedsYou;
  /** The instant open alerts and waiting times are measured against. */
  now?: Date;
}

export async function composeProjectDigest(input: {
  db: Database.Database;
  workspacePath: string;
  project: Project;
  window: DigestWindow;
  narrator: DigestNarrator;
} & DigestReportInputs): Promise<ComposedProjectDigest> {
  const window = normalizeWindow(input.window);
  return persistDigest({
    ...input,
    window,
    subject: projectDigestSubject(input.project),
    projects: [input.project],
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
} & DigestReportInputs): Promise<ComposedProjectDigest> {
  const window = normalizeWindow(input.window);
  return persistDigest({
    ...input,
    window,
    subject: portfolioDigestSubject(),
    facts: gatherPortfolioDigestFacts(input.db, input.projects, window)
  });
}

/**
 * Compute and render a digest without storing anything: no Artifact, no row,
 * and no Intelligence job unless a narrator is supplied.
 */
export async function previewDigest(input: {
  db: Database.Database;
  subject: DigestSubject;
  projects: Array<Pick<Project, "id" | "slug" | "name">>;
  window: DigestWindow;
  narrator?: DigestNarrator;
} & DigestReportInputs): Promise<{ report: DigestReport; summary: DigestSummary; facts: DigestFact[]; narrative: string }> {
  const window = normalizeWindow(input.window);
  const facts = input.subject.scope === "portfolio"
    ? gatherPortfolioDigestFacts(input.db, input.projects, window)
    : gatherProjectDigestFacts(input.db, input.projects[0], window);
  const report = buildDigestReport({
    db: input.db,
    subject: input.subject,
    projects: input.projects,
    window,
    facts,
    needsYou: input.needsYou ?? NEEDS_YOU_NOT_READ,
    now: input.now ?? new Date()
  });
  const summary = await summarizeReport(report, window, input.narrator ?? null);
  return { report, summary, facts, narrative: renderDigestSections(report, summary) };
}

const NEEDS_YOU_NOT_READ = needsYouUnavailable("the to-do list was not read for this digest");

/**
 * The AI headline, or the computed one.
 *
 * A digest is never lost to the model: an unreachable service, a failed job,
 * a malformed result, or a headline stating a number the facts lack all fall
 * back to the deterministic summary, labelled as such, with the reason kept.
 */
export async function summarizeReport(
  report: DigestReport,
  window: DigestWindow,
  narrator: DigestNarrator | null
): Promise<DigestSummary> {
  const fallback = (fallbackReason: string | null): DigestSummary => ({
    text: deterministicSummary(report),
    source: "deterministic",
    fallbackReason,
    jobId: null
  });
  if (reportIsEmpty(report) || !narrator) return fallback(null);
  const facts = summaryFacts(report);
  try {
    const narrated = await narrator({ subject: report.subject, window, facts });
    const checked = checkAiSummary(typeof narrated.summary === "string" ? narrated.summary : "", facts);
    if (!checked.ok) return { ...fallback(checked.reason), jobId: narrated.jobId };
    return { text: checked.text, source: "ai", fallbackReason: null, jobId: narrated.jobId };
  } catch (error) {
    return fallback(error instanceof Error ? error.message : String(error));
  }
}

async function persistDigest(input: {
  db: Database.Database;
  workspacePath: string;
  subject: DigestSubject;
  projects: Array<Pick<Project, "id" | "slug" | "name">>;
  window: DigestWindow;
  facts: DigestFact[];
  narrator: DigestNarrator;
} & DigestReportInputs): Promise<ComposedProjectDigest> {
  const { db, subject, window, facts } = input;
  const report = buildDigestReport({
    db,
    subject,
    projects: input.projects,
    window,
    facts,
    needsYou: input.needsYou ?? NEEDS_YOU_NOT_READ,
    now: input.now ?? new Date()
  });
  const summary = await summarizeReport(report, window, input.narrator);
  const narrative = renderDigestSections(report, summary);

  const relativePath = digestRelativePath(subject.slug, window);
  writeDigestAtomically(input.workspacePath, relativePath, subject, window, facts, narrative, summary, report);

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
      ).run(summary.jobId, JSON.stringify(facts), timestamp, existing.id);
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
      summary.jobId, JSON.stringify(facts), timestamp, timestamp
    );
    digest = db.prepare("SELECT * FROM narrative_digests WHERE id = ?").get(id) as NarrativeDigestRecord;
  });
  transaction();

  return { digest: digest!, artifact: artifact!, facts, narrative, report, summary, created: !existing };
}

/**
 * Real local-preferred narrator, using the durable queue and in-process worker.
 *
 * The CLI reads `.env` from its current directory, so a run from a linked
 * worktree (which has no `.env`) has no LiteLLM proxy key. Executing the job
 * here would send it unauthenticated and LiteLLM would block it with 401
 * ("No api key passed in"). Without a key this process therefore leaves the
 * queued job to the Arcadia Intelligence service, which is launched from the
 * main checkout and does hold the key. With a key it runs only its own job.
 */
export function createIntelligenceDigestNarrator(
  db: Database.Database,
  workspacePath: string,
  env: NodeJS.ProcessEnv = process.env
): DigestNarrator {
  const repository = createSqliteIntelligenceJobRepository(db);
  const artifactStore = createSqliteIntelligenceArtifactStore(db, workspacePath);
  const config = loadIntelligenceConfig(env);
  const worker = config.liteLlmApiKey
    ? new IntelligenceWorker(repository, createLiteLlmHttpClient({
      baseUrl: config.liteLlmBaseUrl,
      apiKey: config.liteLlmApiKey,
      timeoutMs: DIGEST_TIMEOUT_MS
    }), config, artifactStore)
    : undefined;

  return async (input) => {
    const request = buildNarrativeDigestRequest({ subject: input.subject, window: input.window, facts: input.facts });
    const { job: submitted } = await submitIntelligenceRequest(repository, request);
    const deadline = Date.now() + DIGEST_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const current = await repository.findById(submitted.id);
      if (!current) throw new NarrativeDigestUnavailableError(`Digest job disappeared: ${submitted.id}`);
      if (current.status === "completed") {
        return { summary: normalizeSummary(current.result), jobId: current.id };
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
      if (worker) await worker.runJob(submitted.id);
      await new Promise((resolve) => setTimeout(resolve, worker ? 100 : 500));
    }
    throw new NarrativeDigestUnavailableError(
      worker
        ? `Timed out waiting for digest job ${submitted.id}.`
        : `Timed out waiting for digest job ${submitted.id}. ARCADIA_LITELLM_API_KEY is not set in this process ` +
          `(Arcadia reads .env from the current directory, ${process.cwd()}), so the job was left for the ` +
          "Arcadia Intelligence service, which did not complete it. Check `scripts/services.sh status`, " +
          "or run the command through the `arcadia` launcher."
    );
  };
}

function normalizeSummary(raw: unknown): string {
  const summary = raw && typeof raw === "object" && "summary" in raw
    ? (raw as { summary?: unknown }).summary
    : undefined;
  if (typeof summary !== "string" || !summary.trim()) {
    throw new NarrativeDigestInvalidResultError("Digest result must contain a non-empty summary.");
  }
  return summary.trim();
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
  narrative: string,
  summary: DigestSummary,
  report: DigestReport
): void {
  const projectName = subject.name;
  const target = path.join(workspacePath, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const body = [
    "---",
    "artifact_type: narrative_digest",
    // Only the headline can be model-written; say which it is.
    `narration: ${summary.source === "ai" ? "local-ai" : "deterministic"}`,
    ...(summary.fallbackReason ? [`summary_fallback_reason: ${JSON.stringify(summary.fallbackReason)}`] : []),
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
    "",
    DIGEST_DETAIL_MARKER,
    "",
    renderDigestDetail(facts, report.operatorInteractions),
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
