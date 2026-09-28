import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { invocationRoot } from "../cli/invocation.js";
import { withDatabase, withReadOnlyDatabase, writeTransaction } from "../db/connection.js";
import {
  SAFE_TASK_BRANCH,
  branchReflogActivity,
  countCommits,
  existingDirectory,
  git,
  hasUpstream,
  isAncestor,
  isInside,
  isPatchEquivalent,
  listWorktrees,
  liveProcessCwds,
  mergedPullRequests,
  resolveBaseBranch,
  resolveComparisonBase,
  samePath,
  shortBranch,
  tryGit,
  uncommittedChanges,
  type ComparisonBase
} from "../git/worktrees.js";
import {
  createTidyRunId,
  finalizeTidyJournal,
  listTidyRuns,
  probePath,
  quarantineBranch,
  quarantineWorktree,
  recoverTidyJournals,
  undoTidyRun,
  type TidyJournalRecovery,
  type TidyQuarantineManifest,
  type TidyUndoResult
} from "../git/quarantine.js";
import {
  getActiveWorktreeReservation,
  getRepositoryLease,
  hasWorktreeReservationTable,
  releaseWorktreeReservation
} from "../sessions/index.js";
import { getWorkspacePaths } from "../workspace/paths.js";
import { resolveWorkspace } from "../workspace/resolve.js";

/**
 * What tidy decided about one worktree or branch, and why.
 *
 * Every verdict names its reason, because the operator's actual complaint is
 * not that the mess exists — it is not knowing which branch holds the live work
 * or what state anything is in. A classification without a reason would replace
 * one opaque situation with another.
 */
export type TidyVerdict =
  /** The base branch, or where this command was invoked from. Never touched. */
  | "protected"
  /** Uncommitted changes present. Never touched, reported first. */
  | "dirty"
  /** Clean, and every branch change is proven present on the base branch. Safe to retire. */
  | "merged"
  /** Clean, but carries commits the base branch does not have. Never touched. */
  | "unmerged"
  /** Registered worktree whose directory is provably gone. Safe to quarantine. */
  | "missing"
  /** Clean and detached, with nothing unreachable. Safe to retire. */
  | "detached"
  /** Registered worktree whose path is unreachable right now (a disconnected or unmounted volume, a permission error) rather than provably absent. Never touched. */
  | "unavailable";

/**
 * How a `merged` verdict was actually established.
 *
 * `ancestry` means the branch's own commits are reachable from the base
 * branch — true for an ordinary merge or fast-forward.
 *
 * `patch-equivalent` means they are not reachable, but `git cherry` finds an
 * equivalent patch already upstream for every one of them — what a cherry-pick,
 * a rebase, or an amended commit leaves behind. Local, offline, no credentials.
 *
 * `pull-request` means neither of the above held, but GitHub recorded a merged
 * pull request for the branch and the commit it actually produced
 * (`mergeCommit`) is on the base branch. Checking that commit's ancestry
 * rather than trusting GitHub's "merged" label is what makes it a proof.
 *
 * All three answer the same question — did this content land? — and each
 * catches cases the others miss, which is why a branch is only reported
 * unmerged once all three decline it.
 */
export type MergeProof = "ancestry" | "patch-equivalent" | "pull-request";

/** What a verified merged pull request record needs to prove a branch's *current* content, not just its name, actually landed. */
export interface PrMergeRecord {
  /** What actually landed on the base branch. */
  sha: string;
  /** The PR's recorded head commit; the local branch's tip must be an ancestor of (or equal to) this before the record can vouch for it. */
  headRefOid: string;
  number: number;
}

/**
 * Why a worktree may not be retired, and whether that reason can end on
 * evidence rather than only on the clock.
 *
 * A live Session lease is absolute. A `go` handoff reservation is not: it
 * exists to stop tidy retiring a worktree `go` prepared that nobody has
 * launched yet, and once that handoff has visibly been used and its work has
 * landed on the base branch, it guards nothing.
 */
export interface WorktreeProtection {
  kind: "session-lease" | "handoff-reservation";
  reason: string;
}

export interface TidyWorktree {
  path: string;
  branch: string | null;
  verdict: TidyVerdict;
  reason: string;
  /** Commits on this branch that the base branch does not have. */
  ahead: number;
  /** Whether a remote-tracking branch exists, so unmerged work is not necessarily lost. */
  pushed: boolean;
  uncommitted: string[];
  /** Set only when `verdict` is `merged`. */
  mergeProof: MergeProof | null;
  /** Whether `--apply` actually retired it on this run. */
  retired: boolean;
}

export interface TidyBranch {
  branch: string;
  verdict: Extract<TidyVerdict, "merged" | "unmerged" | "protected">;
  reason: string;
  ahead: number;
  pushed: boolean;
  agentOwned: boolean;
  mergeProof: MergeProof | null;
  retired: boolean;
  /** The ref its history was relocated to when quarantined: `refs/arcadia/tidy/<run>/heads/<branch>`. Null until retired. */
  quarantineRef: string | null;
}

