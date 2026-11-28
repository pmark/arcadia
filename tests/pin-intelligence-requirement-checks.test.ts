import { describe, expect, it } from "vitest";

import { validateRequirements } from "../src/intelligence/validation/validateRequirements.js";

type Request = Parameters<typeof validateRequirements>[0];

function check(capability: string, requirements?: Record<string, unknown>) {
  return validateRequirements({ capability, requirements } as unknown as Request);
}

describe("validateRequirements", () => {
  it("accepts supported requirement combinations", () => {
    expect(check("text.generate")).toBeUndefined();
    expect(check("text.generate", { structuredOutput: true })).toBeUndefined();
    expect(
      check("image.generate", { imageSize: "1024x1024", transparency: false, structuredOutput: false }),
    ).toBeUndefined();
    expect(check("image.edit", { imageSize: "1024x1024" })).toBeUndefined();
  });

  it("rejects unsupported requirement combinations with exact messages", () => {
    expect(check("image.edit", { structuredOutput: true })).toBe(
      'requirements.structuredOutput is not supported for capability "image.edit".',
    );
    expect(check("text.generate", { imageSize: "1024x1024" })).toBe(
      'requirements.imageSize is only supported for image capabilities, not "text.generate".',
    );
    expect(check("image.generate", { imageSize: "512x512" })).toBe(
      'requirements.imageSize "512x512" is not supported. Supported sizes: 1024x1024.',
    );
    expect(check("text.generate", { transparency: false })).toBe(
      'requirements.transparency is only supported for image capabilities, not "text.generate".',
    );
    expect(check("image.generate", { transparency: true })).toBe(
      'requirements.transparency: true is not supported yet. Only "false" is accepted.',
    );
  });
});
