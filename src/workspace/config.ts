import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { validationError } from "../cli/errors.js";

export interface UserArcadiaConfig {
  defaultWorkspace?: string;
}

export interface WorkspaceMemoryConfig {
  enabled: boolean;
  obsidianVaultPath?: string;
}

/**
 * Whether the capacity gate is enforced, and for which providers.
 * `capacityGateEnabled: false` is a deliberate, visible operator override: the
 * exempted providers are treated as admitted without a real observation or a
 * bounded attestation. It is not proof of any real limit, only a stated
 * operator choice.
 *
 * Naming `provider` exempts exactly that one provider — never silently any
 * other. Omitting it exempts **every configured provider**, which is the
 * operator saying capacity evidence is not a gate at all. Both forms are
 * off by default: the gate is enforced unless the operator turns it off.
 */
export interface WorkspaceCodingAgentConfig {
  provider?: string;
  capacityGateEnabled?: boolean;
}

/**
 * Which providers the config exempts: `"all"` for every configured provider,
 * a list of ids for specific ones, or `null` when the gate is enforced
 * everywhere (the default).
 */
export type UnmeteredProviderSelector = "all" | readonly string[] | null;

/**
 * Resolve the config into the selector the capacity observer takes.
 * `null` means the gate is enforced for every provider. `"all"` means the
 * operator disabled it entirely, which is the difference between "this one is
 * unmetered" and "capacity evidence is not a gate".
 */
export function unmeteredProviderSelector(
  config: WorkspaceCodingAgentConfig | undefined
): UnmeteredProviderSelector {
  if (config?.capacityGateEnabled !== false) return null;
  const named = config.provider?.trim();
  return named ? [named] : "all";
}

/**
 * Red-alert diagnosis calls a model, so it is off unless the operator sets
 * `enabled: true` here. `issueRepo` (`owner/name`) is where the bug Issue is
 * filed and is required to enable it; `tokenBudget` caps one diagnosis.
 */
export interface WorkspaceRedAlertDiagnosisConfig {
  enabled?: boolean;
  issueRepo?: string;
  tokenBudget?: number;
}

/**
 * Marks a disposable experiment workspace (Decision 0082). `allowedRepoRoot`
 * is relative to the workspace root and must stay inside it: every Project
 * repository registered here must live under it. The guard in
 * `src/workspace/experimentGuard.ts` refuses the host-global and production
 * commands while such a workspace is the resolved one.
 */
export interface WorkspaceExperimentConfig {
  enabled: true;
  allowedRepoRoot: string;
  decision?: string;
}

export interface WorkspaceArcadiaConfig {
  name?: string;
  version?: number;
  createdAt?: string;
  database?: string;
  memory?: WorkspaceMemoryConfig;
  codingAgent?: WorkspaceCodingAgentConfig;
  redAlertDiagnosis?: WorkspaceRedAlertDiagnosisConfig;
  experiment?: WorkspaceExperimentConfig;
}

/** The resolved facts about an experiment workspace, with absolute paths. */
export interface ExperimentWorkspace {
  workspacePath: string;
  allowedRepoRoot: string;
}

/** The workspace-relative directory `init --profile experiment` allows fixture repositories under. */
export const EXPERIMENT_ALLOWED_REPO_ROOT = "projects";

/**
 * The experiment facts of a workspace, or null when it is an ordinary one.
 * A missing config file is an ordinary (or uninitialized) workspace; a
 * malformed `experiment` block fails loudly rather than silently reading as
 * "not an experiment", because the guard must fail closed.
 */
export function readExperimentWorkspace(workspacePath: string): ExperimentWorkspace | null {
  const root = path.resolve(workspacePath);
  const configPath = path.join(root, "config", "arcadia.json");
  if (!existsSync(configPath)) return null;
  // Only the experiment block is validated here, so an unrelated config
  // problem cannot turn every guard check into a refusal.
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw validationError("Workspace configuration is not valid JSON.", {
      configPath,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  const block = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>).experiment
    : undefined;
  const experiment = parseExperimentConfig(block, configPath);
  if (!experiment) return null;
  return { workspacePath: root, allowedRepoRoot: path.resolve(root, experiment.allowedRepoRoot) };
}

export function userConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ARCADIA_CONFIG_PATH?.trim()) {
    return path.resolve(env.ARCADIA_CONFIG_PATH);
  }

  if (process.platform === "win32" && env.APPDATA?.trim()) {
    return path.join(env.APPDATA, "Arcadia", "config.json");
  }

  const configHome = env.XDG_CONFIG_HOME?.trim()
    ? path.resolve(env.XDG_CONFIG_HOME)
    : path.join(os.homedir(), ".config");
  return path.join(configHome, "arcadia", "config.json");
}

export function loadUserConfig(env: NodeJS.ProcessEnv = process.env): UserArcadiaConfig {
  const configPath = userConfigPath(env);
  if (!existsSync(configPath)) {
    return {};
  }

  const raw = readFileSync(configPath, "utf8").trim();
  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw) as UserArcadiaConfig;
  return {
    defaultWorkspace: typeof parsed.defaultWorkspace === "string" ? parsed.defaultWorkspace : undefined
  };
}

