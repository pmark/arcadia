import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewCard } from "./dashboard-ui";
import type { DashboardReviewItem } from "../lib/types";

const base = {
  id: "review_1", slug: "R1", decisionId: "review_1", decisionSlug: "R1", displayId: "0132", workItemId: null, actionId: null,
  projectId: "p", project: "Demo", goal: null, outcome: null, status: "open", statusLabel: "Open", category: "ActionClarification",
  decisionNeeded: "Pick?", context: "", recommendation: null, proposedAction: "Answer", missingFields: [], options: ["approve", "reject", "defer"],
  sourceInput: "src", createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z", resultingAskRequestId: null, contextJson: null,
  resolvedIntent: "ActionClarification", packetArtifactId: null, codexInvocationId: null, artifactPath: null, promptPath: null,
  finalMessagePath: null, validationPath: null, planningArtifact: null
} as unknown as DashboardReviewItem;

describe("Decision lettered menu", () => {
  it("shows one button per letter with consequence and the recommended marker, and no free-text field", () => {
    const html = renderToStaticMarkup(
      <ReviewCard item={{ ...base, answerMenu: { source: "decision_options", answerable: true, blocked: null, options: [
        { letter: "A", label: "Ship it", consequence: "Ships now.", recommended: true },
        { letter: "B", label: "Wait", consequence: "Waits.", recommended: false }
      ] } }} />
    );
    expect(html).toContain("Choice A: Ship it");
    expect(html).toContain("Choice B: Wait");
    expect(html).toContain("Recommended");
    expect(html).toContain("Ships now.");
    expect(html).not.toContain("<textarea");
  });

  it("shows the remedy and no answer buttons when the document is not on the base branch", () => {
    const html = renderToStaticMarkup(
      <ReviewCard item={{ ...base, answerMenu: { source: "standard", answerable: false, options: [], blocked: {
        reason: "decision_document_not_on_base", message: "Not answerable yet: merge it.", branch: "b", pullRequestsUrl: "https://github.com/a/b/pulls"
      } } }} />
    );
    expect(html).toContain("Not answerable yet");
    expect(html).toContain("https://github.com/a/b/pulls");
    expect(html).not.toContain("Choice A");
    expect(html).not.toContain("<textarea");
  });
});
