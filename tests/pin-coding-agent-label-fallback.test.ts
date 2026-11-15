import { describe, expect, it } from "vitest";
import { codingAgentLabel } from "../src/codingAgents/adapters.js";

describe("codingAgentLabel fallback", () => {
  it("shows the profile name when the provider has no label", () => {
    const profile = {
      name: "Custom profile",
      provider: "not-a-real-provider",
      args: []
    } as unknown as Parameters<typeof codingAgentLabel>[0];

    expect(codingAgentLabel(profile)).toBe("Custom profile");
  });
});
