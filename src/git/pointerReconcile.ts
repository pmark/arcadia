import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { validationError } from "../cli/errors.js";
import {
  FULL_GIT_OID,
  assertReconcilableHistory,
  baseReconciliationCommitMessage,
  countRevisionRange,
  createBaseReconciliationCommit,
  isRecognizedProtectedReconciliation,
  verifyReconciliationCommit
} from "./baseReconcile.js";
import { redactSecrets, sanitizeOutput } from "../sessions/validationEvidence.js";
import { redactUrlUserinfo } from "../timeline/collectors/git.js";
import { git, isAncestor, tryGit, tryGitWithStderr } from "./worktrees.js";

/**
 * Bring the local base branch onto its remote when that is safe. Pointer
 * commits (`chore(arcadia): point at ...`) are written locally and never
 * pushed, so after GitHub merges a PR the local base is both ahead (its own
 * pointer commits) and behind (the merge). A plain `--ff-only` refuses that
 * forever. When every local-only commit is such a pointer commit -- one parent,
 * a diff limited to PROJECT.md and the active Plan document -- this publishes
 * the same conflict-free two-parent reconcile commit `arcadia go` writes, then
 * fast-forwards the checkout onto it. It never rewrites or discards a local
 * commit, never pushes, and refuses (leaving the checkout untouched) on any
 * other local-only commit, a dirty tracked file, another checked-out branch,
 * a conflict outside the pointer lines, or a merged pointer pair that no
 * longer agrees with the Plan. A conflict confined to `current_action` lines of
 * PROJECT.md and the active Plan resolves to the remote's value (see planReconcile).
 */
export type BaseSyncOutcome = "current" | "fast-forwarded" | "reconciled" | "refused";

export interface BaseSyncResult {
  outcome: BaseSyncOutcome;
  /** Why the sync refused, or null. */
  reason: string | null;
  headBefore: string | null;
  resultHead: string | null;
  /** The local-only pointer commits a reconcile kept, oldest first. */
  pointerCommits: string[];
}

export interface BaseSyncInput {
  repoRoot: string;
  baseBranch: string;
  remote?: string;
  /** False when the caller has just fetched. Defaults to fetching. */
  fetch?: boolean;
  now?: Date;
}

const POINTER_SUBJECT = /^chore\(arcadia\): point at \S/;
/** The Plan-activation commit `commitActivation` (src/dispatch/planActivationApply.ts) writes, and its trailer. */
const ACTIVATE_SUBJECT = /^chore\(arcadia\): activate ([a-z0-9][a-z0-9-]*) at (\S+)$/;
const ACTIVATE_TRAILER = /^Written by the total Arcadia Go transition resolver \([A-Za-z0-9][A-Za-z0-9_.:-]*\)\.$/m;

class SyncRefusal extends Error {}

function refuse(reason: string): never {
  throw new SyncRefusal(reason);
}

function result(outcome: BaseSyncOutcome, headBefore: string | null, resultHead: string | null, reason: string | null = null, pointerCommits: string[] = []): BaseSyncResult {
  return { outcome, reason, headBefore, resultHead, pointerCommits };
}

