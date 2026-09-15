import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runProjectImportCommand } from "../src/commands/project.js";
import { runWorkPlanCommand, runWorkRunCommand } from "../src/commands/work.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A "coding agent" that always fails, so `executeCodexStep` takes the
 * `result.status !== 0` branch for a `codex_build` step.
 */
function installFailingBuildAgent(workspace: string): void {
  const paths = getWorkspacePaths(workspace);
  const agentPath = path.join(workspace, "fake-failing-build-agent.cjs");
  writeFileSync(
    agentPath,
    "process.stdin.resume(); process.stdin.on('end', () => { process.stderr.write('simulated executor failure'); process.exit(1); });",
    "utf8"
  );
  const registry = JSON.parse(readFileSync(paths.codingAgentProfiles, "utf8")) as {
    profiles: Array<Record<string, unknown>>;
  };
  const profile = registry.profiles.find((candidate) => candidate.name === "claude_build");
  if (!profile) throw new Error("Expected bundled claude_build profile.");
  profile.command = process.execPath;
  profile.args = [agentPath];
  writeFileSync(paths.codingAgentProfiles, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

describe("executeCodexStep build-purpose failure", () => {
  it("does not duplicate the diagnostic artifact id when a codex_build executor fails", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-runner-build-failure-"));
    temporaryRoots.push(root);
    const workspace = path.join(root, "workspace");
    const repository = path.join(root, "repository");
    initWorkspace(workspace);
    mkdirSync(repository, { recursive: true });
    installFailingBuildAgent(workspace);

    const imported = runProjectImportCommand({
      workspace,
      name: "Runner Build Failure Fixture",
      mission: "Reproduce the run_artifacts duplicate-id bug for a failing codex_build step.",
      status: "active",
      milestone: "Reproduce the bug",
      nextAction: "Implement a one-line marker file.",
      classification: "agent"
    });
    const workId = imported.data.workItem.id;
    const projectId = imported.data.project.id;

    withDatabase(workspace, (db) => {
      upsertProjectMetadata(db, { projectId, repoPath: repository });
    });

    const planned = runWorkPlanCommand({ workspace, workId });
    expect(planned.data.plan.steps).toHaveLength(1);
    expect(planned.data.plan.steps[0].executor_type).toBe("codex_build");

    // Before the fix, this threw SQLITE_ERROR (UNIQUE constraint failed:
    // run_artifacts.run_id, run_artifacts.artifact_id) instead of returning
    // a clean "failed" run, because the diagnostic artifact was listed both
    // as the step's primary `artifact` and inside `additionalArtifacts`.
    const result = runWorkRunCommand({ workspace, workId, allowCodexBuild: true });
    expect(result.data.run.status).toBe("failed");
    expect(result.data.run.work_item_id).toBe(workId);
  });
});
