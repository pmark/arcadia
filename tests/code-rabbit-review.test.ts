import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSuccess } from "../src/cli/response.js";
import { renderPrCodeReviewSuccess } from "../src/commands/prCodeReview.js";
import {
  classifyCodeRabbitStatus,
  condense,
  decide,
  declineCodeRabbitFinding,
  extractPrompt,
  hasOutsideDiffFindings,
  MAX_FIX_ROUNDS,
  REVIEWER_LOGIN,
  type Review,
  type Thread
} from "../src/stewardship/codeRabbitReview.js";

const review = (commitId: string, state: string, submittedAt: string, body = ""): Review => ({ author: REVIEWER_LOGIN, commitId, state, submittedAt, body });
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

  it("never lets an approval of an earlier head approve a changed head (#874)", () => {
    // Seen live on pmark/arcadia#325: CodeRabbit approved one head, found the
    // next push clean, and posted nothing new -- reviewDecision stayed APPROVED.
    // That standing approval is evidence about h2, not h3: a push invalidates
    // it, so h3 is at most a completed review without approval.
    const verdict = decide("h3", [review("h1", "CHANGES_REQUESTED", "1"), review("h2", "APPROVED", "2")], []);
    expect(verdict.approved).toBe(false);
    expect(verdict.verdict).toBe("done");
    expect(verdict.note).toMatch(/earlier head/);
  });

  it("does not count an approval from anyone but the actual CodeRabbit bot (#874)", () => {
    const impostor: Review = { ...review("h1", "APPROVED", "1"), author: "coderabbitai-impostor" };
    const verdict = decide("h1", [impostor], []);
    expect(verdict.approved).toBe(false);
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

// A fake GitHub for `waitForCodeRabbitReview`: every `gh`/`git` call the loop
// makes is answered from this scenario, so the whole path from commit status
// to verdict runs exactly as it does against a real PR.
interface GitHubScenario {
  heads: string[]; // successive PR heads `gh pr view` reports; the last one repeats
  // Each head's CodeRabbit status; `creator` defaults to the CodeRabbit bot.
  status: Record<string, { state: string; description: string | null; creator?: string } | undefined>;
  reviews: Review[];
  threads: Thread[];
}

async function runLoop(scenario: GitHubScenario) {
  const repo = mkdtempSync(path.join(tmpdir(), "code-rabbit-loop-"));
  let views = 0;
  const currentHead = () => scenario.heads[Math.min(views, scenario.heads.length) - 1] ?? scenario.heads[0];
  vi.resetModules();
  vi.doMock("node:child_process", () => ({
    execFileSync: (command: string, args: string[]) => {
      // The agent pushed from this checkout, so its HEAD follows the PR head.
      if (command === "git") return `${currentHead()}\n`;
      if (args[0] === "repo") return "o/r\n";
      if (args[0] === "pr" && args[1] === "view") {
        views += 1;
        return JSON.stringify({ headRefOid: currentHead(), isDraft: false, state: "OPEN" });
      }
      const status = /^repos\/o\/r\/commits\/(\w+)\/statuses\?per_page=100$/.exec(args.find((arg) => arg.startsWith("repos/")) ?? "");
      if (status) {
        const entry = scenario.status[status[1]];
        return entry ? `${JSON.stringify({ creator: REVIEWER_LOGIN, ...entry })}\n` : "";
      }
      if (args.includes("repos/o/r/pulls/1/reviews")) {
        return scenario.reviews.map((entry) => JSON.stringify(entry)).join("\n");
      }
      if (args[1] === "graphql") {
        const nodes = scenario.threads.map((entry) => ({
          id: entry.id,
          isResolved: entry.isResolved,
          isOutdated: entry.isOutdated,
          comments: { nodes: [{ author: { login: entry.author }, path: entry.path, line: entry.line, url: entry.url, body: entry.body, originalCommit: { oid: entry.commitId } }] }
        }));
        return JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } } });
      }
      throw new Error(`unexpected call: ${command} ${args.join(" ")}`);
    }
  }));
  try {
    const { waitForCodeRabbitReview } = await import("../src/stewardship/codeRabbitReview.js");
    // A deadline already in the past: a head with no finished review fails at
    // once instead of polling, while a finished one still returns its verdict.
    return await waitForCodeRabbitReview({ repo, pr: 1, timeoutMin: -1 });
  } finally {
    vi.doUnmock("node:child_process");
    vi.resetModules();
    rmSync(repo, { recursive: true, force: true });
  }
}

const completed = { state: "success", description: "Review completed" };

