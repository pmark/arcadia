import { describe, expect, it } from "vitest";
import { workerOperatorMergeCommand } from "../src/production/workerMerge.js";

const URL = "https://github.com/o/r/pull/7";
const HEAD = "0123456789abcdef0123456789abcdef01234567";

describe("workerOperatorMergeCommand", () => {
  it("returns the exact gh merge command pinned to the reviewed head", () => {
    expect(workerOperatorMergeCommand(URL, HEAD)).toBe(
      `gh pr merge ${URL} --merge --match-head-commit ${HEAD}`
    );
  });

  it("returns null for a null URL", () => {
    expect(workerOperatorMergeCommand(null, HEAD)).toBeNull();
  });

  it("returns null for an empty URL", () => {
    expect(workerOperatorMergeCommand("", HEAD)).toBeNull();
  });
});
