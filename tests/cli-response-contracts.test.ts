import { mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProject, createTempConfigPath, createTempWorkspacePath, importWorkItem, initializedWorkspace, parseJson, runCli, cleanupTrackedPaths } from "./cli-response-fixture.js";

afterEach(cleanupTrackedPaths);

describe("CLI response contract — stable error contracts", () => {
  it("round-trips every clarification flag on work update, including clearing them", () => {
    const workspace = initializedWorkspace();
    const workItem = importWorkItem(workspace, {
      title: "Sort out the sync job",
      queue: "requires_review",
      classification: "requires_review",
      nextAction: "Clarify the desired outcome or approve a Codex execution path."
    });

    const set = parseJson(runCli([
      "work",
      "update",
      workItem.id,
      "--workspace",
      workspace,
      "--clarification-status",
      "question_open",
      "--gap-type",
      "missing-decision",
      "--question",
      "Should the nightly sync retry on partial failure, or fail the whole run?",
      "--confidence",
      "medium",
      "--source",
      "docs/plans/nightly-sync.md",
      "--json"
    ]).stdout);

    expect(set.ok).toBe(true);
    expect(set.data.updated).toEqual([
      "clarificationStatus",
      "gapType",
      "openQuestion",
      "clarificationSource",
      "confidence"
    ]);
    expect(set.data.workItem.clarification_status).toBe("question_open");
    expect(set.data.workItem.gap_type).toBe("missing-decision");
    expect(set.data.workItem.open_question).toBe(
      "Should the nightly sync retry on partial failure, or fail the whole run?"
    );
    expect(set.data.workItem.clarification_source).toBe("docs/plans/nightly-sync.md");
    expect(set.data.workItem.confidence).toBe("medium");

    const cleared = parseJson(runCli([
      "work",
      "update",
      workItem.id,
      "--workspace",
      workspace,
      "--clarification-status",
      "none",
      "--gap-type",
      "none",
      "--question",
      "none",
      "--confidence",
      "none",
      "--source",
      "none",
      "--json"
    ]).stdout);

    expect(cleared.ok).toBe(true);
    expect(cleared.data.workItem.clarification_status).toBeNull();
    expect(cleared.data.workItem.gap_type).toBeNull();
    expect(cleared.data.workItem.open_question).toBeNull();
    expect(cleared.data.workItem.clarification_source).toBeNull();
    expect(cleared.data.workItem.confidence).toBeNull();
  });

  it("rejects clarification values outside the rubric vocabulary", () => {
    const workspace = initializedWorkspace();
    const workItem = importWorkItem(workspace, {
      title: "Reject bad gap types",
      queue: "inbox",
      classification: "autonomous",
      nextAction: "Do the thing"
    });

    const result = runCli([
      "work",
      "update",
      workItem.id,
      "--workspace",
      workspace,
      "--gap-type",
      "missing-everything",
      "--json"
    ]);

    expect(result.status).not.toBe(0);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("work.update");
    expect(json.error.message).toContain("Gap type must be one of");
  });

  it("captures every new Action as unclarified", () => {
    const workspace = initializedWorkspace();

    const captured = parseJson(runCli([
      "capture",
      "--workspace",
      workspace,
      "--text",
      "Something vague about the billing rewrite",
      "--json"
    ]).stdout);

    expect(captured.ok).toBe(true);
    // capture is not clarify: the Action lands with a placeholder next action,
    // and clarification_status — not that text — is what says so.
    expect(captured.data.workItem.clarification_status).toBe("unclarified");
    expect(captured.data.workItem.gap_type).toBeNull();
    expect(captured.data.workItem.open_question).toBeNull();

    const listed = parseJson(runCli(["work", "list", "--workspace", workspace, "--json"]).stdout);
    const found = listed.data.workItems.find((item: { id: string }) => item.id === captured.data.workItem.id);
    expect(found.clarification_status).toBe("unclarified");
  });

  it("runs a clarification Decision through open, list, and resolve", () => {
    const workspace = initializedWorkspace();
    const workItem = importWorkItem(workspace, {
      title: "Fix the flaky checkout test",
      queue: "requires_review",
      classification: "requires_review",
      nextAction: "Clarify the desired outcome or approve a Codex execution path."
    });

    const opened = parseJson(runCli([
      "review",
      "open",
      workItem.id,
      "--workspace",
      workspace,
      "--question",
      "Which of the three failing assertions fails in isolation?",
      "--gap-type",
      "missing-definition",
      "--json"
    ]).stdout);

    expect(opened.ok).toBe(true);
    expect(opened.command).toBe("review.open");
    expect(opened.data.item.resolvedIntent).toBe("ActionClarification");
    expect(opened.data.item.decisionNeeded).toBe(
      "Which of the three failing assertions fails in isolation?"
    );
    // The Decision holds the question; the Action records that it is blocked on one.
    expect(opened.data.workItem.clarification_status).toBe("question_open");
    expect(opened.data.workItem.gap_type).toBe("missing-definition");
    expect(opened.data.workItem.open_question).toBe(
      "Which of the three failing assertions fails in isolation?"
    );

    const listed = parseJson(runCli(["review", "--workspace", workspace, "--json"]).stdout);
    const found = listed.data.items.find((item: { id: string }) => item.id === opened.data.item.id);
    expect(found).toBeDefined();
    expect(found.status).toBe("open");

    const resolved = parseJson(runCli([
      "review",
      "approve",
      opened.data.item.slug,
      "--workspace",
      workspace,
      "--answer",
      "Only the shipping-estimate assertion fails in isolation.",
      "--json"
    ]).stdout);

    expect(resolved.ok).toBe(true);
    // Answering is information, not execution: no run, no ask.
    expect(resolved.data.run).toBeNull();
    expect(resolved.data.approval).toBeNull();
    expect(resolved.data.item.status).toBe("approved");

    const after = parseJson(runCli(["work", "list", "--workspace", workspace, "--json"]).stdout);
    const action = after.data.workItems.find((item: { id: string }) => item.id === workItem.id);
    // The answer is an input to clarification, not the next action itself, so
    // the Action returns to unclarified for an explicit re-clarify.
    expect(action.clarification_status).toBe("unclarified");
    expect(action.open_question).toBeNull();
    expect(action.clarification_source).toContain("Only the shipping-estimate assertion fails in isolation.");

    const closed = parseJson(runCli(["review", "--workspace", workspace, "--json"]).stdout);
    expect(closed.data.items.some((item: { id: string }) => item.id === opened.data.item.id)).toBe(false);
  });

  it("refuses to resolve a clarification Decision without an answer", () => {
    const workspace = initializedWorkspace();
    const workItem = importWorkItem(workspace, {
      title: "Decide the retention window",
      queue: "requires_review",
      classification: "requires_review",
      nextAction: "Clarify the desired outcome."
    });

    const opened = parseJson(runCli([
      "review",
      "open",
      workItem.id,
      "--workspace",
      workspace,
      "--question",
      "How long should audit logs be retained?",
      "--gap-type",
      "missing-decision",
      "--json"
    ]).stdout);

    const result = runCli(["review", "approve", opened.data.item.slug, "--workspace", workspace, "--json"]);

    expect(result.status).not.toBe(0);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.error.message).toContain("--answer");
  });

  it("records a free-text adapter reply as the answer to a clarification Decision", () => {
    const workspace = initializedWorkspace();
    const workItem = importWorkItem(workspace, {
      title: "Choose the audit-log retention period",
      queue: "requires_review",
      classification: "requires_review",
      nextAction: "Clarify the desired retention period."
    });

    const opened = parseJson(runCli([
      "review",
      "open",
      workItem.id,
      "--workspace",
      workspace,
      "--question",
      "How long should audit logs be retained?",
      "--gap-type",
      "missing-decision",
      "--json"
    ]).stdout);

    const resolved = parseJson(runCli([
      "ask",
      "Retain them for 90 days, then delete them.",
      "--workspace",
      workspace,
      "--reply-review-id",
      opened.data.item.id,
      "--json"
    ]).stdout);

    expect(resolved.ok).toBe(true);
    expect(resolved.data.resolvedIntent.intentId).toBe("ReviewResponse");
    expect(resolved.data.result.summary).toContain("answer recorded");

    const after = parseJson(runCli(["work", "list", "--workspace", workspace, "--json"]).stdout);
    const action = after.data.workItems.find((item: { id: string }) => item.id === workItem.id);
    expect(action.clarification_status).toBe("unclarified");
    expect(action.open_question).toBeNull();
    expect(action.clarification_source).toContain("Retain them for 90 days");

    const closed = parseJson(runCli(["review", "--workspace", workspace, "--json"]).stdout);
    expect(closed.data.items.some((item: { id: string }) => item.id === opened.data.item.id)).toBe(false);
  });

  it("rejecting a clarification Decision releases the Action's open question", () => {
    const workspace = initializedWorkspace();
    const workItem = importWorkItem(workspace, {
      title: "Rework the onboarding email",
      queue: "requires_review",
      classification: "requires_review",
      nextAction: "Clarify the desired outcome."
    });

    const opened = parseJson(runCli([
      "review",
      "open",
      workItem.id,
      "--workspace",
      workspace,
      "--question",
      "Should the email mention pricing?",
      "--json"
    ]).stdout);

    const rejected = parseJson(runCli([
      "review",
      "reject",
      opened.data.item.slug,
      "--workspace",
      workspace,
      "--json"
    ]).stdout);
    expect(rejected.ok).toBe(true);

    const after = parseJson(runCli(["work", "list", "--workspace", workspace, "--json"]).stdout);
    const action = after.data.workItems.find((item: { id: string }) => item.id === workItem.id);
    expect(action.clarification_status).toBe("unclarified");
    expect(action.open_question).toBeNull();
  });

  it("adds subtasks that inherit the parent's context and list beneath it", () => {
    const workspace = initializedWorkspace();
    const created = createProject(workspace);
    const parentId = created.workItem.id;

    const first = parseJson(runCli([
      "work",
      "add-subtask",
      parentId,
      "--workspace",
      workspace,
      "--title",
      "Migrate the invoice table",
      "--json"
    ]).stdout);

    expect(first.ok).toBe(true);
    expect(first.command).toBe("work.add-subtask");
    expect(first.data.workItem.parent_work_item_id).toBe(parentId);
    expect(first.data.workItem.project_id).toBe(created.project.id);
    // Naming a subtask is not deciding how to do it.
    expect(first.data.workItem.clarification_status).toBe("unclarified");

    const second = parseJson(runCli([
      "work",
      "add-subtask",
      parentId,
      "--workspace",
      workspace,
      "--title",
      "Backfill historical invoices",
      "--next-action",
      "Run the backfill script against staging",
      "--json"
    ]).stdout);
    expect(second.data.workItem.next_action).toBe("Run the backfill script against staging");

    const listed = runCli(["work", "list", "--workspace", workspace]);
    expect(listed.status).toBe(0);
    const parentLine = listed.stdout.split("\n").findIndex((line) => line.includes(parentId));
    const childLine = listed.stdout.split("\n").findIndex((line) => line.includes(first.data.workItem.id));
    expect(childLine).toBeGreaterThan(parentLine);
    expect(listed.stdout).toContain("  - Migrate the invoice table");
    expect(listed.stdout).toContain("  - Backfill historical invoices");
  });

  it("emits stable JSON when adding a subtask to a missing parent", () => {
    const workspace = initializedWorkspace();

    const result = runCli([
      "work",
      "add-subtask",
      "work_missing",
      "--workspace",
      workspace,
      "--title",
      "Orphan subtask",
      "--json"
    ]);

    expect(result.status).toBe(3);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("work.add-subtask");
    expect(json.error.code).toBe("WORK_ITEM_NOT_FOUND");
  });

  it("marks work items done with JSON output", () => {
    const workspace = initializedWorkspace();
    const workItem = importWorkItem(workspace, {
      title: "Complete this work",
      queue: "work_queue",
      classification: "agent",
      nextAction: "Finish it"
    });

    const result = runCli(["work", "done", workItem.id, "--workspace", workspace, "--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("work.done");
    expect(json.data.workItem.id).toBe(workItem.id);
    expect(json.data.workItem.status).toBe("done");
  });

  it("emits stable JSON for inbox import validation errors", () => {
    const workspace = initializedWorkspace();
    const result = runCli([
      "inbox",
      "import",
      "--workspace",
      workspace,
      "--title",
      "Bad queue",
      "--input",
      "Bad queue",
      "--queue",
      "bad_queue",
      "--classification",
      "agent",
      "--next-action",
      "Should fail",
      "--json"
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("inbox.import");
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toContain("Queue must be one of");
  });

  it("emits stable JSON for weekly review date validation errors", () => {
    const workspace = initializedWorkspace();
    const result = runCli([
      "review",
      "weekly",
      "--workspace",
      workspace,
      "--since",
      "2026-06-10",
      "--until",
      "2026-06-09",
      "--json"
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("review.weekly");
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toBe("Review window since date must be on or before until date.");
    expect(json.error.details).toEqual({ since: "2026-06-10", until: "2026-06-09" });
  });

  it("emits stable JSON for malformed weekly review dates", () => {
    const workspace = initializedWorkspace();
    const result = runCli([
      "review",
      "weekly",
      "--workspace",
      workspace,
      "--since",
      "2026-02-30",
      "--json"
    ]);

    expect(result.status).toBe(2);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("review.weekly");
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.details).toEqual({ field: "since", value: "2026-02-30" });
  });

  it("emits stable JSON for inbox import missing project references", () => {
    const workspace = initializedWorkspace();
    const result = runCli([
      "inbox",
      "import",
      "--workspace",
      workspace,
      "--title",
      "Needs project",
      "--input",
      "Needs project",
      "--queue",
      "work_queue",
      "--classification",
      "agent",
      "--next-action",
      "Find project",
      "--project",
      "proj_missing",
      "--json"
    ]);

    expect(result.status).toBe(3);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("inbox.import");
    expect(json.error.code).toBe("PROJECT_NOT_FOUND");
    expect(json.error.details.projectId).toBe("proj_missing");
  });

  it("emits stable JSON for project update validation errors", () => {
    const workspace = initializedWorkspace();
    const created = createProject(workspace);

    const result = runCli([
      "project",
      "update",
      created.project.id,
      "--workspace",
      workspace,
      "--status",
      "not_a_status",
      "--json"
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("project.update");
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toContain("Project status must be one of");
  });

  it("emits stable JSON for duplicate project imports", () => {
    const workspace = initializedWorkspace();
    createProject(workspace);

    const result = runCli([
      "project",
      "import",
      "--workspace",
      workspace,
      "--name",
      "CLI Fixture Project",
      "--mission",
      "Support CLI tests.",
      "--milestone",
      "Initial milestone",
      "--next-action",
      "Exercise the CLI",
      "--classification",
      "agent",
      "--json"
    ]);

    expect(result.status).toBe(2);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("project.import");
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toBe("Project already exists.");
  });

  it("emits stable JSON for missing project updates", () => {
    const workspace = initializedWorkspace();
    const result = runCli([
      "project",
      "update",
      "proj_missing",
      "--workspace",
      workspace,
      "--status",
      "paused",
      "--json"
    ]);

    expect(result.status).toBe(3);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("project.update");
    expect(json.error.code).toBe("PROJECT_NOT_FOUND");
    expect(json.error.details.projectId).toBe("proj_missing");
  });

  it("emits stable JSON for missing milestone create project references", () => {
    const workspace = initializedWorkspace();
    const result = runCli([
      "milestone",
      "create",
      "proj_missing",
      "--workspace",
      workspace,
      "--title",
      "Missing parent",
      "--json"
    ]);

    expect(result.status).toBe(3);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("milestone.create");
    expect(json.error.code).toBe("PROJECT_NOT_FOUND");
    expect(json.error.details.projectId).toBe("proj_missing");
  });

  it("emits stable JSON for missing milestone completion", () => {
    const workspace = initializedWorkspace();
    const result = runCli(["milestone", "complete", "ms_missing", "--workspace", workspace, "--json"]);

    expect(result.status).toBe(3);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("milestone.complete");
    expect(json.error.code).toBe("MILESTONE_NOT_FOUND");
    expect(json.error.details.milestoneId).toBe("ms_missing");
  });

  it("emits stable JSON for artifact update validation errors", () => {
    const workspace = initializedWorkspace();
    const created = createProject(workspace);
    const artifactId = created.artifact?.id;
    expect(artifactId).toBeTruthy();

    const result = runCli([
      "artifact",
      "update",
      artifactId,
      "--workspace",
      workspace,
      "--status",
      "not_a_status",
      "--json"
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("artifact.update");
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toContain("Artifact status must be one of");
  });

  it("emits stable JSON when artifact update has no fields", () => {
    const workspace = initializedWorkspace();
    const created = createProject(workspace);
    const artifactId = created.artifact?.id;
    expect(artifactId).toBeTruthy();

    const result = runCli(["artifact", "update", artifactId, "--workspace", workspace, "--json"]);

    expect(result.status).toBe(2);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("artifact.update");
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.details.fields).toEqual(["status", "path"]);
  });

  it("emits stable JSON for missing artifact updates", () => {
    const workspace = initializedWorkspace();
    const result = runCli([
      "artifact",
      "update",
      "art_missing",
      "--workspace",
      workspace,
      "--status",
      "ready",
      "--json"
    ]);

    expect(result.status).toBe(3);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("artifact.update");
    expect(json.error.code).toBe("ARTIFACT_NOT_FOUND");
    expect(json.error.details.artifactId).toBe("art_missing");
  });

  it("emits stable JSON for work update validation errors", () => {
    const workspace = initializedWorkspace();
    const workItem = importWorkItem(workspace, {
      title: "Invalid update target",
      queue: "work_queue",
      classification: "agent",
      nextAction: "Stay valid"
    });

    const result = runCli([
      "work",
      "update",
      workItem.id,
      "--workspace",
      workspace,
      "--status",
      "not_a_status",
      "--json"
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("work.update");
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toContain("Action status must be one of");
  });

  it("emits stable JSON when work update has no fields", () => {
    const workspace = initializedWorkspace();
    const workItem = importWorkItem(workspace, {
      title: "No fields target",
      queue: "work_queue",
      classification: "agent",
      nextAction: "Stay valid"
    });

    const result = runCli(["work", "update", workItem.id, "--workspace", workspace, "--json"]);

    expect(result.status).toBe(2);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("work.update");
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.details.fields).toEqual([
      "queue",
      "classification",
      "nextAction",
      "status",
      "effort",
      "expectedArtifact",
      "clarificationStatus",
      "gapType",
      "openQuestion",
      "clarificationSource",
      "confidence",
      "parentWorkItemId"
    ]);
  });

  it("emits stable JSON for missing work item updates", () => {
    const workspace = initializedWorkspace();
    const result = runCli([
      "work",
      "update",
      "work_missing",
      "--workspace",
      workspace,
      "--status",
      "in_progress",
      "--json"
    ]);

    expect(result.status).toBe(3);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("work.update");
    expect(json.error.code).toBe("WORK_ITEM_NOT_FOUND");
    expect(json.error.details.workItemId).toBe("work_missing");
  });

  it("emits stable JSON for missing work item completion", () => {
    const workspace = initializedWorkspace();
    const result = runCli(["work", "done", "work_missing", "--workspace", workspace, "--json"]);

    expect(result.status).toBe(3);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("work.done");
    expect(json.error.code).toBe("WORK_ITEM_NOT_FOUND");
    expect(json.error.details.workItemId).toBe("work_missing");
  });

  it("emits stable JSON for inbox import usage errors", () => {
    const workspace = initializedWorkspace();
    const result = runCli(["inbox", "import", "--workspace", workspace, "--json"]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("inbox.import");
    expect(json.error.code).toBe("USAGE_ERROR");
    expect(json.error.message).toContain("required option");
  });

  it("defaults status to the current directory workspace", () => {
    const workspace = initializedWorkspace();
    const result = runCli(["status", "--json"], {}, { cwd: workspace });

    expect(result.status).toBe(0);
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("status");
    expect(json.workspace).toBe(realpathSync(workspace));
  });

  it("emits stable JSON for missing workspaces", () => {
    const missingWorkspace = path.join(tmpdir(), `arcadia-missing-${Date.now()}`);
    const result = runCli(["status", "--workspace", missingWorkspace, "--json"]);

    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("status");
    expect(json.workspace).toBe(path.resolve(missingWorkspace));
    expect(json.error.code).toBe("WORKSPACE_NOT_FOUND");
    expect(json.error.message).toBe("Workspace not found.");
  });

  it("emits stable JSON for weekly review missing workspaces", () => {
    const missingWorkspace = path.join(tmpdir(), `arcadia-missing-review-${Date.now()}`);
    const result = runCli(["review", "weekly", "--workspace", missingWorkspace, "--json"]);

    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("review.weekly");
    expect(json.workspace).toBe(path.resolve(missingWorkspace));
    expect(json.error.code).toBe("WORKSPACE_NOT_FOUND");
  });

  it("emits stable JSON for uninitialized databases", () => {
    const workspace = createTempWorkspacePath();
    mkdirSync(workspace, { recursive: true });
    const result = runCli(["work", "list", "--workspace", workspace, "--json"]);

    expect(result.status).toBe(3);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("work.list");
    expect(json.error.code).toBe("DATABASE_NOT_INITIALIZED");
    expect(json.error.message).toBe("Arcadia database is not initialized.");
  });

  it("emits stable JSON for weekly review uninitialized databases", () => {
    const workspace = createTempWorkspacePath();
    mkdirSync(workspace, { recursive: true });
    const result = runCli(["review", "weekly", "--workspace", workspace, "--json"]);

    expect(result.status).toBe(3);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("review.weekly");
    expect(json.error.code).toBe("DATABASE_NOT_INITIALIZED");
  });

  it("emits stable human errors without stack traces", () => {
    const result = runCli(["status", "--workspace", path.join(tmpdir(), "arcadia-nope")]);

    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("Error [WORKSPACE_NOT_FOUND]: Workspace not found.");
    expect(result.stderr).not.toContain("at ");
  });

  it("emits a helpful missing workspace error", () => {
    const result = runCli(["status", "--json"], {}, { configPath: createTempConfigPath() });

    expect(result.status).toBe(2);
    const json = parseJson(result.stderr);
    expect(json.error.code).toBe("USAGE_ERROR");
    expect(json.error.message).toContain("arcadia config set defaultWorkspace <path>");
  });
});
