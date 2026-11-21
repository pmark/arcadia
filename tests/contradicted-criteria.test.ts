import { describe, expect, it } from "vitest";
import { CHECKS_VERIFIED_ELSEWHERE_NOTE } from "../src/sessions/actionBrief.js";
import { contradictedCriteriaRefusal, contradictedMetCriteria } from "../src/sessions/contradictedCriteria.js";

// Issue #2890: a completion Ask marked criteria met while their own notes said the work was not done.
const entry = (note: string | null, status = "met", criterion = "The focused vitest run passes.") => ({ criterion, status, note });

describe("contradicted met criteria", () => {
  it("refuses a met criterion whose note says NOT done, naming the criterion and phrase", () => {
    const reason = contradictedCriteriaRefusal([entry("Focused run NOT done in this session.")]);
    expect(reason).toContain("The focused vitest run passes.");
    expect(reason).toContain("NOT done");
  });

  it("refuses a note that defers the work until the PR merges", () => {
    expect(contradictedCriteriaRefusal([entry("Deferred until the PR merges.", "met", "Issue closed citing the merged PR.")]))
      .toContain("Deferred until the PR merges");
    expect(contradictedCriteriaRefusal([entry("Close the issue, pending the merge.")])).not.toBeNull();
  });

  it("refuses a note that says it was not run", () => {
    expect(contradictedCriteriaRefusal([entry("Tests not run in this session.")])).toContain("not run");
    expect(contradictedCriteriaRefusal([entry("Not yet run; will be run once the PR merges.")])).toContain("Not yet run");
  });

  it("refuses a met note that admits a test was unrun or refused (Issue #2905), but accepts a quoted pass", () => {
    expect(contradictedCriteriaRefusal([entry("New test unrun: the sandbox refused vitest.")])).toContain("unrun");
    expect(contradictedCriteriaRefusal([entry("Unable to run the new test here.")])).toContain("Unable to run");
    expect(contradictedCriteriaRefusal([entry("pnpm vitest run was refused in this Session.")])).toContain("was refused");
    expect(contradictedCriteriaRefusal([entry("Nothing was refused; pnpm vitest run tests/x.test.ts: 3 passed.")])).toBeNull();
  });

  it("accepts the words the brief itself recommends for host-run checks", () => {
    expect(contradictedCriteriaRefusal([entry(`Inspected git diff; ${CHECKS_VERIFIED_ELSEWHERE_NOTE}`)])).toBeNull();
  });

  it("does not refuse a met criterion with a clean note", () => {
    expect(contradictedCriteriaRefusal([entry("Ran pnpm exec vitest run tests/x.test.ts: 1 file, 4 tests passed.")])).toBeNull();
    expect(contradictedCriteriaRefusal([entry(null)])).toBeNull();
  });

  it("does not judge a failed or skipped criterion that already says it was not done", () => {
    expect(contradictedCriteriaRefusal([entry("NOT done.", "failed"), entry("Deferred until the PR merges.", "skipped")])).toBeNull();
  });

  it("judges every match: an historical lower-case comparison does not hide a later NOT", () => {
    expect(contradictedCriteriaRefusal([entry("The old suite was not run; the required focused suite was NOT run.")])).toContain("NOT run");
    expect(contradictedCriteriaRefusal([entry("The old suite was not run, NOT run here either.")])).toContain("NOT run");
    expect(contradictedCriteriaRefusal([entry("The old suite was not run; the new suite passed.")])).toBeNull();
  });

  it("refuses an affirmed deferral but not a negated one", () => {
    expect(contradictedCriteriaRefusal([entry("Work is deferred until the PR merges.")])).toContain("deferred until the PR merges");
    expect(contradictedCriteriaRefusal([entry("All tests passed; no work is deferred until the PR merges.")])).toBeNull();
    expect(contradictedCriteriaRefusal([entry("Nothing deferred to a later Action.")])).toBeNull();
    expect(contradictedCriteriaRefusal([entry("The cleanup isn't deferred until the merge.")])).toBeNull();
  });

  it("does not judge a phrase about another state of the code or a hypothetical", () => {
    expect(contradictedCriteriaRefusal([entry("The old behavior was not run by this path before the fix; now it is. Tests pass.")])).toBeNull();
    expect(contradictedCriteriaRefusal([entry("Deferred to a later Action only if the cache is cold; it was not, so all 3 tests ran.")])).toBeNull();
    expect(contradictedMetCriteria([entry("The unfixed code was not yet done in this path. Tests pass.")])).toEqual([]);
  });
});
