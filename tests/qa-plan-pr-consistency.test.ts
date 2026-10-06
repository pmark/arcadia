/**
 * The checkpoint replay's deterministic plan-versus-PR consistency check
 * (scripts/qa-plan-consistency.ts), on synthetic temp Git repositories only:
 * no live rehearsal data is committed here.
 *
 * The serial case models Issue #987 (rehearsal run 5, PR #6): Action 1 is
 * integrated by fast-forwarding the local base while GitHub's base stays
 * where it was, so Action 2's host Operator QA plan diffs from the local base
 * and lists fewer files than the PR. It is asserted as an EXPECTED FAILURE
 * with `it.fails`: while #987 stands, the consistency assertion fails and the
 * test passes; once the host rendering path renders a plan that agrees with
 * the PR, the assertion holds, `it.fails` reports the test as failing, and the
 * fixing change must turn it into a plain `it` (and update the pinned
 * diagnostic test below). See docs/qa-plan-consistency-replay.md.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderOperatorQaPlan } from "../src/sessions/operatorQaPlan.js";
import {
  QA_PLAN_CONSISTENCY_SCHEMA,
  checkQaPlanConsistency,
  formatReport,
  parseRenderedPlan,
  patchPaths,
  runCli,
  type PullRequestMetadata
} from "../scripts/qa-plan-consistency.js";

const SCRIPT = path.resolve(import.meta.dirname, "../scripts/qa-plan-consistency.ts");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function write(repo: string, file: string, content: string): void {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), content, "utf8");
}

function commit(repo: string, message: string): string {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

interface SerialFixture {
  /** The host's local clone; `origin` stands in for GitHub. */
  repo: string;
  m0: string;
  action1: string;
  action2: string;
}

/**
 * GitHub's main at M0; Action 1 fast-forwarded into the local main only (M1,
 * never pushed, as the run-5 Grant designed); Action 2 branched from M1.
 */
function serialFixture(): SerialFixture {
  const root = mkdtempSync(path.join(tmpdir(), "qa-plan-consistency-"));
  roots.push(root);
  const github = path.join(root, "github.git");
  const seed = path.join(root, "seed");
  git(root, ["init", "-q", "--bare", "-b", "main", github]);
  git(root, ["init", "-q", "-b", "main", seed]);
  write(seed, "PROJECT.md", "# Fixture\n");
  write(seed, "MISSION_LOG.md", "# Log\n");
  const m0 = commit(seed, "M0");
  git(seed, ["push", "-q", github, "main"]);

  const repo = path.join(root, "host");
  git(root, ["clone", "-q", github, repo]);
  git(repo, ["checkout", "-q", "-b", "agent/action-1"]);
  write(repo, "MARKER.md", "start\n");
  commit(repo, "Action 1 work");
  write(repo, ".arcadia/asks/archive/complete-action-1.yaml", "request_id: complete-action-1\n");
  write(repo, "PROJECT.md", "# Fixture\n\nAction 1 done.\n");
  const action1 = commit(repo, "settle Action 1");
  git(repo, ["checkout", "-q", "main"]);
  git(repo, ["merge", "-q", "--ff-only", "agent/action-1"]);

  git(repo, ["checkout", "-q", "-b", "agent/action-2"]);
  write(repo, "MARKER.md", "start\nSTART\n");
  write(repo, "tests/marker.test.mjs", "// asserts both lines\n");
  commit(repo, "Action 2 work");
  write(repo, ".arcadia/asks/archive/complete-action-2.yaml", "request_id: complete-action-2\n");
  write(repo, "MISSION_LOG.md", "# Log\n\nAction 2 done.\n");
  const action2 = commit(repo, "settle Action 2");
  git(repo, ["checkout", "-q", "main"]);
  return { repo, m0, action1, action2 };
}

/** PR metadata as GitHub reports it: files of the three-dot diff base...head. */
function pullRequest(repo: string, input: { number: number; base: string; head: string; branch: string; extraFiles?: string[] }): PullRequestMetadata {
  const changeType: Record<string, string> = { A: "ADDED", M: "MODIFIED", D: "DELETED" };
  const files = git(repo, ["diff", "--name-status", "--no-renames", `${input.base}...${input.head}`])
    .split("\n").filter(Boolean)
    .map((line) => { const [status, file] = line.split("\t"); return { path: file, changeType: changeType[status] ?? status }; });
  for (const extra of input.extraFiles ?? []) files.push({ path: extra, changeType: "ADDED" });
  return { number: input.number, baseRefName: "main", baseRefOid: input.base, headRefName: input.branch, headRefOid: input.head, files };
}

