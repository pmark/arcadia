import { describe, expect, it } from "vitest";
import { condense, decide, extractPrompt, MAX_FIX_ROUNDS, type Review, type Thread } from "../scripts/coderabbit-loop.js";

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

  it("does not count an approval of an older head", () => {
    const verdict = decide("h2", [review("h1", "APPROVED", "1")], [thread("t1")]);
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

  it("still allows the last fix round at the cap boundary", () => {
    const reviews = ["h1", "h2", "h3"].map((head, index) => review(head, "CHANGES_REQUESTED", String(index)));
    expect(decide("h3", reviews, [thread("t1")]).verdict).toBe("fix");
  });
});

describe("coderabbit body helpers", () => {
  it("strips analysis details and HTML markers from a finding", () => {
    expect(condense("_Minor_\n\n<details>\n<summary>chain</summary>\nlong\n</details>\n\nDo X.<!-- marker -->")).toBe("_Minor_\n\nDo X.");
  });

  it("extracts the agent prompt block from a review body", () => {
    const body = "<details>\n<summary>🤖 Prompt to fix review comments</summary>\n\n```\nFix line 63.\n```\n\n</details>";
    expect(extractPrompt(body)).toBe("Fix line 63.");
    expect(extractPrompt("nothing here")).toBeNull();
  });
});
