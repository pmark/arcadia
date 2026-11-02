import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyInitialSchema } from "../src/db/schema.js";
import { syncBaseWithOwnPointerCommits } from "../src/git/pointerReconcile.js";
import { detectBaseBranchAdvance, ensureProductionTickTables, listOperatorEscalations } from "../src/production/tick.js";
import { mergeCandidatePullRequest } from "../src/production/workerMerge.js";
import type { VerdictGate } from "../src/sessions/roleLineage.js";
import { FakeGitHub } from "./helpers/rehearsalHarness.js";

/**
 * Action worker-reconciles-own-pointer-commits (Decision 0169): pointer commits
 * are written to the local base and never pushed, so once GitHub merges a PR
 * the local base is ahead (its pointer commits) and behind (the merge). Disposable
 * local repositories and a bare `origin` only; no network, no live workspace.
 */

const PLAN = "docs/plans/plan-x.md";
const URL = "https://github.com/pmark/rehearsal/pull/7";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function projectDoc(current: string): string {
  return `---\narcadia: v1\ntype: project\nslug: fixture\nactive_plan: plan-x\ncurrent_action: ${current}\n---\n\n# Fixture\n`;
}

function planDoc(current: string, done: string[] = ["a1"]): string {
  const status = (id: string) => (done.includes(id) ? "done" : "open");
  return `---\narcadia: v1\ntype: plan\nslug: plan-x\nactions:\n${["a1", "a2", "a3"].map((id) => `  - id: ${id}\n    status: ${status(id)}\n`).join("")}current_action: ${current}\n---\n\n# Plan\n`;
}

