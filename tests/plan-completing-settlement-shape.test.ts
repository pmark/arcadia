/**
 * Issue #2270: the settlement that completes a Plan's LAST Action removes
 * `current_action` (Plan and PROJECT.md) and sets the Plan `complete` (the
 * shape of commit 7f3235f1a). The shape check verifies it only with the Plan
 * as the commit's parent held it, and refuses every other combination. Series
 * are real `git format-patch` output over real commits.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkGovernedRecords, type CommitObjectFile, type ParentDocuments } from "../src/qa/patchApplicability.js";
import { governedRecordCheckSection } from "../src/qa/prReview.js";

const PLAN_PATH = "docs/plans/p.md";
const LAST = "pin-last";
const ASK = "agent-ask-complete-last.yaml";
const DRAFT = `.arcadia/asks/${ASK}`;
const ARCHIVE = `.arcadia/asks/archive/${ASK}`;
const SETTLED = "Written by `arcadia agent-ask settle --apply` (asksettle_0123456789abcdef01).";
const askContent = (fields: Record<string, string> = {}) => `${JSON.stringify({ request_id: "complete-last", project: "p", target_ref: `action/${LAST}`, intent: "complete", notes: "real", ...fields }, null, 2)}\n`;

type Statuses = Record<string, string>;
function plan(opts: { status: string; actions: Statuses; current: string | null; completedVia?: string }): string {
  const lines = ["---", "arcadia: v1", "type: plan", "slug: p", `status: ${opts.status}`, "updated: 2026-11-08", "actions:"];
  for (const [id, status] of Object.entries(opts.actions)) {
    lines.push(`  - id: ${id}`, `    title: Do ${id}.`, `    status: ${status}`, "    effort: session",
      `    next_action: ${status === "done" && opts.completedVia && id === LAST ? `Completed via Agent Ask ${opts.completedVia}; no further action.` : status === "done" ? "Completed via Agent Ask earlier; no further action." : `Do ${id}.`}`);
  }
  lines.push("questions: []");
  if (opts.current !== null) lines.push(`current_action: ${opts.current}`);
  lines.push("recommended_model: standard", "---", "", "# Body", "");
  return lines.join("\n");
}
const project = (opts: { activePlan: string; current: string | null }) =>
  ["---", "slug: arcadia", "status: active", `active_plan: ${opts.activePlan}`, ...(opts.current === null ? [] : [`current_action: ${opts.current}`]), "updated: 2026-11-08", "---", ""].join("\n");

const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const ENV = {
  ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid"
};

interface Scenario {
  base: Statuses;
  baseCurrent?: string;
  basePlanStatus?: string;
  baseActivePlan?: string;
  after: { status: string; actions: Statuses; current: string | null };
  projectAfter?: string | null;
}

/** A base commit, the preserved Ask draft, and the settlement commit; returns the series as the review reads it. */
function series(scenario: Scenario) {
  const repo = mkdtempSync(path.join(tmpdir(), "arcadia-plan-completion-"));
  temporary.push(repo);
  const git = (args: string[], input?: string) => execFileSync("git", args, { cwd: repo, env: ENV, encoding: "utf8", input });
  const write = (files: Record<string, string | null>) => {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(repo, file);
      if (content === null) rmSync(target);
      else { mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, content, "utf8"); }
    }
  };
  const commit = (files: Record<string, string | null>, message: string) => { write(files); git(["add", "-A"]); git(["commit", "-q", "--no-verify", "-F", "-"], message); };
  git(["init", "-q", "-b", "main"]);
  commit({
    [PLAN_PATH]: plan({ status: scenario.basePlanStatus ?? "active", actions: scenario.base, current: scenario.baseCurrent ?? LAST }),
    "PROJECT.md": project({ activePlan: scenario.baseActivePlan ?? "p", current: scenario.baseCurrent ?? LAST }),
    "MISSION_LOG.md": "# Mission Log\n", "README.md": "# Fixture\n"
  }, "base");
  const base = git(["rev-parse", "HEAD"]).trim();
  commit({ [DRAFT]: askContent({ candidate_revision: "abcdef1" }), "docs/work.md": "The work.\n" }, "chore(candidate): preserve\n\nArcadia-Preservation-Request: worker-tick-preserve-session_fixture\n");
  commit({
    [DRAFT]: null, [ARCHIVE]: askContent({ candidate_revision: "1234567" }),
    [PLAN_PATH]: plan({ ...scenario.after, completedVia: "complete-last" }),
    "PROJECT.md": project({ activePlan: scenario.baseActivePlan ?? "p", current: scenario.projectAfter === undefined ? null : scenario.projectAfter }),
    "MISSION_LOG.md": "# Mission Log\n\n## 2026-11-08 — Completed it\n"
  }, `chore(arcadia): settle complete-last\n\n${SETTLED}\n`);
  const commits = git(["rev-list", "--reverse", `${base}..HEAD`]).trim().split("\n");
  const commitFiles: Record<string, CommitObjectFile[]> = {};
  const parents: Record<string, Record<string, string>> = {};
  for (const oid of commits) {
    commitFiles[oid] = git(["diff-tree", "-r", "-M", "--no-commit-id", "--raw", "--no-abbrev", oid]).trim().split("\n").filter(Boolean).map((line) => {
      const [meta, ...paths] = line.split("\t");
      const [, , oldBlob, newBlob, status] = meta.split(" ");
      return { path: paths[paths.length - 1], previousPath: paths.length > 1 ? paths[0] : null, blob: status === "D" ? oldBlob : newBlob };
    });
    parents[oid] = Object.fromEntries(["PROJECT.md", PLAN_PATH].map((file) => [file, git(["show", `${oid}^:${file}`])]));
  }
  const patch = git(["format-patch", "--stdout", "--no-signature", `${base}..HEAD`]);
  const files = git(["diff", "--name-only", base, "HEAD"]).trim().split("\n");
  return { patch, commits, commitFiles, files, parents: parents as ParentDocuments, settlement: commits[commits.length - 1] };
}

