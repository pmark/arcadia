import path from "node:path";

export interface WorkspacePaths {
  root: string;
  projects: string;
  missionLogs: string;
  artifacts: string;
  skills: string;
  prompts: string;
  config: string;
  database: string;
  reports: string;
  inbox: string;
  configFile: string;
  databaseFile: string;
  statusReport: string;
  intentRegistry: string;
  templateRegistry: string;
  codingAgentProfiles: string;
}

export function resolveWorkspacePath(workspace: string): string {
  return path.resolve(workspace);
}

export function getWorkspacePaths(workspace: string): WorkspacePaths {
  const root = resolveWorkspacePath(workspace);

  return {
    root,
    projects: path.join(root, "projects"),
    missionLogs: path.join(root, "mission_logs"),
    artifacts: path.join(root, "artifacts"),
    skills: path.join(root, "skills"),
    prompts: path.join(root, "prompts"),
    config: path.join(root, "config"),
    database: path.join(root, "database"),
    reports: path.join(root, "reports"),
    inbox: path.join(root, "inbox"),
    configFile: path.join(root, "config", "arcadia.json"),
    databaseFile: path.join(root, "database", "arcadia.sqlite3"),
    statusReport: path.join(root, "reports", "status.md"),
    intentRegistry: path.join(root, "config", "intent-registry.json"),
    templateRegistry: path.join(root, "config", "template-registry.json"),
    codingAgentProfiles: path.join(root, "config", "coding-agent-profiles.json")
  };
}

export function toWorkspaceRelativePath(workspace: string, absolutePath: string): string {
  return path.relative(resolveWorkspacePath(workspace), absolutePath).replaceAll(path.sep, "/");
}
