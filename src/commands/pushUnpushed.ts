import { spawnSync } from "node:child_process";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { runTidyCommand } from "./tidy.js";

/**
 * The one thing `arcadia tidy` finds but will never fix itself: a worktree or
 * standalone branch that is clean, unmerged, and has no remote copy at all —
 * "this is the only copy" in tidy's own report. Tidy is right to never touch
 * these; deciding what a half-finished branch *means* is not tidy's job. But
 * leaving the finding as prose nobody acts on is how a copy stays the only
 * copy until a worktree gets pruned out from under it. This command closes
 * that gap with the one move that is always safe regardless of what the
 * branch turns out to be worth: publish it, so losing the local checkout can
 * never lose the commits.
 *
 * The safety property is a single sentence, the same shape as tidy's own:
 * this command only ever adds a ref. It never forces, never deletes, and
 * never touches anything tidy did not already classify as unmerged-and-only-copy.
 * A plain `git push <remote> <branch>` refuses on any non-fast-forward, so even
 * a same-named branch already diverging on the remote — the one case tidy's own
 * `pushed` check cannot see, since it only asks whether a *local* upstream is
 * configured — fails loudly instead of silently overwriting anything.
 */
export type PushUnpushedOutcome = "pushed" | "pushed-untracked" | "would-push" | "failed";

export interface PushUnpushedItem {
  kind: "worktree" | "branch";
  branch: string;
  /** The worktree path, when this item came from a worktree entry; null for a standalone branch. */
  path: string | null;
  ahead: number;
  outcome: PushUnpushedOutcome;
  detail: string;
}

export interface PushUnpushedCommandData {
  repoRoot: string;
  remote: string;
  applied: boolean;
  items: PushUnpushedItem[];
}

export interface PushUnpushedCommandOptions {
  repo?: string;
  workspace?: string;
  /** Without this nothing is pushed, whatever is found. */
  apply?: boolean;
  /** Defaults to "origin", matching every other remote-facing command in this repository. */
  remote?: string;
  noFetch?: boolean;
  noGithub?: boolean;
}

/**
 * Find every unmerged worktree branch and standalone branch that tidy reports
 * has no remote copy, and push each one — additively, never forced — so it
 * stops being the only copy.
 *
 * Delegates the "what is at risk" question to `runTidyCommand` rather than
 * re-deriving it: tidy already resolves the base branch, fetches origin,
 * checks GitHub-verified merges, and screens out dirty/protected/merged
 * entries. Recomputing any of that here would risk the two commands
 * disagreeing about which branches are actually at risk.
 *
 * The one thing not taken from tidy as-is is "already pushed": tidy's own
 * `pushed` field means *some* upstream is configured, regardless of remote,
 * because tidy has no `--remote` option of its own to be precise about, and
 * it says nothing about whether *later* local commits ever followed that
 * push. Neither a configured-upstream check nor a hand-rolled `ls-remote`
 * comparison is fully trustworthy here either — `ls-remote <remote>` resolves
 * the remote's *fetch* URL, which can differ from its configured *push* URL.
 * `pushOne` instead asks git's own push machinery directly, via
 * `git push --dry-run`: that is the one thing that necessarily resolves the
 * same destination and the same ref-update rules a real push would use,
 * whatever the remote's URL configuration turns out to be.
 */
export function runPushUnpushedCommand(options: PushUnpushedCommandOptions = {}): CommandSuccess<PushUnpushedCommandData> {
  const remote = options.remote?.trim() || "origin";
  const apply = options.apply === true;

  const tidy = runTidyCommand({
    repo: options.repo,
    workspace: options.workspace,
    noFetch: options.noFetch,
    noGithub: options.noGithub
  });
  const { repoRoot, worktrees, branches } = tidy.data;

  const items: PushUnpushedItem[] = [];

  for (const entry of worktrees) {
    if (entry.verdict !== "unmerged" || entry.branch === null) continue;
    const item = pushOne({ repoRoot, remote, apply, kind: "worktree", branch: entry.branch, path: entry.path, ahead: entry.ahead });
    if (item) items.push(item);
  }

  for (const entry of branches) {
    if (entry.verdict !== "unmerged") continue;
    const item = pushOne({ repoRoot, remote, apply, kind: "branch", branch: entry.branch, path: null, ahead: entry.ahead });
    if (item) items.push(item);
  }

  return createSuccess({
    command: "push-unpushed",
    data: { repoRoot, remote, applied: apply, items }
  });
}

