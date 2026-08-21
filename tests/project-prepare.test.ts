import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { runProjectPrepareCommand } from "../src/commands/project.js";
import { withDatabase } from "../src/db/connection.js";
import {
  getWorkItem,
  listCodexInvocationsForWorkItem,
  listExecutionRuns,
  listProjects,
  listReviewItems
} from "../src/db/repositories.js";
import { isDispatchable, resolveDispatch } from "../src/docs/dispatch.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("project prepare", () => {
  it("preserves one project idea and prepares dispatchable read-only planning without invoking a model", () => {
    const { workspace, repository } = fixture();
    const idea = "A calm web app where teachers exchange classroom resources and keep attribution intact.";

    const response = runProjectPrepareCommand({
      workspace,
      name: "Teacher Commons",
      idea,
      path: repository
    });

    expect(response.data.classification).toEqual({
      intentType: "Project Work",
      executionPath: "Plan First",
      responsibility: "codex"
    });
    expect(response.data.project.status).toBe("active");
    expect(response.data.project.goal).toBe(idea);
    expect(response.data.trigger).toMatch(/^arcadia review approve /);
    expect(response.data.planning.planningDecision?.status).toBe("open");
    expect(response.data.planning.packetArtifact?.path).toMatch(/prompt\.md$/);
    expect(existsSync(path.join(repository, "PROJECT.md"))).toBe(true);
    expect(existsSync(path.join(repository, "docs", "plans", "teacher-commons-bootstrap.md"))).toBe(true);

    const dispatch = resolveDispatch(repository, "teacher-commons");
    expect(isDispatchable(dispatch)).toBe(true);
    expect(dispatch.context?.action.id).toBe("plan-the-first-usable-build-for-teacher-commons");

    withDatabase(workspace, (db) => {
      const action = getWorkItem(db, response.data.workItem.id);
      expect(action?.raw_input).toBe(idea);
      expect(action?.doc_ref).toBe("plan/teacher-commons-bootstrap#plan-the-first-usable-build-for-teacher-commons");
      expect(listCodexInvocationsForWorkItem(db, response.data.workItem.id)).toHaveLength(1);
      expect(listCodexInvocationsForWorkItem(db, response.data.workItem.id)[0]?.status).toBe("packet_created");
      expect(listReviewItems(db, "open").filter((item) => item.resolved_intent === "CodexPlanningRunApproval")).toHaveLength(1);
      expect(listExecutionRuns(db)).toHaveLength(0);
    });

    const packetPath = path.join(workspace, response.data.planning.packetArtifact!.path!);
    expect(readFileSync(packetPath, "utf8")).toContain(idea);
  });

  it("refuses an occupied name or governed repository before creating another Project", () => {
    const { workspace, repository } = fixture();
    writeFileSync(
      path.join(repository, "PROJECT.md"),
      "---\narcadia: v1\ntype: project\nslug: occupied\nname: Occupied\nstatus: active\ngoal: Existing work\nupdated: 2026-08-20\n---\n",
      "utf8"
    );

    expect(() => runProjectPrepareCommand({
      workspace,
      name: "New Project",
      idea: "Build something useful.",
      path: repository
    })).toThrow(/already contains PROJECT\.md/);
    expect(withDatabase(workspace, listProjects)).toHaveLength(0);

    rmSync(path.join(repository, "PROJECT.md"));
    runProjectPrepareCommand({ workspace, name: "New Project", idea: "Build something useful.", path: repository });
    expect(() => runProjectPrepareCommand({
      workspace,
      name: "New Project",
      idea: "A different idea.",
      path: path.join(path.dirname(repository), "different")
    })).toThrow(/already registered/);
    expect(withDatabase(workspace, listProjects)).toHaveLength(1);
  });

  it("exposes the preparation receipts through the CLI JSON envelope", () => {
    const { workspace, repository } = fixture();
    const idea = "A tiny local-first tool that turns rehearsal notes into a practice queue.";
    const result = spawnSync(
      tsxBin,
      [
        path.join(repoRoot, "src", "cli.ts"),
        "project",
        "prepare",
        "Practice Queue",
        idea,
        "--workspace",
        workspace,
        "--path",
        repository,
        "--json"
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );

    expect(result.status, result.stderr).toBe(0);
    const envelope = JSON.parse(result.stdout) as {
      command: string;
      data: { classification: { executionPath: string }; workItem: { raw_input: string }; trigger: string };
    };
    expect(envelope.command).toBe("project.prepare");
    expect(envelope.data.classification.executionPath).toBe("Plan First");
    expect(envelope.data.workItem.raw_input).toBe(idea);
    expect(envelope.data.trigger).toMatch(/^arcadia review approve /);
  });
});

function fixture(): { workspace: string; repository: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-project-prepare-"));
  temporaryRoots.push(root);
  const workspace = path.join(root, "workspace");
  const repository = path.join(root, "repository");
  initWorkspace(workspace);
  mkdirSync(repository, { recursive: true });
  return { workspace, repository };
}
