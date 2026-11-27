import { describe, expect, it } from "vitest";

import { workKindForReviewItem } from "../src/timeline/classify.js";

const verify = { workKind: "verify", provenance: "review item asks a QA verdict" };
const review = { workKind: "review", provenance: "review item asks a code-review verdict" };
const govern = { workKind: "govern", provenance: "review item is an approval gate" };

describe("workKindForReviewItem", () => {
  it("names a QA pass-or-fail question as verify work, in any case", () => {
    expect(workKindForReviewItem("QA pass or fail for PR 12")).toEqual(verify);
    expect(workKindForReviewItem("qa FAIL on head")).toEqual(verify);
  });

  it("names a code-review verdict question as review work", () => {
    expect(workKindForReviewItem("Code review verdict")).toEqual(review);
  });

  it("names every other review item an approval gate", () => {
    for (const question of ["QA passed", "QA", "code reviewer", "Review the code", "Approve the release", ""]) {
      expect(workKindForReviewItem(question)).toEqual(govern);
    }
  });
});
