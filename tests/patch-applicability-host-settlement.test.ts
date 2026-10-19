import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyPatchApplicability } from "../src/qa/patchApplicability.js";

/**
 * The deterministic patch check on the live headless Claude candidate of PR
 * #1545 (`112c00845..71d40eb99459`, `git format-patch --stdout`): host
 * preservation committed the agent's report and its drafted `complete` Ask in
 * one attested commit, and the worker's auto-settle settlement archived that
 * draft under its own file name while naming its content-addressed proposal id
 * (`auto-settle-<project>-<action>-<sha256(archived Ask)[0:12]>`) in the Plan's
 * `next_action`. Both governed records used to classify as `authority`, so
 * every reviewer not-applicable claim on such a docs-only candidate was refused.
 */
const LIVE = readFileSync(path.join(import.meta.dirname, "fixtures", "premortem-1545", "candidate.patch"), "utf8");
const DRAFT = ".arcadia/asks/agent-ask-complete-implement-docs-reports-first-supervised-claude-112c008454f2.yaml";
const ARCHIVE = ".arcadia/asks/archive/agent-ask-complete-implement-docs-reports-first-supervised-claude-112c008454f2.yaml";
const PLAN = "docs/plans/arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider.md";
const AUTO_SETTLE_ID = "auto-settle-arcadia-implement-docs-reports-first-supervised-claude-ef5db36bc149";

const classOf = (patch: string) => Object.fromEntries(classifyPatchApplicability(patch).files.map((file) => [file.path, file]));

/** The settlement's archive rename replaced by a plain add of the same archived content: the draft stays in place. */
function draftLeftInPlace(patch: string): string {
  const start = patch.indexOf(`diff --git a/${DRAFT} b/${ARCHIVE}`);
  const end = patch.indexOf("diff --git a/MISSION_LOG.md", start);
  const block = patch.slice(start, end);
  const added = block.split("\n").find((line) => line.startsWith("+{"))!;
  const replacement = `diff --git a/${ARCHIVE} b/${ARCHIVE}\nnew file mode 100644\nindex 000000000..e93807b48\n--- /dev/null\n+++ b/${ARCHIVE}\n@@ -0,0 +1 @@\n${added}\n`;
  return patch.slice(0, start) + replacement + patch.slice(end);
}

describe("the deterministic patch check on a worker-settled headless candidate (live PR #1545)", () => {
  it("classifies the host-consumed completion draft and the auto-settle Plan rewrite as governed records, and changes nothing else", () => {
    const result = classifyPatchApplicability(LIVE);
    expect(result.problems).toEqual([]);
    expect(Object.fromEntries(result.files.map((file) => [file.path, file.class]))).toEqual({
      [DRAFT]: "governed-record",
      "docs/reports/first-supervised-claude-run-2026-10-18.md": "inert-document",
      [ARCHIVE]: "governed-record",
      "MISSION_LOG.md": "governed-record",
      "PROJECT.md": "governed-record",
      [PLAN]: "governed-record"
    });
    expect(result.inert).toBe(true);
  });

  it("still refuses a hand-edited next_action naming an id no carried Ask derives", () => {
    const edited = LIVE.replace(`+    next_action: Completed via Agent Ask ${AUTO_SETTLE_ID}; no further action.`,
      `+    next_action: Completed via Agent Ask ${AUTO_SETTLE_ID.slice(0, -12)}000000000000; no further action.`);
    expect(edited).not.toBe(LIVE);
    expect(classOf(edited)[PLAN]).toMatchObject({ class: "authority", reason: expect.stringContaining("request id must match") });
  });

  it("still refuses a second Agent Ask the mixed preservation commit adds and the settlement never archives", () => {
    const other = ".arcadia/asks/agent-ask-complete-other-ffffffffffff.yaml";
    const extra = `diff --git a/${other} b/${other}\nnew file mode 100644\nindex 000000000..1111111\n--- /dev/null\n+++ b/${other}\n@@ -0,0 +1 @@\n+{"agent_ask":"v1","request_id":"complete-other-ffffffffffff","project":"arcadia","intent":"complete","target_ref":"action/other"}\n`;
    const patched = LIVE.replace("diff --git a/docs/reports/", `${extra}diff --git a/docs/reports/`);
    const classes = classOf(patched);
    expect(classes[other]).toMatchObject({ class: "authority", reason: expect.stringContaining("outside an attested") });
    expect(classes[DRAFT]?.class).toBe("governed-record");
  });

  it("still refuses a completion draft the settlement leaves in place", () => {
    const patched = draftLeftInPlace(LIVE);
    expect(patched).not.toBe(LIVE);
    expect(classOf(patched)[DRAFT]).toMatchObject({ class: "authority", reason: expect.stringContaining("outside an attested") });
  });

  it("does not derive an auto-settle id from archived content it cannot verify against the blob index", () => {
    // The archived Ask's content altered by one byte: its blob no longer matches the index line.
    const tampered = LIVE.replace(/^(\+\{"agent_ask":"v1".*?)"desired_result"/gm, (whole, head: string, offset: number) =>
      offset > LIVE.indexOf(`rename to ${ARCHIVE}`) ? `${head}"desired_result "` : whole);
    expect(tampered).not.toBe(LIVE);
    expect(classOf(tampered)[PLAN]).toMatchObject({ class: "authority", reason: expect.stringContaining("request id must match") });
  });
});
