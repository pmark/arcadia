import { describe, expect, it } from "vitest";
import { stableProposalId } from "../src/ask/agentAsk.js";

describe("stableProposalId", () => {
  it("keeps the first 18 fingerprint characters", () => {
    expect(stableProposalId("abcdefghijklmnopqrstuvwxyz")).toBe("agentask_abcdefghijklmnopqr");
  });

  it("keeps a short fingerprint whole", () => {
    expect(stableProposalId("abc")).toBe("agentask_abc");
  });

  it("returns only the prefix for an empty fingerprint", () => {
    expect(stableProposalId("")).toBe("agentask_");
  });
});
