import { describe, expect, it } from "vitest";
import { normalizeBranch, parseActionRef, parseAgentRef } from "../src/agentWatch/contract.js";

describe("agent watch ref parsing", () => {
  it("parses a valid agent/tier ref", () => {
    expect(parseAgentRef("claude/heavy")).toEqual({ agent: "claude", tier: "heavy" });
  });

  it.each(["claude/huge", "gpt/light", "Claude/heavy", "claude"])("rejects agent ref %s", (value) => {
    expect(parseAgentRef(value)).toBeNull();
  });

  it("parses a valid project/action ref", () => {
    expect(parseActionRef("arcadia/pin-x")).toEqual({ project: "arcadia", actionId: "pin-x" });
  });

  it.each(["Arcadia/x", "a/b/c", "a"])("rejects action ref %s", (value) => {
    expect(parseActionRef(value)).toBeNull();
  });

  it("normalizes branch names", () => {
    expect(normalizeBranch("refs/heads/main")).toBe("main");
    expect(normalizeBranch("feature/x")).toBe("feature/x");
  });

  it("rejects unusable branch values", () => {
    expect(normalizeBranch(" main")).toBeNull();
    expect(normalizeBranch("")).toBeNull();
    expect(normalizeBranch(null)).toBeNull();
    expect(normalizeBranch(undefined)).toBeNull();
  });
});
