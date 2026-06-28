import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { initWorkspace } from "../../../src/workspace/initWorkspace.js";
import { withDatabase } from "../../../src/db/connection.js";
import { createProjectWithInitialWork, upsertProjectMetadata } from "../../../src/db/repositories.js";
import { getWorkspacePaths } from "../../../src/workspace/paths.js";
import { freePort, startProcess, waitForHttp, type TrackedProcess } from "./processes.js";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

export interface E2EWorkspace {
  root: string;
  repo: string;
  url: string;
  modePath: string;
  fakeLogPath: string;
  setMode(mode: "success" | "invalid" | "nonzero" | "timeout"): void;
  fakeInvocationCount(): number;
  stop(keep: boolean): Promise<void>;
}

export async function createE2EWorkspace(): Promise<E2EWorkspace> {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-e2e-"));
  const rebusterRepo = path.join(root, "repos", "rebuster");
  const arcadiaRepo = path.join(root, "repos", "arcadia");
  mkdirSync(rebusterRepo, { recursive: true });
  mkdirSync(arcadiaRepo, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: rebusterRepo });
  spawnSync("git", ["init", "-q"], { cwd: arcadiaRepo });
  initWorkspace(root);

  withDatabase(root, (db) => {
    const rebuster = createProjectWithInitialWork(db, {
      name: "Rebuster",
      mission: "Create and publish high-quality rebus puzzles.",
      goal: "Make Rebuster publishing reliable.",
      status: "active",
      currentMilestone: "Reliable publishing workflow",
      nextAction: "Choose the next publishing improvement.",
      workClassification: "needs_mark"
    });
    upsertProjectMetadata(db, {
      projectId: rebuster.project.id,
      aliases: ["Rebuster Studio"],
      repoPath: rebusterRepo,
      statusSummary: "Ready for local planning.",
      validationCommands: ["node -e \"process.exit(0)\""]
    });
    const arcadia = createProjectWithInitialWork(db, {
      name: "Arcadia",
      mission: "Maintain momentum across creative projects.",
      goal: "Make daily project planning reliable.",
      status: "active",
      currentMilestone: "Decision-gated planning Runs",
      nextAction: "Generate the weekly project status report.",
      workClassification: "autonomous"
    });
    upsertProjectMetadata(db, {
      projectId: arcadia.project.id,
      aliases: ["Arcadia Core"],
      repoPath: arcadiaRepo,
      statusSummary: "Ready for deterministic reports.",
      validationCommands: []
    });
  });

  const paths = getWorkspacePaths(root);
  const modePath = path.join(root, "fake-mode.txt");
  const fakeLogPath = path.join(root, "fake-executor.log");
  const fakeScript = path.join(repoRoot, "tests", "e2e", "fixtures", "fake-planning-executor.cjs");
  writeFileSync(modePath, "success\n");
  writeFileSync(fakeLogPath, "");
  writeFileSync(paths.codingAgentProfiles, `${JSON.stringify({
    version: 1,
    profiles: [{
      name: "fake_planning",
      provider: "fake-agent",
      package: "local",
      command: process.execPath,
      purpose: "planning",
      sandbox: "read-only",
      args: [fakeScript, modePath, fakeLogPath]
    }, {
      name: "fake_build",
      provider: "fake-agent",
      package: "local",
      command: process.execPath,
      purpose: "build",
      sandbox: "workspace-write",
      args: [fakeScript, modePath, fakeLogPath]
    }]
  }, null, 2)}\n`);

  const port = await freePort();
  const env = {
    ...process.env,
    ARCADIA_WORKSPACE: root,
    ARCADIA_CONFIG_PATH: path.join(root, "isolated-user-config.json"),
    HOME: root,
    CI: "1"
  };
  const dashboardLog = path.join(root, "dashboard.log");
  const workerLog = path.join(root, "worker-process.log");
  const dashboard = startProcess(
    path.join(repoRoot, "apps", "dashboard", "node_modules", ".bin", "next"),
    ["start", "-H", "127.0.0.1", "-p", String(port)],
    { cwd: path.join(repoRoot, "apps", "dashboard"), env, logPath: dashboardLog }
  );
  const worker = startProcess(
    path.join(repoRoot, "node_modules", ".bin", "tsx"),
    [path.join(repoRoot, "src", "cli.ts"), "worker", "start", "--workspace", root],
    { cwd: repoRoot, env, logPath: workerLog }
  );
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForHttp(url, dashboard);
  } catch (error) {
    await stopAll([worker, dashboard]);
    rmSync(root, { recursive: true, force: true });
    throw error;
  }

  return {
    root,
    repo: repoRoot,
    url,
    modePath,
    fakeLogPath,
    setMode(mode) { writeFileSync(modePath, `${mode}\n`); },
    fakeInvocationCount() {
      const raw = readFileSync(fakeLogPath, "utf8");
      return raw.trim() ? raw.trim().split(/\r?\n/).length : 0;
    },
    async stop(keep) {
      await stopAll([worker, dashboard]);
      if (!keep) rmSync(root, { recursive: true, force: true });
    }
  };
}

async function stopAll(processes: TrackedProcess[]) {
  for (const process of processes) await process.stop();
}
