import type Database from "better-sqlite3";
import { CLARIFICATION_CONFIDENCE_LEVELS, GAP_TYPES } from "../domain/constants.js";
import type { ClarificationConfidence, GapType } from "../domain/constants.js";
import type { WorkItemSummary } from "../domain/types.js";
import { createSqliteIntelligenceArtifactStore } from "../intelligence/artifacts/store.js";
import { loadIntelligenceConfig } from "../intelligence/config/defaults.js";
import { createSqliteIntelligenceJobRepository } from "../intelligence/db/sqliteRepository.js";
import { IntelligenceWorker } from "../intelligence/jobs/worker.js";
import { createLiteLlmHttpClient } from "../intelligence/litellm/httpClient.js";
import { submitIntelligenceRequest } from "../intelligence/service/jobService.js";
import type { IntelligenceJob } from "../intelligence/types.js";
import { buildClarifyRequest, CLARIFY_ACTORS, type ClarifyActor } from "./contract.js";
import type { ClarifyEvaluator, ClarifyVerdict } from "./types.js";

/** A local model can be slow to warm; a batch pass tolerates that better than a failure. */
const CLARIFY_TIMEOUT_MS = 180_000;

export class ClarifyEngineUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ClarifyEngineUnavailableError";
  }
}

export class ClarifyVerdictUnusableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ClarifyVerdictUnusableError";
  }
}

/**
 * The real evaluator: one Intelligence job per Action, run in-process rather
 * than waiting on the worker daemon's poll loop, mirroring
 * `interpretOrientationReply`.
 */
export function createIntelligenceEvaluator(db: Database.Database, workspacePath: string): ClarifyEvaluator {
  const repository = createSqliteIntelligenceJobRepository(db);
  const artifactStore = createSqliteIntelligenceArtifactStore(db, workspacePath);
  const config = loadIntelligenceConfig(process.env);
  const liteLlmClient = createLiteLlmHttpClient({
    baseUrl: config.liteLlmBaseUrl,
    apiKey: config.liteLlmApiKey,
    timeoutMs: CLARIFY_TIMEOUT_MS
  });
  const worker = new IntelligenceWorker(repository, liteLlmClient, config, artifactStore);

  return async (workItem: WorkItemSummary): Promise<ClarifyVerdict> => {
    const request = buildClarifyRequest(workItem, {
      idempotencyKey: `clarify-${workItem.id}-${workItem.updated_at}`
    });
    const { job: submitted } = await submitIntelligenceRequest(repository, request);
    const finished = await worker.runOnce();
    const job: IntelligenceJob | undefined =
      finished?.id === submitted.id ? finished : await repository.findById(submitted.id);

    if (!job) {
      throw new ClarifyEngineUnavailableError(`Clarify job disappeared after submission for ${workItem.id}.`);
    }

    if (job.status === "blocked") {
      throw new ClarifyEngineUnavailableError(
        `Cannot reach the local model right now (${job.error?.code ?? "UNKNOWN"}): ${job.error?.message ?? "no detail"}`
      );
    }

    if (job.status !== "completed") {
      throw new ClarifyVerdictUnusableError(
        `Clarify job did not complete for ${workItem.id} (${job.error?.code ?? "UNKNOWN"}): ${job.error?.message ?? "no detail"}`
      );
    }

    return normalizeVerdict(job.result);
  };
}

/**
 * Coerce a raw model result into a verdict, or refuse it.
 *
 * A schema-shaped response is not automatically a usable one: a verdict of
 * "clarified" with no next action, or a gap type outside the taxonomy, would
 * write nonsense into the columns the whole feature is built on. Refusing here
 * costs one skipped Action; accepting would silently corrupt the queue.
 */
export function normalizeVerdict(raw: unknown): ClarifyVerdict {
  const value = (raw ?? {}) as Record<string, unknown>;
  const verdict = typeof value.verdict === "string" ? value.verdict.trim() : "";

  if (verdict === "clarified") {
    const nextAction = text(value.nextAction);
    if (!nextAction) {
      throw new ClarifyVerdictUnusableError('A "clarified" verdict must name a next action.');
    }

    return {
      verdict: "clarified",
      nextAction,
      actor: normalizeActor(value.actor),
      source: text(value.source) ?? "unspecified",
      confidence: normalizeConfidence(value.confidence) ?? "low"
    };
  }

  if (verdict === "question_open") {
    const question = text(value.question);
    if (!question) {
      throw new ClarifyVerdictUnusableError('A "question_open" verdict must carry exactly one question.');
    }

    const gapType = text(value.gapType);
    if (!gapType || !(GAP_TYPES as readonly string[]).includes(gapType)) {
      throw new ClarifyVerdictUnusableError(
        `A "question_open" verdict must classify the gap as one of: ${GAP_TYPES.join(", ")}.`
      );
    }

    return {
      verdict: "question_open",
      gapType: gapType as GapType,
      question,
      criteria: stringList(value.criteria),
      decomposition: stringList(value.decomposition),
      draftAsk: text(value.draftAsk),
      confidence: normalizeConfidence(value.confidence)
    };
  }

  throw new ClarifyVerdictUnusableError(
    `Verdict must be "clarified" or "question_open", got ${JSON.stringify(value.verdict)}.`
  );
}

/**
 * An unrecognized actor falls back to the operator rather than being rejected:
 * routing an Action to a human for a second look is always safe, whereas
 * guessing "coding-agent" would hand unreviewed work to an executor.
 */
function normalizeActor(value: unknown): ClarifyActor {
  const candidate = text(value)?.toLowerCase();
  return candidate && (CLARIFY_ACTORS as readonly string[]).includes(candidate)
    ? (candidate as ClarifyActor)
    : "operator";
}

function normalizeConfidence(value: unknown): ClarificationConfidence | undefined {
  const candidate = text(value)?.toLowerCase();
  return candidate && (CLARIFICATION_CONFIDENCE_LEVELS as readonly string[]).includes(candidate)
    ? (candidate as ClarificationConfidence)
    : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.map((entry) => text(entry)).filter((entry): entry is string => Boolean(entry));
  return items.length > 0 ? items : undefined;
}
