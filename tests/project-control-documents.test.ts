import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProjectSetupContextCommand } from "../src/commands/project.js";
import { withDatabase } from "../src/db/connection.js";
import {
  createMilestoneForProject,
  createWorkItemRecord,
  upsertProject,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import { isDispatchable, resolveDispatch } from "../src/docs/dispatch.js";
import { parseDoc } from "../src/docs/parse.js";
import type { CreateWorkItemInput, UpsertProjectInput } from "../src/domain/types.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-control-docs-workspace-"));
  roots.push(workspace);
  initWorkspace(workspace);
  return workspace;
}

function tempRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), "arcadia-control-docs-repo-"));
  roots.push(repo);
  // realpath, because macOS resolves /var to /private/var and setup resolves
  // the repository path the same way before comparing it to `repo_path`.
  return realpathSync(repo);
}

function projectInput(overrides: Partial<UpsertProjectInput> = {}): UpsertProjectInput {
  return {
    name: "Martian Rover",
    mission: "Keep momentum visible for Martian Rover: minimal overhead.",
    status: "active",
    currentMilestone: "Establish the project operating loop",
    nextAction: "Clarify the next action.",
    workClassification: "autonomous",
    ...overrides
  };
}

function workItem(overrides: Partial<CreateWorkItemInput> & { title: string }): CreateWorkItemInput {
  return {
    rawInput: overrides.title,
    queue: "work_queue",
    workClassification: "agent",
    nextAction: "Make the scoped code change, then run tests",
    ...overrides
  };
}

/** A repository registered to one Project, with the Actions Arcadia holds for it. */
function adoptedRepository(options: { workItems?: CreateWorkItemInput[] } = {}) {
  const workspace = tempWorkspace();
  const repo = tempRepo();
  const projectId = withDatabase(workspace, (db) => {
    const project = upsertProject(db, projectInput());
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    const milestone = createMilestoneForProject(db, project.id, "Establish the project operating loop");
    for (const item of options.workItems ?? [
      workItem({
        title: "Implement the next code change",
        status: "in_progress",
        expectedArtifact: "Committed code change"
      })
    ]) {
      createWorkItemRecord(db, { ...item, projectId: project.id, milestoneId: milestone?.id ?? null });
    }
    return project.id;
  });

  return { workspace, repo, projectId };
}