export function syncBaseWithOwnPointerCommits(input: BaseSyncInput): BaseSyncResult {
  const { repoRoot, baseBranch } = input;
  const remote = input.remote ?? "origin";
  const baseRef = `refs/heads/${baseBranch}`;
  const upstream = `${remote}/${baseBranch}`;
  const headBefore = tryGit(repoRoot, ["rev-parse", "--verify", baseRef])?.trim() ?? null;
  try {
    if (!headBefore) refuse(`the local branch ${baseBranch} does not exist`);
    const checkedOut = tryGit(repoRoot, ["symbolic-ref", "-q", "HEAD"])?.trim() ?? null;
    if (checkedOut !== baseRef) refuse(`the checkout is on ${checkedOut?.replace(/^refs\/heads\//, "") ?? "a detached HEAD"}, not ${baseBranch}`);
    if (input.fetch !== false) {
      const fetched = tryGitWithStderr(repoRoot, ["fetch", "--quiet", remote, baseBranch], process.env, 500, (text) => redactUrlUserinfo(redactSecrets(sanitizeOutput(text))));
      if (fetched.stdout === null) refuse(`could not fetch ${upstream}${fetched.stderr ? `: ${fetched.stderr}` : ""}`);
    }
    const remoteHead = tryGit(repoRoot, ["rev-parse", "--verify", `refs/remotes/${upstream}`])?.trim() ?? null;
    if (!remoteHead) refuse(`${upstream} is not known locally`);

    if (headBefore === remoteHead || isAncestor(repoRoot, remoteHead, headBefore)) return result("current", headBefore, headBefore);
    if (isAncestor(repoRoot, headBefore, remoteHead)) {
      const failure = fastForwardMerge(repoRoot, remoteHead);
      if (failure !== null) refuse(`${baseBranch} cannot fast-forward onto ${upstream}: ${failure}`);
      return result("fast-forwarded", headBefore, tryGit(repoRoot, ["rev-parse", "HEAD"])?.trim() ?? remoteHead);
    }

    // Diverged: reconcile only a base whose local-only commits are all ours.
    const dirty = (tryGit(repoRoot, ["status", "--porcelain", "--untracked-files=no"]) ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
    if (dirty.length > 0) refuse(`the checkout has uncommitted changes (${dirty.slice(0, 5).join("; ")})`);
    const mergeBase = assertReconcilableHistory(repoRoot, { localHead: headBefore, remoteHead }, (message) => refuse(message));
    const localCommits = git(repoRoot, ["rev-list", "--reverse", `${remoteHead}..${headBefore}`]).split("\n").map((v) => v.trim()).filter(Boolean);
    const foreign = localCommits.filter((commit) => !isOwnPointerCommit(repoRoot, commit, { baseBranch, upstream, remoteHead }));
    if (localCommits.length === 0 || foreign.length > 0) {
      refuse(`${baseBranch} has local-only commits that are not pointer commits (${foreign.slice(0, 3).map((c) => c.slice(0, 12)).join(", ")})`);
    }
    const { tree, message } = planReconcile(repoRoot, { baseBranch, upstream, mergeBase, localHead: headBefore, remoteHead, localCommits: localCommits.length });
    const resultHead = createBaseReconciliationCommit({ cwd: repoRoot, tree, localHead: headBefore, remoteHead, message, now: input.now ?? new Date() });
    verifyReconciliationCommit(repoRoot, resultHead, tree, headBefore, remoteHead);
    // Re-check immediately before the only write: the merge acts on the checked-out
    // HEAD, so that (not the branch ref alone) must still be the base at the planned head.
    if (tryGit(repoRoot, ["symbolic-ref", "-q", "HEAD"])?.trim() !== baseRef || tryGit(repoRoot, ["rev-parse", "--verify", "HEAD"])?.trim() !== headBefore) {
      refuse(`${baseBranch} moved during the reconcile`);
    }
    const failure = fastForwardMerge(repoRoot, resultHead);
    if (failure !== null) refuse(`${baseBranch} could not fast-forward onto the reconcile commit: ${failure}`);
    return result("reconciled", headBefore, resultHead, null, localCommits);
  } catch (error) {
    return refuseResult(headBefore, error);
  }
}

export interface ReconcilePlan {
  baseBranch: string;
  upstream: string;
  mergeBase: string;
  localHead: string;
  remoteHead: string;
  localCommits: number;
}

interface PlannedReconcile {
  tree: string;
  message: string;
  /** True when a pointer-only conflict was resolved (a clean merge is `arcadia go`'s own shape). */
  resolved: boolean;
}

/**
 * The reconcile tree and commit message for two heads. A clean three-way merge
 * is used as is. A conflict confined to PROJECT.md and the active Plan, where
 * the local side changed only `current_action` lines in those files, resolves
 * per file: if the remote moved the pointer (its value differs from the merge
 * base's) the remote's blob is taken whole; if it did not (the conflict is only
 * an adjacent line such as `updated:`), the remote's blob is taken with the
 * local pointer line kept. Everything else refuses. Deterministic, so a later
 * sync (or `arcadia go`) can recompute it to recognise this commit.
 */
export function planReconcile(cwd: string, plan: ReconcilePlan): PlannedReconcile {
  const { localHead, remoteHead, mergeBase } = plan;
  const baseMessage = baseReconciliationCommitMessage({
    baseBranch: plan.baseBranch,
    upstream: plan.upstream,
    localHead,
    remoteHead,
    mergeBase,
    localCommits: plan.localCommits,
    remoteCommits: countRevisionRange(cwd, `${localHead}..${remoteHead}`)
  });
  const attempt = spawnSync("git", ["merge-tree", "--write-tree", "--name-only", localHead, remoteHead], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const sections = (attempt.stdout ?? "").split("\n\n");
  const lines = sections[0].split("\n").map((v) => v.trim()).filter(Boolean);
  if (attempt.status === 0) {
    if (lines.length !== 1 || !FULL_GIT_OID.test(lines[0])) refuse("git did not return one auditable merge tree");
    const problem = pointerPairProblem(cwd, lines[0]);
    if (problem) refuse(problem);
    return { tree: lines[0], message: baseMessage, resolved: false };
  }
  if (attempt.status !== 1 || lines.length < 2 || !FULL_GIT_OID.test(lines[0])) {
    refuse(`the local ${plan.baseBranch} and ${plan.upstream} could not be merged: ${(attempt.stderr ?? "").trim() || `git exit ${String(attempt.status)}`}`);
  }
  const conflicted = lines.slice(1);
  const allowed = new Set(["PROJECT.md", activePlanPath(cwd, localHead), activePlanPath(cwd, remoteHead)].filter((v): v is string => v !== null));
  const foreign = conflicted.filter((file) => !allowed.has(file));
  if (foreign.length > 0) refuse(`the base and ${plan.upstream} conflict outside the pointer documents (${foreign.slice(0, 3).join(", ")})`);
  const entries: Array<{ file: string; mode: string; text: string | null; blob: string }> = [];
  const notes: string[] = [];
  for (const file of conflicted) {
    const before = rawBlob(cwd, mergeBase, file);
    const local = rawBlob(cwd, localHead, file);
    // The remote's text is only inspected here; its blob is reused by id unless the local pointer line is kept (re-read exactly below).
    const remote = rawBlob(cwd, remoteHead, file, false);
    if (before === null || local === null || remote === null) refuse(`${file} was added or removed, not only re-pointed`);
    if (withoutPointerLines(before) !== withoutPointerLines(local)) refuse(`the local commits changed more than current_action in ${file}`);
    const remoteEntry = /^(\d+) blob ([0-9a-f]+)\t/.exec(tryGit(cwd, ["ls-tree", remoteHead, "--", file]) ?? "");
    if (!remoteEntry) refuse(`${file} is not a regular file on the remote`);
    if (pointerValue(remote) !== pointerValue(before)) {
      entries.push({ file, mode: remoteEntry[1], text: null, blob: remoteEntry[2] });
      notes.push(`Pointer-Conflict-Replaced-Local: ${file} current_action ${pointerValue(local)} (the remote moved it to ${pointerValue(remote)})`);
    } else {
      const kept = withPointerLine(rawBlob(cwd, remoteHead, file) ?? remote, pointerLine(local));
      if (kept === null) refuse(`${file} has no current_action line to keep`);
      entries.push({ file, mode: remoteEntry[1], text: kept, blob: "" });
      notes.push(`Pointer-Conflict-Kept-Local: ${file} current_action ${pointerValue(local)} (the remote did not move it)`);
    }
  }
  const tree = treeWithResolvedFiles(cwd, lines[0], entries);
  const problem = pointerPairProblem(cwd, tree);
  if (problem) refuse(problem);
  const message = [baseMessage, "", ...notes, "", "Only the current_action lines were resolved; every other line is the remote's."].join("\n");
  return { tree, message, resolved: true };
}

/** `tree` with each file's entry replaced (by an existing blob or new text), through a throwaway index. */
function treeWithResolvedFiles(cwd: string, tree: string, entries: Array<{ file: string; mode: string; text: string | null; blob: string }>): string {
  const scratch = mkdtempSync(path.join(tmpdir(), "arcadia-pointer-reconcile-"));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(scratch, "index") };
  const run = (args: string[], stdin?: string): string => {
    const out = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8", env, input: stdin, stdio: ["pipe", "pipe", "pipe"] });
    if (out.status !== 0) refuse(`could not build the resolved tree: ${(out.stderr ?? "").trim()}`);
    return out.stdout.trim();
  };
  try {
    run(["read-tree", tree]);
    for (const entry of entries) {
      const blob = entry.text === null ? entry.blob : run(["hash-object", "-w", "--stdin"], entry.text);
      run(["update-index", "--add", "--cacheinfo", `${entry.mode},${blob},${entry.file}`]);
    }
    const resolved = run(["write-tree"]);
    if (!FULL_GIT_OID.test(resolved)) refuse("git did not return a resolved tree");
    return resolved;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** A conflict-resolving reconcile this module wrote earlier: recomputed from its parents, byte for byte. */
export function isRecognizedResolvedReconciliation(
  cwd: string,
  commit: string,
  parents: string[],
  message: string,
  context: { baseBranch: string; upstream: string; remoteHead: string }
): boolean {
  if (parents.length !== 2 || !isAncestor(cwd, parents[1], context.remoteHead)) return false;
  const mergeBases = tryGit(cwd, ["merge-base", "--all", parents[0], parents[1]])?.split("\n").map((v) => v.trim()).filter(Boolean) ?? [];
  if (mergeBases.length !== 1 || !FULL_GIT_OID.test(mergeBases[0])) return false;
  try {
    const planned = planReconcile(cwd, {
      baseBranch: context.baseBranch,
      upstream: context.upstream,
      mergeBase: mergeBases[0],
      localHead: parents[0],
      remoteHead: parents[1],
      localCommits: countRevisionRange(cwd, `${parents[1]}..${parents[0]}`)
    });
    return planned.resolved && planned.message === message.trimEnd() && planned.tree === tryGit(cwd, ["show", "-s", "--format=%T", commit]);
  } catch {
    return false;
  }
}

function refuseResult(headBefore: string | null, error: unknown): BaseSyncResult {
  const reason = error instanceof SyncRefusal || error instanceof Error ? error.message : String(error);
  return result("refused", headBefore, headBefore, reason);
}

/** Throws when the sync refuses; the worker-merge sync reports that as `base_not_synced`. */
export function syncBaseOrThrow(input: BaseSyncInput): BaseSyncResult {
  const synced = syncBaseWithOwnPointerCommits(input);
  if (synced.outcome === "refused") throw validationError(synced.reason ?? "base sync refused");
  return synced;
}

const POINTER_TRAILER = /^Written by `arcadia advance queue make-next --apply` \([A-Za-z0-9][A-Za-z0-9_.:-]*\)\.$/m;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const CURRENT_ACTION_LINE = /^current_action\s*:/;

/** The text with the frontmatter's top-level `current_action` lines removed; the body is never touched. */
function withoutPointerLines(text: string): string {
  return withoutFrontmatterFields(text, ["current_action"]);
}

/** The text with the frontmatter's top-level lines for `fields` removed; the body is never touched. */
function withoutFrontmatterFields(text: string, fields: string[]): string {
  const match = FRONTMATTER.exec(text);
  if (!match) return text;
  const lineFor = new RegExp(`^(?:${fields.join("|")})\\s*:`);
  const kept = match[1].split("\n").filter((line) => !lineFor.test(line)).join("\n");
  return text.slice(0, match.index) + match[0].replace(match[1], () => kept) + text.slice(match.index + match[0].length);
}

/**
 * A file's exact text at a revision (never trimmed: end-of-file whitespace and
 * CRLF matter), or null if absent. When `exact`, bytes that do not survive a
 * UTF-8 round trip refuse naming the file: decoding would fold distinct bytes
 * together and re-encoding would rewrite them.
 */
function rawBlob(cwd: string, rev: string, file: string, exact = true): string | null {
  const out = spawnSync("git", ["show", `${rev}:${file}`], { cwd, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  if (out.status !== 0) return null;
  const text = out.stdout.toString("utf8");
  if (exact && !Buffer.from(text, "utf8").equals(out.stdout)) refuse(`${file} at ${rev.slice(0, 12)} is not valid UTF-8, so it cannot be compared or re-pointed without risking its bytes`);
  return text;
}

/** Run a fast-forward merge of `target` and return Git's own explanation on failure. */
function fastForwardMerge(cwd: string, target: string): string | null {
  const out = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "merge", "--ff-only", "--no-overwrite-ignore", "--quiet", target], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (out.status === 0) return null;
  return (out.stderr || out.stdout || `git exit ${String(out.status)}`).split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 4).join(" ").slice(0, 400);
}

function pointerLine(text: string | null): string | null {
  const match = text ? FRONTMATTER.exec(text) : null;
  return match?.[1].split("\n").find((line) => CURRENT_ACTION_LINE.test(line)) ?? null;
}

function pointerValue(text: string | null): string {
  return pointerLine(text)?.replace(CURRENT_ACTION_LINE, "").trim() ?? "none";
}

/** `remote` with its frontmatter `current_action` line replaced by `line`, or null if either has none. */
function withPointerLine(remote: string, line: string | null): string | null {
  const match = FRONTMATTER.exec(remote);
  const own = pointerLine(remote);
  if (!match || !own || !line) return null;
  const replaced = match[1].split("\n").map((candidate) => (candidate === own ? line : candidate)).join("\n");
  return remote.slice(0, match.index) + match[0].replace(match[1], () => replaced) + remote.slice(match.index + match[0].length);
}

function isOwnPointerCommit(cwd: string, commit: string, context: { baseBranch: string; upstream: string; remoteHead: string }): boolean {
  const parents = git(cwd, ["show", "-s", "--format=%P", commit]).trim().split(/\s+/).filter(Boolean);
  const message = git(cwd, ["show", "-s", "--format=%B", commit]);
  const subject = message.split(/\r?\n/, 1)[0];
  // A reconcile this function (or `arcadia go`) wrote earlier and never pushed.
  if (subject === `chore(arcadia): reconcile ${context.baseBranch} with ${context.upstream}`) {
    return isRecognizedProtectedReconciliation(cwd, commit, parents, message, context) || isRecognizedResolvedReconciliation(cwd, commit, parents, message, context);
  }
  // A real pointer commit: the writer's subject and trailer, and nothing but
  // `current_action` lines changed in PROJECT.md and the Plan it names (read
  // from the parent, so a commit cannot move `active_plan` and widen the paths).
  if (parents.length === 1 && isOwnActivationCommit(cwd, commit, parents[0], subject, message)) return true;
  if (parents.length !== 1 || !POINTER_SUBJECT.test(subject) || !POINTER_TRAILER.test(message)) return false;
  const paths = git(cwd, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", commit]).split("\0").filter(Boolean);
  if (paths.length === 0) return false;
  const plan = activePlanPath(cwd, parents[0]);
  return paths.every((file) => {
    if (file !== "PROJECT.md" && (plan === null || file !== plan)) return false;
    const before = rawBlob(cwd, parents[0], file);
    const after = rawBlob(cwd, commit, file);
    return before !== null && after !== null && withoutPointerLines(before) === withoutPointerLines(after);
  });
}

/**
 * A Plan-activation commit (Issue #2018): the writer's subject and trailer, only
 * PROJECT.md and the Plan it now names changed, PROJECT.md only in `active_plan`
 * and `current_action`, and that Plan only in `status` and `current_action`.
 * The Plan is read from the commit's own PROJECT.md, which must name the subject's slug.
 */
function isOwnActivationCommit(cwd: string, commit: string, parent: string, subject: string, message: string): boolean {
  const parsed = ACTIVATE_SUBJECT.exec(subject);
  const slug = parsed?.[1];
  // The subject names `<project>/<action>` (the receipt's action key); the pointer holds the bare Action id.
  const actionId = parsed?.[2].split("/").pop();
  if (!slug || !actionId || !ACTIVATE_TRAILER.test(message)) return false;
  const project = frontmatter(rawBlob(cwd, commit, "PROJECT.md"));
  // It must really activate: the Project now names the subject's Plan and Action and the activated Plan is
  // `active`, so a hand-made commit cannot re-point at any Plan or status. A same-Plan activation (the parent
  // already named it, src/dispatch/planActivation.ts) is legitimate and accepted.
  if (project?.active_plan !== slug || project?.current_action !== actionId) return false;
  const plan = activePlanPath(cwd, commit);
  if (plan === null) return false;
  if (frontmatter(rawBlob(cwd, commit, plan))?.status !== "active") return false;
  const paths = git(cwd, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", commit]).split("\0").filter(Boolean);
  if (paths.length === 0) return false;
  return paths.every((file) => {
    const fields = file === "PROJECT.md" ? ["active_plan", "current_action"] : file === plan ? ["status", "current_action"] : null;
    if (fields === null) return false;
    const was = rawBlob(cwd, parent, file);
    const now = rawBlob(cwd, commit, file);
    return was !== null && now !== null && withoutFrontmatterFields(was, fields) === withoutFrontmatterFields(now, fields);
  });
}

function frontmatter(text: string | null): Record<string, unknown> | null {
  const match = text ? /^---\r?\n([\s\S]*?)\r?\n---/.exec(text) : null;
  if (!match) return null;
  try {
    const parsed = parseYaml(match[1]) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function activePlanPath(cwd: string, treeish: string): string | null {
  const slug = frontmatter(tryGit(cwd, ["show", `${treeish}:PROJECT.md`]))?.active_plan;
  return typeof slug === "string" && /^[a-z0-9][a-z0-9-]*$/.test(slug) ? `docs/plans/${slug}.md` : null;
}

/**
 * A clean three-way merge can keep a pointer the Plan no longer supports: a
 * squash merge applies a branch's pointer change as part of one patch, so the
 * merge base cannot show that the remote moved on. Returns the problem, or null
 * when PROJECT.md and the active Plan agree and the Action is still unfinished.
 */
export function pointerPairProblem(cwd: string, treeish: string): string | null {
  const project = frontmatter(tryGit(cwd, ["show", `${treeish}:PROJECT.md`]));
  const planPath = activePlanPath(cwd, treeish);
  if (!project || !planPath) return "the merged PROJECT.md has no readable active_plan";
  const plan = frontmatter(tryGit(cwd, ["show", `${treeish}:${planPath}`]));
  if (!plan) return `the merged active Plan ${planPath} is not readable`;
  const current = project.current_action;
  if (typeof current !== "string") return "the merged PROJECT.md has no current_action";
  if (plan.current_action !== undefined && plan.current_action !== current) {
    return `the merged pointer disagrees with its Plan (PROJECT.md ${current}, Plan ${String(plan.current_action)})`;
  }
  const actions = Array.isArray(plan.actions) ? (plan.actions as Array<Record<string, unknown>>) : [];
  const action = actions.find((candidate) => candidate.id === current);
  if (!action) return `the merged current_action ${current} is not an Action of ${planPath}`;
  if (action.status === "done") return `the merged current_action ${current} is already done in ${planPath}; the remote moved past this pointer`;
  return null;
}
