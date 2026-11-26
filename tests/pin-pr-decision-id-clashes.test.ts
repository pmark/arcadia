import { describe, expect, it } from "vitest";
import { decisionIdOfFile, findPullRequestDecisionIdClashes } from "../src/decisions/decisionIds.js";

describe("decisionIdOfFile", () => {
  it("reads the id from the last path segment only", () => {
    expect(decisionIdOfFile("0241-standing-grant.md")).toBe("0241");
    expect(decisionIdOfFile("docs/decisions/9001-x.md")).toBe("9001");
  });

  it("gives null when the name is not <digits>-<name>.md", () => {
    expect(decisionIdOfFile("0241.md")).toBeNull();
    expect(decisionIdOfFile("x-0241-y.md")).toBeNull();
    expect(decisionIdOfFile("0241-x.txt")).toBeNull();
  });
});

describe("findPullRequestDecisionIdClashes", () => {
  it("reports one sorted clash when the head adds a file carrying an id origin main holds", () => {
    expect(
      findPullRequestDecisionIdClashes({ originFiles: ["9001-a.md"], headFiles: ["9001-b.md"], mergeBaseFiles: [] })
    ).toEqual([{ id: "9001", files: ["docs/decisions/9001-a.md", "docs/decisions/9001-b.md"] }]);
  });

  it("reports nothing for a distinct id or for files already on the merge base", () => {
    expect(findPullRequestDecisionIdClashes({ originFiles: ["9000-a.md"], headFiles: ["9002-b.md"], mergeBaseFiles: [] })).toEqual([]);
    expect(
      findPullRequestDecisionIdClashes({
        originFiles: ["9001-a.md", "9001-b.md"],
        headFiles: ["9001-a.md", "9001-b.md"],
        mergeBaseFiles: ["9001-a.md", "9001-b.md"]
      })
    ).toEqual([]);
  });

  it("grandfathers id 0004 at two files but reports a third file with all three", () => {
    expect(findPullRequestDecisionIdClashes({ originFiles: ["0004-a.md"], headFiles: ["0004-b.md"], mergeBaseFiles: [] })).toEqual([]);
    expect(
      findPullRequestDecisionIdClashes({
        originFiles: ["0004-a.md", "0004-b.md"],
        headFiles: ["0004-a.md", "0004-b.md", "0004-c.md"],
        mergeBaseFiles: ["0004-a.md", "0004-b.md"]
      })
    ).toEqual([{ id: "0004", files: ["docs/decisions/0004-a.md", "docs/decisions/0004-b.md", "docs/decisions/0004-c.md"] }]);
  });
});