export function setDefaultWorkspace(workspace: string, env: NodeJS.ProcessEnv = process.env): UserArcadiaConfig {
  const workspacePath = path.resolve(workspace);
  if (!existsSync(workspacePath)) {
    throw validationError("Default workspace path does not exist.", { workspace: workspacePath });
  }
  // Every live launchd service follows this file, so an experiment workspace
  // as the default would repoint production at its next restart (Decision 0082).
  if (readExperimentWorkspace(workspacePath)) {
    throw validationError("An experiment workspace can never be the default workspace.", {
      workspace: workspacePath,
      reason: "All live launchd services follow the user config default, so this would repoint production at the next restart.",
      alternative: `Address the experiment workspace inline on each command: ARCADIA_WORKSPACE=${workspacePath} arcadia <command> (or --workspace ${workspacePath}); never export it.`
    });
  }

  const configPath = userConfigPath(env);
  mkdirSync(path.dirname(configPath), { recursive: true });
  const config = { ...loadUserConfig(env), defaultWorkspace: workspacePath };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

export function loadWorkspaceConfig(configPath: string): WorkspaceArcadiaConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw validationError("Workspace configuration is not valid JSON.", {
      configPath,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw validationError("Workspace configuration must be a JSON object.", { configPath });
  }
  const config = parsed as Record<string, unknown>;
  const codingAgent = parseCodingAgentConfig(config.codingAgent, configPath);
  const redAlertDiagnosis = parseRedAlertDiagnosisConfig(config.redAlertDiagnosis, configPath);
  const experiment = parseExperimentConfig(config.experiment, configPath);
  const memoryValue = config.memory;
  if (memoryValue === undefined) {
    return { ...config, codingAgent, redAlertDiagnosis, experiment };
  }
  if (!memoryValue || typeof memoryValue !== "object" || Array.isArray(memoryValue)) {
    throw validationError("Workspace memory configuration must be a JSON object.", { configPath });
  }
  const memory = memoryValue as Record<string, unknown>;
  if (typeof memory.enabled !== "boolean") {
    throw validationError("Workspace memory.enabled must be a boolean.", { configPath });
  }
  if (memory.obsidianVaultPath !== undefined && typeof memory.obsidianVaultPath !== "string") {
    throw validationError("Workspace memory.obsidianVaultPath must be a string.", { configPath });
  }
  return {
    ...(config as WorkspaceArcadiaConfig),
    memory: {
      enabled: memory.enabled,
      obsidianVaultPath: typeof memory.obsidianVaultPath === "string" ? memory.obsidianVaultPath : undefined
    },
    codingAgent,
    redAlertDiagnosis,
    experiment
  };
}

function parseExperimentConfig(value: unknown, configPath: string): WorkspaceExperimentConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError("Workspace experiment configuration must be a JSON object.", { configPath });
  }
  const raw = value as Record<string, unknown>;
  // Only `enabled: true` is meaningful; anything else is a hand edit that
  // tried to switch the guard off, which is refused rather than honoured.
  if (raw.enabled !== true) {
    throw validationError("Workspace experiment.enabled must be true; delete the experiment workspace instead of disabling it.", { configPath });
  }
  const root = raw.allowedRepoRoot;
  if (typeof root !== "string" || !root.trim() || path.isAbsolute(root)
    || path.normalize(root).split(path.sep).includes("..")) {
    throw validationError("Workspace experiment.allowedRepoRoot must be a relative path inside the workspace.", { configPath });
  }
  if (raw.decision !== undefined && typeof raw.decision !== "string") {
    throw validationError("Workspace experiment.decision must be a string.", { configPath });
  }
  return {
    enabled: true,
    allowedRepoRoot: root.trim(),
    ...(typeof raw.decision === "string" ? { decision: raw.decision } : {})
  };
}

function parseRedAlertDiagnosisConfig(
  value: unknown,
  configPath: string
): WorkspaceRedAlertDiagnosisConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError("Workspace redAlertDiagnosis configuration must be a JSON object.", { configPath });
  }
  const raw = value as Record<string, unknown>;
  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
    throw validationError("Workspace redAlertDiagnosis.enabled must be a boolean.", { configPath });
  }
  if (raw.issueRepo !== undefined && (typeof raw.issueRepo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(raw.issueRepo.trim()))) {
    throw validationError("Workspace redAlertDiagnosis.issueRepo must be an owner/name string.", { configPath });
  }
  if (raw.tokenBudget !== undefined && (typeof raw.tokenBudget !== "number" || !Number.isInteger(raw.tokenBudget) || raw.tokenBudget <= 0)) {
    throw validationError("Workspace redAlertDiagnosis.tokenBudget must be a positive integer.", { configPath });
  }
  return {
    enabled: raw.enabled,
    issueRepo: typeof raw.issueRepo === "string" ? raw.issueRepo.trim() : undefined,
    tokenBudget: raw.tokenBudget
  };
}

function parseCodingAgentConfig(
  value: unknown,
  configPath: string
): WorkspaceCodingAgentConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError("Workspace codingAgent configuration must be a JSON object.", { configPath });
  }
  const codingAgent = value as Record<string, unknown>;
  if (codingAgent.provider !== undefined && typeof codingAgent.provider !== "string") {
    throw validationError("Workspace codingAgent.provider must be a string.", { configPath });
  }
  if (codingAgent.capacityGateEnabled !== undefined && typeof codingAgent.capacityGateEnabled !== "boolean") {
    throw validationError("Workspace codingAgent.capacityGateEnabled must be a boolean.", { configPath });
  }
  if (codingAgent.provider !== undefined && !String(codingAgent.provider).trim()) {
    throw validationError("Workspace codingAgent.provider must not be blank when present.", { configPath });
  }
  return {
    provider: typeof codingAgent.provider === "string" ? codingAgent.provider.trim() : undefined,
    capacityGateEnabled:
      typeof codingAgent.capacityGateEnabled === "boolean" ? codingAgent.capacityGateEnabled : undefined
  };
}
