import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import {
  archiveWorkItem,
  createProjectWithInitialWork,
  createWorkItemWithOptionalArtifact,
  getWorkItem,
  listArchivedWorkItems,
  listQueueGroups,
  listWorkItems,
  unarchiveWorkItem
} from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function workspaceWithProject(): { workspace: string; projectId: string } {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-work-archive-"));
  roots.push(workspace);
  initWorkspace(workspace);
  const projectId = withDatabase(workspace, (db) => createProjectWithInitialWork(db, {
    name: "Noisy",
    mission: "A Project whose inbox filled with restatements of one request.",
    status: "active",
    currentMilestone: "Clean the inbox",
    nextAction: "Keep the good one",
    workClassification: "agent"
  }).project.id);
  return { workspace, projectId };
}

describe("archiving an Action", () => {
  /**
   * Archiving exists because neither `done` nor deletion is honest about a
   * duplicate: `done` asserts work happened, deletion destroys the evidence
   * that something created the row.
   */
  it("hides it from the queues while keeping it findable and restorable", () => {
    const { workspace, projectId } = workspaceWithProject();

    withDatabase(workspace, (db) => {
      const duplicate = createWorkItemWithOptionalArtifact(db, {
        projectId,
        title: "The same request, restated",
        rawInput: "The same request, restated",
        queue: "inbox",
        workClassification: "agent",
        nextAction: "Do the thing"
      }).workItem;

      expect(listQueueGroups(db).inbox.some((item) => item.id === duplicate.id)).toBe(true);

      archiveWorkItem(db, duplicate.id, "Duplicate of the canonical Action.");

      expect(listQueueGroups(db).inbox.some((item) => item.id === duplicate.id)).toBe(false);
      expect(listWorkItems(db).some((item) => item.id === duplicate.id)).toBe(false);
      expect(listWorkItems(db, { includeArchived: true }).some((item) => item.id === duplicate.id)).toBe(true);

      const archived = listArchivedWorkItems(db);
      expect(archived.map((item) => item.id)).toContain(duplicate.id);
      expect(archived.find((item) => item.id === duplicate.id)?.archive_reason)
        .toBe("Duplicate of the canonical Action.");

      // It never became done — that would claim work that did not happen.
      expect(getWorkItem(db, duplicate.id)?.status).not.toBe("done");

      unarchiveWorkItem(db, duplicate.id);

      expect(listQueueGroups(db).inbox.some((item) => item.id === duplicate.id)).toBe(true);
      expect(getWorkItem(db, duplicate.id)?.archived_at).toBeNull();
      expect(getWorkItem(db, duplicate.id)?.archive_reason).toBeNull();
    });
  });

  it("refuses an empty reason", () => {
    const { workspace, projectId } = workspaceWithProject();

    withDatabase(workspace, (db) => {
      const item = createWorkItemWithOptionalArtifact(db, {
        projectId,
        title: "Needs a reason",
        rawInput: "Needs a reason",
        queue: "inbox",
        workClassification: "agent",
        nextAction: "Do the thing"
      }).workItem;

      expect(() => archiveWorkItem(db, item.id, "   ")).toThrow(/reason is required/i);
      expect(getWorkItem(db, item.id)?.archived_at).toBeNull();
    });
  });

  /** A repeated call must not quietly rewrite why the Action left. */
  it("keeps the original instant and reason when archived twice", () => {
    const { workspace, projectId } = workspaceWithProject();

    withDatabase(workspace, (db) => {
      const item = createWorkItemWithOptionalArtifact(db, {
        projectId,
        title: "Archived twice",
        rawInput: "Archived twice",
        queue: "inbox",
        workClassification: "agent",
        nextAction: "Do the thing"
      }).workItem;

      const first = archiveWorkItem(db, item.id, "The original reason.");
      const second = archiveWorkItem(db, item.id, "A later, different reason.");

      expect(second?.archived_at).toBe(first?.archived_at);
      expect(second?.archive_reason).toBe("The original reason.");
    });
  });
});
