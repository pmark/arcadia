import type { JsonValue } from "@pmark/arcadia/intelligence/contracts";

/**
 * Built-in structured-output test fixtures for the admin Intelligence test
 * bench. These are deterministic test schemas, not production prompt
 * templates — see apps/dashboard/app/admin/intelligence/page.tsx.
 */
export interface StructuredTextPreset {
  id: string;
  label: string;
  description: string;
  jsonSchema: JsonValue;
  samplePrompt: string;
}

export const STRUCTURED_TEXT_PRESETS: StructuredTextPreset[] = [
  {
    id: "simple-object",
    label: "Simple JSON object",
    description: "title + summary",
    samplePrompt: "Summarize the benefits of a local-first project OS in two sentences.",
    jsonSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
      },
      required: ["title", "summary"],
      additionalProperties: false,
    },
  },
  {
    id: "candidate-list",
    label: "List of candidate ideas",
    description: "answer + normalizedAnswer + shortDescription",
    samplePrompt: "Propose one candidate name for a new internal admin tool.",
    jsonSchema: {
      type: "object",
      properties: {
        answer: { type: "string" },
        normalizedAnswer: { type: "string" },
        shortDescription: { type: "string" },
      },
      required: ["answer", "normalizedAnswer", "shortDescription"],
      additionalProperties: false,
    },
  },
  {
    id: "validation-probe",
    label: "Validation probe",
    description: "status + observations + warnings",
    samplePrompt: "Report a status of \"ok\" with two short observations and no warnings.",
    jsonSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        observations: { type: "array", items: { type: "string" } },
        warnings: { type: "array", items: { type: "string" } },
      },
      required: ["status", "observations", "warnings"],
      additionalProperties: false,
    },
  },
];

export const PLAIN_TEXT_SCHEMA: JsonValue = {
  type: "object",
  properties: {
    text: { type: "string" },
  },
  required: ["text"],
  additionalProperties: false,
};

export function findPreset(id: string): StructuredTextPreset | undefined {
  return STRUCTURED_TEXT_PRESETS.find((preset) => preset.id === id);
}
