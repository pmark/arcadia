import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { git } from "../git/worktrees.js";

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
  return `codex -c default_permissions=\"arcadia-unattended\" --ask-for-approval never -C ${quotedPath} -m ${quotedModel}${effortFlag} "arcadia advance"`;
}

/**
 * A reasoning effort as opencode's provider-specific `--variant` value. Both
 * the Arcadia effort key and a stored provider-native value are accepted;
 * anything else omits the flag rather than passing an unsupported value.
 */
export function opencodeVariant(effort: string | null): string | null {
  if (!effort) return null;
  return ({
    e1_brief: "minimal",
    e2_standard: "low",
    e3_deep: "high",
    e4_rigorous: "max",
    minimal: "minimal",
    low: "low",
    medium: "low",
    high: "high",
    xhigh: "max"
  } as Record<string, string>)[effort] ?? null;
}
