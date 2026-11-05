/**
 * The real inputs of pmark/arcadia#2062's failed QA attempt (2026-11-05), through
 * today's prompt and plan renderer. QA failed every candidate that attempt on two
 * things no repair can change: a settlement id it read as a mismatch, and plan
 * steps that claimed more than their commands show.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixturePrompt, fixturePullRequestBody, loadQaPromptFixture } from "../scripts/qa-prompt-fixture.js";
import { assemblePrReviewPrompt, governedRecordCheckSection } from "../src/qa/prReview.js";

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
    expect(qa).toContain("So an `auto-settle-` id the section marks Verified, beside an Ask with a different request_id, is not a mismatch");
    // No unconditional assurance: the rule points at this patch's result.
    expect(qa).toContain("anything marked Not verified, or not listed, carries no assurance from this rule");
    expect(qa).not.toContain("which Arcadia checks");
    expect(qa).not.toContain("Arcadia checks that");
    expect(qa).toContain("Report each as pass, fail, or not-checked with concrete evidence.");
    // QA's criteria are the Action's acceptance, never not-applicable.
    const instructions = qa.slice(0, qa.indexOf("## Pull-request body and deterministic evidence"));
    expect(instructions).not.toContain("not-applicable");
    expect(instructions).not.toContain("Return verdict pass only when every criterion is pass or not-applicable");
  });

  it("hands both roles the check's result, verified, on the real settlement", () => {
    for (const role of ["qa", "code-review"] as const) {
      const prompt = fixturePrompt(role);
      expect(prompt, role).toContain(`- Verified (Agent Ask citation): ${JSON.stringify(AUTO_SETTLE)} cited in`);
      expect(prompt, role).toContain(`(request_id ${JSON.stringify(ASK_REQUEST)})`);
      expect(prompt, role).toContain("as the auto-settle id derived from its content");
      // The rename is the reviewer's to confirm; nothing claims it was compared.
      expect(prompt, role).toContain(`- Not verified (Archived Ask): ${JSON.stringify(`.arcadia/asks/archive/agent-ask-${ASK_REQUEST}.yaml`)} archived by a rename`);
      expect(prompt, role).toContain("- Verified (Draft retirement):");
    }
    const prompt = fixturePrompt("qa");
    expect(prompt.indexOf("## Governed-record check")).toBeGreaterThan(prompt.indexOf("## Scope judgement"));
    expect(prompt.indexOf("## Governed-record check")).toBeLessThan(prompt.indexOf("## Complete patch"));
  });

  it("verifies nothing when the id's hash is wrong, the Ask is not carried, or the commit list is unreadable", () => {
    const fixture = loadQaPromptFixture();
    const files = (fixture.pullRequest.files ?? []).map((file) => file.path);
    const section = (patch: string, commits: readonly string[] | null) => governedRecordCheckSection(patch, files, commits, fixture.commitFiles).join("\n");
    // A real id with one hex digit changed, in the Plan and the Mission Log.
    const wrongHash = fixture.patch.replaceAll(AUTO_SETTLE, `${AUTO_SETTLE.slice(0, -1)}0`);
    const wrong = section(wrongHash, fixture.declaredCommits ?? null);
    expect(wrong).toContain(`- Not verified (Agent Ask citation): ${JSON.stringify(`${AUTO_SETTLE.slice(0, -1)}0`)}`);
    expect(wrong).not.toContain("- Verified (Agent Ask citation)");
    // A merge commit GitHub's patch omits, or an unreadable list: everything falls back to normal judgement.
    for (const commits of [null, [...(fixture.declaredCommits ?? []), "f".repeat(40)]]) {
      const closed = section(fixture.patch, commits);
      expect(closed).toContain("Nothing below is verified");
      expect(closed).toContain("No assurance in the Governed records rule applies");
      expect(closed).not.toMatch(/^- Verified/m);
    }
    expect(governedRecordCheckSection("From 1111111111111111111111111111111111111111 Mon Sep 17 00:00:00 2001\nSubject: [PATCH] x\n\n---\ndiff --git a/src/a.ts b/src/a.ts\n", ["src/a.ts"], ["1".repeat(40)])).toEqual([]);
  });

  it("verifies a split archive only when nothing but candidate_revision differs", () => {
    const blob = (content: string) => createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex");
    const hunk = (prefix: string, content: string) => {
      const lines = content.split("\n").slice(0, -1);
      return [`@@ -${prefix === "-" ? `1,${lines.length}` : "0,0"} +${prefix === "+" ? `1,${lines.length}` : "0,0"} @@`, ...lines.map((line) => `${prefix}${line}`)].join("\n");
    };
    const draft = "request_id: complete-a\nproject: p\ntarget_ref: action/a\ncandidate_revision: abcdef1\nnotes: real\n";
    const patch = (archive: string) => {
      return [
        "From 1111111111111111111111111111111111111111 Mon Sep 17 00:00:00 2001",
        "Subject: [PATCH] chore(arcadia): settle",
        "",
        "Written by `arcadia agent-ask settle --apply` (asksettle_abc).",
        "---",
        "diff --git a/.arcadia/asks/agent-ask-complete-a.yaml b/.arcadia/asks/agent-ask-complete-a.yaml",
        "deleted file mode 100644",
        `index ${blob(draft)}..0000000`,
        "--- a/.arcadia/asks/agent-ask-complete-a.yaml",
        "+++ /dev/null",
        hunk("-", draft),
        "diff --git a/.arcadia/asks/archive/agent-ask-complete-a.yaml b/.arcadia/asks/archive/agent-ask-complete-a.yaml",
        "new file mode 100644",
        `index 0000000..${blob(archive)}`,
        "--- /dev/null",
        "+++ b/.arcadia/asks/archive/agent-ask-complete-a.yaml",
        hunk("+", archive),
        ""
      ].join("\n");
    };
    const files = [".arcadia/asks/agent-ask-complete-a.yaml", ".arcadia/asks/archive/agent-ask-complete-a.yaml"];
    const commits = ["1".repeat(40)];
    const object = (archive: string) => ({ [commits[0]]: [{ path: files[0], previousPath: null, blob: blob(draft) }, { path: files[1], previousPath: null, blob: blob(archive) }] });
    const section = (archive: string) => governedRecordCheckSection(patch(archive), files, commits, object(archive)).join("\n");
    expect(section("request_id: complete-a\nproject: p\ntarget_ref: action/a\ncandidate_revision: 1234567\nnotes: real\n"))
      .toContain("- Verified (Archived Ask):");
    // The review's case: an archive re-added with edited evidence notes.
    const edited = section("request_id: complete-a\nproject: p\ntarget_ref: action/a\ncandidate_revision: 1234567\nnotes: edited\n");
    expect(edited).toContain("- Not verified (Archived Ask):");
    expect(edited).not.toContain("- Verified (Archived Ask):");
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
    expect(step(4)).toContain("which runs `tests/work-monitor-failures.test.ts`: its exit-zero result is that proof.");
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

  it("keeps the real inputs: the fixture's own body still carries the plan that attempt judged", () => {
    const fixture = loadQaPromptFixture();
    const original = assemblePrReviewPrompt({ ...fixture, role: "qa" });
    expect(original).toContain("and that output shows this criterion holds, exactly as worded: “The alteration applies only");
    expect(original).not.toContain("gh pr checks");
    expect(fixture.pullRequest.number).toBe(2062);
  });
});