function refsAndStatus(repo: string): string {
  const gitDir = path.join(repo, ".git");
  return [
    git(repo, ["for-each-ref", "--format=%(refname) %(objectname)"]),
    git(repo, ["status", "--porcelain"]),
    readdirSync(repo).sort().join(","),
    readdirSync(gitDir).sort().join(","),
    readFileSync(path.join(gitDir, "config"), "utf8")
  ].join("\n--\n");
}

describe("plan-versus-PR consistency (checkpoint replay)", () => {
  it("passes a first-Action candidate whose launch base is the PR's base", () => {
    const f = serialFixture();
    const report = checkQaPlanConsistency({
      repositoryPath: f.repo,
      pullRequest: pullRequest(f.repo, { number: 5, base: f.m0, head: f.action1, branch: "agent/action-1" }),
      base: f.m0,
      branch: "agent/action-1"
    });
    expect(report.mismatches).toEqual([]);
    expect(report.consistent).toBe(true);
    expect(report.plan.baseRevision).toBe(f.m0);
    expect(report.plan.files.map((file) => file.path)).toEqual([".arcadia/asks/archive/complete-action-1.yaml", "MARKER.md", "PROJECT.md"]);
  });

  // EXPECTED FAILURE (Issue #987). Passes today because the assertion fails;
  // the fix for #987 makes it pass, which `it.fails` reports as a failure:
  // then change this to `it` and update the pinned diagnostic below. Only a
  // fix at or below renderPreservedOperatorQaPlan flips it on its own: a fix
  // in launch-base selection or in the preservation caller must also change
  // this test's `base` input to what the host would then record.
  it.fails("serial Action 2: the host plan agrees with its PR (Issue #987, expected to fail until fixed)", () => {
    const f = serialFixture();
    const report = checkQaPlanConsistency({
      repositoryPath: f.repo,
      pullRequest: pullRequest(f.repo, { number: 6, base: f.m0, head: f.action2, branch: "agent/action-2" }),
      // The host launches from the local base branch (`git rev-parse main`, src/sessions/launch.ts).
      base: "main",
      branch: "agent/action-2"
    });
    expect(report.mismatches).toEqual([]);
  });

  it("pins the serial Action 2 diagnostic: plan base M1 vs PR base M0 and Action 1's files only in the PR", () => {
    const f = serialFixture();
    const report = checkQaPlanConsistency({
      repositoryPath: f.repo,
      pullRequest: pullRequest(f.repo, { number: 6, base: f.m0, head: f.action2, branch: "agent/action-2" }),
      base: "main",
      branch: "agent/action-2"
    });
    expect(report.consistent).toBe(false);
    expect(report.candidate.baseRevision).toBe(f.action1);
    expect(report.plan.fileCount).toBe(4);
    expect(report.pullRequest.fileCount).toBe(6);
    expect(report.mismatches).toEqual([
      { check: "base-revision", plan: f.action1, pullRequest: f.m0 },
      { check: "file-count", plan: 4, pullRequest: 6 },
      { check: "files", onlyInPlan: [], onlyInPullRequest: [".arcadia/asks/archive/complete-action-1.yaml", "PROJECT.md"] },
      { check: "file-status", differences: [{ path: "MARKER.md", plan: "M", pullRequest: "ADDED" }] }
    ]);
    const summary = formatReport(report);
    expect(summary).toContain(`- base-revision: plan ${f.action1}, PR ${f.m0}`);
    expect(summary).toContain("- files only in the PR: .arcadia/asks/archive/complete-action-1.yaml, PROJECT.md");
    expect(summary).toContain("- file-status: MARKER.md plan M, PR ADDED");
  });

  it("detects a changed-file list mismatch at the same base", () => {
    const f = serialFixture();
    const report = checkQaPlanConsistency({
      repositoryPath: f.repo,
      pullRequest: pullRequest(f.repo, { number: 5, base: f.m0, head: f.action1, branch: "agent/action-1", extraFiles: ["extra.txt"] }),
      base: f.m0
    });
    expect(report.consistent).toBe(false);
    expect(report.mismatches).toEqual([
      { check: "file-count", plan: 3, pullRequest: 4 },
      { check: "files", onlyInPlan: [], onlyInPullRequest: ["extra.txt"] }
    ]);
  });

  it("reads the candidate repository only, through a throwaway mirror", () => {
    const f = serialFixture();
    const before = refsAndStatus(f.repo);
    checkQaPlanConsistency({
      repositoryPath: f.repo,
      pullRequest: pullRequest(f.repo, { number: 6, base: f.m0, head: f.action2, branch: "agent/action-2" }),
      base: "main"
    });
    expect(refsAndStatus(f.repo)).toBe(before);
  });

  it("re-renders through the host path: the published body matches only the same plan source", () => {
    const f = serialFixture();
    const source = { actionKey: "fixture/action-1", action: { title: "Write MARKER.md", acceptanceCriteria: ["MARKER.md holds \"start\"."] }, validationCommands: ["node --test"] };
    const planSource = { kind: "action-acceptance" as const, actionKey: source.actionKey, actionTitle: source.action.title, acceptanceCriteria: source.action.acceptanceCriteria, validationCommands: source.validationCommands };
    const pr = pullRequest(f.repo, { number: 5, base: f.m0, head: f.action1, branch: "agent/action-1" });
    const first = checkQaPlanConsistency({ repositoryPath: f.repo, pullRequest: pr, base: f.m0, branch: "agent/action-1", planSource });
    expect(first.plan.matchesPublishedBody).toBeNull();
    // A body the host would publish: the plan, then its evidence sections.
    const published = renderOperatorQaPlan(planSource, {
      branch: "agent/action-1", baseBranch: "main", baseRevision: f.m0, commitSha: f.action1,
      changedFiles: first.plan.files,
      pathExists: (candidate) => candidate === "MARKER.md"
    });
    const body = `${published.body}\n\n### Validation evidence\n\n...`;
    expect(checkQaPlanConsistency({ repositoryPath: f.repo, pullRequest: { ...pr, body }, base: f.m0, branch: "agent/action-1", planSource }).plan.matchesPublishedBody).toBe(true);
    const placeholder = checkQaPlanConsistency({ repositoryPath: f.repo, pullRequest: { ...pr, body }, base: f.m0, branch: "agent/action-1" });
    expect(placeholder.plan).toMatchObject({ placeholderSource: true, matchesPublishedBody: false });
  });

  it("treats a plan the host renderer refuses as a replay that could not run", () => {
    const f = serialFixture();
    expect(() => checkQaPlanConsistency({
      repositoryPath: f.repo,
      pullRequest: pullRequest(f.repo, { number: 5, base: f.m0, head: f.action1, branch: "agent/action-1" }),
      base: f.m0,
      planSource: { kind: "action-acceptance", actionKey: "fixture/none", actionTitle: null, acceptanceCriteria: [], validationCommands: [] }
    })).toThrow(/host renderer refused the plan: Action fixture\/none declares no acceptance criteria/);
  });

  it("parses the renderer's file list, including paths with spaces and backticks", () => {
    const changedFiles = [{ status: "A", path: "docs/a `b` c.md" }, { status: "M", path: " lead.txt" }, { status: "D", path: "x" }];
    const rendered = renderOperatorQaPlan(
      { kind: "action-acceptance", actionKey: "p/a", actionTitle: null, acceptanceCriteria: ["Holds."], validationCommands: [] },
      { branch: "b", baseBranch: "main", baseRevision: "a".repeat(40), commitSha: "c".repeat(40), changedFiles }
    );
    expect(parseRenderedPlan(rendered.body)).toEqual({ baseBranch: "main", baseRevision: "a".repeat(40), commit: "c".repeat(40), fileCount: 3, files: changedFiles });
  });

  it("lists the files a reviewer patch touches", () => {
    const patch = [
      "From 1 Mon Sep 17 00:00:00 2001", "Subject: [PATCH 1/2] one", "---",
      "diff --git a/MARKER.md b/MARKER.md", "new file mode 100644", "--- /dev/null", "+++ b/MARKER.md", "@@ -0,0 +1 @@", "+start",
      "From 2 Mon Sep 17 00:00:00 2001", "Subject: [PATCH 2/2] two", "---",
      "diff --git a/MARKER.md b/MARKER.md", "diff --git a/a b.md b/a b.md", "diff --git a/old.md b/new.md"
    ].join("\n");
    expect(patchPaths(patch)).toEqual(["MARKER.md", "a b.md", "new.md", "old.md"]);
  });
});

