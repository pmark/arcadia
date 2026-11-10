import { describe, expect, it } from "vitest";
import { workKindForAskIntent } from "../src/timeline/classify.js";

describe("workKindForAskIntent", () => {
  it.each(["plan", "split", "action", "milestone", "project_update"])("maps %s to plan-design", (intent) => {
    expect(workKindForAskIntent(intent)).toBe("plan-design");
  });

  it("maps log to observe", () => {
    expect(workKindForAskIntent("log")).toBe("observe");
  });

  it.each(["complete", "decision", "proposal", "auto", "unknown", null, undefined])("maps %s to govern", (intent) => {
    expect(workKindForAskIntent(intent)).toBe("govern");
  });
});
