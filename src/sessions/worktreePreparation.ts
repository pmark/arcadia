import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { git, tryGit } from "../git/worktrees.js";
import { resolveMiseExecutable } from "../runtime/mise.js";

export interface PreparedAgentWorktree {
  agent: "codex" | "claude" | "opencode";
  path: string;
  branch: string;
  model: string;
  effort: string | null;
  command: string;
}

/** Each Session agent prepares its candidate under its own provider directory. */
const AGENT_WORKTREE_DIRECTORY: Record<PreparedAgentWorktree["agent"], string> = {
  codex: ".codex/worktrees",
  claude: ".claude/worktrees",
  opencode: ".opencode/worktrees"
};

/** The default candidate root for one agent: `<home>/<agent worktree directory>`. */
export function defaultAgentWorktreeRoot(agent: PreparedAgentWorktree["agent"]): string {
  return path.join(homedir(), AGENT_WORKTREE_DIRECTORY[agent]);
}

/**
 * Creates only the isolated candidate branch/worktree. Reconciliation belongs
 * to `arcadia go`; launch callers reuse this narrow primitive so preparation
 * can never accidentally integrate or retire earlier work.
 */
export function prepareAgentWorktree(input: {
  agent: "codex" | "claude" | "opencode";
  actionId: string;
  baseBranch: string;
  repositoryPath: string;
  rootOverride?: string;
  now: Date;
  model: string;
  effort: string | null;
  beforeCreate?: (candidate: PreparedAgentWorktree) => void;
}): PreparedAgentWorktree {
  const stamp = input.now.toISOString().replaceAll(/[-:.]/g, "").replace(/Z$/, "Z");
  const safeAction = input.actionId.replaceAll(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 72);
  const name = `${safeAction}-${stamp}`;
  const branch = `${input.agent}/${name}`;
  const repositoryName = path.basename(input.repositoryPath);
  const defaultRoot = defaultAgentWorktreeRoot(input.agent);
  const root = path.resolve(input.rootOverride ?? defaultRoot);
  const worktreePath = path.join(root, name, repositoryName);
  if (existsSync(worktreePath)) {
    throw validationError("The prepared agent worktree path already exists.", { worktreePath });
  }
  const candidate: PreparedAgentWorktree = {
    agent: input.agent,
    path: worktreePath,
    branch,
    model: input.model,
    effort: input.effort,
    command: buildAgentLaunchCommand(input.agent, worktreePath, input.model, input.effort)
  };
  input.beforeCreate?.(candidate);
  mkdirSync(path.dirname(worktreePath), { recursive: true });
  git(input.repositoryPath, ["-c", "core.hooksPath=/dev/null", "worktree", "add", "-b", branch, worktreePath, input.baseBranch]);
  try {
    trustMiseConfig(input.repositoryPath, worktreePath);
  } catch (error) {
    // `worktree remove` does not delete the branch `worktree add -b` just
    // created; left behind, a retry with the same `input.now` (the stamp
    // that names both) fails at `git worktree add -b` on a branch that
    // already exists, masking the real cause behind an unrelated Git error.
    // Report a cleanup failure alongside the original one instead of
    // recommending a plain retry over state that is still sitting there.
    const worktreeRemoved = tryGit(input.repositoryPath, ["-c", "core.hooksPath=/dev/null", "worktree", "remove", "--force", worktreePath]) !== null;
    const branchRemoved = tryGit(input.repositoryPath, ["-c", "core.hooksPath=/dev/null", "branch", "-D", branch]) !== null;
    if (!worktreeRemoved || !branchRemoved) {
      const original = error as { message?: string; details?: Record<string, unknown> };
      throw validationError("Could not pre-trust the prepared worktree's mise.toml, and cleanup after that failure did not fully complete.", {
        ...(original.details ?? {}),
        originalError: original.message ?? String(error),
        worktreePath,
        branch,
        worktreeRemoved,
        branchRemoved,
        remedy: `${worktreeRemoved ? "" : `Remove the leftover worktree at ${worktreePath} `}` +
          `${branchRemoved ? "" : `${worktreeRemoved ? "Remove" : "and remove"} the leftover branch ${branch} `}` +
          "by hand, resolve the original mise trust failure above, then retry preparation."
      });
    }
    throw error;
  }
  return candidate;
}

/**
 * A `mise` executable for trusting a worktree's config, preferring the fixed
 * launch-agent path (`resolveMiseExecutable`) but falling back to `PATH` --
 * unlike that function's other callers, this one runs synchronously inside an
 * interactive or agent-driven process that inherits a real shell `PATH`, not
 * a launchd plist with none, so a `mise` installed outside the fixed
 * candidates (a Linux package at `/usr/bin/mise`, a cargo install) is still
 * found instead of silently skipping pre-trust.
 */
