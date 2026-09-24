import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAskCommand } from "../src/commands/ask.js";
import { renderAskTrailSuccess, runAskTrailCommand } from "../src/commands/askTrail.js";
import { runBackBurnerPromoteCommand } from "../src/commands/backBurner.js";
import { runReviewApproveCommand } from "../src/commands/review.js";
import { withDatabase } from "../src/db/connection.js";
import { createProjectWithInitialWork, upsertProjectMetadata } from "../src/db/repositories.js";
import { backfillAskTraceLinks } from "../src/db/schema.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

// #591: the capture id the operator is handed must lead to whatever the Ask became.
describe("arcadia ask-trail", () => {
  it("traces a planned Ask from its capture id, request id, or ask id", () => {
    const { workspace, projectId } = workspaceWithArcadia();
    const asked = runAskCommand({
      workspace,
      request: "Improve UX of Arcadia Runs page in the web dashboard UI .\n\n* Add tabs for segregating concerns"
    });
    const capture = asked.data.captureEnvelope;
    const workItemId = asked.data.workItem?.id;
    expect(workItemId).toBeTruthy();

    for (const id of [capture.id, capture.requestId, asked.data.ask?.id ?? ""]) {
      const trail = runAskTrailCommand({ workspace, id }).data;
      expect(trail.capture?.id, id).toBe(capture.id);
      expect(trail.asks).toHaveLength(1);
      expect(trail.asks[0].executionPath).toBe("Plan First");
      expect(trail.asks[0].projectName).toBe("Arcadia");
      expect(trail.asks[0].outcomes).toContainEqual(
        expect.objectContaining({ kind: "action", id: workItemId, projectName: "Arcadia" })
      );
    }
    expect(withDatabase(workspace, (db) =>
      db.prepare("SELECT project_id FROM work_items WHERE id = ?").get(workItemId)
    )).toEqual({ project_id: projectId });
  });

  it("follows a shelved Ask to its Back Burner item and on to the Action it was promoted to", () => {
    const { workspace, projectId } = workspaceWithArcadia();
    const asked = runAskCommand({ workspace, request: "Maybe creator partnerships could help someday." });
    const itemId = asked.data.backBurnerItemId ?? "";
    expect(itemId).toMatch(/^bb_/);

    const shelved = runAskTrailCommand({ workspace, id: asked.data.captureEnvelope.id }).data;
    expect(shelved.asks[0].outcomes).toEqual([expect.objectContaining({ kind: "back_burner_item", id: itemId })]);

    const promoted = runBackBurnerPromoteCommand({ workspace, id: itemId, project: projectId });
    const trail = runAskTrailCommand({ workspace, id: asked.data.captureEnvelope.id });
    expect(trail.data.asks[0].outcomes).toContainEqual(
      expect.objectContaining({ kind: "action", id: promoted.data.workItem.id })
    );
    expect(renderAskTrailSuccess(trail).join("\n")).toContain(`→ back_burner_item ${itemId}`);
  });

  it("shows the Decision an unrouted request is waiting on", () => {
    const { workspace } = workspaceWithArcadia();
    const asked = runAskCommand({ workspace, request: "Build Pinterest support." });
    const trail = runAskTrailCommand({ workspace, id: asked.data.captureEnvelope.id }).data;
    expect(trail.asks[0].executionPath).toBe("Clarify First");
    expect(trail.asks[0].outcomes).toContainEqual(
      expect.objectContaining({ kind: "decision", id: asked.data.reviewItemId })
    );
  });

  it("follows an approved Decision to the Action its resulting Ask created", () => {
    const { workspace } = workspaceWithArcadia();
    const asked = runAskCommand({ workspace, request: "Add a deterministic fixture for Arcadia." });
    const reviewItemId = asked.data.reviewItemId ?? "";
    expect(reviewItemId).toMatch(/^review_/);

    const approved = runReviewApproveCommand({ workspace, id: reviewItemId, execute: false });
    const resultingWorkItemId = approved.data.approval?.workItem?.id;
    expect(resultingWorkItemId).toBeTruthy();

    const trail = runAskTrailCommand({ workspace, id: asked.data.captureEnvelope.id }).data;
    expect(trail.asks[0].outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "decision", id: reviewItemId }),
      expect.objectContaining({ kind: "action", id: resultingWorkItemId })
    ]));
  });

  it("says an unlinked capture may predate tracing, not that nothing happened", () => {
    const { workspace } = workspaceWithArcadia();
    const asked = runAskCommand({ workspace, request: "Maybe an unlinked idea could matter someday." });
    withDatabase(workspace, (db) => db.prepare("UPDATE ask_requests SET capture_id = NULL").run());
    const trail = runAskTrailCommand({ workspace, id: asked.data.captureEnvelope.id });
    expect(trail.data.asks).toEqual([]);
    expect(renderAskTrailSuccess(trail).join("\n")).toContain("predates Ask tracing");
  });

  it("refuses an id that matches nothing, naming the ids it accepts", () => {
    const { workspace } = workspaceWithArcadia();
    expect(() => runAskTrailCommand({ workspace, id: "capture_missing" })).toThrow(/No Ask capture, request, or ask/);
  });

  it("backfills links for Asks recorded before tracing, but only unambiguous ones", () => {
    const { workspace } = workspaceWithArcadia();
    const unique = runAskCommand({ workspace, request: "Maybe a unique idea could matter someday." });
    const twinA = runAskCommand({ workspace, request: "Maybe twins could matter someday." });
    const twinB = runAskCommand({ workspace, request: "Maybe twins could matter someday." });

    // Unlink everything, as rows written before #591 were, then backfill.
    withDatabase(workspace, (db) => {
      db.exec("UPDATE back_burner_items SET ask_request_id = NULL; UPDATE ask_requests SET capture_id = NULL;");
      backfillAskTraceLinks(db);
    });

    const uniqueTrail = runAskTrailCommand({ workspace, id: unique.data.captureEnvelope.id }).data;
    expect(uniqueTrail.asks.map((ask) => ask.id)).toEqual([unique.data.ask?.id]);
    expect(uniqueTrail.asks[0].outcomes).toEqual([
      expect.objectContaining({ kind: "back_burner_item", id: unique.data.backBurnerItemId })
    ]);

    // Identical text within seconds cannot be paired safely, so it stays unlinked.
    for (const twin of [twinA, twinB]) {
      expect(runAskTrailCommand({ workspace, id: twin.data.captureEnvelope.id }).data.asks).toEqual([]);
    }
  });
});

function workspaceWithArcadia(): { workspace: string; projectId: string } {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-ask-trail-"));
  workspaces.push(workspace);
  initWorkspace(workspace);
  const projectId = withDatabase(workspace, (db) => {
    const created = createProjectWithInitialWork(db, {
      name: "Arcadia",
      mission: "Turn intent into governed work.",
      goal: "Make Ask trustworthy.",
      status: "active",
      currentMilestone: "Traceable Asks",
      nextAction: "Trace every Ask.",
      workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: created.project.id, aliases: ["Arcadia"], repoPath: workspace });
    return created.project.id;
  });
  return { workspace, projectId };
}