describe("coderabbit loop only treats a genuinely completed review of the current head as done (#874, #892)", () => {
  it("does not report a paused status after an older approval as a completed, approved review", async () => {
    // Seen live on pmark/arcadia#873: the new head's CodeRabbit status was a
    // success described as "Review paused" while an earlier head was approved.
    const result = runLoop({
      heads: ["h2"],
      status: { h2: { state: "success", description: "Review paused" } },
      reviews: [review("h1", "APPROVED", "1")],
      threads: []
    });
    await expect(result).rejects.toMatchObject({
      code: "CODE_REVIEW_NOT_COMPLETED",
      details: expect.objectContaining({ head: "h2", reason: "paused", status: "Review paused" })
    });
  });

  it("does not report a skipped status as a completed review", async () => {
    const result = runLoop({
      heads: ["h2"],
      status: { h2: { state: "success", description: "Review skipped" } },
      reviews: [review("h1", "APPROVED", "1")],
      threads: []
    });
    await expect(result).rejects.toMatchObject({ code: "CODE_REVIEW_NOT_COMPLETED", details: expect.objectContaining({ reason: "skipped" }) });
  });

  it("does not report a rate-limited status with no review as a completed review", async () => {
    // Seen live on pmark/private-practice-now#209: status `pass` / "Review
    // rate limited", no review at all, and the loop said `done`.
    const result = runLoop({
      heads: ["h1"],
      status: { h1: { state: "success", description: "Review rate limited" } },
      reviews: [],
      threads: []
    });
    await expect(result).rejects.toMatchObject({
      code: "CODE_REVIEW_NOT_COMPLETED",
      details: expect.objectContaining({ head: "h1", reason: "rate_limited", status: "Review rate limited" })
    });
  });

  it("reports a genuinely completed review without approval as completed-not-approved", async () => {
    const result = await runLoop({
      heads: ["h1"],
      status: { h1: completed },
      reviews: [review("h1", "COMMENTED", "1", "Actionable comments posted: 0")],
      threads: []
    });
    expect(result).toMatchObject({ verdict: "done", approved: false, reviewStatus: "completed_not_approved", head: "h1", status: "Review completed" });
  });

  it("reports a genuine approval of the exact current head by the CodeRabbit bot as approved", async () => {
    const result = await runLoop({
      heads: ["h2"],
      status: { h2: completed },
      reviews: [review("h1", "CHANGES_REQUESTED", "1"), review("h2", "APPROVED", "2")],
      threads: [thread("t1", { isResolved: true })]
    });
    expect(result).toMatchObject({ verdict: "done", approved: true, reviewStatus: "approved", head: "h2" });
  });

  it("does not let an approval by another identity approve the current head", async () => {
    const result = await runLoop({
      heads: ["h1"],
      status: { h1: completed },
      reviews: [{ ...review("h1", "APPROVED", "1"), author: "coderabbitai-impostor" }],
      threads: []
    });
    expect(result).toMatchObject({ approved: false, reviewStatus: "completed_not_approved" });
  });

  it("keeps the verdict not done while a CodeRabbit finding is unresolved, even beside a head approval", async () => {
    const result = await runLoop({
      heads: ["h1"],
      status: { h1: completed },
      reviews: [review("h1", "APPROVED", "1")],
      threads: [thread("t1", { commitId: "h1" })]
    });
    expect(result.verdict).not.toBe("done");
    expect(result.approved).toBe(false);
    expect(result.findings.map((finding) => finding.threadId)).toEqual(["t1"]);
  });

  it("lets a push invalidate an earlier head's approval", async () => {
    const result = await runLoop({
      heads: ["h2"],
      status: { h1: completed, h2: completed },
      reviews: [review("h1", "APPROVED", "1")],
      threads: []
    });
    expect(result).toMatchObject({ head: "h2", approved: false, reviewStatus: "completed_not_approved" });
  });

  it("does not let a look-alike login's review on the head clear a CodeRabbit change request", async () => {
    // A user `coderabbitai-x` matches the old prefix filter; its COMMENTED
    // review, as the latest on the head, used to flip `fix` to `done`.
    const result = await runLoop({
      heads: ["h1"],
      status: { h1: completed },
      reviews: [review("h1", "CHANGES_REQUESTED", "1"), { ...review("h1", "COMMENTED", "2", "Looks fine to me."), author: "coderabbitai-x" }],
      threads: []
    });
    expect(result.verdict).toBe("fix");
    expect(result.approved).toBe(false);
  });

  it("does not accept a completed CodeRabbit status that another identity posted", async () => {
    const result = runLoop({
      heads: ["h1"],
      status: { h1: { ...completed, creator: "coderabbitai-x" } },
      reviews: [review("h1", "APPROVED", "1")],
      threads: []
    });
    await expect(result).rejects.toMatchObject({
      code: "CODE_REVIEW_NOT_COMPLETED",
      details: expect.objectContaining({ reason: "unverified_reporter", reporter: "coderabbitai-x" })
    });
  });

  it("re-reads the head after gathering evidence, so a push mid-read never yields a verdict on stale evidence", async () => {
    // h1 is approved and complete when the loop starts; a push lands h2 while
    // the reviews are being read. h2 has no finished review, so the loop must
    // not return h1's approval -- it keeps waiting and times out on h2.
    const result = runLoop({
      heads: ["h1", "h2"],
      status: { h1: completed, h2: { state: "pending", description: "Review in progress" } },
      reviews: [review("h1", "APPROVED", "1")],
      threads: []
    });
    await expect(result).rejects.toMatchObject({ message: expect.stringContaining("h2") });
  });
});