function resolveMiseForTrust(): string | null {
  const fixed = resolveMiseExecutable();
  if (existsSync(fixed)) return fixed;
  const located = spawnSync("which", ["mise"], { encoding: "utf8" });
  const fromPath = located.status === 0 ? located.stdout.trim() : "";
  return fromPath && existsSync(fromPath) ? fromPath : null;
}

/**
 * Pre-trusts the new worktree's `mise.toml` from the host side, where this
 * function always runs (see `prepareAgentWorktree`'s callers). Left untrusted,
 * the agent's own sandbox hits it first: mise's on-first-use trust write goes
 * to `~/.local/state/mise/trusted-configs/`, outside every coding-agent
 * sandbox's writable paths, so the very first mise-wrapped command in a fresh
 * worktree fails with "Operation not permitted" before any real work starts.
 * A missing `mise.toml` or a missing `mise` binary is not this worktree's
 * problem to solve -- those leave it exactly as `git worktree add` produced
 * it. A `mise trust` call that actually runs and fails is different: it means
 * the same first-use sandbox failure this function exists to prevent is
 * still ahead of the agent, so it is surfaced here, host-side, where there is
 * still a chance to repair it, instead of appearing later as an
 * unattributed sandbox error the agent has no path back to this cause from.
 */
function trustMiseConfig(repositoryPath: string, worktreePath: string): void {
  const miseConfig = path.join(worktreePath, "mise.toml");
  if (!existsSync(miseConfig)) return;
  const miseBin = resolveMiseForTrust();
  if (!miseBin) return;
  const result = spawnSync(miseBin, ["trust", "--yes", miseConfig], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    // The caller removes `worktreePath` on this throw, so `miseConfig` will
    // not exist by the time anyone reads this message -- point at the
    // failure and the retry, not at a file that is already gone.
    throw validationError("Could not pre-trust the prepared worktree's mise.toml.", {
      repositoryPath,
      worktreePath,
      miseBin,
      cause: result.error?.message ?? result.stderr?.trim() ?? `mise trust exited ${result.status}`,
      remedy: "Resolve the reported mise trust failure (check the mise installation and its permissions " +
        "on ~/.local/state/mise/trusted-configs/), then retry worktree preparation."
    });
  }
}

const CLAUDE_MODEL_ALIASES = new Set(["sonnet", "opus", "haiku", "fable"]);

/**
 * A plan's `recommended_model` is free-form, provider-agnostic text (see
 * `PlanDoc.recommendedModel`), so a plan written with a Codex model in mind
 * (e.g. `gpt-6-astra`) can end up as the automatic recommendation for a
 * Claude handoff too, with nothing downstream to catch the mismatch before it
 * reaches `claude --model`. This is a coarse sanity check, not a real Claude
 * model registry — it only rules out an obvious wrong-provider value when
 * Arcadia is choosing the model on the operator's behalf. An explicit
 * `--model` is trusted as-is, same as everywhere else this field is used.
 */
export function isPlausibleClaudeModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.startsWith("claude-") || CLAUDE_MODEL_ALIASES.has(normalized);
}

export function buildAgentLaunchCommand(agent: "codex" | "claude" | "opencode", worktreePath: string, model: string, effort: string | null): string {
  const quotedPath = JSON.stringify(worktreePath);
  const quotedModel = JSON.stringify(model);
  if (agent === "claude") {
    const effortFlag = effort ? ` --effort ${JSON.stringify(effort)}` : "";
    return `cd ${quotedPath} && claude --model ${quotedModel}${effortFlag} "arcadia advance"`;
  }
  if (agent === "opencode") {
    const variant = opencodeVariant(effort);
    const variantFlag = variant ? ` --variant ${JSON.stringify(variant)}` : "";
    return `cd ${quotedPath} && opencode run --model ${quotedModel}${variantFlag} "arcadia advance"`;
  }
  const effortFlag = effort ? ` -c model_reasoning_effort=${JSON.stringify(effort)}` : "";
  return `codex -c default_permissions="arcadia-unattended" --ask-for-approval never -C ${quotedPath} -m ${quotedModel}${effortFlag} "arcadia advance"`;
}

/**
 * A reasoning effort as opencode's provider-specific `--variant` value for the
 * pinned `opencode-go/deepseek-v4.1-flash` binding, whose reasoning options are
 * `low`/`high`/`max`. Both the Arcadia effort key and a stored provider-native
 * value are accepted; `e1_brief` clamps up to `low` because the provider has no
 * lower step, and anything unrecognized omits the flag rather than passing an
 * unsupported value.
 */
export function opencodeVariant(effort: string | null): string | null {
  if (!effort) return null;
  return ({
    e1_brief: "low",
    e2_standard: "low",
    e3_deep: "high",
    e4_rigorous: "max",
    minimal: "low",
    low: "low",
    medium: "low",
    high: "high",
    xhigh: "max",
    max: "max"
  } as Record<string, string>)[effort] ?? null;
}