/**
 * Push one branch, or determine that nothing needs to happen — returning
 * `null` in that case rather than an item, so a branch that turns out to
 * already be current at the selected remote is left out of the report
 * entirely, the same as it would be if tidy had never flagged it.
 */
function pushOne(input: {
  repoRoot: string;
  remote: string;
  apply: boolean;
  kind: "worktree" | "branch";
  branch: string;
  path: string | null;
  ahead: number;
}): PushUnpushedItem | null {
  const { repoRoot, remote, apply, kind, branch, path, ahead } = input;
  const refspec = `refs/heads/${branch}:refs/heads/${branch}`;

  if (!apply) {
    // A dry run asks git's own push machinery whether anything would actually
    // change, which is the only way to correctly account for a configured
    // push URL that differs from the fetch URL a hand-rolled `ls-remote`
    // check would see. Nothing is written by `--dry-run`.
    const preview = spawnSync("git", ["push", "--dry-run", "--porcelain", remote, refspec], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (preview.status !== 0) {
      const stderr = (preview.stderr || "").trim().split("\n").filter(Boolean).pop() ?? "git push --dry-run failed with no output";
      return { kind, branch, path, ahead, outcome: "failed", detail: stderr };
    }
    if (pushPorcelainFlag(preview.stdout, refspec) === "=") {
      return null; // the selected remote already has exactly this tip
    }
    return {
      kind, branch, path, ahead,
      outcome: "would-push",
      detail: `Would push ${branch} to ${remote} and set it as upstream (${ahead} commit${ahead === 1 ? "" : "s"}).`
    };
  }

  // Run from the shared repository root, never from a worktree path: refs/heads
  // is common across every worktree of one repository, so this reaches the
  // branch regardless of which worktree — or none — currently has it checked
  // out. No `--force` anywhere in this call: a plain push can only fast-forward
  // the remote ref, so the worst case is a clean refusal, never lost history.
  const result = spawnSync("git", ["push", "--porcelain", "-u", remote, refspec], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim().split("\n").filter(Boolean).pop() ?? "git push failed with no output";
    return { kind, branch, path, ahead, outcome: "failed", detail: stderr };
  }

  if (pushPorcelainFlag(result.stdout, refspec) === "=") {
    return null; // was already current at the selected remote; nothing changed
  }

  // `git push -u` can exit 0 while the ref lands on the remote but the local
  // upstream-tracking config write fails — observed in exactly this
  // repository, whose agent worktrees intentionally sandbox-protect
  // `.git/config` (see candidatePreservation.ts). Trusting the exit code alone
  // reports success for the one property tidy actually checks (`branch@{upstream}`)
  // that in fact never landed, so the branch would still show as "no remote
  // copy" — the exact false positive this command exists to close. Verifying
  // the real state, not the exit code, is what makes the report trustworthy.
  if (upstreamMatches(repoRoot, branch, remote)) {
    return {
      kind, branch, path, ahead,
      outcome: "pushed",
      detail: `Pushed ${branch} to ${remote}/${branch} and set it as upstream.`
    };
  }

  // One explicit retry: the push's own attempt can lose a lock race with
  // another process touching the same shared config, and a plain config write
  // has a real chance of succeeding even when the combined push+config-write
  // did not.
  spawnSync("git", ["branch", "--set-upstream-to", `${remote}/${branch}`, branch], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"]
  });

  if (upstreamMatches(repoRoot, branch, remote)) {
    return {
      kind, branch, path, ahead,
      outcome: "pushed",
      detail: `Pushed ${branch} to ${remote}/${branch} and set it as upstream.`
    };
  }

  return {
    kind, branch, path, ahead,
    outcome: "pushed-untracked",
    detail:
      `Pushed ${branch} to ${remote}/${branch} — the commits are safe on the remote — ` +
      `but could not record local upstream tracking (commonly a sandbox-protected .git/config). ` +
      `\`arcadia tidy\` will still list this until tracking is set; run ` +
      `\`git branch --set-upstream-to=${remote}/${branch} ${branch}\` outside the sandbox to clear it.`
  };
}

