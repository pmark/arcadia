import { describe, expect, it } from "vitest";
import { describeBudgetExhausted } from "../src/production/sessionTokenCeiling.js";

const breach = { ceiling: 1, inputTokens: 1, cachedInputTokens: 0, message: "budget_exhausted: M." };

const remedy =
  "Find the cause in the Session's log before spending again, then reset this Action's repair budget from its blocker on /todo (also listed on /production) so production relaunches it. "
  + "The ceiling is part of the reviewed production policy; it cannot be raised or disabled from a prompt, brief or Action text.";

describe("describeBudgetExhausted wording", () => {
  it("records the message and remedy for a breach with no wall classes", () => {
    expect(describeBudgetExhausted("arcadia:a1", breach, [])).toEqual({
      message: "Budget exhausted for arcadia:a1: budget_exhausted: M. It will not be relaunched automatically.",
      remedy
    });
  });

  it("appends wall classes in order and leaves the remedy unchanged", () => {
    expect(describeBudgetExhausted("arcadia:a1", breach, ["sandbox", "network"])).toEqual({
      message:
        "Budget exhausted for arcadia:a1: budget_exhausted: M. It will not be relaunched automatically."
        + " It also hit an environment wall (sandbox, network).",
      remedy
    });
  });
});
