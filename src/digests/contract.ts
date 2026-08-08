import { createHash } from "node:crypto";
import type { IntelligenceRequest, JsonValue } from "../intelligence/types.js";
import type { DigestFact, DigestSubject, DigestWindow } from "./types.js";

export const NARRATIVE_DIGEST_OPERATION_ID = "arcadia.digest.compose-project";
export const PORTFOLIO_DIGEST_OPERATION_ID = "arcadia.digest.compose-portfolio";
export const NARRATIVE_DIGEST_SCHEMA_ID = "arcadia.narrative-digest.v1";

export const NARRATIVE_DIGEST_JSON_SCHEMA: JsonValue = {
  type: "object",
  properties: {
    narrative: { type: "string" }
  },
  required: ["narrative"],
  additionalProperties: false
};

const INSTRUCTIONS =
  "Write a concise narrative account of the supplied Project activity. Narrate only; do not judge, grade, recommend, or invent. " +
  "Every factual claim must be supported by one of the supplied facts. Do not infer an outcome, cause, completion, or intent that the facts do not state. " +
  "Use the Project name and the explicit window in the opening. If the facts array is empty, say plainly that nothing happened in the recorded activity for this window. " +
  "Return JSON with exactly one field, narrative.";

/**
 * The roll-up narrates across Projects, so it needs one extra prohibition the
 * per-Project prompt does not: several Projects side by side is exactly the
 * shape that invites ranking them, and this plan deliberately has no judgment
 * layer. Attributing each fact to its Project is required for the same reason
 * every other rule here exists — an unattributed cross-Project claim cannot be
 * traced back to the fact that supports it.
 */
const PORTFOLIO_INSTRUCTIONS =
  "Write a concise narrative account of the supplied activity across the whole portfolio of Projects. Narrate only; do not judge, grade, rank, compare, recommend, or invent. " +
  "Every factual claim must be supported by one of the supplied facts, and each fact names the Project it belongs to — attribute it to that Project. " +
  "Do not infer an outcome, cause, completion, or intent that the facts do not state, and do not claim anything about a Project that has no facts here. " +
  "Use the explicit window in the opening. If the facts array is empty, say plainly that nothing happened in the recorded activity for this window. " +
  "Return JSON with exactly one field, narrative.";

export function buildNarrativeDigestRequest(input: {
  subject: DigestSubject;
  window: DigestWindow;
  facts: DigestFact[];
}): IntelligenceRequest {
  const { subject } = input;
  const portfolio = subject.scope === "portfolio";
  const factDigest = createHash("sha256").update(JSON.stringify(input.facts)).digest("hex").slice(0, 24);
  return {
    idempotencyKey: [
      portfolio ? "portfolio-digest" : "project-digest",
      subject.scopeKey,
      input.window.period,
      input.window.start,
      input.window.end,
      factDigest
    ].join(":"),
    operationId: portfolio ? PORTFOLIO_DIGEST_OPERATION_ID : NARRATIVE_DIGEST_OPERATION_ID,
    clientApp: "arcadia-digests",
    // Routing that charges the roll-up to any one Project would misattribute
    // it; the Intelligence job for a portfolio digest belongs to no Project.
    ...(subject.projectId ? { projectId: subject.projectId } : {}),
    capability: "text.generate",
    execution: "local-preferred",
    profile: "fast",
    input: {
      instructions: portfolio ? PORTFOLIO_INSTRUCTIONS : INSTRUCTIONS,
      ...(portfolio
        ? { portfolio: { name: subject.name } }
        : { project: { id: subject.projectId, name: subject.name } }),
      window: {
        period: input.window.period,
        start: input.window.start,
        end: input.window.end
      },
      facts: input.facts.map((fact) => ({
        id: fact.id,
        kind: fact.kind,
        occurredAt: fact.occurredAt,
        summary: fact.summary,
        detail: fact.detail
      }))
    },
    requirements: { structuredOutput: true },
    outputContract: {
      schemaId: NARRATIVE_DIGEST_SCHEMA_ID,
      schemaVersion: 1,
      jsonSchema: NARRATIVE_DIGEST_JSON_SCHEMA
    },
    template: {
      id: portfolio ? "arcadia.digest.narrate-portfolio-facts" : "arcadia.digest.narrate-facts",
      version: "1"
    },
    executionPolicy: { allowPaidUsage: false, maxRetries: 1 }
  };
}
