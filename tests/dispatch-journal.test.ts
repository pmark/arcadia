import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDocsSyncCommand } from "../src/commands/docs.js";
import { runNextReadyCommand } from "../src/commands/next.js";
import { runReviewApproveCommand } from "../src/commands/review.js";
import { runWorkPlanCommand } from "../src/commands/work.js";
import { withDatabase } from "../src/db/connection.js";
import {
  createWorkItemWithOptionalArtifact,
  getWorkItemByDocRef,
  listProjects,
  upsertProject,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import { resolveActionReadiness } from "../src/docs/dispatch.js";
import { listDispatchEvents, recordDispatchEvent, summarizeDispatchEvents } from "../src/docs/journal.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function scratch(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-journal-"));
  temporary.push(directory);
  return directory;
}

function writeDoc(repoRoot: string, relativePath: string, content: string): void {
  const absolute = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

/** A plan with a two-step chain: `ship-it` waits on `migrate`. */
function chainPlan(migrateStatus: string): string {
  return [
    "---",
    "arcadia: v1",
    "type: plan",
    "slug: sample-plan",
    "project: demo",
    "status: active",
    "milestone: First milestone",
    "current_action: ship-it",
    "updated: 2026-07-25",
    "actions:",
    "  - id: migrate",
    "    title: Run the migration",
    `    status: ${migrateStatus}`,
    "    responsibility: codex",
    "    next_action: Add the column.",
    "    expected_artifact: A migration that runs twice safely",
    "    clarification: clarified",
    "    acceptance_criteria:",
    "      - The migration is idempotent.",
    "    depends_on: []",
    "  - id: ship-it",
    "    title: Ship the thing",
    "    status: open",
    "    responsibility: codex",
    "    next_action: Wire the command.",
    "    expected_artifact: A wired command with a test",
    "    clarification: clarified",
    "    acceptance_criteria:",
    "      - The command is covered by a test.",
    "    depends_on: [migrate]",
    "---",
    "",
    "# Sample plan",
    ""
  ].join("\n");
}

function workspaceFor(repoRoot: string): string {
  const workspace = path.join(scratch(), "ws");
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo",
      mission: "Exercise the dispatch guard.",
      status: "active",
      currentMilestone: "First milestone",
      nextAction: "Start",
      workClassification: "codex"
    });
    upsertProjectMetadata(db, {
      projectId: project.id,
      repoPath: repoRoot,
      validationCommands: ["pnpm test"]
    });
  });
  return workspace;
}

describe("action-scoped document readiness", () => {
  it("reports the unmet prerequisite for an action that is not the pointer", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", chainPlan("open"));

    const readiness = resolveActionReadiness(repo, "demo", "ship-it");

    expect(readiness.found).toBe(true);
    expect(readiness.planSlug).toBe("sample-plan");
    expect(readiness.blockers).toHaveLength(1);
    expect(readiness.blockers[0].field).toBe("actions.ship-it.depends_on");
    expect(readiness.blockers[0].message).toContain('"migrate"');
  });

  it("clears the action once its prerequisite is done", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", chainPlan("done"));

    const readiness = resolveActionReadiness(repo, "demo", "ship-it");

    expect(readiness.blockers).toEqual([]);
    expect(readiness.operatorQuestion).toBeNull();
  });

  it("reports nothing checked for an action the repository does not describe", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", chainPlan("done"));

    expect(resolveActionReadiness(repo, "demo", "no-such-action").found).toBe(false);
    // A different project's slug must not match this project's plan.
    expect(resolveActionReadiness(repo, "other", "ship-it").found).toBe(false);
  });
});

