import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runDecisionApproveCommand,
  runDecisionNewCommand,
  runDecisionValidateCommand
} from "../src/commands/decision.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function scratch(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-decision-"));
  temporary.push(directory);
  return directory;
}

function workspaceWithProject(): { workspace: string; repoRoot: string; projectSlug: string } {
  const root = scratch();
  const repoRoot = path.join(root, "repo");
  mkdirSync(repoRoot, { recursive: true });
  const workspace = path.join(root, "ws");
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo",
      mission: "Exercise the decision command.",
      status: "active",
      currentMilestone: "Initial",
      nextAction: "Start",
      workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repoRoot });
  });
  return { workspace, repoRoot, projectSlug: "demo" };
}

describe("decision new", () => {
  it("writes a valid Decision document with an auto-assigned id", () => {
    const { workspace, repoRoot, projectSlug } = workspaceWithProject();

    const result = runDecisionNewCommand({
      workspace,
      project: projectSlug,
      slug: "first-gap",
      question: "Should this exist?"
    });

    expect(result.data.id).toBe("0001");
    const content = readFileSync(path.join(repoRoot, "docs/decisions/0001-first-gap.md"), "utf8");
    expect(content).toContain("status: open");
    expect(content).toContain("question: Should this exist?");
    expect(content).toContain("gap_type: missing-decision");

    const validated = runDecisionValidateCommand({ workspace, project: projectSlug, id: "0001" });
    expect(validated.data.valid).toBe(true);
    expect(validated.data.errors).toEqual([]);
  });

  it("increments the id past existing decision files", () => {
    const { workspace, projectSlug } = workspaceWithProject();
    runDecisionNewCommand({ workspace, project: projectSlug, slug: "one", question: "First?" });
    const second = runDecisionNewCommand({ workspace, project: projectSlug, slug: "two", question: "Second?" });
    expect(second.data.id).toBe("0002");
  });

  it("quotes a question containing a colon so the frontmatter stays valid YAML", () => {
    const { workspace, repoRoot, projectSlug } = workspaceWithProject();
    runDecisionNewCommand({
      workspace,
      project: projectSlug,
      slug: "colon-check",
      question: "Session: does it merge with the queue?"
    });
    const content = readFileSync(path.join(repoRoot, "docs/decisions/0001-colon-check.md"), "utf8");
    expect(content).toContain('question: "Session: does it merge with the queue?"');
  });

  it("rejects a slug that is not kebab-case before touching the filesystem", () => {
    const { workspace, projectSlug } = workspaceWithProject();
    expect(() =>
      runDecisionNewCommand({ workspace, project: projectSlug, slug: "Not Kebab", question: "?" })
    ).toThrow(/kebab-case/);
  });

  it("rejects an out-of-enum gap_type instead of writing an invalid document", () => {
    const { workspace, projectSlug } = workspaceWithProject();
    expect(() =>
      runDecisionNewCommand({
        workspace,
        project: projectSlug,
        slug: "bad-gap",
        question: "?",
        gapType: "missing-guard" as never
      })
    ).toThrow();
  });
});

describe("decision approve", () => {
  it("sets status, answer, and decided without disturbing other fields", () => {
    const { workspace, repoRoot, projectSlug } = workspaceWithProject();
    runDecisionNewCommand({
      workspace,
      project: projectSlug,
      slug: "ratify-me",
      question: "Ready?",
      recommendation: "Do the thing."
    });

    runDecisionApproveCommand({
      workspace,
      project: projectSlug,
      id: "0001",
      answer: "Yes: do the thing.",
      decided: "2026-08-23"
    });

    const content = readFileSync(path.join(repoRoot, "docs/decisions/0001-ratify-me.md"), "utf8");
    expect(content).toContain("status: approved");
    expect(content).toContain('answer: "Yes: do the thing."');
    expect(content).toContain("decided: 2026-08-23");
    expect(content).toContain("recommendation: Do the thing.");

    const validated = runDecisionValidateCommand({ workspace, project: projectSlug, id: "0001" });
    expect(validated.data.valid).toBe(true);
  });

  it("resolves a decision by slug as well as by numeric id", () => {
    const { workspace, projectSlug } = workspaceWithProject();
    runDecisionNewCommand({ workspace, project: projectSlug, slug: "by-slug", question: "Q?" });
    const approved = runDecisionApproveCommand({
      workspace,
      project: projectSlug,
      id: "by-slug",
      answer: "Answered."
    });
    expect(approved.data.relativePath).toBe(path.join("docs", "decisions", "0001-by-slug.md"));
  });

  it("refuses to approve without recording an answer, matching the validator's rule", () => {
    const { workspace, projectSlug } = workspaceWithProject();
    runDecisionNewCommand({ workspace, project: projectSlug, slug: "needs-answer", question: "Q?" });
    expect(() =>
      runDecisionApproveCommand({
        workspace,
        project: projectSlug,
        id: "0001",
        answer: ""
      })
    ).toThrow();
  });

  it("throws when no decision file matches the given id", () => {
    const { workspace, projectSlug } = workspaceWithProject();
    expect(() =>
      runDecisionApproveCommand({ workspace, project: projectSlug, id: "9999", answer: "Anything" })
    ).toThrow(/No decision file matches/);
  });
});

describe("decision validate", () => {
  it("reports errors for a hand-edited document without writing anything", () => {
    const { workspace, repoRoot, projectSlug } = workspaceWithProject();
    runDecisionNewCommand({ workspace, project: projectSlug, slug: "broken-later", question: "Q?" });
    const filePath = path.join(repoRoot, "docs/decisions/0001-broken-later.md");
    const original = readFileSync(filePath, "utf8");
    writeFileSync(filePath, original.replace("status: open", "status: approved"), "utf8");

    const validated = runDecisionValidateCommand({ workspace, project: projectSlug, id: "0001" });
    expect(validated.data.valid).toBe(false);
    expect(validated.data.errors[0]?.message).toMatch(/must record an `answer`/);
  });
});
