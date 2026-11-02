import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { git, isAncestor, tryGit } from "./worktrees.js";

/*
 * Shared Git mechanics for reconciling a local base branch that is both ahead
 * of and behind its remote through one conflict-free, two-parent merge commit.
 * `arcadia go` (the protected host route) and the worker's own-pointer reconcile
 * use these, so there is one set of history safety checks.
 */

export const FULL_GIT_OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export type ReconcileRefusal = (message: string, details: Record<string, unknown>) => never;

/** Refuse histories Git would not merge faithfully; returns the single complete merge base of the two heads. */
export function assertReconcilableHistory(
  cwd: string,
  details: { localHead: string; remoteHead: string } & Record<string, unknown>,
  fail: ReconcileRefusal
): string {
  const { localHead, remoteHead } = details;
  if (git(cwd, ["rev-parse", "--is-shallow-repository"]).trim() === "true") {
    fail("Protected Go refuses to reconcile a shallow base history.", details);
  }
  if (process.env.GIT_REPLACE_REF_BASE) {
    fail("Protected Go refuses history with a custom replacement-ref namespace.", {
      ...details,
      replacementRefBase: process.env.GIT_REPLACE_REF_BASE
    });
  }
  const replacements = tryGit(cwd, ["for-each-ref", "--format=%(refname)", "refs/replace"]);
  if (replacements) {
    fail("Protected Go refuses base history with replacement refs.", {
      ...details,
      replacements: replacements.split("\n").filter(Boolean)
    });
  }
  const graftPathOutput = git(cwd, ["rev-parse", "--git-path", "info/grafts"]).trim();
  const graftPath = path.isAbsolute(graftPathOutput) ? graftPathOutput : path.resolve(cwd, graftPathOutput);
  if (existsSync(graftPath) && readFileSync(graftPath, "utf8").trim()) {
    fail("Protected Go refuses base history with legacy grafts.", {
      ...details,
      graftPath
    });
  }
  const customMergeDrivers = tryGit(cwd, ["config", "--get-regexp", "^merge\\..*\\.driver$"]);
  if (customMergeDrivers) {
    fail("Protected Go refuses to run repository-configured merge drivers on the host.", {
      ...details,
      customMergeDrivers: customMergeDrivers.split("\n").filter(Boolean)
    });
  }
  const mergeBaseOutput = tryGit(cwd, ["merge-base", "--all", localHead, remoteHead]);
  const mergeBases = mergeBaseOutput?.split("\n").map(value => value.trim()).filter(Boolean) ?? [];
  if (mergeBases.length !== 1 || !FULL_GIT_OID.test(mergeBases[0])) {
    fail("Protected Go requires exactly one complete shared merge base.", {
      ...details,
      mergeBases
    });
  }
  return mergeBases[0];
}

export function isRecognizedProtectedReconciliation(
  cwd: string,
  commit: string,
  parents: string[],
  message: string,
  context: { baseBranch: string; upstream: string; remoteHead: string }
): boolean {
  if (parents.length !== 2 || !isAncestor(cwd, parents[1], context.remoteHead)) return false;
  const mergeBases = tryGit(cwd, ["merge-base", "--all", parents[0], parents[1]])
    ?.split("\n").map(value => value.trim()).filter(Boolean) ?? [];
  if (mergeBases.length !== 1 || !FULL_GIT_OID.test(mergeBases[0])) return false;
  const mergeAttempt = attemptBaseMergeTree(cwd, parents[0], parents[1]);
  if (mergeAttempt.status !== 0 || mergeAttempt.lines.length !== 1 ||
      !FULL_GIT_OID.test(mergeAttempt.lines[0])) return false;
  const actualTree = tryGit(cwd, ["show", "-s", "--format=%T", commit]);
  if (actualTree !== mergeAttempt.lines[0]) return false;
  const expectedMessage = baseReconciliationCommitMessage({
    baseBranch: context.baseBranch,
    upstream: context.upstream,
    localHead: parents[0],
    remoteHead: parents[1],
    mergeBase: mergeBases[0],
    localCommits: countRevisionRange(cwd, parents[1] + ".." + parents[0]),
    remoteCommits: countRevisionRange(cwd, parents[0] + ".." + parents[1])
  });
  return message.trimEnd() === expectedMessage;
}

