import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyInitialSchema } from "../src/db/schema.js";
import { inspectGovernedBaseDivergence, isRecognizedGovernanceCommit } from "../src/commands/go.js";
import { baseReconciliationCommitMessage, createBaseReconciliationCommit, writeCleanBaseMergeTree } from "../src/git/baseReconcile.js";
import { planReconcile, syncBaseWithOwnPointerCommits } from "../src/git/pointerReconcile.js";
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

function projectDoc(current: string, updated = "2026-11-01", plan = "plan-x"): string {
  // `updated:` sits directly under `current_action:`, as in the real PROJECT.md.
  return `---\narcadia: v1\ntype: project\nslug: fixture\nactive_plan: ${plan}\ncurrent_action: ${current}\nupdated: ${updated}\n---\n\n# Fixture\n`;
}

function planDoc(current: string, done: string[] = [], last = 1): string {
  const status = (id: string) => (done.includes(id) ? "done" : "open");
  return `---\narcadia: v1\ntype: plan\nslug: plan-x\nactions:\n${["a1", "a2", "a3"].map((id) => `  - id: ${id}\n    status: ${status(id)}\n`).join("")}current_action: ${current}\nlast: ${last}\n---\n\n# Plan\n`;
}

const MUTATING_GIT = /\bgit\s+(merge|reset|rebase|switch|checkout|branch|commit|stash|push|pull|clean|rm|cherry-pick|revert|apply)\b/;
const OTHER_PLAN = "docs/plans/other-plan.md";
function otherPlanDoc(current: string): string {
  return `---\ntype: plan\nslug: other-plan\nactions:\n  - id: b1\n    status: open\ncurrent_action: ${current}\n---\n`;
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
    writeDoc(repo, OTHER_PLAN, otherPlanDoc("b1"));
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
      writeDoc(repo, OTHER_PLAN, otherPlanDoc("b1").replace("b1", "b1\nextra: 1"));
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

    it("a conflicting pointer that leaves the merged pair disagreeing", () => {
      pointer(repo, "a2");
      // The remote moved only PROJECT.md's pointer: resolving to it would split the pair.
      writeDoc(other, "PROJECT.md", projectDoc("a3"));
      commitAll(other, "remote pointer");
      git(other, ["push", "-q", "origin", "main"]);
      expectRefused(/disagrees with its Plan/);
    });

    it("a conflicting pointer whose remote value names a done Action", () => {
      pointer(repo, "a2");
      squashedPointer("a3", ["a1", "a2", "a3"]);
      expectRefused(/already done/);
    });

    it("a conflicting pointer whose remote value names no Action of the Plan", () => {
      pointer(repo, "a2");
      squashedPointer("zz", ["a1", "a2"]);
      expectRefused(/not an Action/);
    });

    it("a pointer commit that also changed a non-pointer line, when the pointer conflicts", () => {
      writeDoc(repo, "PROJECT.md", `${projectDoc("a2")}\nLocal prose.\n`);
      writeDoc(repo, PLAN, planDoc("a2", []));
      commitAll(repo, "chore(arcadia): point at a2");
      squashedPointer("a3", ["a1", "a2"]);
      expectRefused(/not pointer commits/);
    });

    const TRAILER = "\n\nWritten by `arcadia advance queue make-next --apply` (qpointer_fixture).";

    it("a pointer-subject commit with no make-next trailer that marks an Action done", () => {
      writeDoc(repo, "PROJECT.md", projectDoc("a2"));
      writeDoc(repo, PLAN, planDoc("a2", ["a1"]));
      commitAll(repo, "chore(arcadia): point at a2");
      remoteAdvances();
      expectRefused(/not pointer commits/);
    });

    it("a trailered pointer commit that also marks an Action done, even when the pointer conflicts", () => {
      writeDoc(repo, "PROJECT.md", projectDoc("a2"));
      writeDoc(repo, PLAN, planDoc("a2", ["a1"]));
      commitAll(repo, `chore(arcadia): point at a2${TRAILER}`);
      squashedPointer("a3", ["a2"]);
      expectRefused(/not pointer commits/);
    });

    it("a trailered pointer commit that rewrites Plan prose or injects a field", () => {
      writeDoc(repo, "PROJECT.md", projectDoc("a2"));
      writeDoc(repo, PLAN, planDoc("a2").replace("# Plan", "# Plan\n\nHand-written body").replace("last: 1", "last: 1\ninjected: yes"));
      commitAll(repo, `chore(arcadia): point at a2${TRAILER}`);
      remoteAdvances();
      expectRefused(/not pointer commits/);
    });

    it("a trailered pointer commit that moves active_plan and edits the newly active Plan", () => {
      writeDoc(repo, "PROJECT.md", projectDoc("b1", "2026-11-01", "other-plan"));
      writeDoc(repo, OTHER_PLAN, otherPlanDoc("b1").replace("current_action: b1", "acceptance_override: anything\ncurrent_action: b1"));
      commitAll(repo, `chore(arcadia): point at b1${TRAILER}`);
      remoteAdvances();
      expectRefused(/not pointer commits/);
    });

    it("an older pointer commit changes the Plan and a later one moves active_plan, while the remote changes the Plan", () => {
      pointer(repo, "a2");
      writeDoc(repo, "PROJECT.md", projectDoc("b1", "2026-11-01", "other-plan"));
      commitAll(repo, `chore(arcadia): point at b1${TRAILER}`);
      writeDoc(other, "PROJECT.md", projectDoc("b1", "2026-11-01", "other-plan"));
      writeDoc(other, PLAN, planDoc("a3"));
      commitAll(other, "remote activates the other Plan");
      git(other, ["push", "-q", "origin", "main"]);
      expectRefused(/not pointer commits/);
    });

    it("a pointer commit that also changes an indented current_action line", () => {
      writeDoc(repo, "PROJECT.md", projectDoc("a2"));
      writeDoc(repo, PLAN, planDoc("a2").replace("  - id: a2\n    status: open\n", "  - id: a2\n    status: open\n    current_action: nested\n"));
      commitAll(repo, `chore(arcadia): point at a2${TRAILER}`);
      remoteAdvances();
      expectRefused(/not pointer commits/);
    });

    it("a pointer commit that also changes a column-0 body line named current_action", () => {
      writeDoc(repo, "PROJECT.md", `${projectDoc("a1")}\ncurrent_action: operator note v1\n`);
      commitAll(repo, "operator note");
      git(repo, ["push", "-q", "origin", "main"]);
      git(other, ["pull", "-q", "origin", "main"]);
      writeDoc(repo, "PROJECT.md", `${projectDoc("a2")}\ncurrent_action: operator note v2\n`);
      writeDoc(repo, PLAN, planDoc("a2"));
      commitAll(repo, `chore(arcadia): point at a2${TRAILER}`);
      remoteAdvances();
      expectRefused(/not pointer commits/);
    });

    it("a hand commit with the pointer subject and no make-next trailer, even when it changes only the pointer", () => {
      writeDoc(repo, "PROJECT.md", projectDoc("a2"));
      writeDoc(repo, PLAN, planDoc("a2"));
      commitAll(repo, "chore(arcadia): point at a2");
      remoteAdvances();
      expectRefused(/not pointer commits/);
    });

    it("a pointer commit that also changes end-of-file whitespace", () => {
      writeDoc(repo, "PROJECT.md", `${projectDoc("a2")}\n\n`);
      writeDoc(repo, PLAN, planDoc("a2"));
      commitAll(repo, `chore(arcadia): point at a2${TRAILER}`);
      remoteAdvances();
      expectRefused(/not pointer commits/);
    });

    it("a conflicting PROJECT.md that the remote deleted", () => {
      pointer(repo, "a2");
      git(other, ["rm", "-q", "PROJECT.md"]);
      commitAll(other, "remote removes PROJECT.md");
      git(other, ["push", "-q", "origin", "main"]);
      expectRefused(/added or removed/);
    });

    it("a conflict outside the pointer documents (the git conflict is reached)", () => {
      // A local-only commit can no longer reach another file through sync, so drive the resolver directly.
      const mergeBase = head();
      writeDoc(repo, "docs/reports/merged.md", "local edit\n");
      const local = commitAll(repo, "local edit");
      git(other, ["pull", "-q", "origin", "main"]);
      writeDoc(other, "docs/reports/merged.md", "remote edit\n");
      commitAll(other, "remote edit");
      git(other, ["push", "-q", "origin", "main"]);
      git(repo, ["fetch", "-q", "origin"]);
      const remote = git(repo, ["rev-parse", "origin/main"]).trim();
      expect(() => planReconcile(repo, { baseBranch: "main", upstream: "origin/main", mergeBase, localHead: local, remoteHead: remote, localCommits: 1 })).toThrow(/conflict outside the pointer documents \(docs\/reports\/merged.md\)/);
    });
  });

  it("refuses a merged pointer that the remote already finished (a squash merge hides the move)", () => {
    // The squashed PR carried this pointer change and also finished a2: no commit
    // on the remote shows the move, and the three-way merge keeps current_action: a2.
    pointer(repo, "a2");
    squashedPointer("a2", ["a1", "a2"]);
    expectRefused(/already done/);
  });

  it("replays run i: two local pointer commits that net to nothing take the remote's settled pointer", () => {
    // 4279f1bcd..bfb4ea609 on 2026-11-02: the scheduler moved the pointer away and back
    // (a1 -> a2 -> a1) while the PR settling a1 landed on the remote and moved it to a2.
    pointer(repo, "a2");
    pointer(repo, "a1");
    squashedPointer("a2", ["a1"]);
    expect(sync()).toMatchObject({ outcome: "reconciled" });
    expect(readFileSync(path.join(repo, "PROJECT.md"), "utf8")).toContain("current_action: a2");
    expect(readFileSync(path.join(repo, PLAN), "utf8")).toContain("current_action: a2");
  });

  it("resolves a conflicting pointer to the remote's settled value and keeps everything else the remote changed", () => {
    const pointerCommit = pointer(repo, "a2");
    // The remote squash settled a2 (status done), moved the pointer to a3, and added a report.
    writeDoc(other, "docs/reports/merged.md", "settled elsewhere\n");
    squashedPointer("a3", ["a1", "a2"]);
    const remoteBefore = originMain();

    const result = sync();

    expect(result).toMatchObject({ outcome: "reconciled", pointerCommits: [pointerCommit] });
    // Exactly the remote's blobs: pointer, the settled status and the other file all come through.
    for (const file of ["PROJECT.md", PLAN, "docs/reports/merged.md"]) {
      expect(git(repo, ["rev-parse", `HEAD:${file}`]).trim()).toBe(git(origin, ["rev-parse", `main:${file}`]).trim());
    }
    expect(readFileSync(path.join(repo, "PROJECT.md"), "utf8")).toContain("current_action: a3");
    expect(readFileSync(path.join(repo, PLAN), "utf8")).toMatch(/id: a2\n\s+status: done/);
    // Local history is kept, the replaced local value is visible, nothing is pushed.
    expect(git(repo, ["rev-parse", "HEAD^1"]).trim()).toBe(pointerCommit);
    const message = git(repo, ["show", "-s", "--format=%B", "HEAD"]);
    expect(message).toContain("Pointer-Conflict-Replaced-Local: PROJECT.md current_action a2");
    expect(message).toContain(`Pointer-Conflict-Replaced-Local: ${PLAN} current_action a2`);
    expect(originMain()).toBe(remoteBefore);
    expect(git(repo, ["status", "--porcelain"])).toBe("");
    // A replay is a no-op, and the resolved reconcile is recognised as ours when the remote advances again.
    expect(sync()).toMatchObject({ outcome: "current" });
    remoteAdvances("docs/reports/later.md", "later\n");
    expect(sync()).toMatchObject({ outcome: "reconciled" });
    expect(readFileSync(path.join(repo, "PROJECT.md"), "utf8")).toContain("current_action: a3");
  });

  it("keeps an identical pointer move the remote also made when the Action is still open", () => {
    pointer(repo, "a2");
    squashedPointer("a2");
    expect(sync()).toMatchObject({ outcome: "reconciled" });
    expect(readFileSync(path.join(repo, "PROJECT.md"), "utf8")).toContain("current_action: a2");
  });

  describe("a conflict that the remote did not cause by moving the pointer", () => {
    it("keeps the local pointer and the remote's adjacent lines when the remote only touched `updated:` (K2)", () => {
      pointer(repo, "a2");
      writeDoc(other, "PROJECT.md", projectDoc("a1", "2026-11-02"));
      commitAll(other, "docs hygiene: updated date only");
      git(other, ["push", "-q", "origin", "main"]);

      const result = sync();

      expect(result.outcome).toBe("reconciled");
      // Exact bytes (final newline included), in the working tree and in the committed blob.
      const project = readFileSync(path.join(repo, "PROJECT.md"), "utf8");
      expect(project).toBe(projectDoc("a2", "2026-11-02"));
      expect(git(repo, ["show", "HEAD:PROJECT.md"])).toBe(projectDoc("a2", "2026-11-02"));
      const message = git(repo, ["show", "-s", "--format=%B", "HEAD"]);
      expect(message).toContain("Pointer-Conflict-Kept-Local: PROJECT.md current_action a2 (the remote did not move it)");
      expect(message).not.toContain("Replaced-Local");
      expect(message).not.toMatch(/settled/);
    });

    it("keeps the local pointer when the remote edited only lines next to it in both documents (K)", () => {
      pointer(repo, "a2");
      writeDoc(other, "PROJECT.md", projectDoc("a1", "2026-11-02"));
      writeDoc(other, PLAN, planDoc("a1", [], 2));
      commitAll(other, "remote docs hygiene, no settlement");
      git(other, ["push", "-q", "origin", "main"]);

      expect(sync().outcome).toBe("reconciled");
      expect(readFileSync(path.join(repo, "PROJECT.md"), "utf8")).toBe(projectDoc("a2", "2026-11-02"));
      expect(readFileSync(path.join(repo, PLAN), "utf8")).toBe(planDoc("a2", [], 2));
      expect(git(repo, ["show", "HEAD:PROJECT.md"])).toBe(projectDoc("a2", "2026-11-02"));
      expect(git(repo, ["show", "HEAD:" + PLAN])).toBe(planDoc("a2", [], 2));
      // A later reconcile keeps the bytes.
      remoteAdvances("docs/reports/later.md", "later\n");
      expect(sync().outcome).toBe("reconciled");
      expect(git(repo, ["show", "HEAD:PROJECT.md"])).toBe(projectDoc("a2", "2026-11-02"));
    });

    it("round-trips CRLF line endings and a missing final newline byte for byte", () => {
      const crlf = (text: string) => text.replace(/\n/g, "\r\n");
      const noFinalNewline = (text: string) => text.replace(/\r?\n$/, "");
      for (const cwd of [repo, other]) git(cwd, ["config", "core.autocrlf", "false"]);
      writeDoc(repo, "PROJECT.md", noFinalNewline(crlf(projectDoc("a1"))));
      writeDoc(repo, PLAN, crlf(planDoc("a1")));
      commitAll(repo, "CRLF documents");
      git(repo, ["push", "-q", "origin", "main"]);
      git(other, ["pull", "-q", "origin", "main"]);
      writeDoc(repo, "PROJECT.md", noFinalNewline(crlf(projectDoc("a2"))));
      writeDoc(repo, PLAN, crlf(planDoc("a2")));
      commitAll(repo, "chore(arcadia): point at a2\n\nWritten by `arcadia advance queue make-next --apply` (qpointer_fixture).");
      writeDoc(other, "PROJECT.md", noFinalNewline(crlf(projectDoc("a1", "2026-11-02"))));
      writeDoc(other, PLAN, crlf(planDoc("a1", [], 2)));
      commitAll(other, "remote hygiene");
      git(other, ["push", "-q", "origin", "main"]);

      expect(sync().outcome).toBe("reconciled");

      expect(readFileSync(path.join(repo, "PROJECT.md"), "utf8")).toBe(noFinalNewline(crlf(projectDoc("a2", "2026-11-02"))));
      expect(readFileSync(path.join(repo, PLAN), "utf8")).toBe(crlf(planDoc("a2", [], 2)));
      expect(git(repo, ["show", "HEAD:PROJECT.md"])).toBe(noFinalNewline(crlf(projectDoc("a2", "2026-11-02"))));
    });
  });

  describe("recognising its own earlier reconcile", () => {
    const ctx = (remoteHead: string) => ({ baseBranch: "main", upstream: "origin/main", remoteHead });

    /** A conflict-resolved worker reconcile (local main now holds it, unpushed). */
    function resolvedReconcile(): string {
      pointer(repo, "a2");
      squashedPointer("a3", ["a1", "a2"]);
      expect(sync().outcome).toBe("reconciled");
      return head();
    }

    function forge(parentTree: string, parents: string[], message: string, extraFile?: { file: string; content: string }): string {
      const scratch = path.join(root, "forge-index");
      const env = { ...process.env, GIT_INDEX_FILE: scratch, GIT_AUTHOR_NAME: "x", GIT_AUTHOR_EMAIL: "x@x.invalid", GIT_COMMITTER_NAME: "x", GIT_COMMITTER_EMAIL: "x@x.invalid" };
      const run = (args: string[], input?: string) => execFileSync("git", args, { cwd: repo, env, input, encoding: "utf8" }).trim();
      run(["read-tree", parentTree]);
      if (extraFile) run(["update-index", "--add", "--cacheinfo", `100644,${run(["hash-object", "-w", "--stdin"], extraFile.content)},${extraFile.file}`]);
      const tree = run(["write-tree"]);
      rmSync(scratch, { force: true });
      return run(["commit-tree", tree, ...parents.flatMap((p) => ["-p", p]), "-m", message]);
    }

    it("recognises a resolved reconcile on the next remote advance, and so does go, in both orders", () => {
      const resolved = resolvedReconcile();
      remoteAdvances("docs/reports/later.md", "later\n");
      git(repo, ["fetch", "-q", "origin"]);
      const remoteHead = git(repo, ["rev-parse", "origin/main"]).trim();
      // go's recogniser and divergence inspection accept it (go itself still never resolves a conflict) ...
      expect(isRecognizedGovernanceCommit(repo, resolved, ctx(remoteHead))).toBe(true);
      expect(() => inspectGovernedBaseDivergence({ cwd: repo, baseBranch: "main", upstream: "origin/main", localHead: resolved, remoteHead })).not.toThrow();
      // ... and the worker reconciles over it again (worker, then go, then worker).
      expect(sync().outcome).toBe("reconciled");
    });

    it("recognises a reconcile written the way go writes it (worker after go)", () => {
      const pointerCommit = pointer(repo, "a2");
      remoteAdvances();
      git(repo, ["fetch", "-q", "origin"]);
      const remoteHead = git(repo, ["rev-parse", "origin/main"]).trim();
      const mergeBase = git(repo, ["merge-base", pointerCommit, remoteHead]).trim();
      const tree = writeCleanBaseMergeTree(repo, pointerCommit, remoteHead);
      const message = baseReconciliationCommitMessage({ baseBranch: "main", upstream: "origin/main", localHead: pointerCommit, remoteHead, mergeBase, localCommits: 1, remoteCommits: 1 });
      const goWritten = createBaseReconciliationCommit({ cwd: repo, tree, localHead: pointerCommit, remoteHead, message, now: new Date("2026-11-02T12:00:00Z") });
      git(repo, ["merge", "-q", "--ff-only", goWritten]);
      remoteAdvances("docs/reports/later.md", "later\n");
      expect(sync().outcome).toBe("reconciled");
      expect(git(repo, ["rev-parse", "HEAD^1"]).trim()).toBe(goWritten);
    });

    it("refuses a forged reconcile whose tree carries something the merge would not", () => {
      const resolved = resolvedReconcile();
      const [first, second] = git(repo, ["show", "-s", "--format=%P", resolved]).trim().split(" ");
      const forged = forge(`${resolved}^{tree}`, [first, second], git(repo, ["show", "-s", "--format=%B", resolved]), { file: "src/evil.sh", content: "evil\n" });
      git(repo, ["reset", "-q", "--hard", forged]);
      remoteAdvances("docs/reports/later.md", "later\n");
      expectRefused(/not pointer commits/);
    });

    it("refuses a forged reconcile whose message was changed", () => {
      const resolved = resolvedReconcile();
      const [first, second] = git(repo, ["show", "-s", "--format=%P", resolved]).trim().split(" ");
      const forged = forge(`${resolved}^{tree}`, [first, second], `${git(repo, ["show", "-s", "--format=%B", resolved])}\nApproved by the operator.\n`);
      git(repo, ["reset", "-q", "--hard", forged]);
      remoteAdvances("docs/reports/later.md", "later\n");
      expectRefused(/not pointer commits/);
    });

    it("refuses a resolved reconcile whose remote parent is no longer in the remote's history", () => {
      const genesis = head();
      pointer(repo, "a2");
      // The remote's own pointer move: the reconcile resolves to it, then the remote is rewritten without it.
      pointer(other, "a3");
      git(other, ["push", "-q", "origin", "main"]);
      expect(sync().outcome).toBe("reconciled");
      git(other, ["reset", "-q", "--hard", genesis]);
      writeDoc(other, "docs/reports/rewritten.md", "rewritten\n");
      commitAll(other, "history rewritten");
      git(other, ["push", "-q", "--force", "origin", "main"]);
      expectRefused(/not pointer commits/);
    });
  });

  it("does not overwrite a locally ignored file the remote adds", () => {
    writeDoc(repo, ".gitignore", "secret.env\n");
    commitAll(repo, "ignore secret.env");
    git(repo, ["push", "-q", "origin", "main"]);
    git(other, ["pull", "-q", "origin", "main"]);
    pointer(repo, "a2");
    writeDoc(other, "secret.env", "from the remote\n");
    git(other, ["add", "-f", "secret.env"]);
    commitAll(other, "remote adds a path that is ignored here");
    git(other, ["push", "-q", "origin", "main"]);
    writeFileSync(path.join(repo, "secret.env"), "MY IGNORED LOCAL FILE\n");
    const before = head();

    const result = sync();

    expect(result.outcome).toBe("refused");
    expect(head()).toBe(before);
    expect(readFileSync(path.join(repo, "secret.env"), "utf8")).toBe("MY IGNORED LOCAL FILE\n");
  });

  it("does not overwrite a locally ignored file on the plain fast-forward path either", () => {
    writeDoc(repo, ".gitignore", "secret.env\n");
    commitAll(repo, "ignore secret.env");
    git(repo, ["push", "-q", "origin", "main"]);
    git(other, ["pull", "-q", "origin", "main"]);
    writeDoc(other, "secret.env", "from the remote\n");
    git(other, ["add", "-f", "secret.env"]);
    commitAll(other, "remote adds a path that is ignored here");
    git(other, ["push", "-q", "origin", "main"]);
    writeFileSync(path.join(repo, "secret.env"), "MY IGNORED LOCAL FILE\n");
    const before = head();

    expect(sync().outcome).toBe("refused");
    expect(head()).toBe(before);
    expect(readFileSync(path.join(repo, "secret.env"), "utf8")).toBe("MY IGNORED LOCAL FILE\n");
  });

  it("keeps a column-0 body line named current_action intact through a resolved conflict", () => {
    writeDoc(repo, "PROJECT.md", `${projectDoc("a1")}\ncurrent_action: operator note that matters\n`);
    commitAll(repo, "operator note");
    git(repo, ["push", "-q", "origin", "main"]);
    git(other, ["pull", "-q", "origin", "main"]);
    writeDoc(repo, "PROJECT.md", `${projectDoc("a2")}\ncurrent_action: operator note that matters\n`);
    writeDoc(repo, PLAN, planDoc("a2"));
    commitAll(repo, "chore(arcadia): point at a2\n\nWritten by `arcadia advance queue make-next --apply` (qpointer_fixture).");
    writeDoc(other, "PROJECT.md", `${projectDoc("a3")}\ncurrent_action: operator note that matters\n`);
    writeDoc(other, PLAN, planDoc("a3", ["a1", "a2"]));
    commitAll(other, "remote settles");
    git(other, ["push", "-q", "origin", "main"]);
    expect(sync().outcome).toBe("reconciled");
    expect(readFileSync(path.join(repo, "PROJECT.md"), "utf8")).toContain("current_action: operator note that matters");
  });

  it("refuses when the remote finished the Plan and removed current_action (an end of Plan)", () => {
    pointer(repo, "a2");
    writeDoc(other, "PROJECT.md", projectDoc("a1").replace("current_action: a1\n", ""));
    writeDoc(other, PLAN, planDoc("a1", ["a1", "a2", "a3"]).replace("current_action: a1\n", ""));
    commitAll(other, "final settlement");
    git(other, ["push", "-q", "origin", "main"]);
    expectRefused(/no current_action/);
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

    const logged: string[] = [];
    function tick(db: Database.Database, fastForward = true) {
      return detectBaseBranchAdvance(db, { repoRoot: repo, projectSlug: "fixture", projectId: "project_fixture", now: new Date("2026-11-02T12:00:00Z"), log: (line) => { logged.push(line); }, fastForward });
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
      expect(logged.some((line) => line.startsWith("Reconciled fixture's checkout"))).toBe(true);
      expect(logged.some((line) => line.startsWith("Fast-forwarded"))).toBe(false);
      db.close();
    });

    it("the per-tick base sync escalates a checkout on another branch as a fast-forward problem, with a read-only remedy", () => {
      const db = new Database(":memory:");
      applyInitialSchema(db);
      ensureProductionTickTables(db);
      remoteAdvances();
      git(repo, ["checkout", "-q", "-b", "feature"]);

      tick(db);

      const [escalation] = listOperatorEscalations(db);
      expect(escalation.message).toContain("cannot fast-forward onto origin/main");
      expect(escalation.message).toContain("the checkout is on feature, not main");
      expect(escalation.remedy).toContain(repo);
      expect(escalation.remedy).not.toContain("has diverged");
      const pings = (db.prepare("SELECT message FROM operator_pings").all() as Array<{ message: string }>).map((row) => row.message);
      expect(pings.join("\n")).toContain("cannot fast-forward");
      for (const text of [escalation.message, escalation.remedy, ...pings]) expect(text).not.toMatch(MUTATING_GIT);
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
      const [escalation] = listOperatorEscalations(db);
      expect(escalation).toMatchObject({ kind: "base_not_synced", message: expect.stringContaining("not pointer commits") });
      // Diverged, not "cannot fast-forward": names the refusal and the local-only commit, and suggests no write.
      expect(escalation.message).toContain("has diverged from origin/main");
      expect(escalation.message).toContain("local work");
      expect(escalation.message).not.toContain("cannot fast-forward");
      expect(escalation.remedy).toContain("Rowan");
      const pings = (db.prepare("SELECT message FROM operator_pings").all() as Array<{ message: string }>).map((row) => row.message);
      expect(pings.join("\n")).toContain("cannot reconcile");
      expect(pings.join("\n")).not.toContain("cannot fast-forward");
      for (const text of [escalation.message, escalation.remedy, ...pings]) expect(text).not.toMatch(MUTATING_GIT);
      db.close();
    });
  });
});
