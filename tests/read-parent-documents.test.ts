/**
 * The evidence wiring for the Plan-completing settlement (#2270): a break here
 * fails closed and silently, so the read is pinned with an injected runner.
 */
import { describe, expect, it } from "vitest";
import { readParentDocuments } from "../src/qa/prReview.js";

const OID = "a".repeat(40);
const OTHER = "c".repeat(40);
const PARENT = "b".repeat(40);
const settlement = [{ path: "PROJECT.md", previousPath: null, blob: null }, { path: "docs/plans/p.md", previousPath: null, blob: null }];

function runner(failing: string[] = []) {
  const calls: string[][] = [];
  const runCommand = ((input: { args: string[] }) => {
    calls.push(input.args);
    const target = input.args.find((arg) => arg.startsWith("repos/")) ?? "";
    if (failing.some((fragment) => target.includes(fragment))) return { status: 1, stdout: "", stderr: "no" };
    return { status: 0, stdout: `content of ${target}`, stderr: "" };
  }) as never;
  return { calls, runCommand };
}

describe("readParentDocuments", () => {
  it("reads PROJECT.md and each changed Plan at the single parent, for commits changing both", () => {
    const { calls, runCommand } = runner();
    const read = readParentDocuments("/cwd", "o/r", { [OID]: settlement, [OTHER]: [{ path: "docs/plans/p.md", previousPath: null, blob: null }] }, { [OID]: [PARENT], [OTHER]: [PARENT] }, runCommand);
    expect(Object.keys(read)).toEqual([OID]);
    expect(read[OID]["PROJECT.md"]).toBe(`content of repos/o/r/contents/PROJECT.md?ref=${PARENT}`);
    expect(read[OID]["docs/plans/p.md"]).toContain(`contents/docs/plans/p.md?ref=${PARENT}`);
    expect(calls).toHaveLength(2);
  });

  it("omits a commit whose document read fails, and one without exactly one parent", () => {
    expect(readParentDocuments("/cwd", "o/r", { [OID]: settlement }, { [OID]: [PARENT] }, runner(["docs/plans/p.md"]).runCommand)).toEqual({});
    expect(readParentDocuments("/cwd", "o/r", { [OID]: settlement }, { [OID]: [PARENT, PARENT] }, runner().runCommand)).toEqual({});
    expect(readParentDocuments("/cwd", "o/r", { [OID]: settlement }, {}, runner().runCommand)).toEqual({});
  });

  it("encodes each path segment", () => {
    const { calls, runCommand } = runner();
    readParentDocuments("/cwd", "o/r", { [OID]: [{ path: "PROJECT.md", previousPath: null, blob: null }, { path: "docs/plans/a?b#c%d.md", previousPath: null, blob: null }] }, { [OID]: [PARENT] }, runCommand);
    expect(calls.some((args) => args.some((arg) => arg.includes("contents/docs/plans/a%3Fb%23c%25d.md?ref=")))).toBe(true);
  });
});