describe("qa-plan-consistency CLI", () => {
  function cliFixture(input: { action: 1 | 2; extraFiles?: string[] }) {
    const f = serialFixture();
    const root = mkdtempSync(path.join(tmpdir(), "qa-plan-consistency-cli-"));
    roots.push(root);
    const evidence = path.join(root, "evidence.json");
    const head = input.action === 1 ? f.action1 : f.action2;
    writeFileSync(evidence, JSON.stringify({ ...pullRequest(f.repo, { number: input.action + 4, base: f.m0, head, branch: `agent/action-${input.action}`, extraFiles: input.extraFiles }), body: "## Operator QA plan\n" }));
    return { ...f, evidence };
  }

  it("exits 0 with a consistent JSON report", () => {
    const f = cliFixture({ action: 1 });
    const result = runCli(["--repo", f.repo, "--pr", f.evidence, "--base", f.m0, "--json"]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(Object.keys(report)).toEqual(["schema", "consistent", "candidate", "plan", "pullRequest", "patch", "mismatches", "durationMs"]);
    expect(report).toMatchObject({ schema: QA_PLAN_CONSISTENCY_SCHEMA, consistent: true, mismatches: [], patch: null });
    expect(Object.keys(report.plan as object)).toEqual(["baseBranch", "baseRevision", "commit", "fileCount", "files", "placeholderSource", "matchesPublishedBody"]);
  });

  // The CLI mismatch cases use an extra PR file, not the #987 shape, so they
  // keep exiting 1 after #987 is fixed.
  it("exits 1 and names the differing values in the human summary", () => {
    const f = cliFixture({ action: 1, extraFiles: ["extra.txt"] });
    const result = runCli(["--repo", f.repo, "--pr", f.evidence, "--base", f.m0]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("QA plan consistency: MISMATCH (2 findings)");
    expect(result.stdout).toContain(`Plan       base main at ${f.m0}; 3 changed files`);
    expect(result.stdout).toContain(`PR #5      base main at ${f.m0}; 4 changed files`);
    expect(result.stdout).toContain("- file-count: plan 3, PR 4");
    expect(result.stdout).toContain("- files only in the PR: extra.txt");
  });

  it("defaults the host base to the local base branch as it is now", () => {
    const f = cliFixture({ action: 1, extraFiles: ["extra.txt"] });
    const result = runCli(["--repo", f.repo, "--pr", f.evidence, "--json"]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ candidate: { baseRevision: f.action1, baseSource: "local branch main now" } });
  });

  it("takes the base, commit and branch from a sqlite3 -json receipt row", () => {
    const f = cliFixture({ action: 1 });
    const receipt = path.join(path.dirname(f.evidence), "receipt.json");
    writeFileSync(receipt, JSON.stringify([{ repository_path: f.repo, branch: "agent/action-1", base_branch: "main", base_revision: f.m0, commit_sha: f.action1 }]));
    const result = runCli(["--receipt", receipt, "--pr", f.evidence, "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ candidate: { baseRevision: f.m0, commit: f.action1, baseSource: "receipt base_revision" } });
  });

  it("exits 2 on unusable input, never claiming consistency", () => {
    const f = cliFixture({ action: 1 });
    expect(runCli(["--repo", f.repo]).exitCode).toBe(2);
    expect(runCli(["--repo", f.repo, "--pr", f.evidence, "--bogus"]).exitCode).toBe(2);
    const missingBase = runCli(["--repo", f.repo, "--pr", f.evidence, "--base", "no-such-ref"]);
    expect(missingBase).toMatchObject({ exitCode: 2, stdout: "" });
    expect(missingBase.stderr).toContain("The base no-such-ref is not a commit");
    const missingRepo = runCli(["--repo", path.join(path.dirname(f.evidence), "absent"), "--pr", f.evidence]);
    expect(missingRepo.exitCode).toBe(2);
  });

  it("runs as a script and sets the process exit code", () => {
    const f = cliFixture({ action: 1, extraFiles: ["extra.txt"] });
    const result = spawnSync(process.execPath, ["--import", "tsx", SCRIPT, "--repo", f.repo, "--pr", f.evidence, "--base", f.m0, "--json"], {
      cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8", timeout: 60_000
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ consistent: false, pullRequest: { baseRefOid: f.m0 } });
  }, 60_000);
});