describe("adoption seeds the work pointer chain", () => {
  it("writes a PROJECT.md and a plan that leave the project dispatchable", () => {
    const { workspace, repo, projectId } = adoptedRepository();

    const response = runProjectSetupContextCommand({ workspace, projectId });

    // The defect this closes: every governance file was written and the two
    // documents that make the repository dispatchable were not, so `next`
    // refused forever with no command that would produce them.
    expect(response.data.files.projectDocument).toBe(path.join(repo, "PROJECT.md"));
    expect(response.data.files.plan).toBe(path.join(repo, "docs", "plans", "martian-rover-bootstrap.md"));

    const resolution = resolveDispatch(repo, "martian-rover");
    expect(resolution.blockers).toEqual([]);
    expect(resolution.context?.action.title).toBe("Implement the next code change");
    expect(isDispatchable(resolution)).toBe(true);
  });

  it("carries the Project's own identity rather than a generic template", () => {
    const { workspace, repo, projectId } = adoptedRepository();

    runProjectSetupContextCommand({ workspace, projectId });
    const parsed = parseDoc(
      "PROJECT.md",
      path.join(repo, "PROJECT.md"),
      readFileSync(path.join(repo, "PROJECT.md"), "utf8")
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.doc).toMatchObject({
      type: "project",
      slug: "martian-rover",
      name: "Martian Rover",
      status: "active",
      milestone: "Establish the project operating loop",
      activePlan: "martian-rover-bootstrap"
    });
    // A mission containing a colon is the most common way generated
    // frontmatter stops parsing, which is why this one has one.
    expect((parsed.doc as { goal: string }).goal).toContain("minimal overhead");
  });

  it("derives acceptance criteria only from the expected Artifact the operator wrote", () => {
    const { workspace, repo, projectId } = adoptedRepository();

    runProjectSetupContextCommand({ workspace, projectId });
    const action = resolveDispatch(repo, "martian-rover").context?.action;

    expect(action?.acceptanceCriteria).toEqual(["The expected Artifact exists: Committed code change"]);
    expect(action?.nextAction).toBe("Make the scoped code change, then run tests");
  });

  it("asks the operator one question rather than inventing criteria it does not have", () => {
    const { workspace, repo, projectId } = adoptedRepository({
      workItems: [workItem({ title: "Wait for missing access", nextAction: "Request access from the owner" })]
    });

    runProjectSetupContextCommand({ workspace, projectId });
    const resolution = resolveDispatch(repo, "martian-rover");

    // Nothing observable exists to assert, so the Action is recorded as the
    // open question it already was -- not given criteria nobody agreed to.
    expect(resolution.operatorQuestion).toContain("Wait for missing access");
    expect(resolution.context?.action.acceptanceCriteria).toEqual([]);
    expect(isDispatchable(resolution)).toBe(false);
  });

  it("leaves the pointer unset rather than choosing between equally startable Actions", () => {
    const { workspace, repo, projectId } = adoptedRepository({
      workItems: [
        workItem({ title: "Review the generated status report", expectedArtifact: "Project status report" }),
        workItem({ title: "Choose the product direction", expectedArtifact: "Decision note" })
      ]
    });

    runProjectSetupContextCommand({ workspace, projectId });
    const resolution = resolveDispatch(repo, "martian-rover");

    // Choosing the objective is the operator's call. The refusal names every
    // candidate id, which is a smaller ask than undoing a wrong pointer.
    const blocker = resolution.blockers.find((candidate) => candidate.field === "current_action");
    expect(blocker?.remedy).toContain("review-the-generated-status-report");
    expect(blocker?.remedy).toContain("choose-the-product-direction");
  });

  it("never overwrites control documents the operator already wrote", () => {
    const { workspace, repo, projectId } = adoptedRepository();
    const own = "---\narcadia: v1\ntype: project\nslug: martian-rover\nname: Mine\nstatus: active\ngoal: Mine\nupdated: 2026-08-20\n---\n\n# Mine\n";
    writeFileSync(path.join(repo, "PROJECT.md"), own, "utf8");

    const response = runProjectSetupContextCommand({ workspace, projectId });

    expect(readFileSync(path.join(repo, "PROJECT.md"), "utf8")).toBe(own);
    expect(response.data.files.projectDocument).toBeNull();
    expect(response.data.controlDocuments.skipped.join("\n")).toContain("already declares this project");
  });

  it("identifies the Project from a bare --repo path that is registered to one", () => {
    const { workspace, repo } = adoptedRepository();

    const response = runProjectSetupContextCommand({ workspace, repoPath: repo });

    // `--repo` and a project identifier used to adopt the same repository and
    // produce different results, because only one of them looked up identity.
    expect(response.data.project?.name).toBe("Martian Rover");
    expect(existsSync(path.join(repo, "PROJECT.md"))).toBe(true);
  });

  it("refuses to guess an identity for a repository no Project claims", () => {
    const workspace = tempWorkspace();
    const stranger = tempRepo();

    const response = runProjectSetupContextCommand({ workspace, repoPath: stranger });

    // A PROJECT.md declaring the wrong slug is worse than none: dispatch would
    // resolve it and work would be recorded against the wrong Project.
    expect(existsSync(path.join(stranger, "PROJECT.md"))).toBe(false);
    expect(existsSync(path.join(stranger, "AGENTS.md"))).toBe(true);
    expect(response.data.controlDocuments.skipped.join("\n")).toContain("cannot know which Project");
  });
});
