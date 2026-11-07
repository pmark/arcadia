import { describe, expect, it } from "vitest";
import { COMPLETION_VALIDATION_TIMEOUT_MS, namedTestFiles, validateCompletionCandidate } from "../src/sessions/completionValidation.js";
import { MAX_TICK_DURATION_MS } from "../src/commands/worker.js";

// Issue #1599: which test files an Action's acceptance criteria name. The
// live criterion shapes come from the Plan of Action
// test-transient-review-retry-after-exhaustion.
// 2026-10-20 pre-mortem: one named file (tests/review-repair-loop.test.ts)
// takes 360s on the host, so the bound must clear it with headroom while the
// synchronous validation stays well inside one tick's ceiling.
describe("COMPLETION_VALIDATION_TIMEOUT_MS", () => {
  it("clears the slowest named test file with headroom and stays within half the tick ceiling", () => {
    expect(COMPLETION_VALIDATION_TIMEOUT_MS).toBeGreaterThanOrEqual(2 * 360_000);
    expect(COMPLETION_VALIDATION_TIMEOUT_MS).toBeLessThanOrEqual(MAX_TICK_DURATION_MS / 2);
  });
});

describe("namedTestFiles", () => {
  it("finds the test files the live criteria named, once each, in first-mention order", () => {
    expect(namedTestFiles([
      "tests/tick-independent-review.test.ts gains a case where a reviewer call fails with a transient error.",
      "In tests/system-tmux-long-command.test.ts, a launch delivers its brief.",
      "The change touches only tests/tick-independent-review.test.ts; the focused vitest run of that file, pnpm lint and tsc pass."
    ])).toEqual(["tests/tick-independent-review.test.ts", "tests/system-tmux-long-command.test.ts"]);
  });

  it("accepts nested and workspace-package test paths in code spans or parentheses", () => {
    expect(namedTestFiles([
      "`tests/sessions/deep.test.ts` passes (and apps/dashboard/tests/page.test.tsx too)."
    ])).toEqual(["tests/sessions/deep.test.ts", "apps/dashboard/tests/page.test.tsx"]);
  });

  it("ignores anything that is not a plain repository-relative test file", () => {
    expect(namedTestFiles([
      "src/sessions/reconciliation.ts changes; tests/helpers/rehearsalHarness.ts is a helper.",
      "../tests/escape.test.ts and tests/../escape.test.ts and /abs/tests/x.test.ts are not named.",
      "foo/tests/x.test.ts belongs to no recognized root; tests/x.test.tsfoo is not a test file.",
      "No test files are mentioned here.",
      "tests/old.test.ts is removed; the deletion of tests/older.test.ts is recorded; it removes `tests/oldest.test.ts`."
    ])).toEqual([]);
  });

  // 2026-11-07 incident: Action pin-governed-record-path named tests/x.test.ts only as a
  // string the new test asserts about, and pre-acceptance refused 26 relaunches with
  // "tests/x.test.ts (missing)". Paths quoted as data are never files the change must contain.
  it("does not require a test path the criteria quote as data: a value list, a source location or a string literal", () => {
    expect(namedTestFiles([
      "tests/pin-governed-record-path.test.ts is a new test file that imports isGovernedRecordPath from ../src/sessions/scopeCriteria.js and asserts isGovernedRecordPath is true for each of PROJECT.md, MISSION_LOG.md, docs/plans/x.md, docs/decisions/0001-x.md and .arcadia/asks/x.yaml.",
      "The same test file asserts it is false for each of project.md, docs/plansx.md, src/x.ts, tests/x.test.ts and ./PROJECT.md.",
      "The same test asserts isWorkerMergeSafePath returns true for tests/worker-merge.test.ts, docs/guide.md and notes.md.",
      "tests/pin-repository-frame-extraction.test.ts is a new test file that imports firstRepositoryFrame from ../src/soak/rehearsalSoak.js and asserts firstRepositoryFrame returns \"src/foo/bar.ts:12\" for a stack whose frames are, in order, node_modules/x/index.js:5:1, src/foo/bar.ts:12:3 and tests/baz.test.ts:7:1.",
      "The same test file asserts firstRepositoryFrame(\"at scripts/run.mjs:9:2\") returns \"scripts/run.mjs:9\" and firstRepositoryFrame(\"at tests/a.test.ts:3:1\") returns \"tests/a.test.ts:3\".",
      "Apart from the settlement records Arcadia writes, the change touches only tests/pin-governed-record-path.test.ts; tests/tail.test.ts passes."
    ])).toEqual(["tests/pin-governed-record-path.test.ts", "tests/pin-repository-frame-extraction.test.ts", "tests/tail.test.ts"]);
  });

  it("still requires a file named before a value list or outside a string literal", () => {
    expect(namedTestFiles([
      "tests/lister.test.ts asserts the lister returns false for each of src/a.ts and src/b.ts.",
      "The message \"done\" appears and tests/after-quote.test.ts passes.",
      "tests/colon.test.ts: a case is added."
    ])).toEqual(["tests/lister.test.ts", "tests/after-quote.test.ts", "tests/colon.test.ts"]);
  });

  it("still requires a named file when a removal verb governs something else", () => {
    expect(namedTestFiles([
      "tests/review-repair-loop.test.ts asserts a patch that deletes test files is refused.",
      "Removing the stale fixture leaves tests/fixture.test.ts passing."
    ])).toEqual(["tests/review-repair-loop.test.ts", "tests/fixture.test.ts"]);
  });
});

describe("validateCompletionCandidate", () => {
  it("is not required when the criteria name no test file", () => {
    expect(validateCompletionCandidate({ repository: "/nonexistent", worktree: "/nonexistent", base: "HEAD", workspace: "/nonexistent", commands: ["true"], acceptanceCriteria: ["The contract exists."] }))
      .toEqual({ status: "not_required" });
  });

  it("refuses, never passes, when more files are named than run before acceptance", () => {
    const criteria = Array.from({ length: 11 }, (_, index) => `tests/n${index}.test.ts passes.`);
    const result = validateCompletionCandidate({ repository: "/nonexistent", worktree: "/nonexistent", base: "HEAD", workspace: "/nonexistent", commands: ["true"], acceptanceCriteria: criteria });
    expect(result.status).toBe("refused");
  });

  it("refuses, never passes, when no workspace is given to keep unreadable", () => {
    const result = validateCompletionCandidate({ repository: "/nonexistent", worktree: "/nonexistent", base: "HEAD", workspace: undefined, commands: ["true"], acceptanceCriteria: ["tests/x.test.ts passes."] }, { unconfinedForTests: true });
    expect(result).toMatchObject({ status: "refused", reason: expect.stringContaining("workspace was not given") });
  });

  it.runIf(process.platform !== "darwin")("refuses on a host without the macOS Seatbelt sandbox rather than running unconfined", () => {
    const result = validateCompletionCandidate({ repository: "/nonexistent", worktree: "/nonexistent", base: "HEAD", workspace: "/nonexistent", commands: ["true"], acceptanceCriteria: ["tests/x.test.ts passes."] });
    expect(result).toMatchObject({ status: "refused", reason: expect.stringContaining("macOS Seatbelt") });
  });
});
