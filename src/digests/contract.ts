import { createHash } from "node:crypto";
import type { IntelligenceRequest, JsonValue } from "../intelligence/types.js";
import type { DigestFact, DigestWindow } from "./types.js";

export const NARRATIVE_DIGEST_OPERATION_ID = "arcadia.digest.compose-project";
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

export function buildNarrativeDigestRequest(input: {
  projectId: string;
  projectName: string;
  window: DigestWindow;
  facts: DigestFact[];
}): IntelligenceRequest {
  const factDigest = createHash("sha256").update(JSON.stringify(input.facts)).digest("hex").slice(0, 24);
  return {
    idempotencyKey: [
      "project-digest",
      input.projectId,
      input.window.period,
      input.window.start,
      input.window.end,
      factDigest
    ].join(":"),
    operationId: NARRATIVE_DIGEST_OPERATION_ID,
    clientApp: "arcadia-digests",
    projectId: input.projectId,
    capability: "text.generate",
    execution: "local-preferred",
    profile: "fast",
    input: {
      instructions: INSTRUCTIONS,
      project: { id: input.projectId, name: input.projectName },
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
    template: { id: "arcadia.digest.narrate-facts", version: "1" },
    executionPolicy: { allowPaidUsage: false, maxRetries: 1 }
  };
}
