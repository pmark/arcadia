import { describe, expect, it } from "vitest";

import { missingDoneConditionQuestion } from "../src/clarify/lint.js";

describe("missingDoneConditionQuestion", () => {
  it("asks how anyone will observe the action is finished and ends with the done-condition prompt", () => {
    expect(missingDoneConditionQuestion("Run tests")).toBe(
      'How will anyone observe that "Run tests" is finished? State the done-condition in one sentence.'
    );
  });
});
