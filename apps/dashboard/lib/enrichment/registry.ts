import type {
  IntelligenceExecutionTarget,
  IntelligenceProfile,
  JsonValue,
  OutputContract,
} from "@pmark/arcadia/intelligence/contracts";

/**
 * The generalized async-enrichment layer for the admin dashboard.
 *
 * An "enrichment" is a text-in → text-out operation the UI can request for a
 * piece of already-rendered content: summarize a long field to a headline,
 * augment a terse note with context, embellish a label, and so on. Every
 * enrichment runs through the same Arcadia Intelligence service companion apps
 * use (local-first, deterministic routing) and is always a *progressive
 * enhancement* — the deterministic UI it decorates must stand on its own when
 * an enrichment is skipped, pending, or unavailable.
 *
 * Adding a new enrichment is intentionally small: append an id to
 * `ENRICHMENT_KINDS` and a definition to `ENRICHMENTS`. Nothing else in the
 * pipeline (API route, hook, cache) needs to change.
 */
export const ENRICHMENT_KINDS = [
  "review.proposed-action.headline",
] as const;

export type EnrichmentKind = (typeof ENRICHMENT_KINDS)[number];

export function isEnrichmentKind(value: unknown): value is EnrichmentKind {
  return (
    typeof value === "string" &&
    (ENRICHMENT_KINDS as readonly string[]).includes(value)
  );
}

export interface EnrichmentDefinition {
  /** Stable identifier, also the `kind` the client requests. */
  id: EnrichmentKind;
  /**
   * App-defined operation id for provenance/logging in the Intelligence
   * service. Never participates in route resolution.
   */
  operationId: string;
  /** Optimization profile. Enrichments are latency-sensitive → "fast". */
  profile: IntelligenceProfile;
  /**
   * Where the job runs. Enrichments must stay local (never bill the user for
   * a decorative summary); "codex" or "local" both resolve to a local route.
   */
  execution: IntelligenceExecutionTarget;
  /**
   * Below this many characters, enrichment is pointless — the API short
   * circuits to a "skipped" result and the deterministic UI stands alone.
   */
  minInputChars: number;
  /** Renders the prompt sent to the model from the source text. */
  buildPrompt: (text: string) => string;
  /** JSON Schema the model output is validated against. */
  outputContract: OutputContract;
  /**
   * Extracts the display string from the validated job result. Returns null
   * when the result is unusable, so the caller degrades gracefully.
   */
  parse: (result: JsonValue) => string | null;
}

const HEADLINE_SCHEMA: JsonValue = {
  type: "object",
  properties: {
    headline: { type: "string" },
  },
  required: ["headline"],
  additionalProperties: false,
};

const REVIEW_PROPOSED_ACTION_HEADLINE: EnrichmentDefinition = {
  id: "review.proposed-action.headline",
  operationId: "arcadia-admin.enrich.review-proposed-action-headline",
  profile: "fast",
  execution: "codex",
  minInputChars: 280,
  buildPrompt: (text: string) =>
    [
      "You are summarizing an automated executor's completion report so a",
      "reviewer can triage it at a glance. Write ONE plain-sentence headline",
      "(no more than 120 characters) capturing the outcome: what happened and",
      "whether it needs attention. Prefer concrete signals (files changed,",
      "tests passing/failing) over vague summaries. Do not add commentary,",
      "markdown, or quotes.",
      "",
      "Report:",
      text,
    ].join("\n"),
  outputContract: {
    schemaId: "arcadia-admin.enrich.review-headline",
    schemaVersion: 1,
    jsonSchema: HEADLINE_SCHEMA,
  },
  parse: (result: JsonValue): string | null => {
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const headline = (result as Record<string, JsonValue>).headline;
      if (typeof headline === "string" && headline.trim().length > 0) {
        return headline.trim();
      }
    }
    return null;
  },
};

const ENRICHMENTS: Record<EnrichmentKind, EnrichmentDefinition> = {
  "review.proposed-action.headline": REVIEW_PROPOSED_ACTION_HEADLINE,
};

export function getEnrichment(kind: EnrichmentKind): EnrichmentDefinition {
  return ENRICHMENTS[kind];
}
