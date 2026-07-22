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
  "action.advice",
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
   * Where the job runs. "codex" or "local" both resolve to a local route;
   * "cloud" uses a cloud provider when configured.
   */
  execution: IntelligenceExecutionTarget;
  /**
   * Below this many characters, enrichment is pointless — the API short
   * circuits to a "skipped" result and the deterministic UI stands alone.
   */
  minInputChars: number;
  /**
   * Whether to allow paid cloud usage. Defaults to false (free enrichments
   * only). Ignored for local execution.
   */
  allowPaidUsage?: boolean;
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

/**
 * Advice output: obstacles the operator should clear, and insightful
 * recommendations for executing the item excellently. `obstacles` is optional
 * (a clean item may have none); at least one recommendation is required for the
 * result to be usable.
 */
const ADVICE_SCHEMA: JsonValue = {
  type: "object",
  properties: {
    obstacles: { type: "array", items: { type: "string" }, maxItems: 4 },
    recommendations: { type: "array", items: { type: "string" }, maxItems: 5 },
  },
  required: ["recommendations"],
  additionalProperties: false,
};

function toStringList(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * On-demand "most useful plan the AI can perform with this item": by default,
 * surface the obstacles standing in the way of excellent execution and a few
 * insightful recommendations. Unlike the headline summarizer, advice is
 * valuable even for a short action title, so the input threshold is low.
 * The structured obstacle/recommendation output is flattened into a single
 * sectioned string so the generic enrichment pipeline stays unchanged.
 */
const ACTION_ADVICE: EnrichmentDefinition = {
  id: "action.advice",
  operationId: "arcadia-admin.enrich.action-advice",
  profile: "standard",
  execution: "cloud",
  allowPaidUsage: true,
  // Even a terse action title ("Ship the release notes") is a valid target for
  // advice, so only skip genuinely empty input.
  minInputChars: 8,
  buildPrompt: (text: string) =>
    [
      "You are an expert operator and advisor helping the user execute one",
      "specific action item with excellence. Given the action item and any",
      "context below:",
      "1. Identify the most likely obstacles or blockers standing in the way of",
      "   completing it, and phrase each as the concrete way to clear it.",
      "2. Give a few insightful, specific recommendations for executing it",
      "   excellently — non-obvious leverage, sequencing, or a quality bar to",
      "   hold.",
      "",
      "Be concrete and specific to THIS item; avoid generic platitudes and",
      "filler. Keep every point to a single sentence. Return 0-4 obstacles and",
      "2-5 recommendations.",
      "",
      "Action item and context:",
      text,
    ].join("\n"),
  outputContract: {
    schemaId: "arcadia-admin.enrich.action-advice",
    schemaVersion: 1,
    jsonSchema: ADVICE_SCHEMA,
  },
  parse: (result: JsonValue): string | null => {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      return null;
    }
    const record = result as Record<string, JsonValue>;
    const obstacles = toStringList(record.obstacles);
    const recommendations = toStringList(record.recommendations);
    if (recommendations.length === 0) {
      return null;
    }

    const sections: string[] = [];
    if (obstacles.length > 0) {
      sections.push(
        ["Clear these obstacles:", ...obstacles.map((line) => `• ${line}`)].join("\n"),
      );
    }
    sections.push(
      [
        "Recommendations for excellent execution:",
        ...recommendations.map((line) => `• ${line}`),
      ].join("\n"),
    );
    return sections.join("\n\n");
  },
};

const ENRICHMENTS: Record<EnrichmentKind, EnrichmentDefinition> = {
  "review.proposed-action.headline": REVIEW_PROPOSED_ACTION_HEADLINE,
  "action.advice": ACTION_ADVICE,
};

export function getEnrichment(kind: EnrichmentKind): EnrichmentDefinition {
  return ENRICHMENTS[kind];
}
