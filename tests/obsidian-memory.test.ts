import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAskCommand } from "../src/commands/ask.js";
import { runMemorySyncCommand } from "../src/commands/memory.js";
import {
  runReviewApproveCommand,
  runReviewDeferCommand,
  runReviewRejectCommand
} from "../src/commands/review.js";
import { withDatabase } from "../src/db/connection.js";
import {
  createArtifactRecord,
  createProjectWithInitialWork,
  createReviewItem,
  getReviewItem,
  getWorkItem,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Obsidian accepted planning Artifact memory", () => {
  it("exports one standalone Record only when the validated planning Artifact is accepted", () => {
    const fixture = planningFixture({ memory: true });

    expect(recordFiles(fixture.vault)).toEqual([]);
    expect(getWorkItemStatus(fixture)).toBe("in_progress");
    runReviewApproveCommand({ workspace: fixture.workspace, id: fixture.decisionId });

    const files = recordFiles(fixture.vault);
    expect(files).toHaveLength(1);
    const record = readFileSync(files[0]!, "utf8");
    expect(record).toContain("record_type: accepted_planning_artifact");
    expect(record).toContain(`arcadia_artifact_id: \"${fixture.artifactId}\"`);
    expect(record).toContain(`arcadia_decision_id: \"${fixture.decisionId}\"`);
    expect(record).toContain("# Complete implementation plan");
    expect(record).toContain("## Provenance");
    expect(record).toContain("validation.json");
    expect(readFileSync(path.join(fixture.vault, "Arcadia", "README.md"), "utf8")).toContain("SQLite remains");
    expect(getDecisionStatus(fixture)).toBe("approved");
    expect(getWorkItemStatus(fixture)).toBe("done");
  });

  it("does not export initial planning approval, a completed Run awaiting acceptance, or rejected/deferred acceptance", () => {
    const initial = initialApprovalFixture();
    runReviewApproveCommand({ workspace: initial.workspace, id: initial.decisionId, execute: false });
    expect(recordFiles(initial.vault)).toEqual([]);

    const awaiting = planningFixture({ memory: true });
    expect(recordFiles(awaiting.vault)).toEqual([]);
    runReviewRejectCommand({ workspace: awaiting.workspace, id: awaiting.decisionId });
    expect(recordFiles(awaiting.vault)).toEqual([]);

    const deferred = planningFixture({ memory: true });
    runReviewDeferCommand({ workspace: deferred.workspace, id: deferred.decisionId });
    expect(recordFiles(deferred.vault)).toEqual([]);
  });

  it("refuses failed Validation and leaves the Decision open and Action unfinished", () => {
    const fixture = planningFixture({ memory: true, validationStatus: "failed" });
    expect(() => runReviewApproveCommand({ workspace: fixture.workspace, id: fixture.decisionId }))
      .toThrow(/Validation did not pass/);
    expect(recordFiles(fixture.vault)).toEqual([]);
    expect(getDecisionStatus(fixture)).toBe("open");
    expect(getWorkItemStatus(fixture)).toBe("in_progress");
  });

  it("replays acceptance and sync idempotently, and repairs a changed Record at the stable path", () => {
    const fixture = planningFixture({ memory: true });
    runReviewApproveCommand({ workspace: fixture.workspace, id: fixture.decisionId });
    const firstPath = recordFiles(fixture.vault)[0]!;

    runReviewApproveCommand({ workspace: fixture.workspace, id: fixture.decisionId });
    expect(recordFiles(fixture.vault)).toEqual([firstPath]);

    writeFileSync(firstPath, "changed by an external organizer\n", "utf8");
    const repaired = runMemorySyncCommand({ workspace: fixture.workspace });
    expect(repaired.data.counts.updated).toBe(1);
    expect(repaired.data.entries[0]?.recordPath).toBe(realpathSync(firstPath));
    expect(readFileSync(firstPath, "utf8")).toContain("# Complete implementation plan");

    const current = runMemorySyncCommand({ workspace: fixture.workspace });
    expect(current.data.counts.skipped).toBe(1);
    expect(recordFiles(fixture.vault)).toEqual([firstPath]);
  });

  it("dry-run reports backfill with zero vault mutations", () => {
    const fixture = planningFixture({ memory: false });
    runReviewApproveCommand({ workspace: fixture.workspace, id: fixture.decisionId });
    enableMemory(fixture.workspace, fixture.vault);

    const before = vaultTree(fixture.vault);
    const result = runMemorySyncCommand({ workspace: fixture.workspace, dryRun: true });
    expect(result.data.counts.created).toBe(1);
    expect(result.data.entries[0]).toMatchObject({ artifactId: fixture.artifactId, status: "created" });
    expect(vaultTree(fixture.vault)).toEqual(before);
  });

  it("preserves prior behavior without configuration and rejects an invalid vault path", () => {
    const unconfigured = planningFixture({ memory: false });
    runReviewApproveCommand({ workspace: unconfigured.workspace, id: unconfigured.decisionId });
    expect(getDecisionStatus(unconfigured)).toBe("approved");
    expect(getWorkItemStatus(unconfigured)).toBe("done");
    expect(recordFiles(unconfigured.vault)).toEqual([]);

    const invalid = planningFixture({ memory: false });
    enableMemory(invalid.workspace, path.join(invalid.workspace, "missing-vault"));
    expect(() => runReviewApproveCommand({ workspace: invalid.workspace, id: invalid.decisionId }))
      .toThrow(/vault directory does not exist/);
    expect(getDecisionStatus(invalid)).toBe("open");
    expect(getWorkItemStatus(invalid)).toBe("in_progress");
  });

  it("leaves acceptance open when an atomic vault write fails", () => {
    const fixture = planningFixture({ memory: true });
    const managedRoot = path.join(fixture.vault, "Arcadia");
    mkdirSync(managedRoot, { recursive: true });
    chmodSync(managedRoot, 0o500);
    try {
      expect(() => runReviewApproveCommand({ workspace: fixture.workspace, id: fixture.decisionId }))
        .toThrow(/memory export failed/);
      expect(getDecisionStatus(fixture)).toBe("open");
      expect(getWorkItemStatus(fixture)).toBe("in_progress");
    } finally {
      chmodSync(managedRoot, 0o700);
    }
  });
});

