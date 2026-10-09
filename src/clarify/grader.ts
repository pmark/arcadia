import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { GAP_TYPES } from "../domain/constants.js";
import type { GapType } from "../domain/constants.js";
import type { WorkItemSummary } from "../domain/types.js";
import type { IntelligenceRequest, JsonValue } from "../intelligence/types.js";
import { createClarifyJobRunner, ClarifyVerdictUnusableError, type ClarifyJobRunner } from "./engine.js";
import type { ClarifySourceMaterial } from "./lint.js";
import type { ClarifiedVerdict } from "./types.js";

/**
 * The separate grader for a clarified verdict.
 *
 * A generator never grades its own output. After the deterministic lint
 * passes, this module asks a second, differently-prompted local Intelligence
 * call whether the candidate is actually actionable. The criteria live in
 * `.agents/skills/next-action-grader/SKILL.md`; `GRADER_CRITERIA` carries the
 * same text and a test fails when they differ. The grader is never shown the
 * generator's confidence or its stated justification.
 *
 * Independence: the grader requests the `standard` local text profile, the
 * generator the `fast` one. Both resolve to the same local model alias unless
 * the route configuration separates them, so only prompt independence is
 * claimed by default (see SKILL.md).
 */

export const GRADER_OPERATION_ID = "arcadia.clarify.grade-next-action";
export const GRADER_SCHEMA_ID = "arcadia.clarify.grade.v1";
export const GRADER_PROFILE = "standard";
export const GRADER_RECEIPT_SCHEMA = "arcadia-clarify-grader-receipt-v1";

export const GRADER_CRITERIA: ReadonlyArray<{ id: string; text: string }> = [
  {
    id: "concrete-verb",
    text:
      "The next action opens with one concrete imperative verb naming a single physical act, such as Add, Run, Write, Call or Open. " +
      "Vague verbs such as think about, look into, handle, sort out, figure out or improve fail."
  },
  {
    id: "startable-first-step",
    text:
      "The first physical step can be started by the named actor in under 15 minutes with what that actor already has. " +
      "A step that first needs another person, an access grant, a decision or a missing input fails."
  },
  {
    id: "observable-done",
    text:
      "The done-condition names an output, a file, a command result or a state that a third party could check. " +
      "A feeling, an intention or a restatement of the next action fails."
  },
  {
    id: "no-invented-facts",
    text:
      "The next action and done-condition rely on no file path, identifier, name, number, tool or fact that is absent from the source material."
  },
  {
    id: "one-missing-item",
    text:
      "When any criterion above fails because information is missing, the request asks for exactly that one item as a single question. " +
      "A list of questions, advice or a restated criterion fails."
  }
];

/** The criteria exactly as SKILL.md prints them between its markers. */
export function renderGraderCriteria(): string {
  return GRADER_CRITERIA.map((criterion, index) => `${index + 1}. ${criterion.id}: ${criterion.text}`).join("\n");
}

const GRADER_CRITERION_IDS: ReadonlySet<string> = new Set(GRADER_CRITERIA.map((criterion) => criterion.id));

export const GRADER_INSTRUCTIONS =
  "You are a grader, separate from the model that proposed the candidate below. " +
  "Decide whether the candidate next action and done-condition are actionable, using only these criteria:\n" +
  `${renderGraderCriteria()}\n` +
  'Set grade to "pass" only when every criterion holds; otherwise set grade to "fail", list the failed criterion ids in ' +
  "failedCriteria, give a one-sentence reason, set gapType to exactly one of " +
  `${GAP_TYPES.join(", ")}, and set request to the single question that asks for exactly the one missing item. ` +
  "Judge only what is written in the candidate and the source material. Never invent facts to rescue a candidate, " +
  'and never refer to the operator by a personal name — say "the operator".';

export const GRADER_JSON_SCHEMA: JsonValue = {
  type: "object",
  properties: {
    grade: { type: "string", enum: ["pass", "fail"] },
    failedCriteria: { type: "array", items: { type: "string" } },
    reason: { type: "string" },
    // Deliberately not schema-required: a reply that fails output validation
    // becomes a failed job the idempotency key keeps reusing. `normalizeGrade`
    // enforces the single request on a fail instead.
    request: { type: "string" },
    gapType: { type: "string", enum: [...GAP_TYPES] }
  },
  required: ["grade"]
};

/** What the grader is asked to judge. The generator's confidence and justification are deliberately absent. */
export interface GraderCandidate {
  nextAction: string;
  doneCondition: string;
  actor: ClarifiedVerdict["actor"];
}

export interface GraderInput {
  workItem: WorkItemSummary;
  candidate: GraderCandidate;
  source: ClarifySourceMaterial;
}

/** What is stored for one grade, on a `clarify.grader.verdict` event payload. */
export interface GraderReceipt {
  schema: typeof GRADER_RECEIPT_SCHEMA;
  grader: { id: string; operationId: string; profile: string };
  promptSha256: string;
  inputSha256: string;
  verdict: "pass" | "fail";
  failedCriteria: string[];
  reason: string;
  request?: string;
}

export interface GraderOutcome {
  grade: "pass" | "fail";
  failedCriteria: string[];
  reason: string;
  /** Set on a fail: the single information request. */
  request?: string;
  gapType?: GapType;
  receipt: GraderReceipt;
}

export type ClarifyGrader = (input: GraderInput) => Promise<GraderOutcome>;

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** The case under grading, as hashed into the receipt. */
export function graderInputPayload(input: GraderInput): JsonValue {
  return {
    candidate: {
      nextAction: input.candidate.nextAction,
      doneCondition: input.candidate.doneCondition,
      actor: input.candidate.actor
    },
    source: {
      title: input.source.title ?? null,
      rawInput: input.source.rawInput ?? null,
      currentNextAction: input.source.currentNextAction ?? null,
      expectedArtifact: input.source.expectedArtifact ?? null,
      priorQuestion: input.source.priorQuestion ?? null,
      priorAnswer: input.source.priorAnswer ?? null
    }
  };
}

