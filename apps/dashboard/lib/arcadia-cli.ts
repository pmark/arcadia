import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ArcadiaJsonSuccess, DashboardSnapshotResponse } from "./types";

const execFileAsync = promisify(execFile);

export async function loadDashboardSnapshot(): Promise<ArcadiaJsonSuccess<DashboardSnapshotResponse>> {
  const workspace = resolveWorkspacePath();
  const repoRoot = findRepoRoot(process.cwd());
  const sourceCli = path.join(repoRoot, "src", "cli.ts");
  const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");
  const builtCli = path.join(repoRoot, "dist", "src", "cli.js");

  const command = existsSync(sourceCli) ? (existsSync(tsxBin) ? tsxBin : "tsx") : process.execPath;
  const cliArgs = existsSync(sourceCli)
    ? [sourceCli, "dashboard", "snapshot", "--workspace", workspace, "--json"]
    : [builtCli, "dashboard", "snapshot", "--workspace", workspace, "--json"];

  const result = await execFileAsync(command, cliArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024
  });

  const parsed = JSON.parse(result.stdout) as ArcadiaJsonSuccess<DashboardSnapshotResponse>;
  if (!parsed.ok) {
    throw new Error("Arcadia CLI returned an unsuccessful response.");
  }

  return parsed;
}

function resolveWorkspacePath(): string {
  if (process.env.ARCADIA_WORKSPACE?.trim()) {
    return path.resolve(process.env.ARCADIA_WORKSPACE);
  }

  return path.join(findRepoRoot(process.cwd()), "tmp", "demo-workspace");
}

function findRepoRoot(start: string): string {
  let current = path.resolve(start);

  while (true) {
    if (existsSync(path.join(current, "src", "cli.ts")) && existsSync(path.join(current, "package.json"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Unable to locate Arcadia repository root.");
    }

    current = parent;
  }
}