export function writeCleanBaseMergeTree(cwd: string, localHead: string, remoteHead: string): string {
  const result = attemptBaseMergeTree(cwd, localHead, remoteHead);
  if (result.status === 129 || /unknown option|usage: git merge-tree/i.test(result.stderr)) {
    throw validationError("The installed Git cannot compute a protected two-commit merge tree.", {
      localHead,
      remoteHead,
      cause: result.stderr || result.error,
      remedy: "Run the protected controller on a host with Git 2.38 or newer; no base ref or worktree was changed."
    });
  }
  if (result.status !== 0) {
    throw validationError("The governed local base and fetched remote do not reconcile cleanly; Arcadia left the base ref and worktree unchanged.", {
      localHead,
      remoteHead,
      conflictingPaths: result.lines.slice(1),
      cause: result.stderr || result.error,
      remedy: "Record a focused governed repair for the overlap, then request protected Go again."
    });
  }
  if (result.lines.length !== 1 || !FULL_GIT_OID.test(result.lines[0])) {
    throw validationError("Git did not return one auditable tree for protected base reconciliation.", {
      localHead,
      remoteHead,
      output: result.lines
    });
  }
  return result.lines[0];
}

export function attemptBaseMergeTree(cwd: string, localHead: string, remoteHead: string): {
  status: number | null;
  lines: string[];
  stderr: string;
  error: string | null;
} {
  const result = spawnSync("git", ["merge-tree", "--write-tree", "--name-only", localHead, remoteHead], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const lines = result.stdout?.split("\n").map(value => value.trim()).filter(Boolean) ?? [];
  return {
    status: result.status,
    lines,
    stderr: result.stderr?.trim() ?? "",
    error: result.error?.message ?? null
  };
}

export function createBaseReconciliationCommit(input: {
  cwd: string;
  tree: string;
  localHead: string;
  remoteHead: string;
  message: string;
  now: Date;
}): string {
  const stamp = input.now.toISOString();
  let resultHead: string;
  try {
    resultHead = execFileSync("git", [
      "-c", "core.hooksPath=/dev/null",
      "-c", "commit.gpgSign=false",
      "commit-tree", input.tree,
      "-p", input.localHead,
      "-p", input.remoteHead,
      "-m", input.message
    ], {
      cwd: input.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Arcadia Controller",
        GIT_AUTHOR_EMAIL: "controller@arcadia.local",
        GIT_COMMITTER_NAME: "Arcadia Controller",
        GIT_COMMITTER_EMAIL: "controller@arcadia.local",
        GIT_AUTHOR_DATE: stamp,
        GIT_COMMITTER_DATE: stamp
      }
    }).trim();
  } catch (error) {
    const detail = error as { stderr?: Buffer | string; message?: string };
    throw validationError("Protected Go could not create the pinned reconciliation commit.", {
      cause: String(detail.stderr ?? detail.message ?? error).trim()
    });
  }
  if (!FULL_GIT_OID.test(resultHead)) {
    throw validationError("Git did not return a full object id for the host-controller reconciliation commit.", {
      resultHead
    });
  }
  return resultHead;
}

export function verifyReconciliationCommit(
  cwd: string,
  resultHead: string,
  expectedTree: string,
  localHead: string,
  remoteHead: string
): void {
  const parents = git(cwd, ["show", "-s", "--format=%P", resultHead]).trim();
  const tree = git(cwd, ["show", "-s", "--format=%T", resultHead]).trim();
  if (parents !== localHead + " " + remoteHead || tree !== expectedTree) {
    throw validationError("The generated reconciliation commit does not match its pinned parents and tree.", {
      resultHead,
      expectedParents: [localHead, remoteHead],
      actualParents: parents.split(/\s+/).filter(Boolean),
      expectedTree,
      actualTree: tree
    });
  }
}

export function baseReconciliationCommitMessage(input: {
  baseBranch: string;
  upstream: string;
  localHead: string;
  remoteHead: string;
  mergeBase: string;
  localCommits: number;
  remoteCommits: number;
}): string {
  return [
    "chore(arcadia): reconcile " + input.baseBranch + " with " + input.upstream,
    "",
    "Local-Head: " + input.localHead,
    "Remote-Head: " + input.remoteHead,
    "Merge-Base: " + input.mergeBase,
    "Local-Governance-Commits: " + input.localCommits,
    "Remote-Commits-Integrated: " + input.remoteCommits,
    "",
    "Written by protected Arcadia Go host-controller reconciliation."
  ].join("\n");
}

export function countRevisionRange(cwd: string, range: string): number {
  return Number.parseInt(git(cwd, ["rev-list", "--count", range]).trim(), 10);
}
