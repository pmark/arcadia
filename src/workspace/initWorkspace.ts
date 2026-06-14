import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import type Database from "better-sqlite3";
import { WORKSPACE_FOLDERS } from "../domain/constants.js";
import { openDatabase } from "../db/connection.js";
import { applyInitialSchema } from "../db/schema.js";
import { getDefaultRegistryPath } from "../intent/registries.js";
import { getWorkspacePaths } from "./paths.js";

export interface InitWorkspaceResult {
  workspacePath: string;
  databasePath: string;
  configPath: string;
  createdConfig: boolean;
}

export function initWorkspace(workspace: string): InitWorkspaceResult {
  const paths = getWorkspacePaths(workspace);

  mkdirSync(paths.root, { recursive: true });
  for (const folder of WORKSPACE_FOLDERS) {
    mkdirSync(paths[folderToPathKey(folder)], { recursive: true });
  }

  const createdConfig = !existsSync(paths.configFile);
  if (createdConfig) {
    const config = {
      name: "Arcadia Workspace",
      version: 1,
      createdAt: new Date().toISOString(),
      database: "database/arcadia.sqlite3"
    };
    writeFileSync(paths.configFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }

  copyRegistryIfMissing("intent-registry.json", paths.intentRegistry);
  copyRegistryIfMissing("template-registry.json", paths.templateRegistry);
  copyRegistryIfMissing("coding-agent-profiles.json", paths.codingAgentProfiles);
  copyRegistryIfMissing("operator-context.md", paths.operatorContext);

  const db: Database.Database = openDatabase(paths.root);
  try {
    applyInitialSchema(db);
  } finally {
    db.close();
  }

  return {
    workspacePath: paths.root,
    databasePath: paths.databaseFile,
    configPath: paths.configFile,
    createdConfig
  };
}

function copyRegistryIfMissing(fileName: string, destination: string): void {
  if (existsSync(destination)) {
    return;
  }

  copyFileSync(getDefaultRegistryPath(fileName), destination);
}

function folderToPathKey(folder: (typeof WORKSPACE_FOLDERS)[number]): keyof ReturnType<typeof getWorkspacePaths> {
  switch (folder) {
    case "mission_logs":
      return "missionLogs";
    default:
      return folder;
  }
}
