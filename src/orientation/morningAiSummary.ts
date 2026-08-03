import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { createSqliteIntelligenceArtifactStore } from "../intelligence/artifacts/store.js";
import { loadIntelligenceConfig } from "../intelligence/config/defaults.js";
import { createSqliteIntelligenceJobRepository } from "../intelligence/db/sqliteRepository.js";
import { IntelligenceWorker } from "../intelligence/jobs/worker.js";
import { createLiteLlmHttpClient } from "../intelligence/litellm/httpClient.js";
import { retryIntelligenceJob, submitIntelligenceRequest } from "../intelligence/service/jobService.js";
import type { IntelligenceRequest, JsonValue } from "../intelligence/types.js";

const MORNING_AI_TIMEOUT_MS = 180_000;

export interface MorningAiSummary {
  headline: string;
  paragraph: string;
}

export type MorningAiSummarizer = (input: {
  localDate: string;
  sourceNarrative: string;
  projectNames: string[];
}) => Promise<MorningAiSummary>;

export const MORNING_AI_SUMMARY_JSON_SCHEMA: JsonValue = {
  type: "object",
  properties: {
    headline: { type: "string" },
    paragraph: { type: "string" }
  },
  required: ["headline", "paragraph"],
  additionalProperties: false
};

export function buildMorningAiSummaryRequest(input: {
  localDate: string;
  sourceNarrative: string;
  projectNames?: string[];
}): IntelligenceRequest {
  const sourceHash = createHash("sha256").update(input.sourceNarrative).digest("hex").slice(0, 24);
  return {
    idempotencyKey: `morning-ai-summary-v6:${input.localDate}:${sourceHash}`,
    operationId: "arcadia.orientation.morning-ai-summary",
    clientApp: "arcadia-orientation",
    capability: "text.generate",
    execution: "local-preferred",
    profile: "fast",
    input: {
      instructions:
        "Orient the operator using only the supplied Arcadia morning narrative. Return a short, interesting single-line headline and exactly one concise paragraph explaining what was done and why it matters. " +
        "When the evidence supports it, identify one implication, opportunity, velocity concern, or inefficiency. The projectNames array is exhaustive: only those names are Projects. Preserve them exactly; quoted text may be an Action title and must never be called a Project. " +
        "Do not invent work, outcomes, causes, benefits, or intent; state uncertainty plainly. Do not repeat the date. Return JSON only.",
      localDate: input.localDate,
      projectNames: input.projectNames ?? [],
      sourceNarrative: `Only these are Projects: ${(input.projectNames ?? []).join(", ") || "none identified"}.\n\n${input.sourceNarrative}`
    },
    requirements: { structuredOutput: true },
    outputContract: {
      schemaId: "arcadia.morning-ai-summary.v1",
      schemaVersion: 1,
      jsonSchema: MORNING_AI_SUMMARY_JSON_SCHEMA
    },
    template: { id: "arcadia.orientation.morning-ai-summary", version: "1" },
    executionPolicy: { allowPaidUsage: false, maxRetries: 1 }
  };
}

export function createIntelligenceMorningAiSummarizer(
  db: Database.Database,
  workspacePath: string
): MorningAiSummarizer {
  const repository = createSqliteIntelligenceJobRepository(db);
  const artifactStore = createSqliteIntelligenceArtifactStore(db, workspacePath);
  const config = loadIntelligenceConfig(process.env);
  const worker = new IntelligenceWorker(repository, createLiteLlmHttpClient({
    baseUrl: config.liteLlmBaseUrl,
    apiKey: config.liteLlmApiKey,
    timeoutMs: MORNING_AI_TIMEOUT_MS
  }), config, artifactStore);

  return async (input) => {
    const request = buildMorningAiSummaryRequest(input);
    const { job: submitted } = await submitIntelligenceRequest(repository, request);
    if ((submitted.status === "blocked" || submitted.status === "failed") && submitted.retryCount < request.executionPolicy.maxRetries) {
      await retryIntelligenceJob(repository, submitted.id, request.executionPolicy.maxRetries);
    }
    const deadline = Date.now() + MORNING_AI_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const current = await repository.findById(submitted.id);
      if (!current) throw new Error(`Morning AI summary job disappeared: ${submitted.id}`);
      if (current.status === "completed") return normalizeMorningAiSummary(current.result);
      if (current.status === "blocked" || current.status === "failed") {
        throw new Error(
          `Morning AI summary ${current.status} (${current.error?.code ?? "UNKNOWN"}): ${current.error?.message ?? "no detail"}`
        );
      }
      await worker.runOnce();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for morning AI summary job ${submitted.id}.`);
  };
}

function normalizeMorningAiSummary(raw: unknown): MorningAiSummary {
  const result = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const headline = typeof result.headline === "string" ? result.headline.replace(/\s+/g, " ").trim() : "";
  const paragraph = typeof result.paragraph === "string" ? result.paragraph.replace(/\s+/g, " ").trim() : "";
  if (!headline || !paragraph) {
    throw new Error("Morning AI summary must contain a non-empty headline and paragraph.");
  }
  return { headline, paragraph };
}
