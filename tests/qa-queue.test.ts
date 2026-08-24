import { mkdtempSync, rmSync } from "node:fs";
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
        workClassification: "codex"
      });
    });

    const listed = runQaListCommand({ workspace });
    expect(listed.data.candidates.map((candidate) => candidate.id)).toContain("arcadia-qa-queue");

    // Read the revision from the listing rather than hardcoding it. What is
    // under test is that a Decision binds to whatever revision was displayed —
    // not that one candidate carries one particular string. The candidate list
    // is a config file that is supposed to change as targets move, and pinning
    // a value here made editing it look like a regression.
    const candidate = listed.data.candidates.find((entry) => entry.id === "arcadia-qa-queue");
    expect(candidate?.revision).toBeTruthy();

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

function createWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-qa-test-"));
  workspaces.push(workspace);
  initWorkspace(workspace);
  return workspace;
}
