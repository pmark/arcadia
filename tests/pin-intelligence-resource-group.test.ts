import { describe, expect, it } from "vitest";

import { resolveIntelligenceResourceGroup } from "../src/intelligence/jobs/resourceGroup.js";

type Route = Parameters<typeof resolveIntelligenceResourceGroup>[0];

function group(executor: Route["executor"], location: Route["location"], capability: string) {
  return resolveIntelligenceResourceGroup({ executor, location, capability } as Route);
}

describe("resolveIntelligenceResourceGroup", () => {
  it.each([
    ["codex-cli", "local", "text.generate", "codex-cli"],
    ["claude-code-cli", "cloud", "text.generate", "claude-code-cli"],
    ["comfyui", "local", "image.generate", "comfyui"],
    ["speech", "local", "speech.transcribe", "speech-local"],
    ["speech", "cloud", "speech.transcribe", "speech-cloud"]
  ] as const)("routes executor %s at %s to its own group", (executor, location, capability, expected) => {
    expect(group(executor, location, capability)).toBe(expected);
  });

  it("puts every local litellm route in litellm-local, even image.generate", () => {
    expect(group("litellm", "local", "image.generate")).toBe("litellm-local");
  });

  it("splits cloud litellm routes on the image. capability prefix", () => {
    expect(group("litellm", "cloud", "image.edit")).toBe("litellm-cloud-image");
    expect(group("litellm", "cloud", "text.generate")).toBe("litellm-cloud-text");
    expect(group("litellm", "cloud", "imagegen")).toBe("litellm-cloud-text");
  });
});
