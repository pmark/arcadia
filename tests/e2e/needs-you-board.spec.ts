import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test as base, type Page } from "@playwright/test";
import { runProjectPrepareCommand } from "../../src/commands/project.js";
import { runReviewApproveCommand } from "../../src/commands/review.js";
import { withDatabase } from "../../src/db/connection.js";
import { createCodexInvocation, createWorkItemWithOptionalArtifact } from "../../src/db/repositories.js";
import { createE2EWorkspace, type E2EWorkspace } from "./fixtures/workspace.js";

const CANONICAL_REQUEST = "Prepare a plan for adding Pinterest publishing to Rebuster.";

const test = base.extend<{ arcadia: E2EWorkspace }>({
  arcadia: async ({}, use, testInfo) => {
    const arcadia = await createE2EWorkspace();
    try {
      await use(arcadia);
    } finally {
      await arcadia.stop(testInfo.status !== testInfo.expectedStatus);
    }
  }
});

async function submitAsk(page: Page, arcadia: E2EWorkspace, request: string) {
  await page.goto(`${arcadia.url}/dashboard`);
  await page.getByPlaceholder("Ask Arcadia").fill(request);
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText(/Action created\.|Captured in Back Burner\./)).toBeVisible();
}

function openReviewCount(arcadia: E2EWorkspace): number {
  return withDatabase(arcadia.root, (db) =>
    (db.prepare("SELECT COUNT(*) AS count FROM review_items WHERE status = 'open'").get() as { count: number }).count
  );
}

test("the board shows a plain empty state with nothing open", async ({ page, arcadia }) => {
  await page.goto(`${arcadia.url}/review`);
  await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
  await expect(page.getByText("Nothing needs you right now.")).toBeVisible();
});

