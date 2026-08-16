import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { adoptContinuationProtocol, CONTINUATION_PROTOCOL_FILE, updateAgentsMarkdown } from "../src/projects/contextSetup.js";
import { reportWayDrift } from "../src/projects/wayDrift.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalConstitution = readFileSync(path.join(repoRoot, "CONSTITUTION.md"), "utf8");
const canonicalProtocolSource = readFileSync(path.join(repoRoot, CONTINUATION_PROTOCOL_FILE), "utf8");

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-way-status-workspace-"));
  roots.push(workspace);
  initWorkspace(workspace);
  return workspace;
}

function tempRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), "arcadia-way-status-repo-"));
  roots.push(repo);
  return repo;
}

/** Writes a repository whose adopted files exactly match Arcadia's own canonical text. */
function writeCurrentAdoption(repo: string): void {
  writeFileSync(path.join(repo, "CONSTITUTION.md"), canonicalConstitution, "utf8");
  writeFileSync(path.join(repo, "AGENTS.md"), updateAgentsMarkdown(null), "utf8");
  const protocolPath = path.join(repo, CONTINUATION_PROTOCOL_FILE);
  mkdirSync(path.dirname(protocolPath), { recursive: true });
  writeFileSync(protocolPath, adoptContinuationProtocol(canonicalProtocolSource, null, null), "utf8");
}

function writeAdoptionPolicy(repo: string, upgradePolicy: string): void {
  const adoptionPath = path.join(repo, ".arcadia/arcadia-way/adoption.json");
  mkdirSync(path.dirname(adoptionPath), { recursive: true });
  writeFileSync(adoptionPath, JSON.stringify({ upgrade_policy: upgradePolicy }), "utf8");
}

describe("reportWayDrift", () => {
  it("reports a project with no configured repository path as unknown, never current", () => {
    const workspace = tempWorkspace();
    withDatabase(workspace, (db) => {
      upsertProject(db, { name: "No Repo", mission: "Ship it.", status: "active" });
    });

    const [report] = withDatabase(workspace, (db) => reportWayDrift(db));

    expect(report.status).toBe("unknown");
    expect(report.repoPath).toBeNull();
    expect(report.files).toEqual({ constitution: "unknown", agentsRegion: "unknown", continuationProtocol: "unknown" });
    expect(report.upgradePolicy).toBeNull();
  });

  it("reports a project whose repository path does not exist as unknown", () => {
    const workspace = tempWorkspace();
    withDatabase(workspace, (db) => {
      const project = upsertProject(db, { name: "Ghost", mission: "Ship it.", status: "active" });
      upsertProjectMetadata(db, {
        projectId: project.id,
        aliases: [],
        repoPath: path.join(tmpdir(), "arcadia-way-status-does-not-exist"),
        statusSummary: null,
        validationCommands: []
      });
    });

    const [report] = withDatabase(workspace, (db) => reportWayDrift(db));

    expect(report.status).toBe("unknown");
  });

  it("reports current when the adopted files match Arcadia's canonical text byte for byte", () => {
    const workspace = tempWorkspace();
    const repo = tempRepo();
    writeCurrentAdoption(repo);
    writeAdoptionPolicy(repo, "explicit-only");

    withDatabase(workspace, (db) => {
      const project = upsertProject(db, { name: "Current Adopter", mission: "Ship it.", status: "active" });
      upsertProjectMetadata(db, {
        projectId: project.id,
        aliases: [],
        repoPath: repo,
        statusSummary: null,
        validationCommands: []
      });
    });

    const [report] = withDatabase(workspace, (db) => reportWayDrift(db));

    expect(report.status).toBe("current");
    expect(report.files).toEqual({ constitution: "match", agentsRegion: "match", continuationProtocol: "match" });
    expect(report.upgradePolicy).toBe("explicit-only");
  });

  it("names which managed region differs when the adopted Constitution has drifted", () => {
    const workspace = tempWorkspace();
    const repo = tempRepo();
    writeCurrentAdoption(repo);
    writeFileSync(path.join(repo, "CONSTITUTION.md"), "# An older, edited Constitution\n", "utf8");

    withDatabase(workspace, (db) => {
      const project = upsertProject(db, { name: "Stale Adopter", mission: "Ship it.", status: "active" });
      upsertProjectMetadata(db, {
        projectId: project.id,
        aliases: [],
        repoPath: repo,
        statusSummary: null,
        validationCommands: []
      });
    });

    const [report] = withDatabase(workspace, (db) => reportWayDrift(db));

    expect(report.status).toBe("stale");
    expect(report.files.constitution).toBe("differs");
    expect(report.files.agentsRegion).toBe("match");
    expect(report.files.continuationProtocol).toBe("match");
  });

  it("reports missing managed files rather than treating an unadopted repository as current", () => {
    const workspace = tempWorkspace();
    const repo = tempRepo();

    withDatabase(workspace, (db) => {
      const project = upsertProject(db, { name: "Never Adopted", mission: "Ship it.", status: "active" });
      upsertProjectMetadata(db, {
        projectId: project.id,
        aliases: [],
        repoPath: repo,
        statusSummary: null,
        validationCommands: []
      });
    });

    const [report] = withDatabase(workspace, (db) => reportWayDrift(db));

    expect(report.status).toBe("stale");
    expect(report.files).toEqual({ constitution: "missing", agentsRegion: "missing", continuationProtocol: "missing" });
    expect(report.upgradePolicy).toBeNull();
  });

  it("writes nothing to any repository it inspects", () => {
    const workspace = tempWorkspace();
    const repo = tempRepo();
    writeCurrentAdoption(repo);
    writeAdoptionPolicy(repo, "explicit-only");
    const before = snapshot(repo);

    withDatabase(workspace, (db) => {
      const project = upsertProject(db, { name: "Untouched", mission: "Ship it.", status: "active" });
      upsertProjectMetadata(db, {
        projectId: project.id,
        aliases: [],
        repoPath: repo,
        statusSummary: null,
        validationCommands: []
      });
    });

    withDatabase(workspace, (db) => reportWayDrift(db));

    expect(snapshot(repo)).toEqual(before);
  });
});

/** File paths and contents under `repo`, so a write shows up as a diff. */
function snapshot(repo: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else {
        entries[path.relative(repo, full)] = readFileSync(full, "utf8");
      }
    }
  };
  visit(repo);
  return entries;
}
