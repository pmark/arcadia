import { describe, expect, it } from "vitest";
import { decisionSlugOfDocRef, letterFor, optionForLetter } from "../src/decisions/answerMenu.js";
import type { ReviewAnswerMenu } from "../src/decisions/answerMenu.js";

describe("Decision answer menu letters", () => {
  it("maps option indexes to letters starting at A", () => {
    expect(letterFor(0)).toBe("A");
    expect(letterFor(2)).toBe("C");
  });

  it("finds an option by trimmed, case-insensitive letter and returns null for an unknown letter", () => {
    const menu: ReviewAnswerMenu = {
      source: "standard",
      answerable: true,
      options: [
        { letter: "A", label: "Approve", consequence: null, recommended: false },
        { letter: "B", label: "Reject", consequence: null, recommended: false }
      ],
      blocked: null
    };
    expect(optionForLetter(menu, " b ")).toBe(menu.options[1]);
    expect(optionForLetter(menu, " b ")?.label).toBe("Reject");
    expect(optionForLetter(menu, "C")).toBeNull();
  });
});

describe("decisionSlugOfDocRef", () => {
  it("reads the slug from a decision doc ref", () => {
    expect(decisionSlugOfDocRef("decision/0184-foo")).toBe("0184-foo");
    expect(decisionSlugOfDocRef(" decision/x ")).toBe("x");
  });

  it("returns null for other refs, missing refs and an empty slug", () => {
    expect(decisionSlugOfDocRef("plan/x")).toBeNull();
    expect(decisionSlugOfDocRef(null)).toBeNull();
    expect(decisionSlugOfDocRef("decision/   ")).toBeNull();
  });
});
