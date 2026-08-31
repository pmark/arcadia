import { describe, expect, it } from "vitest";
import { decisionDisplayId } from "./decisionDisplay.js";

describe("decisionDisplayId", () => {
  it("uses the governed Decision number for a document-backed review", () => {
    expect(decisionDisplayId({
      id: "reviewItem_internal",
      slug: "R42",
      sourceInput: "docs/decisions/0038-authorize-real-session-dogfood.md (authorize-real-session-dogfood)"
    })).toBe("0038");
  });

  it("falls back to the database review slug", () => {
    expect(decisionDisplayId({
      id: "reviewItem_internal",
      slug: "R42",
      sourceInput: "operator request"
    })).toBe("R42");
  });
});
