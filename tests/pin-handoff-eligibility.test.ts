import { describe, expect, it } from "vitest";
import { isHandoffEligible } from "../src/clarify/handoff.js";

type WorkItem = Parameters<typeof isHandoffEligible>[0];
type Verdict = Parameters<typeof isHandoffEligible>[1];

const workItem = (captureId: string | null): WorkItem => ({ id: "work_abc123", capture_id: captureId }) as unknown as WorkItem;
const verdict = (actor: string): Verdict => ({ actor }) as unknown as Verdict;

describe("isHandoffEligible", () => {
  it("is true for a captured work item with a coding-agent verdict", () => {
    expect(isHandoffEligible(workItem("env_abc123"), verdict("coding-agent"))).toBe(true);
  });

  it("is false when the work item has no capture id", () => {
    expect(isHandoffEligible(workItem(null), verdict("coding-agent"))).toBe(false);
  });

  it("is false when the verdict actor is human", () => {
    expect(isHandoffEligible(workItem("env_abc123"), verdict("human"))).toBe(false);
  });
});