describe("planning preparation honors the managed plan", () => {
  it("refuses an Action whose plan prerequisite is unfinished", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", chainPlan("open"));
    const workspace = workspaceFor(repo);
    runDocsSyncCommand({ workspace, apply: true });

    const action = withDatabase(workspace, (db) => getWorkItemByDocRef(db, "plan/sample-plan#ship-it"));
    expect(action).not.toBeNull();

    expect(() => runWorkPlanCommand({ workspace, workId: action!.id }))
      .toThrow("Action is not ready in its managed plan.");
  });

  it("records the refusal even though the command threw", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", chainPlan("open"));
    const workspace = workspaceFor(repo);
    runDocsSyncCommand({ workspace, apply: true });
    const action = withDatabase(workspace, (db) => getWorkItemByDocRef(db, "plan/sample-plan#ship-it"));

    expect(() => runWorkPlanCommand({ workspace, workId: action!.id })).toThrow();

    // The guard runs before the preparation transaction precisely so this
    // survives: a journal that forgets its refusals answers nothing.
    const events = withDatabase(workspace, (db) => listDispatchEvents(db));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      command: "work.plan",
      planSlug: "sample-plan",
      actionId: "ship-it",
      dispatchable: false
    });
    expect(events[0].blockerFields).toEqual(["actions.ship-it.depends_on"]);
  });

  it("lets the Action through once the plan marks the prerequisite done", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", chainPlan("done"));
    const workspace = workspaceFor(repo);
    runDocsSyncCommand({ workspace, apply: true });
    const action = withDatabase(workspace, (db) => getWorkItemByDocRef(db, "plan/sample-plan#ship-it"));

    const prepared = runWorkPlanCommand({ workspace, workId: action!.id });

    expect(prepared.data.plan.work_item_id).toBe(action!.id);
    const events = withDatabase(workspace, (db) => listDispatchEvents(db));
    expect(events[0]).toMatchObject({ command: "work.plan", dispatchable: true, blockerCount: 0 });
  });

  it("leaves Actions Arcadia captured itself alone", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", chainPlan("open"));
    const workspace = workspaceFor(repo);
    runDocsSyncCommand({ workspace, apply: true });

    // No doc_ref means no plan to be judged against; the guard must not invent
    // one, and must not journal a resolution it never made.
    const captured = withDatabase(workspace, (db) => {
      const project = listProjects(db)[0];
      return createWorkItemWithOptionalArtifact(db, {
        projectId: project.id,
        title: "Something captured directly",
        rawInput: "Something captured directly",
        queue: "work_queue",
        workClassification: "codex",
        nextAction: "Do the captured thing.",
        expectedArtifact: "A captured result"
      }).workItem;
    });

    try {
      runWorkPlanCommand({ workspace, workId: captured.id });
    } catch (error) {
      // May fail later for unrelated eligibility reasons; what matters is that
      // it is never refused by the document guard.
      expect((error as Error).message).not.toContain("managed plan");
    }

    const events = withDatabase(workspace, (db) => listDispatchEvents(db));
    expect(events).toEqual([]);
  });
});

describe("approval-time readiness recheck (Decision 0005, hybrid)", () => {
  it("approves without a recheck when the plan document is unchanged", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", chainPlan("done"));
    const workspace = workspaceFor(repo);
    runDocsSyncCommand({ workspace, apply: true });
    const action = withDatabase(workspace, (db) => getWorkItemByDocRef(db, "plan/sample-plan#ship-it"));

    const prepared = runWorkPlanCommand({ workspace, workId: action!.id });
    expect(prepared.data.planningDecision).not.toBeNull();

    const approved = runReviewApproveCommand({
      workspace,
      id: prepared.data.planningDecision!.id,
      execute: false
    });
    expect(approved.data.result.status).toBe("approved");

    // Nothing prompted a re-read of the repository, so no review.approve
    // resolution was journalled -- only the earlier work.plan one.
    const events = withDatabase(workspace, (db) => listDispatchEvents(db));
    expect(events.map((event) => event.command)).toEqual(["work.plan"]);
  });

  it("approves after a recheck when the document moved but nothing regressed", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", chainPlan("done"));
    const workspace = workspaceFor(repo);
    runDocsSyncCommand({ workspace, apply: true });
    const action = withDatabase(workspace, (db) => getWorkItemByDocRef(db, "plan/sample-plan#ship-it"));
    const prepared = runWorkPlanCommand({ workspace, workId: action!.id });

    // A cosmetic edit elsewhere in the file, with the updated: date bumped --
    // the honest trigger for a recheck, even though nothing here regresses.
    writeDoc(
      repo,
      "docs/plans/sample-plan.md",
      chainPlan("done")
        .replace("updated: 2026-07-25", "updated: 2026-07-26")
        .replace("title: Ship the thing", "title: Ship the thing, carefully")
    );

    const approved = runReviewApproveCommand({
      workspace,
      id: prepared.data.planningDecision!.id,
      execute: false
    });
    expect(approved.data.result.status).toBe("approved");

    const events = withDatabase(workspace, (db) => listDispatchEvents(db));
    expect(events.map((event) => event.command)).toEqual(["review.approve", "work.plan"]);
    expect(events[0]).toMatchObject({ dispatchable: true, blockerCount: 0 });
  });

  it("refuses approval when the document moved and readiness regressed", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", chainPlan("done"));
    const workspace = workspaceFor(repo);
    runDocsSyncCommand({ workspace, apply: true });
    const action = withDatabase(workspace, (db) => getWorkItemByDocRef(db, "plan/sample-plan#ship-it"));
    const prepared = runWorkPlanCommand({ workspace, workId: action!.id });

    // The prerequisite this packet was built against is undone, and the
    // document says so with a bumped updated: date.
    writeDoc(
      repo,
      "docs/plans/sample-plan.md",
      chainPlan("open").replace("updated: 2026-07-25", "updated: 2026-07-26")
    );

    expect(() =>
      runReviewApproveCommand({ workspace, id: prepared.data.planningDecision!.id, execute: false })
    ).toThrow(/no longer ready/);

    // The Decision was never moved to approved by the failed attempt, but the
    // refusal itself survives -- it was journalled before the transaction
    // that would have rolled it back along with everything else.
    const events = withDatabase(workspace, (db) => listDispatchEvents(db));
    expect(events.map((event) => event.command)).toEqual(["review.approve", "work.plan"]);
    expect(events[0]).toMatchObject({ dispatchable: false });
    expect(events[0].blockerFields).toEqual(["actions.ship-it.depends_on"]);
  });

  it("trusts the updated: field, so a regression without a date bump is not caught", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", chainPlan("done"));
    const workspace = workspaceFor(repo);
    runDocsSyncCommand({ workspace, apply: true });
    const action = withDatabase(workspace, (db) => getWorkItemByDocRef(db, "plan/sample-plan#ship-it"));
    const prepared = runWorkPlanCommand({ workspace, workId: action!.id });

    // The dependency regresses, but the author forgot to bump updated:. This
    // is the hybrid's known, accepted gap -- documented, not silently patched.
    writeDoc(repo, "docs/plans/sample-plan.md", chainPlan("open"));

    const approved = runReviewApproveCommand({
      workspace,
      id: prepared.data.planningDecision!.id,
      execute: false
    });
    expect(approved.data.result.status).toBe("approved");

    const events = withDatabase(workspace, (db) => listDispatchEvents(db));
    expect(events.map((event) => event.command)).toEqual(["work.plan"]);
  });
});

