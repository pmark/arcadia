import { describe, expect, it } from "vitest";

import { isAgentRole } from "../src/codingAgents/agentIdentity.js";

describe("isAgentRole", () => {
  it("accepts builder and critic", () => {
    expect(isAgentRole("builder")).toBe(true);
    expect(isAgentRole("critic")).toBe(true);
  });

  it.each(["Builder", "reviewer", "", " builder"])("rejects %j", (value) => {
    expect(isAgentRole(value)).toBe(false);
  });
});
