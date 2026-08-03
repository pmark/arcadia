import { describe, expect, it } from "vitest";
import { buildMorningAiSummaryRequest } from "../src/orientation/morningAiSummary.js";

describe("morning AI summary request", () => {
  it("is bounded, local-preferred, unpaid, and structured", () => {
    const request = buildMorningAiSummaryRequest({
      localDate: "2026-08-03",
      sourceNarrative: "Alpha completed two Actions and produced one ready Artifact.",
      projectNames: ["Alpha"]
    });
    expect(request).toMatchObject({
      operationId: "arcadia.orientation.morning-ai-summary",
      capability: "text.generate",
      execution: "local-preferred",
      profile: "fast",
      executionPolicy: { allowPaidUsage: false, maxRetries: 1 },
      outputContract: { schemaId: "arcadia.morning-ai-summary.v1", schemaVersion: 1 }
    });
    expect(request.outputContract?.jsonSchema).toMatchObject({
      required: ["headline", "paragraph"],
      additionalProperties: false
    });
    expect((request.input as { instructions: string }).instructions).toContain("Do not invent work");
    expect((request.input as { instructions: string }).instructions).toContain("only those names are Projects");
    expect((request.input as { projectNames: string[] }).projectNames).toEqual(["Alpha"]);
  });
});