function upstreamMatches(repoRoot: string, branch: string, remote: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--abbrev-ref", `${branch}@{upstream}`], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  return result.status === 0 && result.stdout.trim() === `${remote}/${branch}`;
}

/**
 * The per-ref status for a given refspec from `git push --porcelain` output —
 * `"="` only when *every* line reporting on this refspec says "already up to
 * date". A remote with more than one configured push URL (mirrors, a
 * multi-destination push) emits one status line per destination; picking just
 * the first would report the whole push as a no-op even when a later
 * destination still needed the update — git itself still updates every
 * destination regardless, so this only affects what gets reported, not what
 * gets pushed, but it must not be allowed to hide a real destination that was
 * behind. Returns `undefined`, never `"="`, when no line matches at all: an
 * empty result is not evidence of being current, only of finding nothing.
 *
 * The line format is `<flag><TAB><from>:<to><TAB><summary>`, so the flag is
 * each line's first character, not a trimmed token — a fast-forward's flag is
 * a literal space.
 */
function pushPorcelainFlag(stdout: string, refspec: string): string | undefined {
  const lines = stdout.split("\n").filter((candidate) => candidate.includes(refspec));
  if (lines.length === 0) return undefined;
  // Not just "the first line's flag" when destinations disagree: with two
  // destinations reported as ["=", "*"], `lines[0]` is itself "=" — returning
  // it here would reproduce the exact bug this rewrite exists to fix. Any
  // non-"=" line means at least one destination needs the push.
  const notYetCurrent = lines.find((line) => line.charAt(0) !== "=");
  return notYetCurrent ? notYetCurrent.charAt(0) : "=";
}

export function renderPushUnpushedSuccess(response: CommandSuccess<PushUnpushedCommandData>): string[] {
  const { repoRoot, remote, applied, items } = response.data;
  const lines: string[] = [`Arcadia Push Unpushed — ${repoRoot}`, `Remote: ${remote}`, ""];

  if (items.length === 0) {
    lines.push("Nothing to push. Every worktree and branch tidy would report is either merged, dirty, protected, or already has a remote copy.");
    return lines;
  }

  const failedCount = items.filter((item) => item.outcome === "failed").length;
  const heading =
    failedCount === 0
      ? (applied ? `Pushed (${items.length}):` : `Would push (${items.length}) — re-run with --apply to actually push:`)
      : (applied
          ? `${items.length - failedCount} pushed, ${failedCount} failed:`
          : `${items.length - failedCount} would push, ${failedCount} could not be checked:`);
  lines.push(heading);
  for (const item of items) {
    // Outcome-driven, not applied-driven: a preview can itself fail (the dry
    // run couldn't reach the remote), and that must not be marked the same as
    // an ordinary unpushed candidate.
    const mark =
      item.outcome === "pushed" ? "✓" :
      item.outcome === "pushed-untracked" ? "≈ untracked" :
      item.outcome === "failed" ? "✗ failed" : "-";
    const location = item.kind === "worktree" ? `${item.path} [${item.branch}]` : `branch ${item.branch}`;
    lines.push(`  ${mark} ${location}`);
    lines.push(`      ${item.detail}`);
  }

  const untracked = items.filter((item) => item.outcome === "pushed-untracked");
  lines.push("");
  if (failedCount > 0) {
    lines.push(
      applied
        ? `${failedCount} of ${items.length} failed to push — nothing local was changed for those; see the reason above and resolve it before retrying.`
        : `${failedCount} of ${items.length} could not even be checked against the remote — see the reason above; nothing was changed.`
    );
  } else if (!applied) {
    lines.push("Nothing was changed. Re-run with --apply to push the branches listed above.");
  } else if (untracked.length > 0) {
    lines.push(`Every branch's commits are safe on the remote, but ${untracked.length} of ${items.length} could not record local upstream tracking — see the fix-up command above for each.`);
  } else {
    lines.push("Every branch above now has a remote copy. Re-run `arcadia tidy` to confirm nothing is flagged as at-risk.");
  }

  return lines;
}
