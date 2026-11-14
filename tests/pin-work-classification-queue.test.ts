import { describe, expect, it } from "vitest";
import { queueForWorkClassification } from "../src/domain/constants.js";

describe("queueForWorkClassification", () => {
  it("routes requires_review to the requires_review queue", () => {
    expect(queueForWorkClassification("requires_review")).toBe("requires_review");
  });

  it("routes blocked to the blocked queue", () => {
    expect(queueForWorkClassification("blocked")).toBe("blocked");
  });

  it("routes agent and autonomous to the work_queue", () => {
    expect(queueForWorkClassification("agent")).toBe("work_queue");
    expect(queueForWorkClassification("autonomous")).toBe("work_queue");
  });
});