function readySetProjectDoc(): string {
  return [
    "---",
    "arcadia: v1",
    "type: project",
    "slug: demo",
    "name: Demo",
    "status: active",
    "goal: Exercise the ready set.",
    "milestone: First milestone",
    "active_plan: sample-plan",
    "updated: 2026-07-25",
    "---",
    ""
  ].join("\n");
}

describe("arcadia next --ready", () => {
  it("lists the dispatchable Action from a real docs-sync'd project, and journals nothing", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", readySetProjectDoc());
    writeDoc(repo, "docs/plans/sample-plan.md", chainPlan("done"));
    const workspace = workspaceFor(repo);
    runDocsSyncCommand({ workspace, apply: true });

    const result = runNextReadyCommand({ workspace, project: "demo" });

    // migrate is done, so it is excluded from consideration entirely; ship-it
    // depends on it and migrate is finished, so ship-it is the whole set.
    expect(result.data.ready.map((entry) => entry.actionId)).toEqual(["ship-it"]);
    expect(result.data.suggestedCurrentAction).toBe("ship-it");

    // A read-only report, computed fresh every time -- not a resolution the
    // dispatch journal needs to remember.
    expect(withDatabase(workspace, (db) => listDispatchEvents(db))).toEqual([]);
  });

  it("excludes the Action still blocked on its migration, from the same real project", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", readySetProjectDoc());
    writeDoc(repo, "docs/plans/sample-plan.md", chainPlan("open"));
    const workspace = workspaceFor(repo);
    runDocsSyncCommand({ workspace, apply: true });

    const result = runNextReadyCommand({ workspace, project: "demo" });

    expect(result.data.ready.map((entry) => entry.actionId)).toEqual(["migrate"]);
    expect(result.data.suggestedCurrentAction).toBe("migrate");
  });
});

describe("dispatch journal", () => {
  it("tallies blocked resolutions by field, most frequent first", () => {
    const workspace = path.join(scratch(), "ws");
    initWorkspace(workspace);

    withDatabase(workspace, (db) => {
      const blocker = (field: string) => ({
        relativePath: "docs/plans/p.md",
        field,
        message: "m",
        remedy: "r"
      });
      recordDispatchEvent(db, {
        command: "next",
        dispatchable: false,
        blockers: [blocker("current_action")],
        operatorQuestion: null
      });
      recordDispatchEvent(db, {
        command: "next",
        // Repeated fields within one resolution are one fact about that field.
        dispatchable: false,
        blockers: [blocker("actions.a.depends_on"), blocker("actions.a.depends_on")],
        operatorQuestion: null
      });
      recordDispatchEvent(db, {
        command: "work.plan",
        dispatchable: false,
        blockers: [blocker("actions.a.depends_on")],
        operatorQuestion: null
      });
      recordDispatchEvent(db, {
        command: "next",
        dispatchable: true,
        blockers: [],
        operatorQuestion: null
      });
    });

    const summary = withDatabase(workspace, (db) => summarizeDispatchEvents(db));

    expect(summary).toMatchObject({ total: 4, dispatchable: 1, blocked: 3 });
    expect(summary.byField).toEqual([
      { field: "actions.a.depends_on", resolutions: 2 },
      { field: "current_action", resolutions: 1 }
    ]);
  });

  it("never fails its caller when the journal cannot be written", () => {
    const workspace = path.join(scratch(), "ws");
    initWorkspace(workspace);

    withDatabase(workspace, (db) => {
      db.exec("DROP TABLE dispatch_events");
      expect(() =>
        recordDispatchEvent(db, {
          command: "next",
          dispatchable: true,
          blockers: [],
          operatorQuestion: null
        })
      ).not.toThrow();
    });
  });
});
