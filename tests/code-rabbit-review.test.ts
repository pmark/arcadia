import { describe, expect, it } from "vitest";
import { condense, decide, extractPrompt, hasOutsideDiffFindings, MAX_FIX_ROUNDS, type Review, type Thread } from "../src/stewardship/codeRabbitReview.js";

const review = (commitId: string, state: string, submittedAt: string, body = ""): Review => ({ commitId, state, submittedAt, body });
const thread = (id: string, overrides: Partial<Thread> = {}): Thread => ({
  id,
  isResolved: false,
  isOutdated: false,
  author: "coderabbitai",
  path: "src/a.ts",
  line: 3,
  url: `https://example.test/${id}`,
  body: "Fix this.",
  ...overrides
});

describe("coderabbit loop decide", () => {
  it("is done when CodeRabbit approved the current head", () => {
    const verdict = decide("h2", [review("h1", "CHANGES_REQUESTED", "1"), review("h2", "APPROVED", "2")], []);
    expect(verdict.verdict).toBe("done");
    expect(verdict.approved).toBe(true);
  });

  it("does not count an older approval while a finding is open", () => {
    const verdict = decide("h2", [review("h1", "APPROVED", "1")], [thread("t1")]);
    expect(verdict.approved).toBe(false);
    expect(verdict.verdict).toBe("fix");
  });

  it("counts a standing approval when a later clean head drew no new review", () => {
    // Seen live on pmark/arcadia#325: CodeRabbit approved one head, found the
    // next push clean, and posted nothing new -- reviewDecision stayed APPROVED.
    const verdict = decide("h3", [review("h1", "CHANGES_REQUESTED", "1"), review("h2", "APPROVED", "2")], []);
    expect(verdict.approved).toBe(true);
    expect(verdict.verdict).toBe("done");
  });

  it("lets a later change request supersede an earlier approval", () => {
    const verdict = decide("h2", [review("h1", "APPROVED", "1"), review("h2", "CHANGES_REQUESTED", "2")], []);
    expect(verdict.approved).toBe(false);
    expect(verdict.verdict).toBe("fix");
  });

  it("asks for a fix on unresolved CodeRabbit threads and ignores resolved or human ones", () => {
    const verdict = decide("h1", [review("h1", "CHANGES_REQUESTED", "1")], [
      thread("open"),
      thread("resolved", { isResolved: true }),
      thread("human", { author: "pmark" })
    ]);
    expect(verdict.verdict).toBe("fix");
    expect(verdict.findings.map((finding) => finding.threadId)).toEqual(["open"]);
    expect(verdict.fixRound).toBe(1);
  });

  it("is done without approval when nothing is unresolved, and says so", () => {
    const verdict = decide("h2", [review("h1", "COMMENTED", "1")], [thread("t1", { isResolved: true })]);
    expect(verdict.verdict).toBe("done");
    expect(verdict.approved).toBe(false);
    expect(verdict.note).toMatch(/no approval/);
  });

  it("stops at the cap once findings survive the allowed fix rounds", () => {
    const reviews = ["h1", "h2", "h3", "h4"].map((head, index) => review(head, "CHANGES_REQUESTED", String(index)));
    const verdict = decide("h4", reviews, [thread("t1")]);
    expect(verdict.fixRound).toBe(MAX_FIX_ROUNDS + 1);
    expect(verdict.verdict).toBe("cap");
  });

  it("matches the bot login in either form GitHub reports it", () => {
    expect(decide("h1", [], [thread("t1", { author: "coderabbitai[bot]" })]).findings).toHaveLength(1);
  });

  it("does not call a head done while findings outside the diff remain", () => {
    const body = "<details>\n<summary>⚠️ Outside diff range comments (1)</summary>\n\nFix it.\n</details>";
    const verdict = decide("h1", [review("h1", "COMMENTED", "1", body)], []);
    expect(verdict.outsideDiffFindings).toBe(true);
    expect(verdict.verdict).toBe("fix");
    expect(verdict.note).toMatch(/outside the diff/);
  });

  it("still allows the last fix round at the cap boundary", () => {
    const reviews = ["h1", "h2", "h3"].map((head, index) => review(head, "CHANGES_REQUESTED", String(index)));
    expect(decide("h3", reviews, [thread("t1")]).verdict).toBe("fix");
  });
});

describe("coderabbit body helpers", () => {
  it("strips analysis details and HTML markers from a finding", () => {
    expect(condense("_Minor_\n\n<details>\n<summary>chain</summary>\nlong\n</details>\n\nDo X.<!-- marker -->")).toBe("_Minor_\n\nDo X.");
  });

  it("detects the outside-diff section heading", () => {
    expect(hasOutsideDiffFindings("<summary>⚠️ Outside diff range comments (2)</summary>")).toBe(true);
    expect(hasOutsideDiffFindings("<summary>🧹 Nitpick comments (2)</summary>")).toBe(false);
  });

  it("extracts the agent prompt block from a review body", () => {
    const body = "<details>\n<summary>🤖 Prompt to fix review comments</summary>\n\n```\nFix line 63.\n```\n\n</details>";
    expect(extractPrompt(body)).toBe("Fix line 63.");
    expect(extractPrompt("nothing here")).toBeNull();
  });
});
