import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { createArtifactRecord } from "../db/repositories.js";
import { createSqliteIntelligenceArtifactStore } from "../intelligence/artifacts/store.js";
import { loadIntelligenceConfig } from "../intelligence/config/defaults.js";
import { createSqliteIntelligenceJobRepository } from "../intelligence/db/sqliteRepository.js";
import { IntelligenceWorker } from "../intelligence/jobs/worker.js";
import { createLiteLlmHttpClient } from "../intelligence/litellm/httpClient.js";
import { submitIntelligenceRequest } from "../intelligence/service/jobService.js";
import type { IntelligenceRequest, JsonValue } from "../intelligence/types.js";
import type { NarrativeDoc } from "./types.js";

export const NARRATIVE_SUMMARY_ARTIFACT = "narrative_summary";
export const NARRATIVE_SUMMARY_OPERATION_ID = "arcadia.docs.summarize-narrative";
export const NARRATIVE_SUMMARY_SCHEMA_ID = "arcadia.narrative-summary.v1";
const NARRATIVE_SUMMARY_TIMEOUT_MS = 180_000;

export const NARRATIVE_SUMMARY_JSON_SCHEMA: JsonValue = {
  type: "object",
  properties: {
    summary: { type: "string" }
  },
  required: ["summary"],
  additionalProperties: false
};

const INSTRUCTIONS =
  "Summarize the supplied narrative document. Summarize only what the document states; do not judge, grade, recommend, or invent. " +
  "Return JSON with exactly one field, summary.";

export class NarrativeSummaryUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NarrativeSummaryUnavailableError";
  }
}

export class NarrativeSummaryInvalidResultError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NarrativeSummaryInvalidResultError";
  }
}

export interface NarrativeSummaryResult {
  summary: string;
  jobId: string | null;
}

export type NarrativeSummarizer = (input: {
  project: { id: string; name: string };
  doc: NarrativeDoc;
  sourceHash: string;
}) => Promise<NarrativeSummaryResult>;

export interface NarrativeSummaryOutcome {
  relativePath: string;
  status: "created" | "unchanged";
  artifactId: string | null;
  artifactPath: string | null;
}

/**
 * One local-preferred summarization request for one narrative document.
 *
 * The idempotency key carries the source content hash, so a document that has
 * not changed never queues a second job for the same text.
 */
export function buildNarrativeSummaryRequest(input: {
  project: { id: string; name: string };
  doc: NarrativeDoc;
  sourceHash: string;
}): IntelligenceRequest {
  return {
    idempotencyKey: ["narrative-summary", input.project.id, input.doc.relativePath, input.sourceHash].join(":"),
    operationId: NARRATIVE_SUMMARY_OPERATION_ID,
    clientApp: "arcadia-docs",
    projectId: input.project.id,
    capability: "text.generate",
    execution: "local-preferred",
    profile: "fast",
    input: {
      instructions: INSTRUCTIONS,
      project: { id: input.project.id, name: input.project.name },
      document: {
        path: input.doc.relativePath,
        type: input.doc.type,
        slug: input.doc.slug,
        updated: input.doc.updated,
        body: input.doc.body
      }
    },
    requirements: { structuredOutput: true },
    outputContract: {
      schemaId: NARRATIVE_SUMMARY_SCHEMA_ID,
      schemaVersion: 1,
      jsonSchema: NARRATIVE_SUMMARY_JSON_SCHEMA
    },
    template: { id: "arcadia.docs.summarize-narrative", version: "1" },
    executionPolicy: { allowPaidUsage: false, maxRetries: 1 }
  };
}

