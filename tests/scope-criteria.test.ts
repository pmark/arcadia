import { describe, expect, it } from "vitest";
import { scopeAllowances, scopeIntersection, scopeViolations, settlementRecordPaths } from "../src/sessions/scopeCriteria.js";
import { scopeJudgementSection } from "../src/qa/prReview.js";

// Issue #1608: the criterion shapes the live Plans use, read exactly or not at all.
describe("scope criteria", () => {
  it("reads explicit paths, cut at the clause's end", () => {
    expect(scopeAllowances(["The change touches only tests/tick-independent-review.test.ts; the focused vitest run of that file, pnpm lint and tsc pass."]))
      .toEqual([{ criterion: expect.any(String), allowed: ["tests/tick-independent-review.test.ts"] }]);
    expect(scopeAllowances(["The change touches only src/production/reviewRepair.ts and tests/review-repair-loop.test.ts; the focused vitest run passes."])[0].allowed)
      .toEqual(["src/production/reviewRepair.ts", "tests/review-repair-loop.test.ts"]);
    expect(scopeAllowances(["The change touches only tests/system-tmux-long-command.test.ts"])[0].allowed).toEqual(["tests/system-tmux-long-command.test.ts"]);
    expect(scopeAllowances(["It touches only a.md, docs/b.md and src/c/. Lint passes."])[0].allowed).toEqual(["a.md", "docs/b.md", "src/c/"]);
  });

  it("resolves 'those two files' and 'that new report file' to the paths the other criteria name, only when the count is exact", () => {
    const action2 = [
      "In docs/managed-production-readiness.md, the Claude usage credential and window cap row (near line 101) states that Decision 0130 is approved; no other line of that file changes.",
      "In tests/claude-capacity-preadmission.test.ts, the loadCredentials fake returns no refreshToken field, and that test still passes.",
      "The change touches only those two files; the focused vitest run of tests/claude-capacity-preadmission.test.ts, pnpm lint and tsc pass."
    ];
    expect(scopeAllowances(action2)).toEqual([{ criterion: action2[2], allowed: ["docs/managed-production-readiness.md", "tests/claude-capacity-preadmission.test.ts"] }]);
    const report = ["docs/reports/first-run.md exists and records the run's stages.", "Every PR number cited resolves.", "The change touches only that new report file."];
    expect(scopeAllowances(report)[0].allowed).toEqual(["docs/reports/first-run.md"]);
    // Three paths named, "two files" claimed: not exactly determined, so not judged.
    expect(scopeAllowances(["a/x.md is fixed.", "b/y.md is fixed.", "c/z.md is fixed.", "The change touches only those two files."])).toEqual([]);
  });

  it("does not judge prose it cannot read exactly", () => {
    expect(scopeAllowances(["Its ON CONFLICT DO UPDATE changes only a row whose role is REPAIR_CANDIDATE_GATE_ROLE, with a hermetic test."])).toEqual([]);
    expect(scopeAllowances(["filters and reset change only view state"])).toEqual([]);
    expect(scopeAllowances(["The change touches only ../outside.md"])).toEqual([]);
  });

  it("names the files a change touches outside each readable scope", () => {
    const criteria = ["The change touches only tests/tick-independent-review.test.ts; lint passes."];
    expect(scopeViolations(criteria, ["tests/tick-independent-review.test.ts"])).toEqual([]);
    expect(scopeViolations(criteria, ["tests/tick-independent-review.test.ts", "src/production/tick.ts"]).map((violation) => violation.outside))
      .toEqual([["src/production/tick.ts"]]);
    expect(scopeViolations(["It touches only src/c/."], ["src/c/d.ts", "src/cd.ts"])[0].outside).toEqual(["src/cd.ts"]);
  });

  it("tells the brief only what every scope criterion allows at once", () => {
    expect(scopeIntersection(["It touches only src/a.ts and src/b.ts.", "It touches only src/."])).toEqual(["src/a.ts", "src/b.ts"]);
    expect(scopeIntersection(["It touches only src/a.ts.", "It touches only src/b.ts."])).toEqual([]);
    expect(scopeIntersection(["No scope here."])).toBeNull();
  });
});

// Issue #1625: the reviewer's scope judgement excludes the settlement records, as the host check does.
describe("settlement records in the reviewer's scope judgement", () => {
  const scoped = ["src/a.ts", "tests/a.test.ts"];
  const records = ["MISSION_LOG.md", "PROJECT.md", "docs/plans/p.md", ".arcadia/asks/archive/agent-ask-x.yaml"];

  it("excuses only the records of a settled head, so scoped files are the whole of the Session's change", () => {
    const files = [...scoped, ...records];
    expect(settlementRecordPaths(files)).toEqual(records);
    const section = scopeJudgementSection(files).join("\n");
    for (const record of records) expect(section).toContain(`\`${record}\``);
    expect(section).not.toContain("`src/a.ts`");
  });

  it("still surfaces a stray script, a stale top-level Ask draft, a proposal and a Decision", () => {
    const stray = ["scripts/stray.mjs", ".arcadia/asks/agent-ask-old.yaml", ".arcadia/asks/proposal.yaml", "docs/decisions/0999-x.md"];
    const files = [...scoped, ...records, ...stray];
    expect(settlementRecordPaths(files)).toEqual(records);
    expect(scopeJudgementSection(files).join("\n")).not.toMatch(/stray\.mjs|agent-ask-old|proposal\.yaml|0999/);
  });

  it("excuses nothing on an unsettled head", () => {
    expect(settlementRecordPaths([...scoped, "PROJECT.md", "docs/plans/p.md"])).toEqual([]);
    expect(scopeJudgementSection([...scoped, "PROJECT.md"])).toEqual([]);
  });
});
