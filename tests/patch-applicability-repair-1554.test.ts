import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyPatchApplicability } from "../src/qa/patchApplicability.js";

/**
 * The deterministic patch check on the live review-repair candidate of PR
 * #1554 (`112c00845..a6e473d8f`, `git format-patch --stdout`): the failed
 * candidate's preserved draft, the Arcadia Controller's retirement of it
 * (2bbc69665, trailer `Arcadia-Retired-Completion-Draft`), the repair's own
 * preserved change and pretty-printed draft, and the worker's settlement. The
 * settlement archived that draft as a deletion plus a compact copy (git finds
 * no rename, #1556) and, settling after midnight, bumped the Mission Log's
 * `updated:` from 2026-10-18 to 2026-10-19 (#1555). Both used to classify as
 * `authority`, gating the repair as authority-adjacent.
 */
const LIVE = readFileSync(path.join(import.meta.dirname, "fixtures", "repair-1554", "candidate.patch"), "utf8");
const RETIRED = ".arcadia/asks/agent-ask-complete-implement-docs-reports-first-supervised-claude-112c008454f2.yaml";
const DRAFT = ".arcadia/asks/agent-ask-complete-implement-docs-reports-first-supervised-claude-2bbc69665127.yaml";
const ARCHIVE = ".arcadia/asks/archive/agent-ask-complete-implement-docs-reports-first-supervised-claude-2bbc69665127.yaml";
const PLAN = "docs/plans/arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider.md";
const COMMITS = [
  "f8e0d5706cae82a02a8c46e5d8d89f5722e0aac6", "2bbc696651270669407db9ac074c9479e9817754",
  "f3abf652f420ffe0564ae644e2f86c40b62635e8", "a6e473d8f7c554284fa027c9a074a1f312a0f6e7"
];
const BUMP = "-updated: 2026-10-18\n+updated: 2026-10-19\n";

const classOf = (patch: string) => Object.fromEntries(classifyPatchApplicability(patch, { declaredCommits: COMMITS }).files.map((file) => [file.path, file]));
const edit = (from: string, to: string) => {
  expect(LIVE).toContain(from);
  return LIVE.replace(from, to);
};

describe("the deterministic patch check on a live review-repair candidate settled after midnight (PR #1554)", () => {
  it("classifies every governed record as governed and the patch as docs-only", () => {
    const result = classifyPatchApplicability(LIVE, { declaredCommits: COMMITS });
    expect(result.problems).toEqual([]);
    expect(Object.fromEntries(result.files.map((file) => [file.path, file.class]))).toEqual({
      [RETIRED]: "governed-record",
      "docs/reports/first-supervised-claude-run-2026-10-18.md": "inert-document",
      [DRAFT]: "governed-record",
      [ARCHIVE]: "governed-record",
      "MISSION_LOG.md": "governed-record",
      "PROJECT.md": "governed-record",
      [PLAN]: "governed-record"
    });
    expect(result.inert).toBe(true);
  });

  it.each([
    ["moves updated: backwards", BUMP, "-updated: 2026-10-18\n+updated: 2026-10-17\n"],
    ["bumps updated: to a date no appended entry carries", BUMP, "-updated: 2026-10-18\n+updated: 2026-10-20\n"],
    ["changes another front-matter field beside updated:", " project: arcadia\n-updated", "-project: arcadia\n+project: other\n-updated"],
    ["replaces an updated: line outside the front matter", "@@ -3,7 +3,7 @@ arcadia: v1", "@@ -2603,7 +2603,7 @@ arcadia: v1"]
  ])("still refuses a Mission Log change that %s", (_label, from, to) => {
    expect(classOf(edit(from, to))["MISSION_LOG.md"]).toMatchObject({ class: "authority", reason: expect.stringContaining("only be appended to") });
  });

  it("still refuses an updated: bump beside an edit to an earlier log entry", () => {
    const context = LIVE.split("\n").find((line) => line.startsWith(" - **Blockers:** None recorded by this settlement (Agent Ask auto-settle-arcadia-implement-a-hermetic"))!;
    const edited = edit(`${context}\n`, `-${context.slice(1)}\n+${context.slice(1).replace("None recorded", "Nothing recorded")}\n`);
    expect(classOf(edited)["MISSION_LOG.md"]).toMatchObject({ class: "authority", reason: expect.stringContaining("only be appended to") });
  });

  it("still refuses an updated: bump with nothing appended", () => {
    const start = LIVE.indexOf("@@ -2631,3 +2631,10 @@");
    const end = LIVE.indexOf("diff --git a/PROJECT.md", start);
    expect(start).toBeGreaterThan(0);
    const bumpOnly = LIVE.slice(0, start) + LIVE.slice(end);
    expect(classOf(bumpOnly)["MISSION_LOG.md"]).toMatchObject({ class: "authority", reason: expect.stringContaining("only be appended to") });
  });

  it("still refuses the repair draft's deletion when its archive copy is not the same Ask", () => {
    // Any byte change breaks the archive copy's blob id, so its content is no longer proven.
    const forged = edit('"candidate_revision":"f3abf652f420ffe0564ae644e2f86c40b62635e8"',
      '"candidate_revision":"f3abf652f420ffe0564ae644e2f86c40b62635e8","approved":"yes"');
    expect(classOf(forged)[DRAFT]).toMatchObject({ class: "authority" });
  });
});
