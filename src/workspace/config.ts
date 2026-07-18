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

export interface WorkspaceArcadiaConfig {
  name?: string;
  version?: number;
  createdAt?: string;
  database?: string;
  memory?: WorkspaceMemoryConfig;
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
  const memoryValue = config.memory;
  if (memoryValue === undefined) {
    return config as WorkspaceArcadiaConfig;
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
    }
  };
}
