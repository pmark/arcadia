import { describe, expect, it } from "vitest";

import { minimumCapability, minimumEffort } from "../src/execution/profiles.js";

describe("minimumCapability", () => {
  it("returns the stronger of two capability tiers", () => {
    expect(minimumCapability("c1_bounded", "c3_systems")).toBe("c3_systems");
    expect(minimumCapability("c4_critical", "c2_integrated")).toBe("c4_critical");
    expect(minimumCapability("c2_integrated", "c2_integrated")).toBe("c2_integrated");
  });
});

describe("minimumEffort", () => {
  it("returns the stronger of two reasoning efforts", () => {
    expect(minimumEffort("e2_standard", "e1_brief")).toBe("e2_standard");
    expect(minimumEffort("e1_brief", "e4_rigorous")).toBe("e4_rigorous");
    expect(minimumEffort("e3_deep", "e3_deep")).toBe("e3_deep");
  });
});
