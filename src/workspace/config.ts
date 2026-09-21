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

export interface WorkspaceArcadiaConfig {
  name?: string;
  version?: number;
  createdAt?: string;
  database?: string;
  memory?: WorkspaceMemoryConfig;
  codingAgent?: WorkspaceCodingAgentConfig;
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
  const memoryValue = config.memory;
  if (memoryValue === undefined) {
    return { ...config, codingAgent };
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
    codingAgent
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
