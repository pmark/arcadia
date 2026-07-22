import { describe, expect, it } from "vitest";
import { getEnrichment, isEnrichmentKind } from "./registry";

describe("action.advice enrichment", () => {
  it("is a registered enrichment kind", () => {
    expect(isEnrichmentKind("action.advice")).toBe(true);
    expect(getEnrichment("action.advice").id).toBe("action.advice");
  });

  it("stays local and accepts short action titles", () => {
    const advice = getEnrichment("action.advice");
    // Advice must never bill the user, so it resolves to a local route.
    expect(advice.execution).toBe("local");
    // A terse action title should still qualify for advice.
    expect(advice.minInputChars).toBeLessThanOrEqual(8);
  });

  it("embeds the target text in the prompt", () => {
    const advice = getEnrichment("action.advice");
    const prompt = advice.buildPrompt("Ship the release notes");
    expect(prompt).toContain("Ship the release notes");
    expect(prompt.toLowerCase()).toContain("obstacles");
    expect(prompt.toLowerCase()).toContain("recommendations");
  });

  it("formats obstacles and recommendations into a sectioned string", () => {
    const advice = getEnrichment("action.advice");
    const value = advice.parse({
      obstacles: ["No staging environment configured"],
      recommendations: ["Draft the summary before the details", "Cite concrete metrics"],
    });
    expect(value).not.toBeNull();
    expect(value).toContain("Clear these obstacles:");
    expect(value).toContain("• No staging environment configured");
    expect(value).toContain("Recommendations for excellent execution:");
    expect(value).toContain("• Draft the summary before the details");
  });

  it("omits the obstacles section when there are none", () => {
    const advice = getEnrichment("action.advice");
    const value = advice.parse({ recommendations: ["Timebox the first draft to 30 minutes"] });
    expect(value).not.toBeNull();
    expect(value).not.toContain("Clear these obstacles:");
    expect(value).toContain("Recommendations for excellent execution:");
  });

  it("returns null when there are no usable recommendations", () => {
    const advice = getEnrichment("action.advice");
    expect(advice.parse({ recommendations: [] })).toBeNull();
    expect(advice.parse({ obstacles: ["Something"], recommendations: ["   "] })).toBeNull();
    expect(advice.parse("not an object")).toBeNull();
    expect(advice.parse(null)).toBeNull();
  });
});
