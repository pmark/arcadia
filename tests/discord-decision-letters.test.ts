import { describe, expect, it } from "vitest";
import { formatRequiresReviewNotificationItem } from "../apps/discord-bot/src/formatters/requiresReviewFormatter.js";
import type { ReviewItem } from "../apps/discord-bot/src/arcadia/types.js";

const item = (answerMenu: ReviewItem["answerMenu"]): ReviewItem => ({
  id: "review_1", slug: "R1", workItemId: null, project: "Demo", goal: null, decisionNeeded: "Pick?", context: "",
  resolvedIntent: "ActionClarification", recommendation: null, options: ["approve", "reject", "defer"],
  sourceInput: "docs/decisions/0132-pick.md (pick)", resultingAskRequestId: null, answerMenu
});

describe("Discord Decision notification", () => {
  it("lists lettered options and asks for just the letter", () => {
    const text = formatRequiresReviewNotificationItem(item({ source: "decision_options", answerable: true, blocked: null, options: [
      { letter: "A", label: "Ship it", consequence: "Ships now.", recommended: true },
      { letter: "B", label: "Wait", consequence: null, recommended: false }
    ] }));
    expect(text).toContain("**A)** Ship it (recommended) — Ships now.");
    expect(text).toContain("**B)** Wait");
    expect(text).toContain("Reply with just the letter");
    expect(text).toContain("0132 A");
    expect(text).not.toContain("own words");
  });

  it("says a Decision is not answerable yet and asks for no reply", () => {
    const text = formatRequiresReviewNotificationItem(item({ source: "standard", answerable: false, options: [], blocked: { message: "Not answerable yet: merge it.", pullRequestsUrl: null } }));
    expect(text).toContain("not answerable yet");
    expect(text).toContain("No reply is needed");
  });
});
