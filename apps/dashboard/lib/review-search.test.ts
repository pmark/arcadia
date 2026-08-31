import { describe, expect, it } from "vitest";
import { attentionItem, reviewItem } from "./needs-you.test-fixtures";
import { decisionLabelForAttention, reviewSearchText } from "./review-search";

describe("review search", () => {
  it("labels and indexes a document-backed Decision by governed number and content", () => {
    const review = reviewItem({
      id: "review-38",
      slug: "R58",
      displayId: "0038",
      decisionNeeded: "Approve one bounded dogfood Session?",
      recommendation: "Approve the disposable rehearsal.",
      project: "Arcadia"
    });
    const attention = attentionItem({
      id: "review:review-38",
      relatedReviewId: review.id,
      relatedReviewSlug: review.slug,
      reason: review.decisionNeeded,
      projectName: review.project
    });
    const reviews = new Map([[review.id, review]]);

    expect(decisionLabelForAttention(attention, reviews)).toBe("Decision 0038");
    const index = reviewSearchText(attention, reviews);
    expect(index).toContain("0038");
    expect(index).toContain("bounded dogfood");
    expect(index).toContain("disposable rehearsal");
    expect(index).toContain("arcadia");
  });
});
