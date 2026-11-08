/**
 * Issue #2270: the settlement that completes a Plan's LAST Action removes
 * `current_action` (Plan and PROJECT.md) and sets the Plan `complete` (the
 * shape of commit 7f3235f1a). The shape check verifies it only with the Plan
 * as the commit's parent held it, and refuses every other combination. Series
 * are real `git format-patch` output over real commits.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
function plan(opts: { status: string | null; actions: Statuses; current: string | null; completedVia?: string; body?: string[]; slug?: string }): string {
  const lines = ["---", "arcadia: v1", "type: plan", "project: arcadia", `slug: ${opts.slug ?? "p"}`, ...(opts.status === null ? [] : [`status: ${opts.status}`]), "updated: 2026-11-08", "actions:"];
  for (const [id, status] of Object.entries(opts.actions)) {
    lines.push(`  - id: ${id}`, `    title: Do ${id}.`, `    status: ${status}`, "    effort: session",
      `    next_action: ${status === "done" && opts.completedVia && id === LAST ? `Completed via Agent Ask ${opts.completedVia}; no further action.` : status === "done" ? "Completed via Agent Ask earlier; no further action." : `Do ${id}.`}`);
  }
  lines.push("questions: []");
  if (opts.current !== null) lines.push(`current_action: ${opts.current}`);
  lines.push("recommended_model: standard", "---", "", "# Body", ...(opts.body ?? []), "");
  return lines.join("\n");
}
const project = (opts: { activePlan: string; current: string | null; updated?: string }) =>
  ["---", "slug: arcadia", "status: active", `active_plan: ${opts.activePlan}`, ...(opts.current === null ? [] : [`current_action: ${opts.current}`]), `updated: ${opts.updated ?? "2026-11-08"}`, "---", ""].join("\n");

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
  after: { status: string | null; actions: Statuses; current: string | null; body?: string[] };
  projectAfter?: string | null;
  /** Extra or replaced whole files in the base and in the settlement commit. */
  baseFiles?: Record<string, string>;
  settleFiles?: Record<string, string>;
  baseBody?: string[];
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
    [PLAN_PATH]: plan({ status: scenario.basePlanStatus ?? "active", actions: scenario.base, current: scenario.baseCurrent ?? LAST, body: scenario.baseBody }),
    "PROJECT.md": project({ activePlan: scenario.baseActivePlan ?? "p", current: scenario.baseCurrent ?? LAST }),
    "MISSION_LOG.md": "# Mission Log\n", "README.md": "# Fixture\n",
    ...scenario.baseFiles
  }, "base");
  const base = git(["rev-parse", "HEAD"]).trim();
  commit({ [DRAFT]: askContent({ candidate_revision: "abcdef1" }), "docs/work.md": "The work.\n" }, "chore(candidate): preserve\n\nArcadia-Preservation-Request: worker-tick-preserve-session_fixture\n");
  commit({
    [DRAFT]: null, [ARCHIVE]: askContent({ candidate_revision: "1234567" }),
    [PLAN_PATH]: plan({ ...scenario.after, completedVia: "complete-last" }),
    "PROJECT.md": project({ activePlan: scenario.baseActivePlan ?? "p", current: scenario.projectAfter === undefined ? null : scenario.projectAfter }),
    "MISSION_LOG.md": "# Mission Log\n\n## 2026-11-08 — Completed it\n",
    ...scenario.settleFiles
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
    parents[oid] = {};
    for (const file of commitFiles[oid].map((entry) => entry.path).filter((entry) => entry === "PROJECT.md" || /^docs\/plans\/[^/]+\.md$/.test(entry))) {
      try { parents[oid][file] = git(["show", `${oid}^:${file}`]); } catch { /* absent at the parent */ }
    }
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
      expect(shapeOf(result, PLAN_PATH)?.detail).toContain("parent revision were not both read");
      expect(shapeOf(result, "PROJECT.md")).toMatchObject({ verified: false });
    }
  });

  it("(c) refuses it when another Action is still open at the parent revision", () => {
    const s = series({ ...COMPLETING, base: { "first-one": "done", "second-one": "open", [LAST]: "open" }, after: { status: "complete", actions: { "first-one": "done", "second-one": "open", [LAST]: "done" }, current: null } });
    const result = check(s, s.parents);
    expect(shapeOf(result, PLAN_PATH)).toMatchObject({ verified: false });
    expect(shapeOf(result, PLAN_PATH)?.detail).toContain("Action second-one");
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

  describe("review round 1 probes", () => {
    const Q = "docs/plans/q.md";
    const qBase = plan({ status: "active", actions: { q1: "done", q2: "open" }, current: "q2" });
    const qDone = plan({ status: "complete", actions: { q1: "done", q2: "done" }, current: null, completedVia: "complete-last" });
    // `p` is the active Plan in PROJECT.md but is not completed; `q` is a second `status: active` Plan.
    const nonActive: Scenario = {
      base: { "first-one": "done", [LAST]: "open" },
      after: { status: "active", actions: { "first-one": "done", [LAST]: "open" }, current: LAST },
      baseFiles: { [Q]: qBase },
      settleFiles: { [Q]: qDone }
    };

    it("F1: refuses completing a non-active Plan when PROJECT.md is untouched", () => {
      const s = series({ ...nonActive, projectAfter: LAST });
      const result = check(s, s.parents);
      expect(shapeOf(result, Q)).toMatchObject({ verified: false });
      expect(shapeOf(result, Q)?.detail).toContain("PROJECT.md");
    });

    it("F1b: refuses it when PROJECT.md only has its updated: bumped", () => {
      const s = series({ ...nonActive, projectAfter: LAST, settleFiles: { ...nonActive.settleFiles, "PROJECT.md": project({ activePlan: "p", current: LAST, updated: "2026-11-09" }) } });
      expect(shapeOf(check(s, s.parents), Q)).toMatchObject({ verified: false });
    });

    it("F5: refuses completing p and q in one commit with the removal naming p", () => {
      const s = series({ ...COMPLETING, baseFiles: { [Q]: qBase }, settleFiles: { [Q]: qDone } });
      const result = check(s, s.parents);
      expect(shapeOf(result, Q)).toMatchObject({ verified: false });
      expect(shapeOf(result, PLAN_PATH)).toMatchObject({ verified: false });
      expect(shapeOf(result, PLAN_PATH)?.detail).toContain("more than one Plan");
      expect(shapeOf(result, "PROJECT.md")).toMatchObject({ verified: false });
    });

    it("F3: refuses deleting the front-matter status and adding status: complete in the body", () => {
      const s = series({ ...COMPLETING, after: { status: null, actions: COMPLETING.after.actions, current: null, body: ["status: complete"] } });
      const result = check(s, s.parents);
      expect(shapeOf(result, PLAN_PATH)).toMatchObject({ verified: false });
      expect(shapeOf(result, "PROJECT.md")).toMatchObject({ verified: false });
    });

    it("F7: refuses removing a body-line current_action while the front-matter pointer stays", () => {
      const body = ["", "```", "current_action: second-one", "```"];
      const s = series({ ...COMPLETING, baseBody: body, after: { status: "complete", actions: COMPLETING.after.actions, current: LAST, body: [] } });
      const result = check(s, s.parents);
      expect(shapeOf(result, PLAN_PATH)).toMatchObject({ verified: false });
      expect(shapeOf(result, "PROJECT.md")).toMatchObject({ verified: false });
    });
  });

  describe("review round 2: the parent is read by the real YAML parser", () => {
    const withExtra = (content: string, extra: string[]) => content.replace("questions: []", `${extra.join("\n")}\nquestions: []`);
    const baseOf = (slug = "p") => plan({ status: "active", actions: COMPLETING.base, current: LAST, slug });
    const afterOf = (slug = "p") => plan({ ...COMPLETING.after, completedVia: "complete-last", slug });
    const withHidden = (extra: string[]): Scenario => ({
      ...COMPLETING,
      baseFiles: { [PLAN_PATH]: withExtra(baseOf(), extra) },
      settleFiles: { [PLAN_PATH]: withExtra(afterOf(), extra) }
    });
    const refused = (scenario: Scenario) => {
      const s = series(scenario);
      expect(shapeOf(check(s, s.parents), PLAN_PATH)).toMatchObject({ verified: false });
      expect(shapeOf(check(s, s.parents), "PROJECT.md")).toMatchObject({ verified: false });
    };

    it("H1: refuses an open Action written after a column-0 comment", () => {
      refused(withHidden(["# parked below", "  - id: hidden", "    title: Hidden", "    status: open", "    next_action: Hidden."]));
    });
    it("H2: refuses an open Action written in flow style", () => {
      refused(withHidden(["  - {id: hidden, title: Hidden, status: open}"]));
    });
    it("H3: refuses an open Action written with quoted keys", () => {
      refused(withHidden(['  - "id": hidden', "    title: Hidden", '    "status": open']));
    });
    it("D1: refuses a parent with a duplicate current_action", () => {
      refused(withHidden([`current_action: ${LAST}`]));
    });
    it("D3: refuses a parent with a duplicate status", () => {
      refused(withHidden(["status: active"]));
    });
    it("refuses a parent whose front matter holds a YAML cycle, without throwing", () => {
      refused(withHidden(["cycle: &x", "  self: *x"]));
    });
    it("A1: refuses completing the file whose slug is not active_plan, though its name is", () => {
      refused({
        ...COMPLETING,
        baseFiles: { [PLAN_PATH]: baseOf("other"), "docs/plans/zzz.md": baseOf("p") },
        settleFiles: { [PLAN_PATH]: afterOf("other") }
      });
    });

    it("allows the writer's updated: bump directly below status:", () => {
      const base = baseOf().replace("updated: 2026-11-08", "updated: 2026-11-07");
      expect(base).toContain("status: active\nupdated: 2026-11-07");
      const s = series({ ...COMPLETING, baseFiles: { [PLAN_PATH]: base } });
      expect(s.patch).toContain("-status: active\n-updated: 2026-11-07\n+status: complete\n+updated: 2026-11-08");
      expect(shapeOf(check(s, s.parents), PLAN_PATH)).toMatchObject({ verified: true });
    });
  });

  describe("review round 3: the outcome is judged on parsed before and after documents", () => {
    const withExtra = (content: string, extra: string[]) => content.replace("questions: []", `${extra.join("\n")}\nquestions: []`);
    const baseOf = () => plan({ status: "active", actions: COMPLETING.base, current: LAST });
    const afterOf = (actions: Statuses = COMPLETING.after.actions, body?: string[]) => plan({ status: "complete", actions, current: null, completedVia: "complete-last", body });
    const refused = (scenario: Scenario) => {
      const s = series(scenario);
      expect(shapeOf(check(s, s.parents), PLAN_PATH)).toMatchObject({ verified: false });
      expect(shapeOf(check(s, s.parents), "PROJECT.md")).toMatchObject({ verified: false });
    };
    const OPEN_LAST = { "first-one": "done", "second-one": "done", [LAST]: "open" };

    it("B1: refuses a decoy Action in a fenced body example marked done while the real Action stays open", () => {
      const decoy = (status: string) => ["", "```yaml", `  - id: ${LAST}`, `    status: ${status}`, "```"];
      refused({
        ...COMPLETING,
        baseFiles: { [PLAN_PATH]: plan({ status: "active", actions: OPEN_LAST, current: LAST, body: decoy("open") }) },
        settleFiles: { [PLAN_PATH]: afterOf(OPEN_LAST, decoy("done")) }
      });
    });

    it("B2: refuses a decoy Action in a front-matter block scalar", () => {
      const decoy = (status: string) => ["notes: |", `  - id: ${LAST}`, `    status: ${status}`];
      refused({
        ...COMPLETING,
        baseFiles: { [PLAN_PATH]: withExtra(plan({ status: "active", actions: OPEN_LAST, current: LAST }), decoy("open")) },
        settleFiles: { [PLAN_PATH]: withExtra(afterOf(OPEN_LAST), decoy("done")) }
      });
    });

    it("refuses a body change in the completion", () => {
      refused({ ...COMPLETING, settleFiles: { [PLAN_PATH]: afterOf(COMPLETING.after.actions, ["", "Extra."]) } });
    });

    it("A6: refuses a Plan of another project than PROJECT.md's", () => {
      refused({
        ...COMPLETING,
        baseFiles: { [PLAN_PATH]: baseOf().replace("project: arcadia", "project: elsewhere") },
        settleFiles: { [PLAN_PATH]: afterOf().replace("project: arcadia", "project: elsewhere") }
      });
    });

    it("accepts a deferred sibling Action, as resolveFinishedActivePlan counts it finished", () => {
      const base = { "first-one": "done", "second-one": "deferred", [LAST]: "open" };
      const s = series({ ...COMPLETING, base, after: { ...COMPLETING.after, actions: { ...base, [LAST]: "done" } } });
      const result = check(s, s.parents);
      expect(shapeOf(result, PLAN_PATH)).toMatchObject({ verified: true });
      expect(shapeOf(result, "PROJECT.md")).toMatchObject({ verified: true });
    });

    it("refuses a sibling Action in any other non-done status", () => {
      const base = { "first-one": "done", "second-one": "blocked", [LAST]: "open" };
      const s = series({ ...COMPLETING, base, after: { ...COMPLETING.after, actions: { ...base, [LAST]: "done" } } });
      expect(shapeOf(check(s, s.parents), PLAN_PATH)).toMatchObject({ verified: false });
    });

    it("O3: verifies status directly above the pointer", () => {
      const base = baseOf().replace(`current_action: ${LAST}\n`, "").replace("status: active\n", `status: active\ncurrent_action: ${LAST}\n`);
      const s = series({ ...COMPLETING, baseFiles: { [PLAN_PATH]: base } });
      expect(s.patch).toContain(`-status: active\n-current_action: ${LAST}\n+status: complete`);
      expect(shapeOf(check(s, s.parents), PLAN_PATH)).toMatchObject({ verified: true });
    });

    it("refuses a parent document over the size bound before parsing it", () => {
      const pad = ["", "x".repeat(1_100_000)];
      refused({
        ...COMPLETING,
        baseFiles: { [PLAN_PATH]: plan({ status: "active", actions: COMPLETING.base, current: LAST, body: pad }) },
        settleFiles: { [PLAN_PATH]: afterOf(COMPLETING.after.actions, pad) }
      });
    });

    it("refuses a completion that also drops PROJECT.md's final newline, which only the patch's marker shows", () => {
      const line = "updated: 2026-01-01";
      const s = series({
        ...COMPLETING,
        baseFiles: { "PROJECT.md": `${project({ activePlan: "p", current: LAST })}${line}\n` },
        settleFiles: { "PROJECT.md": `${project({ activePlan: "p", current: null })}${line}` }
      });
      expect(s.patch).toContain("\\ No newline at end of file");
      expect(shapeOf(check(s, s.parents), "PROJECT.md")).toMatchObject({ verified: false });
    });

    it("refuses a hunk that does not apply exactly to the parent evidence", () => {
      const s = series(COMPLETING);
      const evidence = { [s.settlement]: { ...s.parents[s.settlement], [PLAN_PATH]: s.parents[s.settlement][PLAN_PATH].replace("recommended_model: standard", "recommended_model: heavy") } };
      expect(shapeOf(check(s, evidence), PLAN_PATH)).toMatchObject({ verified: false });
    });
  });

  describe("PR #2268's real settlement (pmark/arcadia commits 43349caae and 6fa32eb8c)", () => {
    const dir = path.join(import.meta.dirname, "fixtures", "plan-completion-2268");
    const meta = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8")) as { commitFiles: Record<string, CommitObjectFile[]> };
    const patch = readFileSync(path.join(dir, "series.patch"), "utf8");
    const SETTLEMENT = "6fa32eb8c33fcf48eae59a1d8fbe22e24233592b";
    const PLAN = "docs/plans/record-run-unattended-test-pins-20261107.md";
    const parents = { [SETTLEMENT]: { "PROJECT.md": readFileSync(path.join(dir, "parent-PROJECT.txt"), "utf8"), [PLAN]: readFileSync(path.join(dir, "parent-plan.txt"), "utf8") } };
    const commits = Object.keys(meta.commitFiles);
    const files = [...new Set(Object.values(meta.commitFiles).flat().map((file) => file.path))];
    const real = (evidence: ParentDocuments | null) => checkGovernedRecords(patch, { declaredFiles: files, declaredCommits: commits, commitFiles: meta.commitFiles, parentDocuments: evidence });

    it("verifies PROJECT.md and the Plan with the parent documents, and refuses both without", () => {
      const verified = real(parents);
      expect(shapeOf(verified, PLAN)).toMatchObject({ verified: true });
      expect(shapeOf(verified, "PROJECT.md")).toMatchObject({ verified: true });
      const bare = real(null);
      expect(shapeOf(bare, PLAN)).toMatchObject({ verified: false });
      expect(shapeOf(bare, "PROJECT.md")).toMatchObject({ verified: false });
    });
  });
});