export interface TidyCommandData {
  repoRoot: string;
  baseBranch: string;
  /** The ref ancestry was actually checked against — `origin/<base>` when the fetch below succeeded. */
  comparisonRef: string;
  fetched: boolean;
  /** Set when fetching from `origin` was attempted and failed, so a stale-looking answer is explained rather than silent. */
  fetchNote: string | null;
  /** Whether pull-request-based verification ran at all, so a squash-merged branch reported `unmerged` can be told apart from one that was actually checked and found unmerged. */
  githubVerificationAvailable: boolean;
  /** Whether live Session leases and go handoff reservations were checked. Required for --apply. */
  workspaceProtectionAvailable: boolean;
  applied: boolean;
  worktrees: TidyWorktree[];
  branches: TidyBranch[];
  /** Anything that could lose work if handled carelessly. */
  needsAttention: string[];
  /** The quarantine run id this apply used, so `arcadia tidy undo <run>` can restore it. Null when nothing was quarantined (including any preview, where `applied` is false). */
  run: string | null;
  /** Interrupted ops from a previous run this invocation found and settled before doing anything else. Empty on an ordinary run. */
  journalRecovery: TidyJournalRecovery;
}

export interface TidyCommandOptions {
  repo?: string;
  workspace?: string;
  /** Without this nothing is changed, whatever the verdicts say. */
  apply?: boolean;
  /**
   * Leave fully merged branches the operator named themselves untouched. All
   * fully merged branches are retired by default, agent-owned or not; this is
   * the opt-out for an operator who wants their own refs kept.
   */
  excludeOwnBranches?: boolean;
  /**
   * Skip fetching `origin` first. Every worktree in a repository shares one
   * set of refs, so comparing against a stale local base branch silently
   * misclassifies anything merged since the last `git pull` as unmerged.
   * Fetching first is the default for that reason; this exists for offline
   * use, where a stale-but-labelled answer beats none.
   */
  noFetch?: boolean;
  /** Skip GitHub pull-request verification even when `gh` is available. */
  noGithub?: boolean;
  /** Reservation-expiry reference point. Not exposed by the CLI; defaults to the real clock. */
  now?: Date;
  /**
   * How long a worktree branch that has just moved (or just been created) is
   * protected regardless of what it otherwise proves, giving a live agent
   * Arcadia never launched — and therefore has no Session lease or handoff
   * reservation for — room to keep working. Not exposed by the CLI; defaults
   * to {@link DEFAULT_WORKTREE_LIVENESS_GRACE_MS}.
   */
  livenessGraceMs?: number;
  /** Deterministic fault injection for race regression tests. Not exposed by the CLI. */
  testHooks?: {
    afterAssessment?: () => void;
    beforeForcedBranchDelete?: (branch: string, expectedTip: string) => void;
  };
}

/**
 * Retire the worktrees and branches whose work is provably already on the base
 * branch, and report everything else without touching it.
 *
 * The safety rule is one sentence: **nothing is removed unless its working
 * tree is clean, its branch changes are proven present on the base, and no
 * live Session or prepared handoff claims it.** Apply rechecks that rule under
 * the workspace write interlock immediately before removal.
 *
 * Everything else is reported. An unmerged branch is never deleted even when it
 * looks abandoned, a dirty worktree is never touched even when its branch is
 * merged, and `--apply` is required before anything at all is written.
 */
