import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  renderBackBurnerListSuccess,
  runBackBurnerArchiveCommand,
  runBackBurnerListCommand,
  runBackBurnerPromoteCommand
} from "../src/commands/backBurner.js";
import { runAskCommand } from "../src/commands/ask.js";
import { buildDashboardSnapshot } from "../src/dashboard/snapshot.js";
import { withDatabase } from "../src/db/connection.js";
import {
  createBackBurnerItem,
  createProjectWithInitialWork,
  createWorkItemWithOptionalArtifact,
  getBackBurnerItem,
  listBackBurnerItems,
  updateWorkItem
} from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-back-burner-surface-"));
  workspaces.push(directory);
  initWorkspace(directory);
  return directory;
}

describe("Back Burner surface conditions", () => {
  it("derives every condition from current facts and never promotes while reading", () => {
    const ws = workspace();
    withDatabase(ws, (db) => {
      const project = createProjectWithInitialWork(db, {
        name: "Client Work",
        mission: "Serve current clients.",
        status: "active",
        currentMilestone: "Deliver",
        nextAction: "Continue",
        workClassification: "agent"
      });
      const second = createWorkItemWithOptionalArtifact(db, {
        projectId: project.project.id,
        title: "Second",
        rawInput: "Second",
        queue: "work_queue",
        workClassification: "autonomous",
        nextAction: "Continue"
      }).workItem;
      createWorkItemWithOptionalArtifact(db, {
        projectId: project.project.id,
        title: "Third",
        rawInput: "Third",
        queue: "work_queue",
        workClassification: "autonomous",
        nextAction: "Continue"
      });
      createWorkItemWithOptionalArtifact(db, {
        projectId: project.project.id,
        title: "Fourth",
        rawInput: "Fourth",
        queue: "work_queue",
        workClassification: "autonomous",
        nextAction: "Continue"
      });

      const make = (label: string, surfaceCondition: Parameters<typeof createBackBurnerItem>[1]["surfaceCondition"], projectId: string | null = null) =>
        createBackBurnerItem(db, {
          originalInput: label,
          ingressSource: "test",
          classification: "IncubatingThought",
          confidence: 1,
          reason: "Test condition",
          surfaceCondition,
          projectId
        });

      const manual = make("manual", undefined);
      const past = make("past date", { kind: "date", date: "2000-01-01" });
      const future = make("future date", { kind: "date", date: "2999-01-01" });
      const dependencyOpen = make("dependency open", { kind: "dependency", workItemId: second.id, status: "done" });
      const dependencyDone = make("dependency done", { kind: "dependency", workItemId: project.workItem.id, status: "done" });
      updateWorkItem(db, project.workItem.id, { status: "done" });
      const predicateTrue = make("predicate true", { kind: "predicate", name: "project-has-three-open-actions" }, project.project.id);
      const predicateFalse = make("predicate false", { kind: "predicate", name: "project-has-three-open-actions" });
      const unknown = make("predicate unknown", { kind: "predicate", name: "not-registered" });

      const before = (db.prepare("SELECT COUNT(*) AS count FROM work_items").get() as { count: number }).count;
      expect(getBackBurnerItem(db, manual.id)).toMatchObject({
        surface_kind: "manual",
        surface_condition: { kind: "manual" },
        surface_fired: false
      });
      expect(getBackBurnerItem(db, past.id)?.surface_fired).toBe(true);
      expect(getBackBurnerItem(db, future.id)?.surface_fired).toBe(false);
      expect(getBackBurnerItem(db, dependencyOpen.id)?.surface_fired).toBe(false);
      expect(getBackBurnerItem(db, dependencyDone.id)?.surface_fired).toBe(true);
      expect(getBackBurnerItem(db, predicateTrue.id)?.surface_fired).toBe(true);
      expect(getBackBurnerItem(db, predicateFalse.id)?.surface_fired).toBe(false);
      expect(getBackBurnerItem(db, unknown.id)).toMatchObject({
        surface_fired: false,
        surface_warning: "Unknown surface predicate: not-registered",
        effective_status: "incubating"
      });
      expect(listBackBurnerItems(db, "all", { fired: true }).map((item) => item.id)).toEqual(
        expect.arrayContaining([past.id, dependencyDone.id, predicateTrue.id])
      );
      expect((db.prepare("SELECT COUNT(*) AS count FROM work_items").get() as { count: number }).count).toBe(before);
      expect((db.prepare("SELECT COUNT(*) AS count FROM back_burner_items WHERE promoted_work_item_id IS NOT NULL").get() as { count: number }).count).toBe(0);
    });
  });

  it("scopes, points, tags, filters, and groups items through the existing Ask path", () => {
    const ws = workspace();
    const projectId = withDatabase(ws, (db) => createProjectWithInitialWork(db, {
      name: "Arcadia",
      mission: "Maintain momentum.",
      status: "active",
      currentMilestone: "Resurface",
      nextAction: "Test",
      workClassification: "agent"
    }).project.id);

    const captured = runAskCommand({
      workspace: ws,
      request: "Revisit the compact status view.",
      project: projectId,
      captureAsIdea: true,
      surfaceCondition: { kind: "date", date: "2000-01-01" },
      sourceRef: "docs/ideas/compact-status.md",
      facetTags: ["quick-win", "experiment"]
    });
    const item = withDatabase(ws, (db) => getBackBurnerItem(db, captured.data.backBurnerItemId!));
    expect(item).toMatchObject({
      project_id: projectId,
      source_ref: "docs/ideas/compact-status.md",
      facet_tags: ["quick-win", "experiment"],
      surface_fired: true,
      effective_status: "opportunistic"
    });

    const result = runBackBurnerListCommand({
      workspace: ws,
      status: "all",
      fired: true,
      project: projectId,
      tag: "quick-win",
      groupBy: "tag"
    });
    expect(result.data.items).toHaveLength(1);
    expect(result.data.groups.map((group) => group.key)).toEqual(["quick-win", "experiment"]);
  });

  it("keeps rows created before the additive columns listable, archivable, and promotable", () => {
    const ws = workspace();
    withDatabase(ws, (db) => {
      const insert = db.prepare(`INSERT INTO back_burner_items (
        id, original_input, ingress_source, classification, confidence, reason, status,
        suggested_next_step, created_at, updated_at, promoted_at, promoted_work_item_id
      ) VALUES (?, ?, 'legacy', 'Idea', 0.5, 'Legacy row', 'opportunistic', NULL, ?, ?, NULL, NULL)`);
      insert.run("bb_legacy_archive", "Archive legacy", "2025-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z");
      insert.run("bb_legacy_promote", "Promote legacy", "2025-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z");
      expect(getBackBurnerItem(db, "bb_legacy_archive")).toMatchObject({
        surface_kind: null,
        surface_condition: { kind: "manual" },
        effective_status: "opportunistic",
        facet_tags: []
      });
    });

    expect(runBackBurnerListCommand({ workspace: ws, status: "all" }).data.count).toBe(2);
    expect(runBackBurnerArchiveCommand({ workspace: ws, id: "bb_legacy_archive" }).data.item.status).toBe("archived");
    expect(runBackBurnerPromoteCommand({ workspace: ws, id: "bb_legacy_promote" }).data.item.status).toBe("promoted");
  });

  it("separates fired items from merely incubating items in the dashboard snapshot", () => {
    const ws = workspace();
    withDatabase(ws, (db) => {
      const make = (originalInput: string, surfaceCondition: Parameters<typeof createBackBurnerItem>[1]["surfaceCondition"]) =>
        createBackBurnerItem(db, {
          originalInput,
          ingressSource: "test",
          classification: "IncubatingThought",
          confidence: 1,
          reason: "Dashboard count test",
          surfaceCondition
        });
      make("Waiting", { kind: "manual" });
      make("Fired", { kind: "date", date: "2000-01-01" });
    });

    const snapshot = buildDashboardSnapshot({ workspace: ws });
    expect(snapshot.counts).toMatchObject({ backBurner: 2, backBurnerFired: 1, backBurnerIncubating: 1 });
    expect(snapshot.backBurnerItems.find((item) => item.originalInput === "Fired")).toMatchObject({
      status: "opportunistic",
      storedStatus: "incubating",
      surfaceFired: true
    });
  });
  it("names the Action a dependency condition waits on, and falls back to its id when the Action is gone", () => {
    const ws = workspace();
    const blocker = withDatabase(ws, (db) => {
      const project = createProjectWithInitialWork(db, {
        name: "Client Work",
        mission: "Serve current clients.",
        status: "active",
        currentMilestone: "Deliver",
        nextAction: "Continue",
        workClassification: "agent"
      });
      const gate = createWorkItemWithOptionalArtifact(db, {
        projectId: project.project.id,
        title: "Ship the intake questionnaire",
        rawInput: "Ship the intake questionnaire",
        queue: "work_queue",
        workClassification: "autonomous",
        nextAction: "Continue"
      }).workItem;
      createBackBurnerItem(db, {
        originalInput: "Revisit the copy rubric",
        ingressSource: "test",
        classification: "IncubatingThought",
        confidence: 1,
        reason: "Dependency rendering test",
        surfaceCondition: { kind: "dependency", workItemId: gate.id, status: "done" }
      });
      return gate;
    });

    const named = renderBackBurnerListSuccess(runBackBurnerListCommand({ workspace: ws, status: "all" })).join("\n");
    expect(named).toContain('dependency "Ship the intake questionnaire" = done');
    expect(named).not.toContain(blocker.id);

    // ON DELETE SET NULL leaves the condition without a target; the raw id is
    // all that is left to show, and it must still be shown.
    withDatabase(ws, (db) => {
      db.prepare("DELETE FROM work_items WHERE id = ?").run(blocker.id);
    });

    const orphaned = renderBackBurnerListSuccess(runBackBurnerListCommand({ workspace: ws, status: "all" })).join("\n");
    expect(orphaned).toContain("Surface dependency Action was not found");
  });
});
