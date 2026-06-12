import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { validationError } from "../cli/errors.js";

export interface UserArcadiaConfig {
  defaultWorkspace?: string;
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
