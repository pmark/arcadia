import { createHash } from "node:crypto";
import type { IntelligenceRequest, JsonValue } from "../intelligence/types.js";
import type { DigestSubject, DigestSummaryFacts, DigestWindow } from "./types.js";

export const NARRATIVE_DIGEST_OPERATION_ID = "arcadia.digest.compose-project";
export const PORTFOLIO_DIGEST_OPERATION_ID = "arcadia.digest.compose-portfolio";
export const NARRATIVE_DIGEST_SCHEMA_ID = "arcadia.digest-summary.v2";

export const NARRATIVE_DIGEST_JSON_SCHEMA: JsonValue = {
  type: "object",
  properties: {
    summary: { type: "string" }
  },
  required: ["summary"],
  additionalProperties: false
};

/**
 * The operator asked for progress, not activity: "show me what matters, not
 * just more data". So the model writes only the headline, and it sees only the
 * facts the deterministic report already computed. Everything it may say is
 * therefore also on the page beneath it, where the operator can check it.
 */
export const DIGEST_SUMMARY_INSTRUCTIONS =
  "You write the headline of an operator's progress digest. Write one to three short, plain sentences saying how much progress was made toward which goals, and whether anything waits on the operator. " +
  "Lead with progress toward goals (Actions done, merged, goals reached, remaining work), not with activity volume. " +
  "Use only the supplied facts. State no fact, number, name, cause, or outcome that is not in them, and do not judge, praise, rank, or recommend. " +
  "If no goal moved, say so plainly. Do not repeat the window dates. Return JSON with exactly one field, summary.";

export function buildNarrativeDigestRequest(input: {
  subject: DigestSubject;
  window: DigestWindow;
  facts: DigestSummaryFacts;
}): IntelligenceRequest {
  const { subject } = input;
  const portfolio = subject.scope === "portfolio";
  const factDigest = createHash("sha256").update(JSON.stringify(input.facts)).digest("hex").slice(0, 24);
  return {
    idempotencyKey: [
      portfolio ? "portfolio-digest-summary" : "project-digest-summary",
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
      instructions: DIGEST_SUMMARY_INSTRUCTIONS,
      facts: input.facts as unknown as JsonValue
    },
    requirements: { structuredOutput: true },
    outputContract: {
      schemaId: NARRATIVE_DIGEST_SCHEMA_ID,
      schemaVersion: 2,
      jsonSchema: NARRATIVE_DIGEST_JSON_SCHEMA
    },
    template: {
      id: "arcadia.digest.progress-headline",
      version: "2"
    },
    executionPolicy: { allowPaidUsage: false, maxRetries: 1 }
  };
}
