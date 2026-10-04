import { expect } from "vitest";
import { resolveAgentIdentity } from "../../src/codingAgents/agentIdentity.js";

/**
 * The deterministic guard every generated prompt and brief must pass: exactly
 * one Identity block, whose self identity is the one resolveAgentIdentity
 * gives for the session's platform, tier and role.
 */
export function expectIdentityBlock(prompt: string, agent: string, tier: string, role: string = "builder"): void {
  expect(prompt.match(/^Identity:$/gm) ?? [], "prompt must carry exactly one Identity block").toHaveLength(1);
  const self = /^You are (.+?) <([^>]+)> \(([a-z]+), ([a-z]+), ([a-z]+)\);/m.exec(prompt);
  expect(self, "Identity block must name its self identity").not.toBeNull();
  const expected = resolveAgentIdentity(agent, tier, role);
  expect({ name: self![1], email: self![2], agent: self![3], tier: self![4], role: self![5] }).toEqual({
    name: expected.name,
    email: expected.email,
    agent: expected.agent,
    tier: expected.tier,
    role: expected.role
  });
}