const shapeOf = (check: ReturnType<typeof checkGovernedRecords>, file: string) => check.shapes.find((fact) => fact.subject.includes(file));
const check = (s: ReturnType<typeof series>, parentDocuments: ParentDocuments | null | undefined) =>
  checkGovernedRecords(s.patch, { declaredFiles: s.files, declaredCommits: s.commits, commitFiles: s.commitFiles, parentDocuments });

/** Every other Action already done, the last one open: the 7f3235f1a base. */
const COMPLETING: Scenario = {
  base: { "first-one": "done", "second-one": "done", [LAST]: "open" },
  after: { status: "complete", actions: { "first-one": "done", "second-one": "done", [LAST]: "done" }, current: null }
};

describe("a Plan-completing settlement (Issue #2270)", () => {
  it("(a) verifies the 7f3235f1a shape when the parent's Plan shows every other Action done", () => {
    const s = series(COMPLETING);
    expect(s.patch).toContain("-current_action: pin-last");
    expect(s.patch).toContain("-status: active\n+status: complete");
    const result = check(s, s.parents);
    expect(shapeOf(result, PLAN_PATH)).toMatchObject({ verified: true });
    expect(shapeOf(result, "PROJECT.md")).toMatchObject({ verified: true });
    const section = governedRecordCheckSection(s.patch, s.files, s.commits, s.commitFiles, s.parents).join("\n");
    expect(section).not.toContain("Nothing below is verified");
    expect(section).toContain("- Verified (Record shape): \"docs/plans/p.md\"");
  });

  it("(b) refuses the same patch without the parent evidence, saying why", () => {
    const s = series(COMPLETING);
    for (const evidence of [undefined, null, {}, { [s.settlement]: {} }]) {
      const result = check(s, evidence);
      expect(shapeOf(result, PLAN_PATH)).toMatchObject({ verified: false });
      expect(shapeOf(result, PLAN_PATH)?.detail).toContain("parent revision was not read");
      expect(shapeOf(result, "PROJECT.md")).toMatchObject({ verified: false });
    }
  });

  it("(c) refuses it when another Action is still open at the parent revision", () => {
    const s = series({ ...COMPLETING, base: { "first-one": "done", "second-one": "open", [LAST]: "open" }, after: { status: "complete", actions: { "first-one": "done", "second-one": "open", [LAST]: "done" }, current: null } });
    const result = check(s, s.parents);
    expect(shapeOf(result, PLAN_PATH)).toMatchObject({ verified: false });
    expect(shapeOf(result, PLAN_PATH)?.detail).toContain("second-one is not done");
    expect(shapeOf(result, "PROJECT.md")).toMatchObject({ verified: false });
  });

  it("(c2) refuses it when a bogus parent Plan is supplied (other Action open, wrong pointer, not active)", () => {
    const s = series(COMPLETING);
    const bogus = (content: string) => ({ [s.settlement]: { ...s.parents[s.settlement], [PLAN_PATH]: content } });
    const good = s.parents[s.settlement][PLAN_PATH];
    expect(shapeOf(check(s, bogus(good.replace("current_action: pin-last", "current_action: first-one"))), PLAN_PATH)).toMatchObject({ verified: false });
    expect(shapeOf(check(s, bogus(good.replace("\nstatus: active", "\nstatus: draft"))), PLAN_PATH)).toMatchObject({ verified: false });
    expect(shapeOf(check(s, bogus("not a plan")), PLAN_PATH)).toMatchObject({ verified: false });
  });

  it("(d) refuses a removed-only current_action without the Plan becoming complete", () => {
    const s = series({ ...COMPLETING, after: { ...COMPLETING.after, status: "active" } });
    const result = check(s, s.parents);
    expect(shapeOf(result, PLAN_PATH)).toMatchObject({ verified: false });
    expect(shapeOf(result, PLAN_PATH)?.detail).toContain("replaced line for line");
    expect(shapeOf(result, "PROJECT.md")).toMatchObject({ verified: false });
  });

  it("(e) refuses status complete with a replaced (moved) pointer", () => {
    const s = series({ ...COMPLETING, after: { ...COMPLETING.after, current: "first-one" }, projectAfter: "first-one" });
    const result = check(s, s.parents);
    expect(shapeOf(result, PLAN_PATH)).toMatchObject({ verified: false });
    expect(shapeOf(result, PLAN_PATH)?.detail).toContain("together with its current_action being removed");
  });

  it("refuses status complete with the pointer left in place", () => {
    const s = series({ ...COMPLETING, after: { ...COMPLETING.after, current: LAST }, projectAfter: LAST });
    expect(shapeOf(check(s, s.parents), PLAN_PATH)).toMatchObject({ verified: false });
  });

  it("refuses PROJECT.md dropping current_action for a Plan other than active_plan", () => {
    const s = series({ ...COMPLETING, baseActivePlan: "q" });
    const result = check(s, s.parents);
    expect(shapeOf(result, "PROJECT.md")).toMatchObject({ verified: false });
    expect(shapeOf(result, "PROJECT.md")?.detail).toContain("active Plan");
  });

  it("refuses a Plan completion that leaves the Action it completes not done", () => {
    const s = series({ ...COMPLETING, after: { status: "complete", actions: { "first-one": "done", "second-one": "done", [LAST]: "open" }, current: null } });
    expect(shapeOf(check(s, s.parents), PLAN_PATH)).toMatchObject({ verified: false });
  });
});
