import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { git } from "../git/worktrees.js";

export interface PreparedAgentWorktree {
  agent: "codex" | "claude";
  path: string;
  branch: string;
  model: string;
  effort: string | null;
  command: string;
}

/**
 * Creates only the isolated candidate branch/worktree. Reconciliation belongs
 * to `arcadia go`; launch callers reuse this narrow primitive so preparation
 * can never accidentally integrate or retire earlier work.
 */
export function prepareAgentWorktree(input: {
  agent: "codex" | "claude";
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
  const defaultRoot = path.join(homedir(), input.agent === "codex" ? ".codex/worktrees" : ".claude/worktrees");
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
  git(input.repositoryPath, ["worktree", "add", "-b", branch, worktreePath, input.baseBranch]);
  return candidate;
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

export function buildAgentLaunchCommand(agent: "codex" | "claude", worktreePath: string, model: string, effort: string | null): string {
  const quotedPath = JSON.stringify(worktreePath);
  const quotedModel = JSON.stringify(model);
  if (agent === "claude") {
    const effortFlag = effort ? ` --effort ${JSON.stringify(effort)}` : "";
    return `cd ${quotedPath} && claude --model ${quotedModel}${effortFlag} "arcadia advance"`;
  }
  const effortFlag = effort ? ` -c model_reasoning_effort=${JSON.stringify(effort)}` : "";
  return `codex -c default_permissions=\"arcadia-unattended\" --ask-for-approval never -C ${quotedPath} -m ${quotedModel}${effortFlag} "arcadia advance"`;
}
