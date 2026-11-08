import { describe, expect, it } from "vitest";

import { requirementIdFor } from "../src/sessions/roleLineage.js";

describe("requirementIdFor", () => {
  it("joins project, plan and Action id with slashes", () => {
    expect(requirementIdFor("arcadia", "my-plan", "do-thing")).toBe("arcadia/my-plan/do-thing");
  });

  it("does not normalize case, spaces or embedded slashes", () => {
    expect(requirementIdFor("A", "B c", "D/E")).toBe("A/B c/D/E");
  });
});
