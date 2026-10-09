import { expect } from "vitest";
import { resolveAgentIdentity } from "../../src/codingAgents/agentIdentity.js";

/**
 * The deterministic guard every generated prompt and brief must pass: exactly
 * one Identity block, whose self identity is the one resolveAgentIdentity
 * gives for the session's platform, tier and role.
 */
export function expectIdentityBlock(prompt: string, agent: string, tier: string, role: string = "builder"): void {
  expect(prompt.match(/^Identity:$/gm) ?? [], "prompt must carry exactly one Identity block").toHaveLength(1);
  const sessionSelf = /^You are .+? \(Git identity: (.+?) <([^>]+)>; effort tier ([a-z]+); ([a-z]+), ([a-z]+)\);/m.exec(prompt);
  const legacySelf = /^You are (.+?) <([^>]+)> \(([a-z]+), ([a-z]+), ([a-z]+)\);/m.exec(prompt);
  const self = sessionSelf ?? legacySelf;
  expect(self, "Identity block must name its self identity").not.toBeNull();
  const expected = resolveAgentIdentity(agent, tier, role);
  const actual = sessionSelf
    ? { name: sessionSelf[1], email: sessionSelf[2], tier: sessionSelf[3], agent: sessionSelf[4], role: sessionSelf[5] }
    : { name: legacySelf![1], email: legacySelf![2], agent: legacySelf![3], tier: legacySelf![4], role: legacySelf![5] };
  expect(actual).toEqual({
    name: expected.name,
    email: expected.email,
    agent: expected.agent,
    tier: expected.tier,
    role: expected.role
  });
}