/** Real local-preferred summarizer, using the durable queue and in-process worker. */
export function createIntelligenceNarrativeSummarizer(
  db: Database.Database,
  workspacePath: string
): NarrativeSummarizer {
  const repository = createSqliteIntelligenceJobRepository(db);
  const artifactStore = createSqliteIntelligenceArtifactStore(db, workspacePath);
  const config = loadIntelligenceConfig(process.env);
  const worker = new IntelligenceWorker(repository, createLiteLlmHttpClient({
    baseUrl: config.liteLlmBaseUrl,
    apiKey: config.liteLlmApiKey,
    timeoutMs: NARRATIVE_SUMMARY_TIMEOUT_MS
  }), config, artifactStore);

  return async (input) => {
    const request = buildNarrativeSummaryRequest(input);
    const { job: submitted } = await submitIntelligenceRequest(repository, request);
    const deadline = Date.now() + NARRATIVE_SUMMARY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const current = await repository.findById(submitted.id);
      if (!current) throw new NarrativeSummaryUnavailableError(`Summary job disappeared: ${submitted.id}`);
      if (current.status === "completed") {
        return { summary: normalizeSummary(current.result), jobId: current.id };
      }
      if (current.status === "blocked") {
        throw new NarrativeSummaryUnavailableError(
          `Cannot reach the local model (${current.error?.code ?? "UNKNOWN"}): ${current.error?.message ?? "no detail"}`
        );
      }
      if (current.status === "failed") {
        throw new NarrativeSummaryInvalidResultError(
          `Summary failed (${current.error?.code ?? "UNKNOWN"}): ${current.error?.message ?? "no detail"}`
        );
      }
      await worker.runOnce();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new NarrativeSummaryUnavailableError(`Timed out waiting for summary job ${submitted.id}.`);
  };
}

/**
 * Queue one summarization per narrative document and store each summary as a
 * `narrative_summary` Artifact under the workspace. The source document is only
 * read: nothing is ever written back into it.
 *
 * A document whose content hash already has a stored summary is reported as
 * `unchanged` and costs nothing, so re-running a sync is idempotent.
 */
export async function summarizeNarrativeDocs(input: {
  db: Database.Database;
  workspacePath: string;
  project: { id: string; slug: string; name: string };
  docs: NarrativeDoc[];
  summarizer: NarrativeSummarizer;
}): Promise<NarrativeSummaryOutcome[]> {
  const outcomes: NarrativeSummaryOutcome[] = [];

  for (const doc of input.docs) {
    const sourceHash = sha256(doc.body);
    const artifactPath = summaryRelativePath(input.project.slug, doc, sourceHash);
    const existing = input.db.prepare(
      "SELECT id FROM artifacts WHERE project_id = ? AND artifact_type = ? AND path = ?"
    ).get(input.project.id, NARRATIVE_SUMMARY_ARTIFACT, artifactPath) as { id: string } | undefined;

    if (existing) {
      outcomes.push({ relativePath: doc.relativePath, status: "unchanged", artifactId: existing.id, artifactPath });
      continue;
    }

    const narrated = await input.summarizer({ project: input.project, doc, sourceHash });
    const summary = requireSummary(narrated.summary);
    writeSummaryAtomically(input.workspacePath, artifactPath, { doc, sourceHash, jobId: narrated.jobId, summary, project: input.project });

    const artifact = createArtifactRecord(input.db, {
      projectId: input.project.id,
      title: `${input.project.name} ${doc.type} summary — ${doc.relativePath}`,
      artifactType: NARRATIVE_SUMMARY_ARTIFACT,
      status: "ready",
      path: artifactPath
    });
    outcomes.push({ relativePath: doc.relativePath, status: "created", artifactId: artifact.id, artifactPath });
  }

  return outcomes;
}

function summaryRelativePath(projectSlug: string, doc: NarrativeDoc, sourceHash: string): string {
  return path.join("artifacts", "narrative-summaries", projectSlug, `${doc.slug}-${sourceHash.slice(0, 12)}.md`);
}

function writeSummaryAtomically(
  workspacePath: string,
  relativePath: string,
  input: {
    doc: NarrativeDoc;
    sourceHash: string;
    jobId: string | null;
    summary: string;
    project: { slug: string };
  }
): void {
  const target = path.join(workspacePath, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const body = [
    "---",
    `artifact_type: ${NARRATIVE_SUMMARY_ARTIFACT}`,
    "narration: local-ai",
    `project: ${input.project.slug}`,
    `source: ${input.doc.relativePath}`,
    `source_sha256: ${input.sourceHash}`,
    `intelligence_job_id: ${input.jobId ?? "none"}`,
    "---",
    "",
    `# Summary of ${input.doc.relativePath}`,
    "",
    input.summary,
    ""
  ].join("\n");
  writeFileSync(temporary, body, "utf8");
  renameSync(temporary, target);
}

function normalizeSummary(raw: unknown): string {
  const summary = raw && typeof raw === "object" && "summary" in raw
    ? (raw as { summary?: unknown }).summary
    : undefined;
  return requireSummary(summary);
}

function requireSummary(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new NarrativeSummaryInvalidResultError("Summary result must contain a non-empty summary.");
  }
  return value.trim();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
