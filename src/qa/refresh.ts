import { spawnSync } from "node:child_process";
import { tryGit } from "../git/worktrees.js";
import {
  freshnessSummary,
  qaProject,
  repoFreshness,
  serviceScriptPath,
  type QaProjectConfig,
  type RepoFreshness
} from "./targets.js";

/**
 * Bring a project's checkout to its base branch, then restart its services.
 *
 * The safety contract is `arcadia go`'s, applied to a service instead of a
 * worktree: fetch, fast-forward only, and refuse anything else. It never
 * merges, rebases, resets, stashes, or discards. A refresh that could lose
 * work is not a refresh — it is a thing you have to check after, which defeats
 * the point of a one-button answer.
 *
 * Restart is delegated, never reimplemented. The project ships
 * `scripts/services.sh` (see docs/service-contract.md); Arcadia's only job is
 * making sure the tree that script restarts from is the one you think it is.
 */

export type RefusalReason =
  | "unknown-project"
  | "no-repo"
  | "dirty"
  | "detached"
  | "wrong-branch"
  | "diverged"
  | "fetch-failed"
  | "fast-forward-failed"
  | "restart-failed";

export interface RefreshResult {
  project: string;
  before: RepoFreshness | null;
  after: RepoFreshness | null;
  fetched: boolean;
  /** True only when HEAD actually moved. */
  advanced: boolean;
  restarted: boolean;
  output: string | null;
  refused: RefusalReason | null;
  message: string;
}

export interface RefreshOptions {
  workspacePath?: string;
  /** Bring the checkout current but leave services alone. */
  skipRestart?: boolean;
}

export function refreshProject(slug: string, options: RefreshOptions = {}): RefreshResult {
  const project = qaProject(slug, options.workspacePath);
  if (!project) {
    return refusal(slug, "unknown-project", `No project \`${slug}\` in the QA target configuration.`, null);
  }

  const before = repoFreshness(project);
  if (before.error && !before.head) {
    return refusal(slug, "no-repo", before.error, before);
  }

  // Dirty first, before the fetch, because it is the one state where the
  // operator certainly has something to lose and should hear about it before
  // anything has happened at all.
  if (before.dirty) {
    return refusal(
      slug,
      "dirty",
      `${slug} has uncommitted changes. Refusing to touch it — commit or set them aside first.`,
      before
    );
  }

  const branch = tryGit(project.repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch || branch === "HEAD") {
    return refusal(slug, "detached", `${slug} is in detached HEAD. Check out ${project.baseBranch} first.`, before);
  }
  if (branch !== project.baseBranch) {
    return refusal(
      slug,
      "wrong-branch",
      `${slug} is on \`${branch}\`, not \`${project.baseBranch}\`. Refresh brings the base branch current; switching branches is yours to decide.`,
      before
    );
  }

  // `tryGit` returns "" on a quiet success and null on failure, so a non-null
  // result is the success case even though it is empty.
  if (tryGit(project.repoPath, ["fetch", "origin", project.baseBranch, "--quiet"]) === null) {
    return refusal(slug, "fetch-failed", `Could not fetch origin/${project.baseBranch}.`, before);
  }

  const fetched = repoFreshness(project);
  if (fetched.ahead && fetched.ahead > 0) {
    return {
      ...refusal(
        slug,
        "diverged",
        `${slug} has ${fetched.ahead} commit(s) origin/${project.baseBranch} does not. Fast-forward is not possible; push or reconcile first.`,
        before
      ),
      after: fetched,
      fetched: true
    };
  }

  let advanced = false;
  if (fetched.behind && fetched.behind > 0) {
    if (tryGit(project.repoPath, ["merge", "--ff-only", `origin/${project.baseBranch}`]) === null) {
      return {
        ...refusal(slug, "fast-forward-failed", `Fast-forward to origin/${project.baseBranch} failed.`, before),
        after: fetched,
        fetched: true
      };
    }
    advanced = true;
  }

  const after = repoFreshness(project);
  const script = serviceScriptPath(project);

  if (options.skipRestart || !script) {
    const why = options.skipRestart
      ? "Restart skipped."
      : `No ${project.serviceScript ?? "scripts/services.sh"} in ${slug}, so services were left alone. See docs/service-contract.md.`;
    return {
      project: slug,
      before,
      after,
      fetched: true,
      advanced,
      restarted: false,
      output: null,
      refused: null,
      message: `${advanced ? `Advanced to ${after.head}.` : "Already current."} ${why}`
    };
  }

  const restart = runService(project, script, "restart");
  if (!restart.ok) {
    return {
      ...refusal(
        slug,
        "restart-failed",
        `Checkout is current, but the restart failed: ${restart.output.trim() || "no output"}`,
        before
      ),
      after,
      fetched: true,
      advanced,
      output: restart.output
    };
  }

  return {
    project: slug,
    before,
    after,
    fetched: true,
    advanced,
    restarted: true,
    output: restart.output,
    refused: null,
    message: `${advanced ? `Advanced to ${after.head}` : "Already current"} · services restarted · ${freshnessSummary(after)}`
  };
}

/** Runs a project's `status` verb. Changes nothing. */
export function serviceStatus(slug: string, workspacePath?: string): { ok: boolean; output: string } | null {
  const project = qaProject(slug, workspacePath);
  if (!project) return null;
  const script = serviceScriptPath(project);
  return script ? runService(project, script, "status") : null;
}

/**
 * Never through a shell, and never with an interpolated argument. The script
 * path comes from the project's own repository and the verb is one of three
 * literals, so there is nothing here a config file could turn into a command.
 */
function runService(
  project: QaProjectConfig,
  script: string,
  action: "status" | "restart" | "stop"
): { ok: boolean; output: string } {
  const result = spawnSync(script, [action], {
    cwd: project.repoPath,
    encoding: "utf8",
    timeout: 180_000
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function refusal(
  project: string,
  refused: RefusalReason,
  message: string,
  before: RepoFreshness | null
): RefreshResult {
  return {
    project,
    before,
    after: null,
    fetched: false,
    advanced: false,
    restarted: false,
    output: null,
    refused,
    message
  };
}
