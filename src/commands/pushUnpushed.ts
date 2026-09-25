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
export type PushUnpushedOutcome = "pushed" | "would-push" | "already-pushed" | "failed";

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
 * Delegates the entire "what is at risk" question to `runTidyCommand` rather
 * than re-deriving it: tidy already resolves the base branch, fetches origin,
 * checks GitHub-verified merges, and screens out dirty/protected/merged
 * entries. Recomputing any of that here would risk the two commands
 * disagreeing about which branches are actually at risk.
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
    if (entry.verdict !== "unmerged" || entry.pushed || entry.branch === null) continue;
    items.push(pushOne({ repoRoot, remote, apply, kind: "worktree", branch: entry.branch, path: entry.path, ahead: entry.ahead }));
  }

  for (const entry of branches) {
    if (entry.verdict !== "unmerged" || entry.pushed) continue;
    items.push(pushOne({ repoRoot, remote, apply, kind: "branch", branch: entry.branch, path: null, ahead: entry.ahead }));
  }

  return createSuccess({
    command: "push-unpushed",
    data: { repoRoot, remote, applied: apply, items }
  });
}

function pushOne(input: {
  repoRoot: string;
  remote: string;
  apply: boolean;
  kind: "worktree" | "branch";
  branch: string;
  path: string | null;
  ahead: number;
}): PushUnpushedItem {
  const { repoRoot, remote, apply, kind, branch, path, ahead } = input;

  if (!apply) {
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
  const result = spawnSync("git", ["push", "--porcelain", "-u", remote, `refs/heads/${branch}:refs/heads/${branch}`], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.status === 0) {
    return {
      kind, branch, path, ahead,
      outcome: "pushed",
      detail: `Pushed ${branch} to ${remote}/${branch} and set it as upstream.`
    };
  }

  const stderr = (result.stderr || "").trim().split("\n").filter(Boolean).pop() ?? "git push failed with no output";
  return {
    kind, branch, path, ahead,
    outcome: "failed",
    detail: stderr
  };
}

export function renderPushUnpushedSuccess(response: CommandSuccess<PushUnpushedCommandData>): string[] {
  const { repoRoot, remote, applied, items } = response.data;
  const lines: string[] = [`Arcadia Push Unpushed — ${repoRoot}`, `Remote: ${remote}`, ""];

  if (items.length === 0) {
    lines.push("Nothing to push. Every worktree and branch tidy would report is either merged, dirty, protected, or already has a remote copy.");
    return lines;
  }

  lines.push(applied ? `Pushed (${items.length}):` : `Would push (${items.length}) — re-run with --apply to actually push:`);
  for (const item of items) {
    const mark = !applied ? "-" : item.outcome === "pushed" ? "✓" : "✗ failed";
    const location = item.kind === "worktree" ? `${item.path} [${item.branch}]` : `branch ${item.branch}`;
    lines.push(`  ${mark} ${location}`);
    lines.push(`      ${item.detail}`);
  }

  const failed = items.filter((item) => item.outcome === "failed");
  lines.push("");
  lines.push(
    applied
      ? failed.length === 0
        ? "Every branch above now has a remote copy. Re-run `arcadia tidy` to confirm nothing is flagged as at-risk."
        : `${failed.length} of ${items.length} failed to push — nothing local was changed for those; see the reason above and resolve it before retrying.`
      : "Nothing was changed. Re-run with --apply to push the branches listed above."
  );

  return lines;
}