interface Fixture {
  workspace: string;
  vault: string;
  decisionId: string;
  artifactId: string;
  workItemId: string;
}

function planningFixture(options: { memory: boolean; validationStatus?: "passed" | "failed" }): Fixture {
  const workspace = temporary("arcadia-memory-workspace-");
  const vault = obsidianVault();
  initWorkspace(workspace);
  if (options.memory) enableMemory(workspace, vault);

  const artifactPath = "artifacts/planning/implementation-plan.md";
  const validationPath = "artifacts/planning/validation.json";
  mkdirSync(path.join(workspace, "artifacts", "planning"), { recursive: true });
  writeFileSync(path.join(workspace, artifactPath), "# Complete implementation plan\n\nKeep SQLite authoritative.\n", "utf8");
  writeFileSync(path.join(workspace, validationPath), JSON.stringify({ status: options.validationStatus ?? "passed" }, null, 2), "utf8");

  return withDatabase(workspace, (db) => {
    const created = createProjectWithInitialWork(db, {
      name: "Martian Rover",
      mission: "Ship durable creative tools.",
      goal: "Preserve reviewed project knowledge.",
      status: "active",
      currentMilestone: "Accepted planning memory",
      nextAction: "Create the Obsidian memory exporter",
      expectedArtifact: "Complete implementation plan",
      workClassification: "needs_mark"
    });
    db.prepare("UPDATE work_items SET status = 'in_progress' WHERE id = ?").run(created.workItem.id);
    const artifact = createArtifactRecord(db, {
      projectId: created.project.id,
      workItemId: created.workItem.id,
      title: "Complete implementation plan",
      artifactType: "planning_artifact",
      status: "drafted",
      path: artifactPath
    });
    createArtifactRecord(db, {
      projectId: created.project.id,
      workItemId: created.workItem.id,
      title: "Planning artifact validation",
      artifactType: "planning_artifact_validation",
      status: options.validationStatus === "failed" ? "drafted" : "ready",
      path: validationPath
    });
    const decision = createReviewItem(db, {
      workItemId: created.workItem.id,
      projectId: created.project.id,
      artifactId: artifact.id,
      decisionNeeded: "Accept the validated planning Artifact.",
      recommendation: "Review and accept.",
      sourceInput: created.workItem.raw_input,
      proposedAction: "Accept the validated plan.",
      resolvedIntent: "CodexPlanningArtifactAcceptance",
      confidenceLabel: "high",
      confidence: 1,
      missingFields: [],
      context: { schemaVersion: 1, runId: null, artifactPath, validationResultPath: validationPath }
    });
    return { workspace, vault, decisionId: decision.id, artifactId: artifact.id, workItemId: created.workItem.id };
  });
}

function initialApprovalFixture(): Fixture {
  const workspace = temporary("arcadia-memory-initial-");
  const vault = obsidianVault();
  initWorkspace(workspace);
  enableMemory(workspace, vault);
  const repo = path.join(workspace, "rebuster-repo");
  mkdirSync(repo, { recursive: true });
  withDatabase(workspace, (db) => {
    const created = createProjectWithInitialWork(db, {
      name: "Rebuster",
      mission: "Create high-quality rebus puzzles.",
      goal: "Make publishing reliable.",
      status: "active",
      currentMilestone: "Reliable publishing workflow",
      nextAction: "Choose the next publishing improvement.",
      workClassification: "needs_mark"
    });
    upsertProjectMetadata(db, {
      projectId: created.project.id,
      aliases: ["Rebuster Studio"],
      repoPath: repo,
      statusSummary: "Ready for planning.",
      validationCommands: []
    });
  });
  const ask = runAskCommand({ workspace, request: "Prepare a plan for adding Pinterest publishing to Rebuster." });
  return {
    workspace,
    vault,
    decisionId: ask.data.reviewItemId!,
    artifactId: ask.data.reviewItemId!,
    workItemId: ask.data.workItem!.id
  };
}

function obsidianVault(): string {
  const vault = temporary("arcadia-memory-vault-");
  mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
  writeFileSync(path.join(vault, "Welcome.md"), "untouched\n", "utf8");
  return vault;
}

function enableMemory(workspace: string, vault: string): void {
  const configPath = getWorkspacePaths(workspace).configFile;
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  config.memory = { enabled: true, obsidianVaultPath: vault };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function getDecisionStatus(fixture: Fixture): string | undefined {
  return withDatabase(fixture.workspace, (db) => getReviewItem(db, fixture.decisionId)?.status);
}

function getWorkItemStatus(fixture: Fixture): string | undefined {
  return withDatabase(fixture.workspace, (db) => getWorkItem(db, fixture.workItemId)?.status);
}

function recordFiles(vault: string): string[] {
  const root = path.join(vault, "Arcadia", "Records");
  if (!existsSync(root)) return [];
  return recursiveFiles(root).filter((file) => file.endsWith(".md")).sort();
}

function recursiveFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    return entry.isDirectory() ? recursiveFiles(entryPath) : [entryPath];
  });
}

function vaultTree(vault: string): string[] {
  return recursiveFiles(vault).map((file) => path.relative(vault, file)).sort();
}

function temporary(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