export function graderInputSha256(input: GraderInput): string {
  return sha256Hex(JSON.stringify(graderInputPayload(input)));
}

export function graderPromptSha256(): string {
  return sha256Hex(GRADER_INSTRUCTIONS);
}

/**
 * The key names the item, the prompt and the case, so a reused job always
 * belongs to the criteria now in force. `attempt` 0 is the first try; a later
 * attempt adds a suffix so a completed-but-unusable result is not re-read
 * forever.
 */
export function graderIdempotencyKey(input: GraderInput, attempt = 0): string {
  const base = `grade-${input.workItem.id}-${graderPromptSha256().slice(0, 8)}-${graderInputSha256(input).slice(0, 16)}`;
  return attempt > 0 ? `${base}-retry${attempt}` : base;
}

export function buildGraderRequest(input: GraderInput, attempt = 0): IntelligenceRequest {
  return {
    idempotencyKey: graderIdempotencyKey(input, attempt),
    operationId: GRADER_OPERATION_ID,
    clientApp: "arcadia-clarify",
    projectId: input.workItem.project_id ?? undefined,
    capability: "text.generate",
    // Local-preferred and unpaid: grading never escalates to a paid model.
    execution: "local-preferred",
    profile: GRADER_PROFILE,
    input: {
      instructions: GRADER_INSTRUCTIONS,
      ...(graderInputPayload(input) as Record<string, JsonValue>)
    },
    outputContract: {
      schemaId: GRADER_SCHEMA_ID,
      schemaVersion: 1,
      jsonSchema: GRADER_JSON_SCHEMA
    },
    template: { id: "arcadia.clarify.grader", version: "1" },
    executionPolicy: { allowPaidUsage: false, maxRetries: 1 }
  };
}

/**
 * Coerce a raw grader result into an outcome, or refuse it. A fail must carry
 * exactly one request: without it there is nothing to put to the operator, so
 * the grade is unusable and the item stays as it was.
 */
export function normalizeGrade(
  raw: unknown,
  context: { grader: GraderReceipt["grader"]; promptSha256: string; inputSha256: string }
): GraderOutcome {
  const value = (raw ?? {}) as Record<string, unknown>;
  const grade = typeof value.grade === "string" ? value.grade.trim().toLowerCase() : "";
  if (grade !== "pass" && grade !== "fail") {
    throw new ClarifyVerdictUnusableError(`Grade must be "pass" or "fail", got ${JSON.stringify(value.grade)}.`);
  }

  const reason = text(value.reason) ?? "no reason given";
  const failedCriteria = Array.isArray(value.failedCriteria)
    ? value.failedCriteria
        .map((entry) => text(entry))
        .filter((entry): entry is string => Boolean(entry) && GRADER_CRITERION_IDS.has(entry as string))
    : [];

  if (grade === "pass") {
    return {
      grade,
      failedCriteria: [],
      reason,
      receipt: { schema: GRADER_RECEIPT_SCHEMA, ...context, verdict: "pass", failedCriteria: [], reason }
    };
  }

  const request = text(value.request);
  if (!request) {
    throw new ClarifyVerdictUnusableError('A "fail" grade must carry exactly one information request.');
  }
  const gapCandidate = text(value.gapType);
  const gapType: GapType =
    gapCandidate && (GAP_TYPES as readonly string[]).includes(gapCandidate)
      ? (gapCandidate as GapType)
      : "missing-definition";

  return {
    grade,
    failedCriteria,
    reason,
    request,
    gapType,
    receipt: { schema: GRADER_RECEIPT_SCHEMA, ...context, verdict: "fail", failedCriteria, reason, request }
  };
}

/** One retry of a completed job whose result `normalizeGrade` refused. */
const GRADER_MAX_UNUSABLE_RETRIES = 1;

/**
 * The real grader: one local Intelligence job per candidate, on the same
 * in-process runner as the generator. A completed job is reused by its
 * idempotency key, so an unusable result would otherwise be re-read on every
 * later run. The first unusable result is therefore retried once under a
 * retry-suffixed key; if that is unusable too, the failure says the item needs
 * operator attention rather than skipping silently. `run` is injectable for
 * tests.
 */
export function createIntelligenceGrader(
  db: Database.Database,
  workspacePath: string,
  run: ClarifyJobRunner = createClarifyJobRunner(db, workspacePath)
): ClarifyGrader {
  return async (input: GraderInput): Promise<GraderOutcome> => {
    const promptSha256 = graderPromptSha256();
    const inputSha256 = graderInputSha256(input);

    for (let attempt = 0; ; attempt += 1) {
      const job = await run(buildGraderRequest(input, attempt), `${input.workItem.id} (grader)`);
      try {
        return normalizeGrade(job.result, {
          grader: {
            id: job.selectedRoute ?? `intelligence:${GRADER_PROFILE}`,
            operationId: GRADER_OPERATION_ID,
            profile: GRADER_PROFILE
          },
          promptSha256,
          inputSha256
        });
      } catch (error) {
        if (!(error instanceof ClarifyVerdictUnusableError)) {
          throw error;
        }
        if (attempt >= GRADER_MAX_UNUSABLE_RETRIES) {
          throw new ClarifyVerdictUnusableError(
            `Grader result unusable after ${attempt + 1} attempts for ${input.workItem.id}; needs operator attention ` +
              `(it will not be retried until the Action or the grader criteria change): ${error.message}`
          );
        }
      }
    }
  };
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
