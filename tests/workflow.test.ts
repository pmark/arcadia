import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getWorkflowDefinition,
  matchWorkflowDefinition,
  validateWorkflowDefinition
} from "../src/workflows/config.js";
import { listWorkflowRuns, runWorkflow } from "../src/workflows/runner.js";
import type { WorkflowDefinition } from "../src/workflows/types.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("deterministic workflows", () => {
  it("loads, validates, and matches the built-in Thundertonk practice workflow", () => {
    const workspace = initializedWorkspace();
    const input = writeRecording(workspace);
    const workflow = getWorkflowDefinition(workspace, "thundertonk-practice");

    expect(validateWorkflowDefinition(workflow)).toEqual({ valid: true, errors: [], warnings: [] });
    expect(matchWorkflowDefinition(workspace, input, "iCloudIdeas")?.id).toBe("thundertonk-practice");
    expect(matchWorkflowDefinition(workspace, path.join(workspace, "other.m4a"), "iCloudIdeas")).toBeNull();
  });

  it("dry-runs without invoking the executable or writing Run Artifacts", () => {
    const workspace = initializedWorkspace();
    const input = writeRecording(workspace);
    const destinationRoot = temporaryDirectory("arcadia-drive-");
    const workflow = fixtureWorkflow(workspace, destinationRoot);
    workflow.action.executable = path.join(workspace, "does-not-exist");

    const result = runWorkflow({ workspace, workflow, inputPath: input, dryRun: true });

    expect(result.status).toBe("would_run");
    expect(result.recordingDate).toBe("2026-07-16");
    expect(result.destinationDirectory).toBe(path.join(destinationRoot, "Thundertonk PMA", "Practices", "2026", "0716"));
    expect(existsSync(path.join(workspace, "artifacts", "workflow-runs"))).toBe(false);
  });

  it("publishes every collected MP3, verifies hashes, and makes a repeated Run idempotent", () => {
    const workspace = initializedWorkspace();
    const input = writeRecording(workspace);
    const destinationRoot = temporaryDirectory("arcadia-drive-");
    const workflow = fixtureWorkflow(workspace, destinationRoot);

    const first = runWorkflow({ workspace, workflow, inputPath: input });

    expect(first.status).toBe("completed");
    expect(first.files).toHaveLength(3);
    expect(first.files.every((file) => file.copied && file.sha256.length === 64)).toBe(true);
    const destinationNames = readdirSync(first.destinationDirectory).sort();
    expect(destinationNames).toEqual([
      "01 - 3m50s.mp3",
      "02 - Working Song.mp3",
      "03 - 6m19s.mp3"
    ]);
    expect(readFileSync(first.stdoutLogPath!, "utf8")).toContain("collected: 3 files →");
    expect(JSON.parse(readFileSync(first.runManifestPath!, "utf8")).status).toBe("completed");

    const second = runWorkflow({ workspace, workflow, inputPath: input });
    expect(second.status).toBe("already_completed");
    expect(second.id).toBe(first.id);
    expect(listWorkflowRuns(workspace, workflow.id)).toHaveLength(1);
    expect(readdirSync(first.destinationDirectory).sort()).toEqual(destinationNames);
  });

  it("records a retryable failed Run when expected MP3 output is absent", () => {
    const workspace = initializedWorkspace();
    const input = writeRecording(workspace);
    const destinationRoot = temporaryDirectory("arcadia-drive-");
    const workflow = fixtureWorkflow(workspace, destinationRoot);
    workflow.action.arguments = ["-e", "process.stdout.write('finished without songs')", "{input}"];

    const result = runWorkflow({ workspace, workflow, inputPath: input });

    expect(result.status).toBe("failed");
    expect(result.retryable).toBe(true);
    expect(result.failureReason).toContain("Expected collected output directory was not found");
    expect(JSON.parse(readFileSync(result.runManifestPath!, "utf8")).currentStep).toBe("failed");
  });
});

function initializedWorkspace(): string {
  const workspace = temporaryDirectory("arcadia-workflow-workspace-");
  initWorkspace(workspace);
  return workspace;
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(directory);
  return directory;
}

function writeRecording(workspace: string): string {
  const input = path.join(workspace, "Thundertonk practice 2026 July 16.m4a");
  writeFileSync(input, "fixture recording", "utf8");
  return input;
}

function fixtureWorkflow(workspace: string, destinationRoot: string): WorkflowDefinition {
  return {
    ...getWorkflowDefinition(workspace, "thundertonk-practice"),
    id: "fixture-thundertonk-practice",
    action: {
      executable: process.execPath,
      arguments: [path.resolve("tests", "fixtures", "fake-rehearsal.mjs"), "{input}"],
      workingDirectory: "{inputDir}",
      timeoutSeconds: 30,
      safeToRunAutomatically: true
    },
    publication: {
      destinationRoot,
      directoryTemplate: "Thundertonk PMA/Practices/{yyyy}/{mmdd}",
      fileNameTemplate: "{sourceName}",
      verify: "sha256"
    }
  };
}