describe("a local base ahead only by its own pointer commits", () => {
  let root: string;
  let repo: string;
  let origin: string;
  let other: string;

  function commitAll(cwd: string, message: string): string {
    git(cwd, ["add", "-A"]);
    git(cwd, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", message]);
    return git(cwd, ["rev-parse", "HEAD"]).trim();
  }

  function writeDoc(cwd: string, file: string, content: string): void {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), content);
  }

  /** A pointer commit as `arcadia advance queue make-next --apply` writes it. */
  function pointer(cwd: string, to: string, done?: string[]): string {
    writeDoc(cwd, "PROJECT.md", projectDoc(to));
    writeDoc(cwd, PLAN, planDoc(to, done));
    return commitAll(cwd, `chore(arcadia): point at ${to}\n\nWritten by \`arcadia advance queue make-next --apply\` (qpointer_fixture).`);
  }

  /** A squash-merged PR on the remote that carries a pointer move inside one differently-named commit. */
  function squashedPointer(to: string, done?: string[]): void {
    writeDoc(other, "PROJECT.md", projectDoc(to));
    writeDoc(other, PLAN, planDoc(to, done));
    commitAll(other, `Land the work (#7)`);
    git(other, ["push", "-q", "origin", "main"]);
  }

  /** The remote advances through another clone: a plain commit pushed to origin. */
  function remoteAdvances(file = "docs/reports/merged.md", content = "merged on the remote\n"): string {
    writeDoc(other, file, content);
    const sha = commitAll(other, "merged elsewhere");
    git(other, ["push", "-q", "origin", "main"]);
    return sha;
  }

  const head = (cwd = repo) => git(cwd, ["rev-parse", "HEAD"]).trim();
  const originMain = () => git(origin, ["rev-parse", "refs/heads/main"]).trim();
  const sync = () => syncBaseWithOwnPointerCommits({ repoRoot: repo, baseBranch: "main", now: new Date("2026-11-02T12:00:00Z") });

  /** The checkout, its branch and the remote as a refusal must leave them. */
  function snapshot() {
    return { head: head(), branch: git(repo, ["branch", "--show-current"]).trim(), status: git(repo, ["status", "--porcelain"]), origin: originMain() };
  }

  function expectRefused(reasonPattern: RegExp) {
    const before = snapshot();
    const result = sync();
    expect(result.outcome).toBe("refused");
    expect(result.reason).toMatch(reasonPattern);
    expect(snapshot()).toEqual(before);
    return result;
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "pointer-reconcile-")));
    repo = path.join(root, "repo");
    origin = path.join(root, "origin.git");
    other = path.join(root, "other");
    git(root, ["init", "-q", "--bare", "-b", "main", origin]);
    mkdirSync(repo);
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["remote", "add", "origin", origin]);
    writeDoc(repo, "PROJECT.md", projectDoc("a1"));
    writeDoc(repo, PLAN, planDoc("a1", []));
    writeDoc(repo, "docs/plans/other-plan.md", "---\ntype: plan\nslug: other-plan\n---\n");
    commitAll(repo, "genesis");
    git(repo, ["push", "-q", "origin", "main"]);
    git(repo, ["branch", "--set-upstream-to=origin/main", "main"]);
    git(root, ["clone", "-q", origin, other]);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("integrates the advanced remote without rewriting or discarding the pointer commits", () => {
    const first = pointer(repo, "a2");
    const second = pointer(repo, "a3");
    const remoteTip = remoteAdvances();
    const remoteBefore = originMain();

    const result = sync();

    expect(result).toMatchObject({ outcome: "reconciled", reason: null, pointerCommits: [first, second] });
    const merged = head();
    expect(merged).toBe(result.resultHead);
    expect(git(repo, ["rev-parse", `${merged}^1`]).trim()).toBe(second);
    expect(git(repo, ["rev-parse", `${merged}^2`]).trim()).toBe(remoteTip);
    // Both pointer commits and the remote's commit are contained in local main, byte-identical.
    for (const kept of [first, second, remoteTip]) {
      expect(() => git(repo, ["merge-base", "--is-ancestor", kept, "refs/heads/main"])).not.toThrow();
    }
    expect(readFileSync(path.join(repo, "docs/reports/merged.md"), "utf8")).toBe("merged on the remote\n");
    expect(readFileSync(path.join(repo, "PROJECT.md"), "utf8")).toContain("current_action: a3");
    expect(git(repo, ["status", "--porcelain"])).toBe("");
    // Nothing is pushed: the remote is exactly where it was.
    expect(originMain()).toBe(remoteBefore);
    // Replay is a no-op; a later remote advance reconciles again over the earlier reconcile commit.
    expect(sync()).toMatchObject({ outcome: "current", resultHead: merged });
    remoteAdvances("docs/reports/more.md", "more\n");
    expect(sync()).toMatchObject({ outcome: "reconciled" });
    expect(originMain()).not.toBe(head());
  });

  it("still fast-forwards a base that is only behind", () => {
    const tip = remoteAdvances();
    expect(sync()).toMatchObject({ outcome: "fast-forwarded", resultHead: tip });
    expect(head()).toBe(tip);
  });

  describe("refuses, leaving the checkout, branch and remote untouched, for", () => {
    it("a local-only commit of any other shape", () => {
      pointer(repo, "a2");
      writeDoc(repo, "src-change.txt", "local work\n");
      commitAll(repo, "local work");
      remoteAdvances();
      expectRefused(/not pointer commits/);
    });

    it("a pointer-subject commit that touches anything beyond PROJECT.md and the active Plan", () => {
      writeDoc(repo, "PROJECT.md", projectDoc("a2"));
      writeDoc(repo, "docs/plans/other-plan.md", "---\ntype: plan\nslug: other-plan\nextra: 1\n---\n");
      commitAll(repo, "chore(arcadia): point at a2");
      remoteAdvances();
      expectRefused(/not pointer commits/);
    });

    it("a commit that touches only PROJECT.md but does not carry the pointer subject", () => {
      writeDoc(repo, "PROJECT.md", projectDoc("a2"));
      commitAll(repo, "chore(arcadia): settle something");
      remoteAdvances();
      expectRefused(/not pointer commits/);
    });

    it("a dirty checkout", () => {
      pointer(repo, "a2");
      remoteAdvances();
      writeFileSync(path.join(repo, "PROJECT.md"), `${readFileSync(path.join(repo, "PROJECT.md"), "utf8")}operator scratch\n`);
      expectRefused(/uncommitted changes/);
    });

    it("a checkout on another branch", () => {
      pointer(repo, "a2");
      remoteAdvances();
      git(repo, ["checkout", "-q", "-b", "elsewhere"]);
      expectRefused(/checkout is on elsewhere, not main/);
    });

    it("a conflict", () => {
      pointer(repo, "a2");
      // The remote moved the same pointer line somewhere else.
      writeDoc(other, "PROJECT.md", projectDoc("a3"));
      commitAll(other, "remote pointer");
      git(other, ["push", "-q", "origin", "main"]);
      expectRefused(/reconcile cleanly|conflict/i);
    });
  });

  it("refuses a merged pointer that the remote already finished (a squash merge hides the move)", () => {
    // The squashed PR carried this pointer change and also finished a2: no commit
    // on the remote shows the move, and the three-way merge keeps current_action: a2.
    pointer(repo, "a2");
    squashedPointer("a2", ["a1", "a2"]);
    expectRefused(/already done/);
  });

  it("keeps an identical pointer move the remote also made when the Action is still open", () => {
    pointer(repo, "a2");
    squashedPointer("a2");
    expect(sync()).toMatchObject({ outcome: "reconciled" });
    expect(readFileSync(path.join(repo, "PROJECT.md"), "utf8")).toContain("current_action: a2");
  });

  describe("both callers use it", () => {
    function gateFor(sha: string): VerdictGate {
      return { satisfied: true, binding: { targetHead: sha }, verdicts: {} } as unknown as VerdictGate;
    }

    function openPullRequest(github: FakeGitHub): string {
      const branch = "claude/write-feature-20261102T000000000Z";
      git(repo, ["checkout", "-q", "-b", branch]);
      writeDoc(repo, "docs/reports/feature.md", "feature\n");
      const sha = commitAll(repo, "agent work");
      git(repo, ["checkout", "-q", "main"]);
      git(repo, ["push", "-q", "origin", branch]);
      github.prs.push({ number: 7, url: URL, branch, baseBranch: "main", isDraft: false });
      return sha;
    }

    function merge(db: Database.Database, github: FakeGitHub, sha: string) {
      return mergeCandidatePullRequest(
        { db, repoRoot: repo, baseBranch: "main", sessionId: "session_1", actionKey: "fixture/write-feature", head: sha, settlementCommit: null, pullRequestUrl: URL, review: gateFor(sha), now: new Date("2026-11-02T12:00:00Z") },
        { runCommand: github.runCommand }
      );
    }

    it("the worker merge sync reconciles instead of reporting base_not_synced, and pushes nothing", () => {
      const github = new FakeGitHub(origin);
      const db = new Database(":memory:");
      const sha = openPullRequest(github);
      const pointerCommit = pointer(repo, "a2");

      const outcome = merge(db, github, sha);

      expect(outcome).toMatchObject({ kind: "merged", head: sha });
      expect(() => git(repo, ["merge-base", "--is-ancestor", sha, "refs/heads/main"])).not.toThrow();
      expect(() => git(repo, ["merge-base", "--is-ancestor", pointerCommit, "refs/heads/main"])).not.toThrow();
      // The only thing on origin is GitHub's own merge; the pointer commit was not pushed.
      expect(github.mergeCalls).toHaveLength(1);
      expect(() => git(origin, ["cat-file", "-e", pointerCommit])).toThrow();
      db.close();
    });

    it("the worker merge sync still refuses base_not_synced when a local-only commit is not a pointer commit", () => {
      const github = new FakeGitHub(origin);
      const db = new Database(":memory:");
      const sha = openPullRequest(github);
      writeDoc(repo, "local.txt", "local\n");
      commitAll(repo, "local work");
      const before = head();

      expect(merge(db, github, sha)).toMatchObject({ kind: "refused", code: "base_not_synced", operatorMergeCommand: null });
      expect(head()).toBe(before);
      db.close();
    });

    function tick(db: Database.Database, fastForward = true) {
      return detectBaseBranchAdvance(db, { repoRoot: repo, projectSlug: "fixture", projectId: "project_fixture", now: new Date("2026-11-02T12:00:00Z"), log: () => undefined, fastForward });
    }

    it("the per-tick base sync reconciles, clears the escalation, and pushes nothing", () => {
      const db = new Database(":memory:");
      applyInitialSchema(db);
      ensureProductionTickTables(db);
      pointer(repo, "a2");
      const tip = remoteAdvances();
      const remoteBefore = originMain();

      const observation = tick(db);

      expect(() => git(repo, ["merge-base", "--is-ancestor", tip, "refs/heads/main"])).not.toThrow();
      expect(observation?.newSha).toBe(head());
      expect(listOperatorEscalations(db)).toEqual([]);
      expect(originMain()).toBe(remoteBefore);
      db.close();
    });

    it("the per-tick base sync still escalates base_not_synced for a foreign local commit", () => {
      const db = new Database(":memory:");
      applyInitialSchema(db);
      ensureProductionTickTables(db);
      writeDoc(repo, "local.txt", "local\n");
      commitAll(repo, "local work");
      remoteAdvances();
      const before = head();

      tick(db);

      expect(head()).toBe(before);
      expect(listOperatorEscalations(db)).toEqual([expect.objectContaining({ kind: "base_not_synced" })]);
      db.close();
    });
  });
});
