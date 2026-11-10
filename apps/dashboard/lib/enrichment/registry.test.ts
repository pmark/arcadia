import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ENRICHMENT_KINDS, getEnrichment, isEnrichmentKind } from "./registry";

describe("action.advice enrichment", () => {
  it("is a registered enrichment kind", () => {
    expect(isEnrichmentKind("action.advice")).toBe(true);
    expect(getEnrichment("action.advice").id).toBe("action.advice");
  });

  it("uses cloud and accepts short action titles", () => {
    const advice = getEnrichment("action.advice");
    // Advice uses cloud text AI for better quality.
    expect(advice.execution).toBe("cloud");
    expect(advice.allowPaidUsage).toBe(false);
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

describe("paid usage guard", () => {
  it("registers at least one enrichment and none sets allowPaidUsage", () => {
    expect(ENRICHMENT_KINDS.length).toBeGreaterThan(0);
    for (const kind of ENRICHMENT_KINDS) {
      expect(getEnrichment(kind).allowPaidUsage, kind).not.toBe(true);
    }
  });

  it("no enrichment source file sets allowPaidUsage true", () => {
    const dir = __dirname;
    const sources = readdirSync(dir).filter(
      (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
    );
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = readFileSync(path.join(dir, file), "utf8");
      expect(text, file).not.toMatch(/allowPaidUsage\s*:\s*true/);
    }
  });
});
