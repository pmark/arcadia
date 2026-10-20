import { describe, expect, it } from "vitest";
import { namedTestFiles, validateCompletionCandidate } from "../src/sessions/completionValidation.js";

// Issue #1599: which test files an Action's acceptance criteria name. The
// live criterion shapes come from the Plan of Action
// test-transient-review-retry-after-exhaustion.
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
