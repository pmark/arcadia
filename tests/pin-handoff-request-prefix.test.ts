import { describe, expect, it } from "vitest";
import { handoffRequestPrefix } from "../src/clarify/handoff.js";

describe("handoffRequestPrefix", () => {
  it("lowercases the work item id and dashes every run of other characters", () => {
    expect(handoffRequestPrefix("Arcadia/Pin_X  Y")).toBe("handoff-arcadia-pin-x-y-");
  });

  it("keeps an already-clean id as is", () => {
    expect(handoffRequestPrefix("pin-x")).toBe("handoff-pin-x-");
  });
});
