import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { createSqliteIntelligenceArtifactStore } from "../intelligence/artifacts/store.js";
import { loadIntelligenceConfig } from "../intelligence/config/defaults.js";
import { createSqliteIntelligenceJobRepository } from "../intelligence/db/sqliteRepository.js";
import { IntelligenceWorker } from "../intelligence/jobs/worker.js";
import { createLiteLlmHttpClient } from "../intelligence/litellm/httpClient.js";
import { retryIntelligenceJob, submitIntelligenceRequest } from "../intelligence/service/jobService.js";
import type { IntelligenceRequest, JsonValue } from "../intelligence/types.js";
import { getProjectMetadata, listProjects } from "../db/repositories.js";
import { readRecentSubjects } from "./attention.js";
import type { NowBrief } from "./types.js";

const NOW_NARRATIVE_TIMEOUT_MS = 120_000;

export interface NowNarrative {
  headline: string;
  paragraph: string;
}

export type NowNarrator = (evidence: NowNarrativeEvidence) => Promise<NowNarrative>;

export interface NowNarrativeEvidence {
  target: string;
  targetProject: string | null;
  gatesDone: number;
  gatesRemaining: number;
  gatesStillOpen: string[];
  driftLine: string;
  perProject: Array<{ project: string; commits: number; subjects: string[] }>;
  projectNames: string[];
}

export const NOW_NARRATIVE_JSON_SCHEMA: JsonValue = {
  type: "object",
  properties: {
    headline: { type: "string" },
    paragraph: { type: "string" }
  },
  required: ["headline", "paragraph"],
  additionalProperties: false
};

/**
 * Assemble the evidence the narrative is allowed to use — and nothing else.
 *
 * Commit subjects are the whole input on purpose. They are what the operator
 * actually did, written at the time, and a summary built only from them cannot
 * drift into the vague portfolio-level prose ("activities were primarily
 * focused on dispatch and decision-making") that made the earlier daily report
 * unreadable. That sentence was true and useless; specificity is the fix.
 */
export function collectNarrativeEvidence(
  db: Database.Database,
  brief: NowBrief,
  windowDays: number,
  subjectsPerProject = 12
): NowNarrativeEvidence {
  const projects = listProjects(db);
  const perProject = brief.attention.slices
    .filter((slice) => slice.commits > 0)
    .map((slice) => {
      const project = projects.find((candidate) => candidate.name === slice.projectName);
      const repositoryPath = project ? getProjectMetadata(db, project.id)?.repo_path ?? null : null;
      return {
        project: slice.projectName,
        commits: slice.commits,
        subjects: readRecentSubjects(repositoryPath, windowDays, subjectsPerProject)
      };
    });

  return {
    target: brief.target.text,
    targetProject: brief.target.projectName,
    gatesDone: brief.distance.done,
    gatesRemaining: brief.distance.remaining,
    gatesStillOpen: brief.gates.filter((gate) => gate.status !== "done").slice(0, 5).map((gate) => gate.title),
    driftLine: brief.drift.line,
    perProject,
    projectNames: projects.map((project) => project.name)
  };
}

export function buildNowNarrativeRequest(evidence: NowNarrativeEvidence): IntelligenceRequest {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(evidence))
    .digest("hex")
    .slice(0, 24);

  return {
    idempotencyKey: `now-narrative-v2:${fingerprint}`,
    operationId: "arcadia.north-star.now-narrative",
    clientApp: "arcadia-north-star",
    capability: "text.generate",
    execution: "local-preferred",
    profile: "fast",
    input: {
      instructions:
        "You are writing the single orientation paragraph on an operator's landing screen. Use ONLY the supplied evidence. " +
        "Return a headline of at most nine words naming the most consequential thing that actually happened, and exactly one paragraph of three or four sentences. " +
        "The paragraph must: say concretely what was built, using the specifics in the commit subjects; then say plainly what that did or did not do for the stated target; then name what stands closest to the target now. " +
        "Be specific and concrete. Never write vague summaries such as 'activities were focused on dispatch and decision-making' — name the actual things. " +
        "Do not scold, moralize, or use the words should, must, or failed. Do not invent work, causes, or outcomes not present in the evidence. " +
        "`gatesStillOpen` lists things that have NOT happened yet — never describe them as done, built, or created; they are only what remains. " +
        "Everything that actually happened is in `perProject[].subjects`, and nothing outside that list may be reported as work done. " +
        "The projectNames array is exhaustive: only those names are Projects, and they must be preserved exactly. Return JSON only.",
      ...evidence
    },
    requirements: { structuredOutput: true },
    outputContract: {
      schemaId: "arcadia.now-narrative.v1",
      schemaVersion: 1,
      jsonSchema: NOW_NARRATIVE_JSON_SCHEMA
    },
    template: { id: "arcadia.north-star.now-narrative", version: "1" },
    executionPolicy: { allowPaidUsage: false, maxRetries: 1 }
  };
}

export function createIntelligenceNowNarrator(db: Database.Database, workspacePath: string): NowNarrator {
  const repository = createSqliteIntelligenceJobRepository(db);
  const artifactStore = createSqliteIntelligenceArtifactStore(db, workspacePath);
  const config = loadIntelligenceConfig(process.env);
  const worker = new IntelligenceWorker(
    repository,
    createLiteLlmHttpClient({
      baseUrl: config.liteLlmBaseUrl,
      apiKey: config.liteLlmApiKey,
      timeoutMs: NOW_NARRATIVE_TIMEOUT_MS
    }),
    config,
    artifactStore
  );

  return async (evidence) => {
    const request = buildNowNarrativeRequest(evidence);
    const { job: submitted } = await submitIntelligenceRequest(repository, request);
    if (
      (submitted.status === "blocked" || submitted.status === "failed") &&
      submitted.retryCount < request.executionPolicy.maxRetries
    ) {
      await retryIntelligenceJob(repository, submitted.id, request.executionPolicy.maxRetries);
    }

    const deadline = Date.now() + NOW_NARRATIVE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const current = await repository.findById(submitted.id);
      if (!current) {
        throw new Error(`Now narrative job disappeared: ${submitted.id}`);
      }
      if (current.status === "completed") {
        return normalize(current.result);
      }
      if (current.status === "blocked" || current.status === "failed") {
        throw new Error(
          `Now narrative ${current.status} (${current.error?.code ?? "UNKNOWN"}): ${current.error?.message ?? "no detail"}`
        );
      }
      await worker.runOnce();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for now narrative job ${submitted.id}.`);
  };
}

function normalize(raw: unknown): NowNarrative {
  const result = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const headline = typeof result.headline === "string" ? result.headline.replace(/\s+/g, " ").trim() : "";
  const paragraph = typeof result.paragraph === "string" ? result.paragraph.replace(/\s+/g, " ").trim() : "";
  if (!headline || !paragraph) {
    throw new Error("Now narrative must contain a non-empty headline and paragraph.");
  }
  return { headline, paragraph };
}