export function runTidyCommand(options: TidyCommandOptions = {}): CommandSuccess<TidyCommandData> {
  const repoRoot = existingDirectory(options.repo ?? invocationRoot(), "repository");
  // Settle any op a previous --apply left mid-flight before assessing
  // anything: a half-quarantined worktree from a crashed run must not be
  // mistaken for a fresh one to classify.
  const journalRecovery = recoverTidyJournals(repoRoot);
  const now = options.now ?? new Date();
  const livenessGraceMs = options.livenessGraceMs ?? DEFAULT_WORKTREE_LIVENESS_GRACE_MS;
  const baseBranch = resolveBaseBranch(repoRoot);
  const worktrees = listWorktrees(repoRoot);
  const controlWorktree = worktrees[0]?.path ?? repoRoot;
  const here = invocationRoot();
  const workspaceResolution = resolveWorkspace({ workspace: options.workspace, cwd: repoRoot });
  const workspacePath = workspaceResolution.workspacePath && existsSync(getWorkspacePaths(workspaceResolution.workspacePath).databaseFile)
    ? workspaceResolution.workspacePath
    : null;
  if (options.apply && !workspacePath) {
    throw validationError("Arcadia tidy --apply requires an initialized workspace so live Sessions and prepared handoffs cannot be retired.", {
      remedy: "Pass --workspace, set ARCADIA_WORKSPACE, run inside an initialized workspace, or configure defaultWorkspace."
    });
  }

  // Fetched once, against the shared repository object database — every
  // worktree sees the result, so there is no reason to repeat it per worktree.
  const comparisonBase: ComparisonBase = options.noFetch
    ? { ref: baseBranch, fetched: false, fetchError: null }
    : resolveComparisonBase(repoRoot, baseBranch);

  const prMerges = options.noGithub ? null : mergedPullRequests(repoRoot);
  const prMergeCommits = new Map<string, PrMergeRecord>(
    (prMerges ?? []).map((entry) => [entry.headBranch, { sha: entry.mergeCommitSha, headRefOid: entry.headRefOid, number: entry.number }])
  );
  const liveCwds = liveProcessCwds();

  const protectionSchemaAvailable = workspacePath
    ? withReadOnlyDatabase(workspacePath, (db) => hasWorktreeReservationTable(db))
    : false;
  const protections = workspacePath
    ? (options.apply
        ? withDatabase(workspacePath, (db) => worktreeProtections(db, controlWorktree, worktrees, now))
        : withReadOnlyDatabase(workspacePath, (db) => worktreeProtections(db, controlWorktree, worktrees, now)))
    : new Map<string, WorktreeProtection>();
  const assessed: TidyWorktree[] = worktrees.map((record) => assessWorktree({
    record, repoRoot, comparisonBase, controlWorktree, here, prMergeCommits, protections, liveCwds, now, livenessGraceMs
  }));

  const claimedByWorktree = new Set(
    assessed.map((entry) => entry.branch).filter((branch): branch is string => branch !== null)
  );

  const branches = assessBranches({
    repoRoot,
    comparisonBase,
    claimedByWorktree,
    includeOwn: !options.excludeOwnBranches,
    prMergeCommits
  });

  let run: string | null = null;
  if (options.apply) {
    options.testHooks?.afterAssessment?.();
    run = createTidyRunId(now);
    const runId = run;
    withDatabase(workspacePath!, (db) => writeTransaction(db, () => {
      // The IMMEDIATE transaction is the shared interlock with `go`'s
      // reservation write. Re-read protection and Git state after acquiring
      // it so a preview-era verdict can never authorize a stale removal --
      // including which processes are live right now, not merely which ones
      // were live back when the preview-time snapshot was taken.
      const currentWorktrees = listWorktrees(repoRoot);
      const currentByPath = new Map(currentWorktrees.map((record) => [pathKey(record.path), record]));
      const currentProtections = worktreeProtections(db, controlWorktree, currentWorktrees, now);
      const currentLiveCwds = liveProcessCwds();
      for (const entry of assessed) {
        if (entry.verdict !== "merged" && entry.verdict !== "missing" && entry.verdict !== "detached") continue;
        const record = currentByPath.get(pathKey(entry.path)) ?? { path: entry.path, head: "", branch: entry.branch ? `refs/heads/${entry.branch}` : null };
        const current = assessWorktree({
          record,
          repoRoot,
          comparisonBase,
          controlWorktree,
          here,
          prMergeCommits,
          protections: currentProtections,
          liveCwds: currentLiveCwds,
          now,
          livenessGraceMs
        });
        Object.assign(entry, current);
        if (entry.verdict === "merged" || entry.verdict === "missing" || entry.verdict === "detached") {
          // One entry's failure (an EXDEV refusal, an unreachable path, an
          // unexpected filesystem error mid-rename) must never abort the rest
          // of this run: every other entry, and the DB writes already made for
          // earlier ones, must still stand. A thrown quarantine leaves this
          // entry itself unretired and explained; whatever it already
          // relocated stays exactly where it is, still protected by its pin
          // ref, for `tidy list`/manual recovery -- ordinary crash recovery
          // across an interrupted single step is tidy-journal-recovery-and-conservation-tests'
          // job, not this one's.
          try {
            const quarantined = quarantineWorktree(repoRoot, { path: entry.path, branch: entry.branch, head: record.head }, runId);
            entry.retired = quarantined !== null;
          } catch (error) {
            entry.retired = false;
            entry.reason = `${entry.reason} Quarantine failed: ${error instanceof Error ? error.message : String(error)}`;
          }
          // The row outlived its worktree. Deleting it here is what turns the
          // reservation from a fixed timer into a claim that ends with the work.
          if (entry.retired) releaseWorktreeReservation(db, controlWorktree, entry.path);
          // The worktree's own branch only goes once its worktree is gone, and
          // only when it is an agent-owned, disposable name -- mirroring the
          // prior removal behavior, but recoverably: quarantined, not deleted.
          // Best-effort: a failure here leaves the ref in place, never fails
          // the worktree's own retirement, and never aborts the rest of the run.
          // `record.head` is the commit this same interlock's recheck just
          // read (or empty for an already-gone registration with no live HEAD
          // to read); passing it as the CAS "old value" pins the branch
          // quarantine to that exact commit instead of trusting a fresh
          // `rev-parse` that could resolve a tip nobody here ever assessed.
          if (entry.retired && entry.branch && entry.branch !== baseBranch && SAFE_TASK_BRANCH.test(entry.branch)) {
            try { quarantineBranch(repoRoot, entry.branch, runId, record.head || undefined); } catch { /* best effort */ }
          }
        }
      }
      // Re-listed after the worktree loop above, not reused from its own
      // `currentWorktrees` snapshot: a worktree this same run just quarantined
      // must no longer count as "checked out" for its own branch, while a
      // worktree created by an entirely different process between preview and
      // this transaction (#740's exact race) must.
      const worktreesAfterRetirement = listWorktrees(repoRoot);
      const checkedOutBranches = new Set(
        worktreesAfterRetirement.map((record) => shortBranch(record.branch)).filter((b): b is string => b !== null)
      );
      for (const entry of branches) {
        if (entry.verdict !== "merged") continue;
        if (checkedOutBranches.has(entry.branch)) {
          entry.retired = false;
          entry.verdict = "protected";
          entry.reason = `Now checked out in a worktree; nothing was touched.`;
          continue;
        }
        // Pinned before the recheck, and that exact commit -- not the branch
        // name -- is what gets verified and then quarantined: resolving the
        // tip a second time after the content check would leave a window
        // where the ref could move in between, verifying one commit and
        // deleting another.
        const expectedTip = tryGit(repoRoot, ["rev-parse", `refs/heads/${entry.branch}^{commit}`])?.trim();
        if (!expectedTip) {
          entry.retired = false;
          entry.reason = `${entry.reason} Skipped: could not resolve its current tip.`;
          continue;
        }
        // The preview-time verdict is not trusted for the delete itself: a
        // fetch, another process's commit, or a rewritten PR record between
        // preview and this transaction must be caught here, not assumed away.
        const recheck = evaluateMerge({ cwd: repoRoot, branch: entry.branch, compareRef: comparisonBase.ref, prMergeCommits, revision: expectedTip });
        if (!recheck.merged) {
          entry.verdict = "unmerged";
          entry.ahead = recheck.ahead;
          entry.mergeProof = null;
          entry.reason = `${recheck.reason}${entry.pushed ? "; a remote copy exists" : "; NO remote copy"}. (Changed since preview.)`;
          continue;
        }
        options.testHooks?.beforeForcedBranchDelete?.(entry.branch, expectedTip);
        try {
          const quarantined = quarantineBranch(repoRoot, entry.branch, runId, expectedTip);
          entry.retired = quarantined !== null;
          entry.quarantineRef = quarantined?.quarantineRef ?? null;
        } catch (error) {
          // One branch's failure must never abort the rest of this run.
          entry.retired = false;
          entry.reason = `${entry.reason} Quarantine failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    }));
    finalizeTidyJournal(repoRoot, runId);
  }

  return createSuccess({
    command: "tidy",
    data: {
      repoRoot,
      baseBranch,
      comparisonRef: comparisonBase.ref,
      fetched: comparisonBase.fetched,
      fetchNote: comparisonBase.fetchError,
      githubVerificationAvailable: prMerges !== null,
      workspaceProtectionAvailable: workspacePath !== null && (options.apply === true || protectionSchemaAvailable),
      applied: options.apply === true,
      worktrees: assessed,
      branches,
      needsAttention: collectAttention(assessed, branches),
      run,
      journalRecovery
    }
  });
}

function assessWorktree(input: {
  record: { path: string; head: string; branch: string | null; locked?: string | null };
  repoRoot: string;
  comparisonBase: ComparisonBase;
  controlWorktree: string;
  here: string;
  prMergeCommits: Map<string, PrMergeRecord>;
  protections: Map<string, WorktreeProtection>;
  liveCwds: Set<string> | null;
  now: Date;
  livenessGraceMs: number;
}): TidyWorktree {
  const { record, comparisonBase, controlWorktree, here, prMergeCommits, protections, liveCwds, now, livenessGraceMs } = input;
  const compareRef = comparisonBase.ref;
  const branch = shortBranch(record.branch);
  const base: Omit<TidyWorktree, "verdict" | "reason"> = {
    path: record.path,
    branch,
    ahead: 0,
    pushed: false,
    uncommitted: [],
    mergeProof: null,
    retired: false
  };

  const presence = probePath(record.path);
  if (presence === "missing") {
    // `git worktree lock` marks the registration, not the directory, so a
    // lock survives even a directory someone deleted by hand -- and still
    // means "leave this alone," including from the quarantine this verdict
    // would otherwise trigger.
    const locked = record.locked ?? null;
    return locked !== null
      ? { ...base, verdict: "protected", reason: locked ? `Worktree is locked: ${locked}.` : "Worktree is locked." }
      : { ...base, verdict: "missing", reason: "Registered worktree whose directory no longer exists." };
  }
  if (presence === "unavailable") {
    return {
      ...base,
      verdict: "unavailable",
      reason: "This path is unreachable right now (possibly an unmounted or disconnected volume), not provably absent; never touched."
    };
  }

  if (samePath(record.path, controlWorktree)) {
    return { ...base, verdict: "protected", reason: "The repository's primary worktree." };
  }
  if (samePath(record.path, here)) {
    return { ...base, verdict: "protected", reason: "You are standing in this worktree." };
  }
  if (branch === comparisonBase.ref.replace(/^origin\//, "")) {
    return { ...base, verdict: "protected", reason: `Holds the base branch.` };
  }
  const protection = protections.get(pathKey(record.path));
  if (protection && !handoffServed(protection, { path: record.path, branch, compareRef, prMergeCommits })) {
    return { ...base, verdict: "protected", reason: protection.reason };
  }

  const liveness = assessWorktreeLiveness({
    path: record.path,
    branch,
    locked: record.locked ?? null,
    liveCwds,
    now,
    graceMs: livenessGraceMs
  });
  if (liveness.live) {
    return { ...base, verdict: "protected", reason: liveness.reason };
  }

  const uncommitted = uncommittedChanges(record.path);
  if (uncommitted.length > 0) {
    return {
      ...base,
      uncommitted,
      verdict: "dirty",
      reason: `${uncommitted.length} uncommitted change${uncommitted.length === 1 ? "" : "s"}; nothing here is touched.`
    };
  }

  if (branch === null) {
    const reachable = isAncestor(record.path, record.head, compareRef);
    return reachable
      ? { ...base, verdict: "detached", mergeProof: "ancestry", reason: "Detached at a commit the base branch already contains." }
      : {
          ...base,
          verdict: "unmerged",
          reason: `Detached at ${record.head.slice(0, 8)}, which the base branch does not contain. Name a branch for it before it can be retired.`
        };
  }

  const merge = evaluateMerge({ cwd: record.path, branch, compareRef, prMergeCommits });
  const pushed = hasUpstream(record.path, branch);

  if (merge.merged) {
    return { ...base, pushed, verdict: "merged", mergeProof: merge.proof, reason: merge.reason };
  }

  const reason = `${merge.reason}${pushed ? "; a remote copy exists" : "; no remote copy exists"}.`;
  return { ...base, ahead: merge.ahead, pushed, verdict: "unmerged", reason };
}

/** Default grace window for {@link assessWorktreeLiveness}: long enough to cover a live agent's own working session. */
export const DEFAULT_WORKTREE_LIVENESS_GRACE_MS = 24 * 60 * 60 * 1000;

/** Whether any live process's cwd is the worktree itself or a directory inside it — an editor or shell open a few levels down still counts. */
function anyCwdInsideWorktree(liveCwds: Set<string>, worktreePath: string): boolean {
  const target = pathKey(worktreePath);
  for (const cwd of liveCwds) {
    if (isInside(cwd, target)) return true;
  }
  return false;
}

/**
 * Whether a worktree shows independent signs of life that no Session lease or
 * go handoff reservation would ever record — because Arcadia never launched
 * it. A Claude Code or Codex desktop session, or any other agent working
 * directly against this repository, only ever shows up through one of these.
 *
 * A branch whose reflog holds only its own creation entry has never been
 * worked on; whether that is still true is read from git's own clock, never
 * this process's, so an injected or skewed `now` can only ever fail toward
 * protecting more, not less. Past the grace window an untouched branch is no
 * longer protected by this signal alone -- it has diverged nothing, so
 * nothing is lost either way -- but a lock or a live process still holds.
 */
function assessWorktreeLiveness(input: {
  path: string;
  branch: string | null;
  locked: string | null;
  liveCwds: Set<string> | null;
  now: Date;
  graceMs: number;
}): { live: true; reason: string } | { live: false } {
  const { path: worktreePath, branch, locked, liveCwds, now, graceMs } = input;

  if (locked !== null) {
    return { live: true, reason: locked ? `Worktree is locked: ${locked}.` : "Worktree is locked." };
  }
  if (liveCwds && anyCwdInsideWorktree(liveCwds, worktreePath)) {
    return { live: true, reason: "A running process has this worktree (or a directory inside it) as its current directory." };
  }
  if (branch !== null) {
    const activity = branchReflogActivity(worktreePath, branch);
    if (!activity.moved) {
      const withinGrace = activity.lastActivityAt === null || now.getTime() - activity.lastActivityAt.getTime() < graceMs;
      if (withinGrace) {
        return { live: true, reason: "Branch has not moved since this worktree was created; treated as possibly still in use." };
      }
    }
  }
  return { live: false };
}

/**
 * Whether a `go` handoff reservation has already done its job.
 *
 * The reservation guards the window between `go` creating a worktree and an
 * agent starting work in it. Inside that window the worktree is clean, its
 * branch sits on the base tip, and no Session exists yet -- indistinguishable
 * from a *finished* handoff on those three signals alone. That is why the
 * reservation is time-based to begin with, and why simply letting tidy retire
 * clean merged worktrees would delete prepared handoffs.
 *
 * The branch's own reflog does separate them, and separates them without
 * consulting a clock. `go` creates the branch with `git worktree add -b`, which
 * writes exactly one entry: `branch: Created from <base>`. A second entry means
 * the ref moved, which only happens when somebody worked here.
 *
 * Reading a timestamp instead was the obvious first attempt and it is wrong: it
 * compares `go`'s reservation clock against git's committer clock, so an
 * injected or skewed clock makes an untouched handoff look finished -- failing
 * in the one direction that destroys work. Every failure mode here goes the
 * other way instead: a pruned, disabled, or unreadable reflog reads as unused
 * and stays protected, as does a handoff whose agent committed nothing.
 */
function handoffServed(protection: WorktreeProtection, input: {
  path: string;
  branch: string | null;
  compareRef: string;
  prMergeCommits: Map<string, PrMergeRecord>;
}): boolean {
  if (protection.kind !== "handoff-reservation") return false;
  if (input.branch === null) return false;
  if (!branchMovedSinceCreation(input.path, input.branch)) return false;
  if (uncommittedChanges(input.path).length > 0) return false;
  return evaluateMerge({
    cwd: input.path,
    branch: input.branch,
    compareRef: input.compareRef,
    prMergeCommits: input.prMergeCommits
  }).merged;
}

function branchMovedSinceCreation(cwd: string, branch: string): boolean {
  const reflog = tryGit(cwd, ["reflog", "show", "--format=%gs", branch]);
  if (reflog === null) return false;
  return reflog.split("\n").filter((entry) => entry.trim() !== "").length > 1;
}

/**
 * The one place `merged` gets decided, for both worktrees and standalone
 * branches, so the two paths cannot reach different verdicts for the same
 * branch depending on which happened to be checked.
 *
 * Ancestry against the fetched base is tried first because it needs no
 * network call beyond the fetch already done once for the whole run. The
 * pull-request check only runs for branches ancestry could not clear, and
 * only when a `gh`-verified merge commit exists for that exact branch name.
 */
export function evaluateMerge(input: {
  cwd: string;
  branch: string;
  compareRef: string;
  prMergeCommits: Map<string, PrMergeRecord>;
  /**
   * The exact commit to check for merged content, when a caller already
   * pinned one under a write interlock rather than trusting a name that could
   * move again between resolving it and reading it here. Defaults to
   * `branch`. `branch` itself is still used for the PR-record lookup and every
   * message, since a pinned tip has no name of its own to report.
   */
  revision?: string;
}): { merged: true; proof: MergeProof; reason: string } | { merged: false; ahead: number; reason: string } {
  const { cwd, branch, compareRef, prMergeCommits } = input;
  const revision = input.revision ?? branch;
  const baseName = compareRef.replace(/^origin\//, "");
  const ahead = countCommits(cwd, compareRef, revision);

  if (ahead === 0 && isAncestor(cwd, revision, compareRef)) {
    return { merged: true, proof: "ancestry", reason: `Every commit on ${branch} is already on ${baseName}.` };
  }

  // Local and free, so it runs before reaching for the network. Catches
  // cherry-picks, rebases, and amended commits, and works with no credentials.
  if (isPatchEquivalent(cwd, compareRef, revision)) {
    return {
      merged: true,
      proof: "patch-equivalent",
      reason: `Every commit on ${branch} already exists on ${baseName} as an equivalent patch (rebased, cherry-picked, or amended).`
    };
  }

  // Checking the branch's own current tip against the PR's recorded head is
  // what makes this proof cover the branch's actual content rather than just
  // its name: without it, a branch pushed to again after its PR merged, or an
  // unrelated branch that later reuses the same name, would inherit a proof
  // that never covered what is there now. `isAncestor` fails closed on its own
  // when `headRefOid` was never fetched into this object store — `git
  // merge-base` cannot resolve it and returns false, exactly the "unmerged"
  // answer a record this repository cannot verify must get.
  const pr = prMergeCommits.get(branch);
  if (pr && isAncestor(cwd, revision, pr.headRefOid) && isAncestor(cwd, pr.sha, compareRef)) {
    return {
      merged: true,
      proof: "pull-request",
      reason: `PR #${pr.number} merged (squash/rebase) — ${pr.sha.slice(0, 8)} is on ${baseName}.`
    };
  }

  return {
    merged: false,
    ahead,
    reason: `${ahead} commit${ahead === 1 ? "" : "s"} on ${branch} not on ${baseName}`
  };
}

function assessBranches(input: {
  repoRoot: string;
  comparisonBase: ComparisonBase;
  claimedByWorktree: Set<string>;
  includeOwn?: boolean;
  prMergeCommits: Map<string, PrMergeRecord>;
}): TidyBranch[] {
  const { repoRoot, comparisonBase, claimedByWorktree, includeOwn, prMergeCommits } = input;
  const compareRef = comparisonBase.ref;
  const baseName = compareRef.replace(/^origin\//, "");

  return git(repoRoot, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((branch) => branch !== baseName)
    // A branch checked out somewhere is that worktree's business; deleting the
    // ref out from under it is how a worktree ends up detached and confusing.
    .filter((branch) => !claimedByWorktree.has(branch) && !claimedByWorktree.has(`refs/heads/${branch}`))
    .map((branch) => {
      const agentOwned = SAFE_TASK_BRANCH.test(branch);
      const pushed = hasUpstream(repoRoot, branch);
      const merge = evaluateMerge({ cwd: repoRoot, branch, compareRef, prMergeCommits });

      if (!merge.merged) {
        return {
          branch,
          verdict: "unmerged" as const,
          ahead: merge.ahead,
          pushed,
          agentOwned,
          mergeProof: null,
          retired: false,
          quarantineRef: null,
          reason: `${merge.reason}${pushed ? "; a remote copy exists" : "; NO remote copy"}.`
        };
      }

      if (!agentOwned && !includeOwn) {
        return {
          branch,
          verdict: "protected" as const,
          ahead: 0,
          pushed,
          agentOwned,
          mergeProof: merge.proof,
          retired: false,
          quarantineRef: null,
          reason: `Fully merged, but not an agent-owned name (${merge.reason.toLowerCase()}). Left alone because --exclude-own-branches was set.`
        };
      }

      return {
        branch,
        verdict: "merged" as const,
        ahead: 0,
        pushed,
        agentOwned,
        mergeProof: merge.proof,
        retired: false,
        quarantineRef: null,
        reason: `${merge.reason} Deleting the ref loses no commit.`
      };
    });
}

function pathKey(value: string): string {
  const resolved = path.resolve(value);
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}

function worktreeProtections(
  db: Database.Database,
  repoRoot: string,
  worktrees: Array<{ path: string }>,
  now: Date = new Date()
): Map<string, WorktreeProtection> {
  const protections = new Map<string, WorktreeProtection>();
  for (const worktree of worktrees) {
    const protection = getWorktreeProtection(db, repoRoot, worktree.path, now);
    if (protection) protections.set(pathKey(worktree.path), protection);
  }
  return protections;
}

export function getWorktreeProtection(
  db: Database.Database,
  repoRoot: string,
  worktreePath: string,
  now: Date = new Date()
): WorktreeProtection | null {
  const lease = getRepositoryLease(db, repoRoot);
  if (lease && pathKey(lease.worktree_path) === pathKey(worktreePath)) {
    return { kind: "session-lease", reason: `Protected by live ${lease.status} Session lease ${lease.id}.` };
  }
  const reservation = getActiveWorktreeReservation(db, repoRoot, worktreePath, now);
  return reservation
    ? {
        kind: "handoff-reservation",
        reason: `Protected by go handoff reservation ${reservation.id} until ${reservation.expires_at}.`
      }
    : null;
}

/**
 * The things that could lose work, stated as instructions rather than statuses.
 *
 * This is the part the operator actually asked for: not a tidier repository,
 * but knowing what is at risk and where the live work is.
 */
function collectAttention(worktrees: TidyWorktree[], branches: TidyBranch[]): string[] {
  const attention: string[] = [];

  for (const entry of worktrees.filter((candidate) => candidate.verdict === "dirty")) {
    attention.push(
      `${entry.path} has ${entry.uncommitted.length} uncommitted change${entry.uncommitted.length === 1 ? "" : "s"}${entry.branch ? ` on ${entry.branch}` : ""}. Commit or preserve them; tidy will never discard them.`
    );
  }

  for (const entry of worktrees.filter((candidate) => candidate.verdict === "unmerged" && !candidate.pushed)) {
    attention.push(
      `${entry.path}${entry.branch ? ` (${entry.branch})` : ""} has ${entry.ahead} unmerged commit${entry.ahead === 1 ? "" : "s"} and no remote copy. This is the only copy.`
    );
  }

  for (const entry of branches.filter((candidate) => candidate.verdict === "unmerged" && !candidate.pushed)) {
    attention.push(
      `Branch ${entry.branch} has ${entry.ahead} unmerged commit${entry.ahead === 1 ? "" : "s"} and no remote copy. This is the only copy.`
    );
  }

  return attention;
}

export function renderTidySuccess(response: CommandSuccess<TidyCommandData>): string[] {
  const {
    repoRoot,
    baseBranch,
    comparisonRef,
    fetched,
    fetchNote,
    githubVerificationAvailable,
    workspaceProtectionAvailable,
    applied,
    worktrees,
    branches,
    needsAttention,
    run,
    journalRecovery
  } = response.data;

  const lines: string[] = [`Arcadia Tidy — ${repoRoot}`];

  if (journalRecovery.rolledForward.length > 0 || journalRecovery.rolledBack.length > 0) {
    lines.push("Recovered from a previous run that did not finish:");
    lines.push(...journalRecovery.rolledForward.map((entry) => `  ✓ finished ${entry}`));
    lines.push(...journalRecovery.rolledBack.map((entry) => `  · never started ${entry} — nothing to undo`));
    lines.push("");
  }

  // Freshness first, unconditionally — every verdict below depends on it, and
  // a stale comparison looks identical to a fresh one unless this is said.
  lines.push(
    fetched
      ? `Base branch: ${baseBranch} (fetched ${comparisonRef} from origin just now)`
      : `Base branch: ${baseBranch} (comparing against the LOCAL branch — ${fetchNote ?? "not fetched"})`
  );
  lines.push(
    workspaceProtectionAvailable
      ? "Workspace protection: on — live Session leases and go handoffs nobody has used yet are protected."
      : "Workspace protection: unavailable — preview only; --apply is refused until a workspace can be checked."
  );
  lines.push(
    githubVerificationAvailable
      ? "GitHub verification: on — a branch whose own commits are not on the base branch is still checked against merged pull requests, so a squash- or rebase-merged branch is not reported as unmerged."
      : "GitHub verification: unavailable (gh CLI missing, unauthenticated, failed, or no usable origin GitHub remote) — a squash- or rebase-merged branch may be reported unmerged even though it landed."
  );
  lines.push("");

  const retirable = [...worktrees.filter(isRetirableWorktree), ...branches.filter((b) => b.verdict === "merged")];

  if (needsAttention.length > 0) {
    lines.push(`Needs your attention (${needsAttention.length}) — nothing below was touched:`);
    lines.push(...needsAttention.map((note) => `  ! ${note}`));
    lines.push("");
  }

  const live = worktrees.filter((entry) => entry.verdict === "dirty" || entry.verdict === "unmerged");
  if (live.length > 0) {
    lines.push("Where the live work is:");
    for (const entry of live) {
      lines.push(`  ${entry.branch ?? "(detached)"} — ${entry.path}`);
      lines.push(`      ${entry.reason}`);
    }
    lines.push("");
  }

  const activelyProtected = worktrees.filter((entry) =>
    entry.verdict === "protected" && (entry.reason.includes("Session lease") || entry.reason.includes("handoff reservation"))
  );
  if (activelyProtected.length > 0) {
    lines.push("Protected active work:");
    for (const entry of activelyProtected) {
      lines.push(`  ${entry.branch ?? "(detached)"} — ${entry.path}`);
      lines.push(`      ${entry.reason}`);
    }
    lines.push("");
  }

  lines.push(applied ? `Retired (${retirable.length}):` : `Would retire (${retirable.length}):`);
  if (retirable.length === 0) {
    lines.push("  Nothing. Every worktree and branch either holds work or is protected.");
  } else {
    for (const entry of worktrees.filter(isRetirableWorktree)) {
      const mark = applied ? (entry.retired ? "✓" : "✗ failed") : "-";
      lines.push(`  ${mark} worktree ${entry.path}${entry.branch ? ` [${entry.branch}]` : ""}`);
      lines.push(`      ${entry.reason}`);
    }
    for (const entry of branches.filter((candidate) => candidate.verdict === "merged")) {
      const mark = applied ? (entry.retired ? "✓" : "✗ failed") : "-";
      lines.push(`  ${mark} branch   ${entry.branch}`);
      lines.push(`      ${entry.reason}`);
    }
  }

  const protectedBranches = branches.filter((entry) => entry.verdict === "protected");
  if (protectedBranches.length > 0) {
    lines.push("");
    lines.push(`Protected branches (${protectedBranches.length}) — never touched:`);
    lines.push(...protectedBranches.map((entry) => `  · ${entry.branch} — ${entry.reason}`));
  }

  const unmergedBranches = branches.filter((entry) => entry.verdict === "unmerged");
  if (unmergedBranches.length > 0) {
    lines.push("");
    lines.push(`Unmerged branches (${unmergedBranches.length}) — never touched by tidy:`);
    for (const entry of unmergedBranches) {
      lines.push(`  · ${entry.branch} — ${entry.reason}`);
    }
  }

  lines.push("");
  if (applied && run) {
    lines.push(`Nothing was deleted: everything above is quarantined under run ${run}.`);
    lines.push(`Undo this run entirely with: arcadia tidy undo ${run}`);
    lines.push(`List quarantined runs with: arcadia tidy list`);
  } else {
    lines.push(
      applied
        ? "Nothing was removed whose commits were not already on the base branch."
        : "Nothing was changed. Re-run with --apply to retire the items listed above."
    );
  }

  return lines;
}

function isRetirableWorktree(entry: TidyWorktree): boolean {
  return entry.verdict === "merged" || entry.verdict === "missing" || entry.verdict === "detached";
}

export interface TidyUndoCommandData extends TidyUndoResult {
  repoRoot: string;
}

export interface TidyUndoCommandOptions {
  repo?: string;
  run: string;
}

/** Restore every branch and worktree one `tidy --apply` run quarantined, exactly to where they were. */
export function runTidyUndoCommand(options: TidyUndoCommandOptions): CommandSuccess<TidyUndoCommandData> {
  const repoRoot = existingDirectory(options.repo ?? invocationRoot(), "repository");
  const result = undoTidyRun(repoRoot, options.run);
  return createSuccess({ command: "tidy.undo", data: { repoRoot, ...result } });
}

export function renderTidyUndoSuccess(response: CommandSuccess<TidyUndoCommandData>): string[] {
  const { repoRoot, run, branchesRestored, branchesFailed, worktreesRestored, worktreesFailed } = response.data;
  const lines = [`Arcadia Tidy Undo — ${repoRoot}`, `Run: ${run}`, ""];

  lines.push(`Branches restored (${branchesRestored.length}):`);
  lines.push(...(branchesRestored.length ? branchesRestored.map((branch) => `  ✓ ${branch}`) : ["  none"]));
  if (branchesFailed.length > 0) {
    lines.push(`Branches NOT restored (${branchesFailed.length}) — already present, or their quarantined ref moved:`);
    lines.push(...branchesFailed.map((branch) => `  ✗ ${branch}`));
  }
  lines.push("");
  lines.push(`Worktrees restored (${worktreesRestored.length}):`);
  lines.push(...(worktreesRestored.length ? worktreesRestored.map((entry) => `  ✓ ${entry}`) : ["  none"]));
  if (worktreesFailed.length > 0) {
    lines.push(`Worktrees NOT restored (${worktreesFailed.length}) — their original path is occupied, or their quarantine directory is missing:`);
    lines.push(...worktreesFailed.map((entry) => `  ✗ ${entry}`));
  }

  return lines;
}

export interface TidyListCommandData {
  repoRoot: string;
  runs: TidyQuarantineManifest[];
}

/** Every quarantine run still recoverable for this repository, newest first. */
export function runTidyListCommand(options: { repo?: string } = {}): CommandSuccess<TidyListCommandData> {
  const repoRoot = existingDirectory(options.repo ?? invocationRoot(), "repository");
  return createSuccess({ command: "tidy.list", data: { repoRoot, runs: listTidyRuns(repoRoot) } });
}

export function renderTidyListSuccess(response: CommandSuccess<TidyListCommandData>): string[] {
  const { repoRoot, runs } = response.data;
  if (runs.length === 0) return [`Arcadia Tidy List — ${repoRoot}`, "No quarantined tidy runs."];

  const lines = [`Arcadia Tidy List — ${repoRoot}`, `Quarantined runs (${runs.length}), newest first:`, ""];
  for (const manifest of runs) {
    lines.push(`${manifest.run} — ${manifest.createdAt} — ${manifest.branches.length} branch(es), ${manifest.worktrees.length} worktree(s)`);
    for (const branch of manifest.branches) lines.push(`    branch   ${branch.branch}`);
    for (const worktree of manifest.worktrees) lines.push(`    worktree ${worktree.worktreePath}${worktree.branch ? ` [${worktree.branch}]` : ""}`);
  }
  lines.push("");
  lines.push("Restore a run with: arcadia tidy undo <run>");
  return lines;
}