describe("coderabbit status classification (#874, #892)", () => {
  const bot = (entry: { state: string; description: string | null }) => ({ ...entry, creator: REVIEWER_LOGIN });

  it("does not accept a CodeRabbit status posted by anyone but the CodeRabbit bot, in any state", () => {
    for (const state of ["success", "pending", "failure"]) {
      expect(classifyCodeRabbitStatus({ state, description: "Review completed", creator: "coderabbitai-x" })).toEqual({ kind: "not_reviewed", reason: "unverified_reporter" });
    }
    expect(classifyCodeRabbitStatus({ state: "success", description: "Review completed", creator: null })).toEqual({ kind: "not_reviewed", reason: "unverified_reporter" });
  });

  it("counts only a completed review as a review", () => {
    expect(classifyCodeRabbitStatus(bot({ state: "success", description: "Review completed" }))).toEqual({ kind: "completed" });
    expect(classifyCodeRabbitStatus(bot({ state: "success", description: "Review paused" }))).toEqual({ kind: "not_reviewed", reason: "paused" });
    expect(classifyCodeRabbitStatus(bot({ state: "success", description: "Review skipped" }))).toEqual({ kind: "not_reviewed", reason: "skipped" });
    expect(classifyCodeRabbitStatus(bot({ state: "success", description: "Review rate limited" }))).toEqual({ kind: "not_reviewed", reason: "rate_limited" });
  });

  it("fails closed on a success it does not recognize, including no description", () => {
    expect(classifyCodeRabbitStatus(bot({ state: "success", description: "Something new" }))).toEqual({ kind: "not_reviewed", reason: "unrecognized" });
    expect(classifyCodeRabbitStatus(bot({ state: "success", description: null }))).toEqual({ kind: "not_reviewed", reason: "unrecognized" });
  });

  it("keeps waiting on pending or absent statuses and reports failures", () => {
    expect(classifyCodeRabbitStatus(undefined)).toEqual({ kind: "waiting" });
    expect(classifyCodeRabbitStatus(bot({ state: "pending", description: "Review in progress" }))).toEqual({ kind: "waiting" });
    expect(classifyCodeRabbitStatus(bot({ state: "failure", description: "Review failed" }))).toEqual({ kind: "failed" });
    expect(classifyCodeRabbitStatus(bot({ state: "error", description: null }))).toEqual({ kind: "failed" });
  });
});

describe("pr code-review rendering", () => {
  const data = { pr: 7, repository: "o/r", status: "Review completed", ...decide("h1", [review("h1", "COMMENTED", "1", "Actionable comments posted: 0")], []) };

  it("says a completed review that did not approve the head is not an approval", () => {
    const lines = renderPrCodeReviewSuccess(createSuccess({ command: "pr.codeReview", data }));
    expect(lines[0]).toBe("Verdict: done (completed, not approved)");
    expect(lines[1]).toContain("CodeRabbit status: Review completed");
  });

  it("shows no review-status parenthetical on a fix verdict", () => {
    const fixData = { ...data, ...decide("h1", [review("h1", "CHANGES_REQUESTED", "1")], [thread("t1")]) };
    expect(renderPrCodeReviewSuccess(createSuccess({ command: "pr.codeReview", data: fixData }))[0]).toBe("Verdict: fix");
  });

  it("says approved only for an approval of the head", () => {
    const approvedData = { ...data, ...decide("h1", [review("h1", "APPROVED", "1")], []) };
    expect(renderPrCodeReviewSuccess(createSuccess({ command: "pr.codeReview", data: approvedData }))[0]).toBe("Verdict: done (approved)");
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

  it("still reports a missing repository path when it is removed between the up-front check and the spawn", async () => {
    // The race CodeRabbit flagged on PR #519: repo exists when runGh's
    // up-front check runs, then disappears before execFileSync starts.
    const repo = mkdtempSync(path.join(tmpdir(), "code-rabbit-review-race-"));
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      execFileSync: () => {
        rmSync(repo, { recursive: true, force: true });
        const error = new Error("spawnSync gh ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
    }));
    const { declineCodeRabbitFinding: declineWithDeletedRepo } = await import("../src/stewardship/codeRabbitReview.js");

    expect(() => declineWithDeletedRepo(repo, "thread1", "not applicable")).toThrowError(
      expect.objectContaining({ message: "The repository path does not exist." })
    );

    vi.doUnmock("node:child_process");
    vi.resetModules();
  });
});
