import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import {
  createProjectWithInitialWork,
  createReviewItem,
  upsertProjectMetadata
} from "../src/db/repositories.js";

export const repoRoot = path.resolve(import.meta.dirname, "..");
export const tsxLoader = path.join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");

const trackedPaths: string[] = [];

export function cleanupTrackedPaths(): void {
  for (const tracked of trackedPaths.splice(0)) {
    rmSync(tracked, { recursive: true, force: true });
  }
}
export function runCli(
  args: string[],
  env: Record<string, string> = {},
  options: { configPath?: string; cwd?: string } = {}
) {
  const { ARCADIA_WORKSPACE: _arcadiaWorkspace, ...baseEnv } = process.env;
  // The `tsx` bin starts an IPC service on macOS. Exercise the same Node
  // loader used by `pnpm arcadia` instead, so this contract suite works under
  // the ordinary network-denied Codex worktree sandbox.
  return spawnSync(process.execPath, ["--import", tsxLoader, path.join(repoRoot, "src", "cli.ts"), ...args], {
    cwd: options.cwd ?? repoRoot,
    env: { ...baseEnv, ARCADIA_CONFIG_PATH: options.configPath ?? createTempConfigPath(), ...env },
    encoding: "utf8"
  });
}

export function parseJson(value: string) {
  return JSON.parse(value) as Record<string, any>;
}

export function createTempWorkspacePath(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-cli-test-"));
  rmSync(workspace, { recursive: true, force: true });
  trackedPaths.push(workspace);
  return workspace;
}

export function createTempConfigPath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-cli-config-"));
  trackedPaths.push(directory);
  return path.join(directory, "config.json");
}

export function createNeutralCwd(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-cli-neutral-cwd-"));
  trackedPaths.push(directory);
  return directory;
}

export function createTempRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), "arcadia-repo-test-"));
  trackedPaths.push(repo);
  return repo;
}

export function initializedGitRepo(): string {
  const repo = createTempRepo();
  writeFileSync(path.join(repo, "tracked.txt"), "initial\n", "utf8");
  spawnSync("git", ["init"], { cwd: repo });
  spawnSync("git", ["config", "user.email", "arcadia@example.test"], { cwd: repo });
  spawnSync("git", ["config", "user.name", "Arcadia Test"], { cwd: repo });
  spawnSync("git", ["add", "tracked.txt"], { cwd: repo });
  spawnSync("git", ["commit", "-m", "initial"], { cwd: repo });
  return repo;
}

export function fakeExecutorBin(names: string[]): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-fake-executors-"));
  trackedPaths.push(directory);
  for (const name of names) {
    const scriptPath = path.join(directory, name);
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        "name=$(basename \"$0\")",
        "cat >/dev/null",
        "printf '\\nchanged by %s\\n' \"$name\" >> tracked.txt",
        "mkdir -p .arcadia",
        "printf 'final from %s\\n' \"$name\" > .arcadia/final-output.md",
        "printf 'executor %s complete\\n' \"$name\""
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 }
    );
  }
  return directory;
}

export function initializedWorkspace(): string {
  const workspace = createTempWorkspacePath();
  const result = runCli(["init", workspace]);
  expect(result.status).toBe(0);
  return workspace;
}

export function createProject(workspace: string) {
  return withDatabase(workspace, (db) =>
    createProjectWithInitialWork(db, {
      name: "CLI Fixture Project",
      mission: "Support CLI tests.",
      status: "active",
      currentMilestone: "Initial milestone",
      nextAction: "Exercise the CLI",
      expectedArtifact: "CLI Fixture Artifact",
      workClassification: "agent"
    })
  );
}

export function createExecutableReview(workspace: string, repoPath: string) {
  return withDatabase(workspace, (db) => {
    const created = createProjectWithInitialWork(db, {
      name: `Executor Fixture ${Date.now()} ${Math.random()}`,
      mission: "Exercise review execution.",
      status: "active",
      currentMilestone: "Execution milestone",
      nextAction: "Review the executor output",
      expectedArtifact: "Review execution artifact",
      workClassification: "agent"
    });
    upsertProjectMetadata(db, {
      projectId: created.project.id,
      aliases: [],
      repoPath,
      statusSummary: "Executor fixture repository.",
      validationCommands: ["test -f tracked.txt"]
    });
    const review = createReviewItem(db, {
      workItemId: created.workItem.id,
      projectId: created.project.id,
      decisionNeeded: "Approve implementation.",
      recommendation: "Execute in safe implementation mode.",
      sourceInput: "Implement a small tracked-file change.",
      proposedAction: "Modify tracked.txt only.",
      resolvedIntent: "ExecutionRequest",
      confidenceLabel: "high",
      confidence: 0.99
    });
    return { projectId: created.project.id, workItemId: created.workItem.id, reviewId: review.id };
  });
}

export function importWorkItem(
  workspace: string,
  input: { title: string; queue: string; classification: string; nextAction: string }
) {
  const result = runCli([
    "inbox",
    "import",
    "--workspace",
    workspace,
    "--title",
    input.title,
    "--input",
    input.title,
    "--queue",
    input.queue,
    "--classification",
    input.classification,
    "--next-action",
    input.nextAction,
    "--json"
  ]);
  expect(result.status).toBe(0);
  return parseJson(result.stdout).data.workItem;
}
