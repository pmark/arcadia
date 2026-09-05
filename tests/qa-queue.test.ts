import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runQaListCommand, runQaRecordCommand } from "../src/commands/qa.js";
import { withDatabase } from "../src/db/connection.js";
import { createProjectWithInitialWork, getReviewItem } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

describe("configured QA queue", () => {
  it("lists checked-in Candidates and records a revision-bound operator Decision", () => {
    const workspace = createWorkspace();
    withDatabase(workspace, (db) => {
      createProjectWithInitialWork(db, {
        name: "Arcadia",
        mission: "Maintain momentum.",
        status: "active",
        currentMilestone: "QA queue",
        nextAction: "Test Candidate",
        workClassification: "agent"
      });
    });

    const listed = runQaListCommand({ workspace });
    expect(listed.data.candidates.map((candidate) => candidate.id)).toContain("arcadia-qa-queue");

    // Read the revision from the listing rather than hardcoding it. What is
    // under test is that a Decision binds to whatever revision was displayed —
    // not that one candidate carries one particular string. The revision is
    // now computed from the project's checkout, and this fixture's repoPath is
    // not a git repository, so `null` is the correct value here and binding to
    // it is exactly as meaningful as binding to a SHA.
    const candidate = listed.data.candidates.find((entry) => entry.id === "arcadia-qa-queue");
    expect(candidate).toBeDefined();

    const recorded = runQaRecordCommand({
      workspace,
      candidateId: "arcadia-qa-queue",
      decision: "needs-follow-up",
      note: "The configured target is not running."
    });

    expect(recorded.data.review.status).toBe("deferred");
    const context = JSON.parse(recorded.data.review.context_json);
    expect(context).toMatchObject({ candidateId: "arcadia-qa-queue", revision: candidate?.revision, decision: "needs-follow-up" });
    expect(withDatabase(workspace, (db) => getReviewItem(db, recorded.data.review.id)?.decision_note)).toBe("The configured target is not running.");
  });
});

/** Declares its own target, rather than depending on shipped configuration. */
function createWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-qa-test-"));
  workspaces.push(workspace);
  initWorkspace(workspace);
  mkdirSync(path.join(workspace, "config"), { recursive: true });
  writeFileSync(
    path.join(workspace, "config", "qa-targets.json"),
    JSON.stringify({
      schemaVersion: 1,
      projects: { arcadia: { repoPath: workspace, baseBranch: "main" } },
      targets: [
        {
          id: "arcadia-qa-queue",
          project: "arcadia",
          label: "Arcadia QA queue",
          environment: "Candidate",
          environmentKind: "lan",
          accessState: "access-protected",
          url: "http://127.0.0.1:3020/qa",
          testProcedure: "Fixture target."
        }
      ]
    })
  );
  return workspace;
}