test("an outcome previews its consequence and can be cancelled before it fires", async ({ page, arcadia }) => {
  await submitAsk(page, arcadia, CANONICAL_REQUEST);
  await page.goto(`${arcadia.url}/review`);
  await expect(page.getByRole("button", { name: "Approve & Run", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Approve & Run", exact: true }).click();
  await expect(page.getByText(/This will:/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm: Approve & Run" })).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText(/This will:/)).toHaveCount(0);
  expect(openReviewCount(arcadia)).toBe(1);
});

test("confirming an outcome runs it and leaves a receipt naming the Decision and transition", async ({ page, arcadia }) => {
  await submitAsk(page, arcadia, CANONICAL_REQUEST);
  await page.goto(`${arcadia.url}/review`);
  const decisionId = withDatabase(arcadia.root, (db) =>
    (db.prepare("SELECT id FROM review_items WHERE status = 'open' LIMIT 1").get() as { id: string }).id
  );

  // Reject rather than approve-and-execute: approving navigates straight to
  // the started Run's own detail page (its existing, separate durable record
  // of what happened -- covered by mission-control.spec.ts), so it never
  // renders this inline receipt. Reject is the outcome that actually stays
  // on /review and exercises the receipt panel this Action adds.
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await page.getByRole("button", { name: "Confirm: Reject" }).click();

  await expect(page.getByText(/^Receipt ·/)).toBeVisible();
  await expect(page.getByText(/Decision rejected/)).toBeVisible();
  expect(withDatabase(arcadia.root, (db) =>
    (db.prepare("SELECT status FROM review_items WHERE id = ?").get(decisionId) as { status: string }).status
  )).toBe("rejected");
});

test("a deferral without a trigger is refused and one with a trigger is persisted", async ({ page, arcadia }) => {
  await submitAsk(page, arcadia, CANONICAL_REQUEST);
  await page.goto(`${arcadia.url}/review`);
  const decisionId = withDatabase(arcadia.root, (db) =>
    (db.prepare("SELECT id FROM review_items WHERE status = 'open' LIMIT 1").get() as { id: string }).id
  );

  await page.getByRole("button", { name: "Defer", exact: true }).click();
  const confirmDefer = page.getByRole("button", { name: "Confirm: Defer" });
  await expect(confirmDefer).toBeDisabled();

  await page.getByLabel("Trigger condition").fill("When Rebuster's next release adds a second channel.");
  await expect(confirmDefer).toBeEnabled();
  await confirmDefer.click();

  await expect(page.getByText(/^Receipt ·/)).toBeVisible();
  const deferred = withDatabase(arcadia.root, (db) =>
    db.prepare("SELECT status, decision_note FROM review_items WHERE id = ?").get(decisionId) as {
      status: string;
      decision_note: string | null;
    }
  );
  expect(deferred.status).toBe("deferred");
  expect(deferred.decision_note).toContain("When Rebuster's next release adds a second channel.");
});

test("a prepared plan is readable at phone width and requires feedback before it is sent back", async ({ page, arcadia }) => {
  const repository = path.join(arcadia.root, "repos", "prepared-plan");
  mkdirSync(repository, { recursive: true });
  const idea = "A calm local tool that turns workshop observations into a prioritized improvement queue.";
  const prepared = runProjectPrepareCommand({
    workspace: arcadia.root,
    name: "Workshop Queue",
    idea,
    path: repository,
    agentProfile: "fake_planning"
  });
  runReviewApproveCommand({ workspace: arcadia.root, id: prepared.data.planning.planningDecision!.id });

  await expect.poll(() => withDatabase(arcadia.root, (db) =>
    db.prepare(
      "SELECT id FROM review_items WHERE work_item_id = ? AND resolved_intent = 'CodexPlanningArtifactAcceptance' AND status = 'open'"
    ).get(prepared.data.workItem.id) as { id: string } | undefined
  )).toBeTruthy();

  await page.goto(`${arcadia.url}/review`);
  const plan = page.getByRole("region", { name: "Pinterest Publishing Plan" });
  await expect(plan.getByText("Prepared plan", { exact: true })).toBeVisible();
  await expect(plan.getByRole("heading", { name: "Pinterest Publishing Plan" })).toBeVisible();
  await expect(plan.getByText(idea, { exact: true })).toBeVisible();
  await expect(plan.getByText("Plan the first usable build", { exact: true })).toBeVisible();
  await expect(plan.getByText("Define the repository-only publishing adapter contract and fixtures.", { exact: true })).toBeVisible();
  await expect(plan.getByText(/Reserve model use for clarifying the Actions below/)).toBeVisible();
  await expect(plan.getByText(repository, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Send back", exact: true }).click();
  const confirm = page.getByRole("button", { name: "Confirm: Send back" });
  await expect(confirm).toBeDisabled();
  const feedback = "Clarify which fixtures prove the first Action is complete.";
  await page.getByLabel("What needs refinement?").fill(feedback);
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByText(/Sent back for refinement/)).toBeVisible();
  const state = withDatabase(arcadia.root, (db) => ({
    decision: db.prepare(
      "SELECT status, decision_note, context_json FROM review_items WHERE work_item_id = ? AND resolved_intent = 'CodexPlanningArtifactAcceptance'"
    ).get(prepared.data.workItem.id) as { status: string; decision_note: string; context_json: string },
    action: db.prepare("SELECT status, queue, work_classification, next_action FROM work_items WHERE id = ?")
      .get(prepared.data.workItem.id) as { status: string; queue: string; work_classification: string; next_action: string }
  }));
  expect(state.decision).toMatchObject({ status: "rejected", decision_note: expect.stringContaining(feedback) });
  expect(JSON.parse(state.decision.context_json)).toMatchObject({
    refinementFeedback: feedback,
    judgedArtifact: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }
  });
  expect(state.action).toMatchObject({ status: "open", queue: "work_queue", work_classification: "codex" });
});

test("the dashboard's own quick-defer keeps working without collecting a trigger", async ({ page, arcadia }) => {
  await submitAsk(page, arcadia, CANONICAL_REQUEST);
  const decisionId = withDatabase(arcadia.root, (db) =>
    (db.prepare("SELECT id FROM review_items WHERE status = 'open' LIMIT 1").get() as { id: string }).id
  );

  // The dashboard's own quick-action lane predates the Needs you board and
  // never collects a trigger; deferring from there must keep working exactly
  // as before, since this Action's "trigger required" rule is scoped to the
  // board's own confirm control (apps/dashboard/app/review/page.tsx), not
  // the shared /api/review-action route every surface calls.
  await page.goto(`${arcadia.url}/dashboard`);
  await page.getByRole("button", { name: "Defer", exact: true }).click();
  await expect(page.getByText(/deferred/i)).toBeVisible();

  const deferred = withDatabase(arcadia.root, (db) =>
    db.prepare("SELECT status, decision_note FROM review_items WHERE id = ?").get(decisionId) as {
      status: string;
      decision_note: string | null;
    }
  );
  expect(deferred.status).toBe("deferred");
  expect(deferred.decision_note).toBe("Deferred for future review.");
});

test("a standalone Codex packet previews the guarded handoff and leaves an honest receipt", async ({ page, arcadia }) => {
  const packet = withDatabase(arcadia.root, (db) => {
    const project = db.prepare("SELECT id FROM projects WHERE name = 'Rebuster'").get() as { id: string };
    const milestone = db.prepare(
      "SELECT id FROM milestones WHERE project_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
    ).get(project.id) as { id: string };
    const action = createWorkItemWithOptionalArtifact(db, {
      projectId: project.id,
      milestoneId: milestone.id,
      title: "Build Pinterest publishing adapter",
      rawInput: "Build the approved Pinterest publishing adapter.",
      queue: "work_queue",
      workClassification: "codex",
      nextAction: "Run the prepared build packet.",
      expectedArtifact: "Working Pinterest publishing adapter"
    }).workItem;
    return createCodexInvocation(db, {
      id: "codex_packet_needs_you",
      purpose: "build",
      agentProfile: "fake_build",
      workspaceScope: arcadia.root,
      command: "arcadia work run action-pinterest --allow-codex-build",
      promptPath: "prompts/codex/codex_packet_needs_you/prompt.md",
      jsonlOutputPath: "prompts/codex/codex_packet_needs_you/output.jsonl",
      finalMessagePath: "prompts/codex/codex_packet_needs_you/final.md",
      status: "packet_created",
      workItemId: action.id
    });
  });

  await page.goto(`${arcadia.url}/review`);
  await page.getByRole("button", { name: "Approve & Run", exact: true }).click();
  await expect(page.getByText("Immediate consequence", { exact: true })).toBeVisible();
  await expect(page.getByText(/records no Decision, starts no Run/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm: Approve & Run" }).click();

  await expect(page.getByText(`Receipt · Packet ${packet.id}`)).toBeVisible();
  await expect(page.getByText("No Decision was recorded and no Arcadia state changed.")).toBeVisible();
  await expect(page.getByText(packet.command)).toBeVisible();
  expect(withDatabase(arcadia.root, (db) =>
    (db.prepare("SELECT status FROM codex_invocations WHERE id = ?").get(packet.id) as { status: string }).status
  )).toBe("packet_created");
});

test("a failed Run previews its durable-record handoff and leaves the Run unchanged", async ({ page, arcadia }) => {
  arcadia.setMode("nonzero");
  await submitAsk(page, arcadia, CANONICAL_REQUEST);
  await page.getByRole("button", { name: "Approve & Run" }).click();
  const failedRun = await waitForRun(arcadia, (row) => row.status === "failed");

  await page.goto(`${arcadia.url}/review`);
  await expect(page.getByRole("heading", { name: "Execution run failed." })).toBeVisible();
  await page.getByRole("button", { name: "View Run", exact: true }).click();
  await expect(page.getByText(/retries no Run/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm: View Run" }).click();

  await expect(page.getByText(`Receipt · Run ${failedRun.id}`)).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue: View Run" })).toHaveAttribute("href", `/runs/${failedRun.id}`);
  expect(withDatabase(arcadia.root, (db) =>
    (db.prepare("SELECT status FROM execution_runs WHERE id = ?").get(failedRun.id) as { status: string }).status
  )).toBe("failed");
});

async function waitForRun(
  arcadia: E2EWorkspace,
  predicate: (row: any) => boolean,
  timeoutMs = 20_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = withDatabase(arcadia.root, (db) =>
      db.prepare("SELECT * FROM execution_runs ORDER BY created_at DESC").all() as any[]
    );
    const row = rows.find(predicate);
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for Run state.");
}
