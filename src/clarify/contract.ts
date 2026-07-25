import { CLARIFICATION_CONFIDENCE_LEVELS, GAP_TYPES } from "../domain/constants.js";
import type { IntelligenceRequest, JsonValue } from "../intelligence/types.js";
import type { WorkItemSummary } from "../domain/types.js";

/**
 * The rubric's `actor` vocabulary. It is not the same as Arcadia's
 * Responsibility values — the model is asked "who physically does this?", which
 * is a smaller and more answerable question than which queue the work belongs
 * in. `RESPONSIBILITY_FOR_ACTOR` does the mapping, so the model never has to
 * know Arcadia's internal vocabulary.
 */
export const CLARIFY_ACTORS = ["operator", "coding-agent", "external-party"] as const;
export type ClarifyActor = (typeof CLARIFY_ACTORS)[number];

export const RESPONSIBILITY_FOR_ACTOR: Record<ClarifyActor, "requires_review" | "codex" | "blocked"> = {
  operator: "requires_review",
  "coding-agent": "codex",
  "external-party": "blocked"
};

/**
 * The clarification rubric as a JSON schema.
 *
 * `verdict` splits the two outcomes rather than making every field optional:
 * a YES must carry a concrete next action, and a NO must carry exactly one gap
 * type and exactly one question. Leaving both shapes in one flat object is how
 * a model ends up returning a next action *and* a question, which is precisely
 * the ambiguity this feature exists to remove.
 */
export const CLARIFY_JSON_SCHEMA: JsonValue = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["clarified", "question_open"] },
    // Present when verdict = clarified.
    nextAction: { type: "string" },
    actor: { type: "string", enum: [...CLARIFY_ACTORS] },
    source: { type: "string" },
    confidence: { type: "string", enum: [...CLARIFICATION_CONFIDENCE_LEVELS] },
    // Present when verdict = question_open.
    gapType: { type: "string", enum: [...GAP_TYPES] },
    question: { type: "string" },
    criteria: { type: "array", items: { type: "string" } },
    decomposition: { type: "array", items: { type: "string" } },
    draftAsk: { type: "string" }
  },
  required: ["verdict"]
};

export const CLARIFY_SCHEMA_ID = "arcadia.clarify.verdict.v1";
export const CLARIFY_OPERATION_ID = "arcadia.clarify.evaluate-action";

const RUBRIC =
  "You are performing GTD's clarify step on one Action. Answer exactly one question: " +
  "can you name one concrete, physical next action — something a person or a coding agent " +
  "could start in their next work session? " +
  'If YES, set verdict to "clarified" and give nextAction (one sentence, starts with a verb, ' +
  "physically doable), actor (who does it), source (which Action detail or linked document " +
  "justified it), and confidence. " +
  'If NO, set verdict to "question_open" and classify the gap as exactly ONE gapType: ' +
  '"missing-decision" (a choice has not been made — also give 2-4 criteria that matter), ' +
  '"missing-external-input" (waiting on someone or something outside — also give a draftAsk), ' +
  '"missing-definition" (this is a problem label, not an action — also give a decomposition of ' +
  "2-5 proposed subtasks), or " +
  '"missing-success-criteria" (the action is clear but "done" is not). ' +
  "Then give exactly ONE question: the single highest-leverage question whose answer unblocks " +
  "this Action. Not a list. One question, asking for specific information. " +
  "Never invent facts about the Action that are not in the material you were given, and never " +
  "refer to the operator by a personal name — say \"the operator\".";

/**
 * Build the Intelligence request for one Action.
 *
 * Deterministic apart from the idempotency key, so a test can assert the whole
 * request as a golden fixture. Local-preferred and unpaid: clarification runs
 * over every unclarified Action in a project, and a pass that quietly bills a
 * frontier model per Action is not one anybody would leave running.
 */
export function buildClarifyRequest(
  workItem: WorkItemSummary,
  options: { idempotencyKey: string; projectGoal?: string | null } = { idempotencyKey: "" }
): IntelligenceRequest {
  return {
    idempotencyKey: options.idempotencyKey || `clarify-${workItem.id}-${workItem.updated_at}`,
    operationId: CLARIFY_OPERATION_ID,
    clientApp: "arcadia-clarify",
    projectId: workItem.project_id ?? undefined,
    capability: "text.generate",
    execution: "local-preferred",
    profile: "fast",
    input: {
      instructions: RUBRIC,
      action: {
        title: workItem.title,
        rawInput: workItem.raw_input,
        currentNextAction: workItem.next_action,
        expectedArtifact: workItem.expected_artifact,
        project: workItem.project_name,
        projectGoal: options.projectGoal ?? null,
        milestone: workItem.milestone_title,
        // A question already asked, and its answer, are the most valuable
        // context a re-clarify has. Without them the pass would ask the same
        // question again.
        priorQuestion: workItem.open_question,
        priorSource: workItem.clarification_source
      }
    },
    outputContract: {
      schemaId: CLARIFY_SCHEMA_ID,
      schemaVersion: 1,
      jsonSchema: CLARIFY_JSON_SCHEMA
    },
    template: { id: "arcadia.clarify.rubric", version: "1" },
    executionPolicy: { allowPaidUsage: false, maxRetries: 1 }
  };
}
