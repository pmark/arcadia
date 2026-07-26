import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDocsSyncCommand } from "../src/commands/docs.js";
import { runPortfolioCommand } from "../src/commands/portfolio.js";
import { withDatabase } from "../src/db/connection.js";
import {
  createWorkItemWithOptionalArtifact,
  getWorkItem,
  getReviewItemByDocRef,
  getWorkItemByDocRef,
  listMilestonesForProject,
  listPortfolioProjects,
  listProjects,
  listReviewItems,
  listWorkItemDependencies,
  updateWorkItem,
  upsertProject,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import { discoverDocs } from "../src/docs/discover.js";
import { isManagedDoc, parseDoc } from "../src/docs/parse.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function scratch(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-docs-"));
  temporary.push(directory);
  return directory;
}

function workspaceWithProject(repoRoot: string, slug = "demo"): string {
  const workspace = path.join(scratch(), "ws");
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: slug === "demo" ? "Demo" : slug,
      mission: "Exercise docs sync.",
      status: "active",
      currentMilestone: "Initial",
      nextAction: "Start",
      workClassification: "codex"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repoRoot });
  });
  return workspace;
}

function writeDoc(repoRoot: string, relativePath: string, content: string): void {
  const absolute = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

const PLAN = `---
arcadia: v1
type: plan
slug: sample-plan
project: demo
status: active
milestone: First milestone
updated: 2026-07-25
actions:
  - id: do-the-thing
    title: Do the thing
    status: open
    responsibility: codex
    effort: short
    next_action: Run the migration against staging.
    clarification: clarified
    confidence: high
    source: conversation
    depends_on: []
  - id: blocked-thing
    title: Blocked thing
    status: open
    responsibility: requires_review
    clarification: question_open
    gap_type: missing-decision
    question: Which environment goes first?
    depends_on: [do-the-thing]
questions:
  - id: rollout
    question: Do we cut over per-tenant or all at once?
    gap_type: missing-decision
decisions: []
---

# Sample plan
`;

describe("managed document detection", () => {
  it("recognizes only files carrying the arcadia marker", () => {
    expect(isManagedDoc(PLAN)).toBe(true);
    expect(isManagedDoc("# Just a readme\n\nWith a --- rule\n")).toBe(false);
    expect(isManagedDoc("---\ntitle: Some other tool\n---\n\nbody\n")).toBe(false);
  });
});

describe("document parsing", () => {
  it("parses a plan with actions and questions", () => {
    const { doc, errors } = parseDoc("docs/plans/sample-plan.md", "/abs/sample-plan.md", PLAN);

    expect(errors).toEqual([]);
    expect(doc?.type).toBe("plan");
    const plan = doc as never as { actions: Array<Record<string, unknown>>; questions: unknown[] };
    expect(plan.actions).toHaveLength(2);
    expect(plan.actions[0]).toMatchObject({
      id: "do-the-thing",
      responsibility: "codex",
      effort: "short",
      clarification: "clarified"
    });
    expect(plan.questions).toHaveLength(1);
  });

  it("parses and resolves vendor-neutral execution metadata", () => {
    const profiled = PLAN.replace(
      "    depends_on: []",
      [
        "    depends_on: []",
        "    execution:",
        "      schema: arcadia.execution/v1",
        "      profile: routine_implementation",
        "      phases:",
        "        review:",
        "          capability: c3_systems",
        "          effort: e3_deep",
        "          review_independence: separate_run"
      ].join("\n")
    );
    const { doc, errors } = parseDoc("docs/plans/sample-plan.md", "/abs/sample-plan.md", profiled);

    expect(errors).toEqual([]);
    const plan = doc as never as {
      actions: Array<{
        execution: { profile: string } | null;
        resolvedExecution: {
          baseline: { capability: string; effort: string };
          phases: { review: { capability: string; reviewIndependence: string } };
        } | null;
      }>;
    };
    expect(plan.actions[0].execution?.profile).toBe("routine_implementation");
    expect(plan.actions[0].resolvedExecution?.baseline).toMatchObject({
      capability: "c2_integrated",
      effort: "e2_standard"
    });
    expect(plan.actions[0].resolvedExecution?.phases.review).toMatchObject({
      capability: "c3_systems",
      reviewIndependence: "separate_run"
    });
  });

  it("accepts an unquoted date, which YAML resolves to a Date object", () => {
    const { doc, errors } = parseDoc("PROJECT.md", "/abs/PROJECT.md", [
      "---",
      "arcadia: v1",
      "type: project",
      "slug: demo",
      "name: Demo",
      "status: active",
      "goal: Ship the thing.",
      "updated: 2026-07-25",
      "---",
      ""
    ].join("\n"));

    expect(errors).toEqual([]);
    expect((doc as never as { updated: string }).updated).toBe("2026-07-25");
  });

  it("rejects an out-of-vocabulary enum, naming the allowed values", () => {
    const { doc, errors } = parseDoc("p.md", "/abs/p.md", PLAN.replace("responsibility: codex", "responsibility: robot"));

    expect(doc).toBeNull();
    const error = errors.find((entry) => entry.field.endsWith("responsibility"));
    expect(error?.message).toContain("must be one of");
    expect(error?.message).toContain("codex");
  });

  it("refuses a clarified action with no next action", () => {
    const broken = PLAN.replace("    next_action: Run the migration against staging.\n", "");
    const { doc, errors } = parseDoc("p.md", "/abs/p.md", broken);

    expect(doc).toBeNull();
    expect(errors.some((entry) => entry.message.includes("must carry a concrete `next_action`"))).toBe(true);
  });

  it("refuses a question_open action that also claims a next action", () => {
    const broken = PLAN.replace(
      "    question: Which environment goes first?",
      "    question: Which environment goes first?\n    next_action: Just start somewhere."
    );
    const { doc, errors } = parseDoc("p.md", "/abs/p.md", broken);

    expect(doc).toBeNull();
    expect(errors.some((entry) => entry.message.includes("must not carry a `next_action`"))).toBe(true);
  });

  it("reports a dependency on an action id that does not exist", () => {
    const broken = PLAN.replace("depends_on: [do-the-thing]", "depends_on: [ghost-action]");
    const { errors } = parseDoc("p.md", "/abs/p.md", broken);

    expect(errors.some((entry) => entry.message.includes('"ghost-action"'))).toBe(true);
  });

  it("collects several problems in one pass rather than stopping at the first", () => {
    const broken = PLAN.replace("responsibility: codex", "responsibility: robot").replace(
      "status: open\n    responsibility: requires_review",
      "status: sideways\n    responsibility: requires_review"
    );
    const { errors } = parseDoc("p.md", "/abs/p.md", broken);

    expect(errors.length).toBeGreaterThan(1);
  });

  it("rejects a non-kebab-case slug and a malformed date", () => {
    const broken = PLAN.replace("slug: sample-plan", "slug: Sample_Plan").replace("updated: 2026-07-25", "updated: last tuesday");
    const { doc, errors } = parseDoc("p.md", "/abs/p.md", broken);

    expect(doc).toBeNull();
    expect(errors.some((entry) => entry.field === "slug")).toBe(true);
    expect(errors.some((entry) => entry.field === "updated")).toBe(true);
  });

  it("refuses an approved decision that records no answer", () => {
    const decision = [
      "---",
      "arcadia: v1",
      "type: decision",
      'id: "0001"',
      "slug: some-call",
      "project: demo",
      "status: approved",
      "question: Which way?",
      "updated: 2026-07-25",
      "---",
      ""
    ].join("\n");
    const { doc, errors } = parseDoc("d.md", "/abs/d.md", decision);

    expect(doc).toBeNull();
    expect(errors.some((entry) => entry.field === "answer")).toBe(true);
  });
});

describe("discovery", () => {
  it("finds managed docs and ignores heavy directories", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", PLAN);
    writeDoc(repo, "README.md", "# Not managed\n");
    writeDoc(repo, "node_modules/pkg/docs/plans/other.md", PLAN);

    const found = discoverDocs(repo);

    expect(found.docs.map((doc) => doc.relativePath)).toEqual([path.join("docs", "plans", "sample-plan.md")]);
  });
});

