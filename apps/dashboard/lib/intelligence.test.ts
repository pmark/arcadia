import { describe, expect, it } from "vitest";
import { AdminSubmissionError, buildAdminIntelligenceRequest } from "./intelligence";
import { ADMIN_INTELLIGENCE_CLIENT_APP } from "./intelligence-types";

describe("buildAdminIntelligenceRequest", () => {
  it("tags text submissions as admin capability tests without affecting routing fields", () => {
    const request = buildAdminIntelligenceRequest({
      capability: "text.generate",
      offeringId: "arcadia.text.generate.local.fast",
      execution: "local-required",
      profile: "fast",
      prompt: "say hello",
      outputMode: "structured",
      presetId: "simple-object",
      allowPaidUsage: false,
    });

    expect(request.clientApp).toBe(ADMIN_INTELLIGENCE_CLIENT_APP);
    expect(request.operationId).toBe("arcadia-admin.intelligence-bench.text");
    expect(request.capability).toBe("text.generate");
    expect(request.execution).toBe("local-required");
    expect(request.profile).toBe("fast");
    expect(request.outputContract.jsonSchema).toMatchObject({
      required: ["title", "summary"],
    });
  });

  it("uses a generic {text} schema for plain-text mode", () => {
    const request = buildAdminIntelligenceRequest({
      capability: "text.generate",
      offeringId: "arcadia.text.generate.local.fast",
      execution: "local-required",
      profile: "fast",
      prompt: "say hello",
      outputMode: "plain",
      allowPaidUsage: false,
    });

    expect(request.outputContract.jsonSchema).toMatchObject({ required: ["text"] });
  });

  it("rejects an empty text prompt", () => {
    expect(() =>
      buildAdminIntelligenceRequest({
        capability: "text.generate",
        offeringId: "arcadia.text.generate.local.fast",
        execution: "local-required",
        profile: "fast",
        prompt: "   ",
        outputMode: "plain",
        allowPaidUsage: false,
      }),
    ).toThrow(AdminSubmissionError);
  });

  it("rejects structured mode without a preset", () => {
    expect(() =>
      buildAdminIntelligenceRequest({
        capability: "text.generate",
        offeringId: "arcadia.text.generate.local.fast",
        execution: "local-required",
        profile: "fast",
        prompt: "say hello",
        outputMode: "structured",
        allowPaidUsage: false,
      }),
    ).toThrow(AdminSubmissionError);
  });

  it("tags image submissions and clamps count to a safe maximum", () => {
    const request = buildAdminIntelligenceRequest({
      capability: "image.generate",
      offeringId: "arcadia.image.generate.local.quality",
      execution: "local-required",
      profile: "quality",
      prompt: "a red circle",
      count: 99,
      allowPaidUsage: false,
    });

    expect(request.clientApp).toBe(ADMIN_INTELLIGENCE_CLIENT_APP);
    expect(request.operationId).toBe("arcadia-admin.intelligence-bench.image");
    expect((request.input as { n?: number }).n).toBe(4);
  });

  it("rejects an empty image prompt", () => {
    expect(() =>
      buildAdminIntelligenceRequest({
        capability: "image.generate",
        offeringId: "arcadia.image.generate.local.quality",
        execution: "local-required",
        profile: "quality",
        prompt: "",
        count: 1,
        allowPaidUsage: false,
      }),
    ).toThrow(AdminSubmissionError);
  });

  it("never sets allowPaidUsage true unless the caller explicitly confirmed it", () => {
    const request = buildAdminIntelligenceRequest({
      capability: "text.generate",
      offeringId: "arcadia.text.generate.cloud.standard",
      execution: "cloud-required",
      profile: "standard",
      prompt: "say hello",
      outputMode: "plain",
      allowPaidUsage: false,
    });

    expect(request.executionPolicy.allowPaidUsage).toBe(false);
  });
});
