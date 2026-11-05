/**
 * The real inputs of pmark/arcadia#2062's failed QA attempt (2026-11-05), through
 * today's prompt and plan renderer. QA failed every candidate that attempt on two
 * things no repair can change: a settlement id it read as a mismatch, and plan
 * steps that claimed more than their commands show.
 */
import { describe, expect, it } from "vitest";
import { fixturePrompt, fixturePullRequestBody, loadQaPromptFixture } from "../scripts/qa-prompt-fixture.js";
import { judgeQaPlanReport } from "../src/production/independentReview.js";
import { assemblePrReviewPrompt } from "../src/qa/prReview.js";

const AUTO_SETTLE = "auto-settle-arcadia-pin-work-monitor-malformed-record-bfaf11b9b9c6";
const ASK_REQUEST = "complete-pin-work-monitor-malformed-record-9a54ef9501c0";
const GOVERNED = /^Governed records: .*$/m;

describe("QA's governed-record facts on the real #2062 inputs", () => {
  it("carries the very settlement shape QA flagged: an auto-settle id beside an Ask with its own request_id", () => {
    const { patch } = loadQaPromptFixture();
    expect(patch).toContain(`Completed via Agent Ask ${AUTO_SETTLE}`);
    expect(patch).toContain(`"request_id":"${ASK_REQUEST}"`);
    expect(patch).not.toContain(`"request_id":"${AUTO_SETTLE}"`);
  });

  it("gives QA the rule that this is no mismatch, without the code-review status vocabulary", () => {
    const qa = fixturePrompt("qa");
    expect(qa).toContain("so an `auto-settle-` id in the Plan or Mission Log beside an Ask with a different request_id is not a mismatch");
    expect(qa).toContain("Report each as pass, fail, or not-checked with concrete evidence.");
    // QA's criteria are the Action's acceptance, never not-applicable.
    const instructions = qa.slice(0, qa.indexOf("## Pull-request body and deterministic evidence"));
    expect(instructions).not.toContain("not-applicable");
    expect(instructions).not.toContain("Return verdict pass only when every criterion is pass or not-applicable");
  });

  it("shares one rule between the roles and leaves the code-review prompt's instructions as they were", () => {
    const qa = GOVERNED.exec(fixturePrompt("qa"))?.[0];
    const codeReview = fixturePrompt("code-review");
    expect(qa).toBeTruthy();
    expect(GOVERNED.exec(codeReview)?.[0]).toBe(qa);
    expect(codeReview).toContain("Report each as pass, fail, not-checked, or not-applicable with concrete evidence.");
    // The rule directly follows the status vocabulary, where it always sat.
    expect(codeReview).toContain(`Return verdict pass only when every criterion is pass or not-applicable and no material finding remains.\n${qa}\n`);
  });
});

describe("the Operator QA plan QA now reads for the real #2062 Action", () => {
  const body = fixturePullRequestBody(loadQaPromptFixture());
  const step = (n: number) => body.slice(body.indexOf(`### Step ${n} `), body.indexOf(`### Step ${n + 1} `));

  it("no longer claims what the real report flagged", () => {
    // Report finding 3, Step 4: "expects it to show that 'every other test in that file passes unchanged'".
    expect(step(4)).toContain("git diff 4468082627ea89698a9285c3dfda362e041090f9 c54b01148403a74893275aa8b084b7b9f796d639");
    expect(step(4)).toContain("a diff never shows that a test passes");
    expect(step(4)).not.toContain("shows this criterion holds");
    // Report finding 2, Step 5: "The contents of one file cannot show which files changed or any CI result".
    expect(step(5)).not.toContain("git show");
    expect(step(5)).not.toContain("shows this criterion holds");
  });

  it("adds the steps the report asked for: a run of the named test file and a read of required checks", () => {
    expect(body).toContain("- **Do:** run `node scripts/bridge-worktree-deps.mjs` to link the clone's installed dependencies into this throwaway worktree (a clone with none needs `pnpm install` first); then run `pnpm exec vitest run tests/work-monitor-failures.test.ts`.");
    expect(body).toContain("- **Do:** run `gh pr checks claude/pin-work-monitor-malformed-record-20261104T093452943Z --required`.");
    // The body keeps its Validation evidence, whose receipts the review binds.
    expect(body).toContain("\n\n### Validation evidence\n");
    expect(fixturePrompt("qa")).toContain("`gh pr checks claude/pin-work-monitor-malformed-record-20261104T093452943Z --required`");
  });

  it("stays in Decision 0169's boundary: the real two-step report still refuses the carve-out", () => {
    const judged = judgeQaPlanReport({
      role: "qa", verdict: "fail", summary: "Operator QA plan steps 4 and 5 expect output that cannot show what they claim.",
      candidate: { headSha: "h", url: "u" },
      checks: [{ criterion: "operator-qa-plan", name: "Operator QA plan", status: "fail", evidence: "Step 4 expects a diff to show tests pass. Step 5 expects one file's contents to show the touched-file limit and CI results." }],
      findings: [
        { severity: "medium", title: "Operator QA plan Step 5 cannot show the criterion it claims to prove", evidence: "", recommendation: "" },
        { severity: "medium", title: "Operator QA plan Step 4 cannot show that the other tests pass", evidence: "", recommendation: "" }
      ],
      residualRisks: [],
      effectiveness: { deterministicGateReasons: [] }
    }, { head: "h", actionKey: "arcadia/pin-work-monitor-malformed-record", requestId: "r", at: "2026-11-05T04:22:17.269Z" });
    expect(judged).toEqual({ ok: false, reason: "more than one finding" });
  });

  it("keeps the real inputs: the fixture's own body still carries the plan that attempt judged", () => {
    const fixture = loadQaPromptFixture();
    const original = assemblePrReviewPrompt({ ...fixture, role: "qa" });
    expect(original).toContain("and that output shows this criterion holds, exactly as worded: “The alteration applies only");
    expect(original).not.toContain("gh pr checks");
    expect(fixture.pullRequest.number).toBe(2062);
  });
});