describe("docs sync", () => {
  it("creates rows, then re-runs as a no-op", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", PLAN);
    const workspace = workspaceWithProject(repo);

    const applied = runDocsSyncCommand({ workspace, apply: true });
    expect(applied.data.totals.create).toBeGreaterThan(0);

    const again = runDocsSyncCommand({ workspace, apply: true });
    expect(again.data.totals.create).toBe(0);
    expect(again.data.totals.update).toBe(0);
    expect(again.data.totals.unchanged).toBeGreaterThan(0);
  });

  it("persists depends_on edges across a sync round trip", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", PLAN);
    const workspace = workspaceWithProject(repo);
    runDocsSyncCommand({ workspace, apply: true });

    const edges = withDatabase(workspace, (db) => {
      const dependent = getWorkItemByDocRef(db, "plan/sample-plan#blocked-thing");
      return listWorkItemDependencies(db, dependent!.id);
    });

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ title: "Do the thing", status: "open" });
    expect(edges[0].docRef).toBe("plan/sample-plan#do-the-thing");

    // Re-running must not fork the edge; the composite key is what guarantees it.
    runDocsSyncCommand({ workspace, apply: true });
    const afterRerun = withDatabase(workspace, (db) => {
      const dependent = getWorkItemByDocRef(db, "plan/sample-plan#blocked-thing");
      return listWorkItemDependencies(db, dependent!.id);
    });
    expect(afterRerun).toHaveLength(1);
  });

  it("removes an edge the document stopped declaring", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", PLAN);
    const workspace = workspaceWithProject(repo);
    runDocsSyncCommand({ workspace, apply: true });

    // The operator deleted the dependency, which is an instruction to drop it.
    writeDoc(
      repo,
      "docs/plans/sample-plan.md",
      PLAN.replace("    depends_on: [do-the-thing]", "    depends_on: []").replace(
        "updated: 2026-07-25",
        "updated: 2026-07-26"
      )
    );
    runDocsSyncCommand({ workspace, apply: true });

    const edges = withDatabase(workspace, (db) => {
      const dependent = getWorkItemByDocRef(db, "plan/sample-plan#blocked-thing");
      return listWorkItemDependencies(db, dependent!.id);
    });
    expect(edges).toEqual([]);
  });

  it("leaves a dependency Arcadia recorded outside ingestion alone", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", PLAN);
    const workspace = workspaceWithProject(repo);
    runDocsSyncCommand({ workspace, apply: true });

    withDatabase(workspace, (db) => {
      const dependent = getWorkItemByDocRef(db, "plan/sample-plan#blocked-thing")!;
      const other = getWorkItemByDocRef(db, "plan/sample-plan#do-the-thing")!;
      const unmanaged = createWorkItemWithOptionalArtifact(db, {
        title: "Hand-captured prerequisite",
        rawInput: "captured by hand",
        queue: "work_queue",
        workClassification: "codex",
        nextAction: "Do it.",
        status: "open"
      });
      db.prepare(
        `INSERT INTO work_item_dependencies (work_item_id, depends_on_work_item_id, doc_ref, created_at)
         VALUES (?, ?, NULL, ?)`
      ).run(dependent.id, unmanaged.workItem.id, "2026-07-26T00:00:00.000Z");
      expect(other.id).not.toBe(unmanaged.workItem.id);
    });

    runDocsSyncCommand({ workspace, apply: true });

    const edges = withDatabase(workspace, (db) => {
      const dependent = getWorkItemByDocRef(db, "plan/sample-plan#blocked-thing");
      return listWorkItemDependencies(db, dependent!.id);
    });
    // Both survive: the managed edge is rewritten, the unmanaged one is untouched.
    expect(edges).toHaveLength(2);
    expect(edges.filter((edge) => edge.docRef === null)).toHaveLength(1);
  });

  it("ends a milestone when its plan is complete, and keeps it active otherwise", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", PLAN);
    const workspace = workspaceWithProject(repo);
    runDocsSyncCommand({ workspace, apply: true });

    const whileActive = withDatabase(workspace, (db) =>
      listMilestonesForProject(db, listProjects(db)[0].id).find((m) => m.title === "First milestone")
    );
    expect(whileActive?.status).toBe("active");

    writeDoc(
      repo,
      "docs/plans/sample-plan.md",
      PLAN.replace("status: active", "status: complete").replace("updated: 2026-07-25", "updated: 2026-07-26")
    );
    runDocsSyncCommand({ workspace, apply: true });

    const afterComplete = withDatabase(workspace, (db) =>
      listMilestonesForProject(db, listProjects(db)[0].id).find((m) => m.title === "First milestone")
    );
    // Left active, this milestone would keep winning `current_milestone`, which
    // picks the newest active one regardless of whether its plan is over.
    expect(afterComplete?.status).toBe("completed");
  });

  it("gives an action its own milestone when it names one", () => {
    const repo = scratch();
    writeDoc(
      repo,
      "docs/plans/sample-plan.md",
      PLAN.replace(
        "  - id: blocked-thing\n    title: Blocked thing",
        "  - id: blocked-thing\n    title: Blocked thing\n    milestone: Second milestone"
      )
    );
    const workspace = workspaceWithProject(repo);
    runDocsSyncCommand({ workspace, apply: true });

    withDatabase(workspace, (db) => {
      const projectId = listProjects(db)[0].id;
      const milestones = listMilestonesForProject(db, projectId);
      const second = milestones.find((m) => m.title === "Second milestone");
      expect(second).toBeDefined();

      // The plan's own milestone keeps the bare ref, so nothing is migrated.
      const first = milestones.find((m) => m.title === "First milestone");
      expect(first?.doc_ref).toBe("plan/sample-plan");

      const overridden = getWorkItemByDocRef(db, "plan/sample-plan#blocked-thing");
      const plain = getWorkItemByDocRef(db, "plan/sample-plan#do-the-thing");
      expect(overridden?.milestone_id).toBe(second!.id);
      expect(plain?.milestone_id).toBe(first!.id);
    });
  });

  it("resolves an already-raised plan question through the decision that answers it", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", PLAN);
    const workspace = workspaceWithProject(repo);
    // The question is raised first, as it was before decisions could answer one.
    runDocsSyncCommand({ workspace, apply: true });
    expect(
      withDatabase(workspace, (db) => getReviewItemByDocRef(db, "plan/sample-plan?question=rollout"))?.status
    ).toBe("open");

    writeDoc(
      repo,
      "docs/plans/sample-plan.md",
      PLAN.replace("    gap_type: missing-decision\ndecisions: []", '    gap_type: missing-decision\n    decision: "0009"\ndecisions: []')
    );
    writeDoc(
      repo,
      "docs/decisions/0009-rollout.md",
      [
        "---",
        "arcadia: v1",
        "type: decision",
        'id: "0009"',
        "slug: rollout-order",
        "project: demo",
        "status: approved",
        "question: Do we cut over per-tenant or all at once?",
        "answer: Per-tenant.",
        "decided: 2026-07-26",
        "updated: 2026-07-26",
        "---",
        ""
      ].join("\n")
    );
    runDocsSyncCommand({ workspace, apply: true });

    const question = withDatabase(workspace, (db) =>
      getReviewItemByDocRef(db, "plan/sample-plan?question=rollout")
    );
    // Answered elsewhere must not keep sitting in the queue as open.
    expect(question?.status).toBe("approved");
    expect(question?.decision_note).toBe("Per-tenant.");
  });

  it("does not raise a second Decision for a question its decision already surfaces", () => {
    const repo = scratch();
    writeDoc(
      repo,
      "docs/plans/sample-plan.md",
      PLAN.replace("    gap_type: missing-decision\ndecisions: []", '    gap_type: missing-decision\n    decision: "0009"\ndecisions: []')
    );
    writeDoc(
      repo,
      "docs/decisions/0009-rollout.md",
      [
        "---",
        "arcadia: v1",
        "type: decision",
        'id: "0009"',
        "slug: rollout-order",
        "project: demo",
        "status: open",
        "question: Do we cut over per-tenant or all at once?",
        "updated: 2026-07-26",
        "---",
        ""
      ].join("\n")
    );
    const workspace = workspaceWithProject(repo);
    runDocsSyncCommand({ workspace, apply: true });

    const question = withDatabase(workspace, (db) =>
      getReviewItemByDocRef(db, "plan/sample-plan?question=rollout")
    );
    expect(question).toBeNull();

    // Exactly one open Decision for the one question, raised by the decision doc.
    const open = withDatabase(workspace, (db) =>
      listReviewItems(db, "open").filter((item) => item.decision_needed.includes("cut over per-tenant"))
    );
    expect(open).toHaveLength(1);
  });

  it("refuses to resolve a question naming a decision that does not exist", () => {
    const repo = scratch();
    writeDoc(
      repo,
      "docs/plans/sample-plan.md",
      PLAN.replace("    gap_type: missing-decision\ndecisions: []", '    gap_type: missing-decision\n    decision: "0099"\ndecisions: []')
    );
    const workspace = workspaceWithProject(repo);
    const result = runDocsSyncCommand({ workspace, apply: true });

    const skipped = result.data.projects
      .flatMap((project) => project.changes)
      .find((change) => change.entity === "question" && change.action === "skipped");
    expect(skipped?.reason).toContain("0099");
  });

  it("writes nothing on a dry run, and previews exactly what apply does", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", PLAN);
    writeDoc(repo, "PROJECT.md", [
      "---",
      "arcadia: v1",
      "type: project",
      "slug: demo",
      "name: Demo",
      "status: active",
      "goal: Ship the thing.",
      // Deliberately the same milestone the plan names: the preview must not
      // report two creates where apply does one create and one adopt.
      "milestone: First milestone",
      "updated: 2026-07-25",
      "---",
      ""
    ].join("\n"));
    const workspace = workspaceWithProject(repo);

    const preview = runDocsSyncCommand({ workspace });
    expect(preview.data.applied).toBe(false);

    const before = withDatabase(workspace, (db) => getWorkItemByDocRef(db, "plan/sample-plan#do-the-thing"));
    expect(before).toBeNull();

    const applied = runDocsSyncCommand({ workspace, apply: true });
    expect(applied.data.totals).toEqual(preview.data.totals);
  });

  it("maps document fields onto the Action, including the clarification columns", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", PLAN);
    const workspace = workspaceWithProject(repo);
    runDocsSyncCommand({ workspace, apply: true });

    const clarified = withDatabase(workspace, (db) =>
      getWorkItemByDocRef(db, "plan/sample-plan#do-the-thing")
    );
    expect(clarified).toMatchObject({
      title: "Do the thing",
      work_classification: "codex",
      queue: "work_queue",
      next_action: "Run the migration against staging.",
      effort: "short",
      clarification_status: "clarified",
      confidence: "high"
    });

    const blocked = withDatabase(workspace, (db) => getWorkItemByDocRef(db, "plan/sample-plan#blocked-thing"));
    expect(blocked).toMatchObject({
      clarification_status: "question_open",
      gap_type: "missing-decision",
      open_question: "Which environment goes first?"
    });
    // An Action the document has not decided must not read as decided.
    expect(blocked?.next_action).toContain("Clarify the desired outcome");
  });

  it("persists a portable execution requirement for compliant runner selection", () => {
    const repo = scratch();
    const profiled = PLAN.replace(
      "    depends_on: []",
      [
        "    depends_on: []",
        "    execution:",
        "      schema: arcadia.execution/v1",
        "      profile: routine_implementation"
      ].join("\n")
    );
    writeDoc(repo, "docs/plans/sample-plan.md", profiled);
    const workspace = workspaceWithProject(repo);
    runDocsSyncCommand({ workspace, apply: true });

    const action = withDatabase(workspace, (db) =>
      getWorkItemByDocRef(db, "plan/sample-plan#do-the-thing")
    );
    expect(JSON.parse(action?.execution_requirement_json as string)).toMatchObject({
      schema: "arcadia.execution/v1",
      profile: "routine_implementation"
    });
  });

  it("follows a renamed title without forking a second Action", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", PLAN);
    const workspace = workspaceWithProject(repo);
    runDocsSyncCommand({ workspace, apply: true });

    const originalId = withDatabase(workspace, (db) =>
      getWorkItemByDocRef(db, "plan/sample-plan#do-the-thing")
    )?.id;

    writeDoc(
      repo,
      "docs/plans/sample-plan.md",
      PLAN.replace("title: Do the thing", "title: Do the thing, but worded differently").replace(
        "updated: 2026-07-25",
        "updated: 2026-07-26"
      )
    );
    runDocsSyncCommand({ workspace, apply: true });

    const after = withDatabase(workspace, (db) => getWorkItemByDocRef(db, "plan/sample-plan#do-the-thing"));
    expect(after?.id).toBe(originalId);
    expect(after?.title).toBe("Do the thing, but worded differently");
  });

  it("refuses to overwrite work that is newer than the document", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", PLAN);
    const workspace = workspaceWithProject(repo);
    runDocsSyncCommand({ workspace, apply: true });

    const id = withDatabase(workspace, (db) => getWorkItemByDocRef(db, "plan/sample-plan#do-the-thing"))?.id;
    // Something in Arcadia moved the Action on — a clarify run, a work update.
    withDatabase(workspace, (db) => updateWorkItem(db, id as string, { status: "in_progress" }));

    // The document still describes the older world, and is dated before it.
    writeDoc(repo, "docs/plans/sample-plan.md", PLAN.replace("updated: 2026-07-25", "updated: 2020-01-01"));
    const result = runDocsSyncCommand({ workspace, apply: true });

    const after = withDatabase(workspace, (db) => getWorkItemByDocRef(db, "plan/sample-plan#do-the-thing"));
    expect(after?.status).toBe("in_progress");
    expect(
      result.data.projects[0].changes.some(
        (change) => change.action === "skipped" && change.reason?.includes("older than the record")
      )
    ).toBe(true);
  });

  it("never touches Actions that Arcadia captured itself", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", PLAN);
    const workspace = workspaceWithProject(repo);

    // Hand-captured work, carrying no doc_ref. A document describing something
    // similar must never be able to claim it.
    const captured = withDatabase(workspace, (db) => {
      const project = listProjects(db)[0];
      return createWorkItemWithOptionalArtifact(db, {
        projectId: project.id,
        title: "Do the thing",
        rawInput: "Do the thing",
        queue: "inbox",
        workClassification: "autonomous",
        nextAction: "Captured by hand, not by a document."
      }).workItem;
    });

    runDocsSyncCommand({ workspace, apply: true });

    const after = withDatabase(workspace, (db) => getWorkItem(db, captured.id));
    expect(after?.next_action).toBe("Captured by hand, not by a document.");
    expect(after?.doc_ref ?? null).toBeNull();

    const rollup = withDatabase(workspace, (db) =>
      listPortfolioProjects(db).find((row) => row.slug === "demo")
    );
    // Two document Actions plus the hand-captured one.
    expect(rollup?.doc_backed_actions).toBe(2);
  });

  it("ignores documents belonging to another Project", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/other.md", PLAN.replace("project: demo", "project: somewhere-else"));
    const workspace = workspaceWithProject(repo);

    const result = runDocsSyncCommand({ workspace, apply: true });

    expect(result.data.projects[0].foreign).toHaveLength(1);
    expect(result.data.totals.create).toBe(0);
  });

  it("refuses two documents that claim the same reference", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", PLAN);
    writeDoc(repo, "docs/plans/duplicate.md", PLAN);
    const workspace = workspaceWithProject(repo);

    const result = runDocsSyncCommand({ workspace, apply: true });

    expect(result.data.errorCount).toBeGreaterThan(0);
    expect(result.data.projects[0].errors.some((error) => error.message.includes("also claimed by"))).toBe(true);
  });

  it("turns a plan-level question into a Decision, and does not reopen a decided one", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", PLAN);
    const workspace = workspaceWithProject(repo);
    runDocsSyncCommand({ workspace, apply: true });

    const open = withDatabase(workspace, (db) => listReviewItems(db, "open"));
    const question = open.find((item) => item.decision_needed.startsWith("Do we cut over"));
    expect(question?.resolved_intent).toBe("ActionClarification");

    withDatabase(workspace, (db) =>
      db.prepare("UPDATE review_items SET status = 'approved' WHERE id = ?").run(question?.id)
    );

    writeDoc(
      repo,
      "docs/plans/sample-plan.md",
      PLAN.replace("Do we cut over per-tenant or all at once?", "Reworded, per-tenant or all at once?").replace(
        "updated: 2026-07-25",
        "updated: 2026-07-26"
      )
    );
    const rerun = runDocsSyncCommand({ workspace, apply: true });

    expect(
      rerun.data.projects[0].changes.some(
        (change) => change.entity === "question" && change.reason?.includes("not reopening")
      )
    ).toBe(true);
  });

  it("reports malformed frontmatter instead of silently skipping the file", () => {
    const repo = scratch();
    // An unquoted question containing a colon — the way chatbot-written YAML
    // most often breaks. The file claims the marker, so it must produce an
    // error rather than quietly vanishing from the portfolio.
    writeDoc(
      repo,
      "docs/plans/broken.md",
      PLAN.replace("question: Do we cut over per-tenant or all at once?", "question: Reworded: with a colon")
    );
    const workspace = workspaceWithProject(repo);

    const result = runDocsSyncCommand({ workspace });

    expect(result.data.errorCount).toBeGreaterThan(0);
    expect(result.data.projects[0].errors[0].message).toContain("Invalid YAML");
    expect(result.data.projects[0].rejected).toContain(path.join("docs", "plans", "broken.md"));
  });

  it("reports a Project with no repo_path instead of failing", () => {
    const workspace = path.join(scratch(), "ws");
    initWorkspace(workspace);
    withDatabase(workspace, (db) =>
      upsertProject(db, {
        name: "Pathless",
        mission: "No repository.",
        status: "active",
        currentMilestone: "Initial",
        nextAction: "Start",
        workClassification: "codex"
      })
    );

    const result = runDocsSyncCommand({ workspace });
    expect(result.data.projects[0].changes[0].reason).toContain("No repo_path");
  });
});

describe("portfolio view", () => {
  it("separates work that is ready from work that is not", () => {
    const repo = scratch();
    writeDoc(repo, "docs/plans/sample-plan.md", PLAN);
    const workspace = workspaceWithProject(repo);
    runDocsSyncCommand({ workspace, apply: true });

    // An Action captured before clarification existed reads NULL, and must be
    // counted separately from one known to be unclarified.
    withDatabase(workspace, (db) => {
      const project = listProjects(db)[0];
      createWorkItemWithOptionalArtifact(db, {
        projectId: project.id,
        title: "Predates clarification",
        rawInput: "Predates clarification",
        queue: "inbox",
        workClassification: "autonomous",
        nextAction: "Something older."
      });
    });

    const portfolio = runPortfolioCommand({ workspace });

    expect(portfolio.data.totals.clarified).toBe(1);
    expect(portfolio.data.totals.questionOpen).toBe(1);
    expect(portfolio.data.totals.unevaluated).toBe(1);
    expect(portfolio.data.openDecisions.length).toBeGreaterThan(0);
  });
});
