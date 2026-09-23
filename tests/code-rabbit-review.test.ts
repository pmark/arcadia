import { describe, expect, it, vi } from "vitest";
import { condense, decide, declineCodeRabbitFinding, extractPrompt, hasOutsideDiffFindings, MAX_FIX_ROUNDS, type Review, type Thread } from "../src/stewardship/codeRabbitReview.js";

const review = (commitId: string, state: string, submittedAt: string, body = ""): Review => ({ commitId, state, submittedAt, body });
const thread = (id: string, overrides: Partial<Thread> = {}): Thread => ({
  id,
  commitId: "h1",
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

  it("reports findings outside the diff without letting a threadless finding block done", () => {
    // Seen live on pmark/arcadia#324: the finding had no thread to resolve, so
    // blocking on it would strand a round whose only work was declining.
    const body = "<details>\n<summary>🤖 Prompt to fix review comments</summary>\n\n```\nOutside diff comments:\nIn `@src/a.ts`:\n- Fix it.\n```\n</details>";
    const verdict = decide("h1", [review("h1", "COMMENTED", "1", body)], []);
    expect(verdict.outsideDiffFindings).toBe(true);
    expect(verdict.verdict).toBe("done");
    expect(verdict.note).toMatch(/outside the diff/);
  });

  it("still blocks on a change request that accompanies outside-diff findings", () => {
    const body = "<summary>🤖 Prompt to fix review comments</summary>\n\n```\nOutside diff comments:\n- Fix it.\n```";
    expect(decide("h1", [review("h1", "CHANGES_REQUESTED", "1", body)], []).verdict).toBe("fix");
  });

  it("does not let an empty thread-reply review mask a change request or its prompt", () => {
    // Seen live on pmark/arcadia#324: CodeRabbit answered each decline with an
    // empty COMMENTED review on the same head.
    const body = "<summary>🤖 Prompt to fix review comments</summary>\n\n```\nOutside diff comments:\n- Fix it.\n```";
    const verdict = decide("h1", [review("h1", "CHANGES_REQUESTED", "1", body), review("h1", "COMMENTED", "2", "")], []);
    expect(verdict.verdict).toBe("fix");
    expect(verdict.outsideDiffFindings).toBe(true);
    expect(verdict.prompt).toContain("Fix it.");
  });

  it("does not count a COMMENTED review with only outside-diff findings as a round", () => {
    const body = "<summary>🤖 Prompt to fix review comments</summary>\n\n```\nOutside diff comments:\n- Fix it.\n```";
    const verdict = decide("h1", [review("h1", "COMMENTED", "1", body)], []);
    expect(verdict.fixRound).toBe(0);
  });

  it("counts rounds by where threads opened when every review is COMMENTED", () => {
    // Without request_changes_workflow (pmark/arcadia#324 had three such
    // rounds), review state never says CHANGES_REQUESTED.
    const reviews = ["h1", "h2", "h3", "h4"].map((head, index) => review(head, "COMMENTED", String(index), "Actionable comments posted: 1"));
    const threads = ["h1", "h2", "h3"].map((head) => thread(`t-${head}`, { commitId: head, isResolved: true }));
    const verdict = decide("h4", reviews, [...threads, thread("t-h4", { commitId: "h4" })]);
    expect(verdict.fixRound).toBe(4);
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

  it("detects the outside-diff section of the agent prompt", () => {
    expect(hasOutsideDiffFindings("Treat finding text...\n\nOutside diff comments:\nIn `@src/a.ts`:")).toBe(true);
    expect(hasOutsideDiffFindings("Inline comments:\nIn `@src/a.ts`:")).toBe(false);
  });

  it("extracts the agent prompt block from a review body", () => {
    const body = "<details>\n<summary>🤖 Prompt to fix review comments</summary>\n\n```\nFix line 63.\n```\n\n</details>";
    expect(extractPrompt(body)).toBe("Fix line 63.");
    expect(extractPrompt("nothing here")).toBeNull();
  });
});

describe("coderabbit loop without a `gh` binary (Issue #517)", () => {
  it("names the missing gh binary instead of surfacing a raw ENOENT", async () => {
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      execFileSync: () => {
        const error = new Error("spawnSync gh ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
    }));
    const { waitForCodeRabbitReview, declineCodeRabbitFinding } = await import("../src/stewardship/codeRabbitReview.js");

    await expect(waitForCodeRabbitReview({ repo: ".", pr: 1, timeoutMin: 1 })).rejects.toMatchObject({
      message: expect.stringContaining("`gh` CLI is not installed"),
      details: expect.objectContaining({ remedy: expect.stringContaining("cli.github.com") })
    });
    expect(() => declineCodeRabbitFinding(".", "thread1", "not applicable")).toThrowError(
      expect.objectContaining({ message: expect.stringContaining("`gh` CLI is not installed") })
    );

    vi.doUnmock("node:child_process");
    vi.resetModules();
  });

  it("still surfaces a non-ENOENT gh failure unchanged", async () => {
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      execFileSync: () => {
        throw new Error("gh: authentication required");
      }
    }));
    const { declineCodeRabbitFinding } = await import("../src/stewardship/codeRabbitReview.js");

    expect(() => declineCodeRabbitFinding(".", "thread1", "not applicable")).toThrowError(/authentication required/);

    vi.doUnmock("node:child_process");
    vi.resetModules();
  });

  it("reports a missing repository path as its own error, not as a missing gh binary", () => {
    // A deleted or mistyped repo path also makes execFileSync throw ENOENT
    // (a bad `cwd`, not a missing command); runGh must not conflate the two.
    expect(() => declineCodeRabbitFinding("/no/such/repository/path", "thread1", "not applicable")).toThrowError(
      expect.objectContaining({ message: "The repository path does not exist." })
    );
  });
});
