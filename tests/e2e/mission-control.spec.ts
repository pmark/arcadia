import { expect, test as base, type Page } from "@playwright/test";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { withDatabase } from "../../src/db/connection.js";
import { createE2EWorkspace, type E2EWorkspace } from "./fixtures/workspace.js";

const CANONICAL_REQUEST = "Prepare a plan for adding Pinterest publishing to Rebuster.";
const STATUS_REQUEST = "Generate this week's Arcadia project status report.";

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

test("canonical dashboard capture completes as a Decision-gated validated planning Run", async ({ page, arcadia }) => {
  await submitAsk(page, arcadia, CANONICAL_REQUEST);
  await expect(page.getByText("Prepare a Pinterest publishing plan for Rebuster.")).toBeVisible();
  await expect(page.getByText("Reliable publishing workflow").first()).toBeVisible();
  await expect(page.getByText("Needs Mark").first()).toBeVisible();
  await expect(page.getByText(/No publishing/).first()).toBeVisible();

  const before = planningState(arcadia);
  expect(before.decision?.status).toBe("open");
  expect(before.runCount).toBe(0);
  expect(arcadia.fakeInvocationCount()).toBe(0);

  await page.getByRole("button", { name: "Approve & Run" }).click();
  const run = await waitForRun(arcadia, (row) => row.status === "completed");
  expect(run.mission_log_id).toBeTruthy();
  const terminal = planningState(arcadia);
  expect(terminal.invocation?.status).toBe("completed");
  expect(terminal.acceptance?.status).toBe("open");
  expect(terminal.finalArtifact?.status).toBe("drafted");
  expect(new Date(terminal.decision!.decided_at!).getTime()).toBeLessThanOrEqual(
    new Date(terminal.invocation!.updated_at).getTime()
  );

  await page.goto(arcadia.url);
  await expect(page.getByRole("button", { name: "Accept Plan" })).toBeVisible();
  await page.getByRole("button", { name: "Accept Plan" }).click();
  await waitFor(() => planningState(arcadia).finalArtifact?.status === "ready");
  const accepted = planningState(arcadia);
  expect(accepted.action?.status).toBe("done");
  expect(accepted.acceptance?.status).toBe("approved");
  await assertEvidenceFiles(page, arcadia, run.id);
});

test("planning approval cannot be bypassed", async ({ page, arcadia }) => {
  await submitAsk(page, arcadia, CANONICAL_REQUEST);
  const state = planningState(arcadia);
  const cli = spawnSync(
    path.join(arcadia.repo, "node_modules", ".bin", "tsx"),
    [
      path.join(arcadia.repo, "src", "cli.ts"),
      "work", "run", state.action!.id,
      "--workspace", arcadia.root,
      "--plan", state.plan!.id,
      "--allow-codex-planning",
      "--json"
    ],
    { cwd: arcadia.repo, encoding: "utf8", env: { ...process.env, ARCADIA_WORKSPACE: arcadia.root } }
  );
  expect(cli.status).not.toBe(0);
  expect(`${cli.stdout}\n${cli.stderr}`).toContain(
    "Planning execution requires an approved Decision for this Action, plan, and packet."
  );
  expect(planningState(arcadia).runCount).toBe(0);
  expect(arcadia.fakeInvocationCount()).toBe(0);
  await expect(page.getByText(/codex exec/)).toHaveCount(0);
  await page.getByRole("button", { name: "Defer" }).click();
  await waitFor(() => planningState(arcadia).decision?.status === "deferred");
  expect(planningState(arcadia).decision?.status).toBe("deferred");
  expect(arcadia.fakeInvocationCount()).toBe(0);
});

test("failed planning Validation cannot be marked complete", async ({ page, arcadia }) => {
  arcadia.setMode("invalid");
  await submitAsk(page, arcadia, CANONICAL_REQUEST);
  await page.getByRole("button", { name: "Approve & Run" }).click();
  const run = await waitForRun(arcadia, (row) => row.status === "requires_review");
  const state = planningState(arcadia);
  expect(state.action?.work_classification).toBe("needs_mark");
  expect(state.finalArtifact?.status).toBe("drafted");
  expect(state.validationArtifact?.status).toBe("drafted");
  expect(state.validationDecision?.status).toBe("open");
  expect(run.mission_log_id).toBeTruthy();
  await page.goto(`${arcadia.url}/runs/${run.id}`);
  await expect(page.getByText("Requires Review", { exact: true })).toBeVisible();
  await expect(page.getByText("Completed", { exact: true })).toHaveCount(0);
});

test("final planning Artifact and Log are linked", async ({ page, arcadia }) => {
  await submitAsk(page, arcadia, CANONICAL_REQUEST);
  await page.getByRole("button", { name: "Approve & Run" }).click();
  const run = await waitForRun(arcadia, (row) => row.status === "completed");
  const state = planningState(arcadia);
  expect(state.finalArtifact?.project_id).toBe(state.action?.project_id);
  expect(state.finalArtifact?.work_item_id).toBe(state.action?.id);
  expect(state.pathlessExpectedCount).toBe(0);
  expect(state.runArtifactTypes).toEqual(expect.arrayContaining(["planning_artifact", "planning_artifact_validation"]));
  expect(run.mission_log_id).toBeTruthy();

  await page.goto(`${arcadia.url}/runs/${run.id}`);
  await expect(page.getByText(state.finalArtifact!.title)).toBeVisible();
  await expect(page.getByRole("link", { name: "View Log" })).toBeVisible();
  await assertEvidenceFiles(page, arcadia, run.id);
});

test("failed and Needs Mark Runs agree in Attention and Run detail", async ({ page, arcadia }) => {
  arcadia.setMode("invalid");
  await submitAsk(page, arcadia, CANONICAL_REQUEST);
  await page.getByRole("button", { name: "Approve & Run" }).click();
  const reviewRun = await waitForRun(arcadia, (row) => row.status === "requires_review");
  await page.goto(`${arcadia.url}/runs/${reviewRun.id}`);
  await expect(page.getByText("Requires Review", { exact: true })).toBeVisible();

  arcadia.setMode("nonzero");
  await submitAsk(page, arcadia, CANONICAL_REQUEST);
  await page.getByRole("button", { name: "Approve & Run" }).click();
  const failedRun = await waitForRun(arcadia, (row) => row.status === "failed" && row.id !== reviewRun.id);
  await page.goto(arcadia.url);
  await expect(page.getByText("Execution run failed.")).toBeVisible();
  await page.goto(`${arcadia.url}/runs/${failedRun.id}`);
  await expect(page.getByText("Failed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request Retry" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("ambiguous Pinterest input remains recoverable in Back Burner", async ({ page, arcadia }) => {
  await page.goto(`${arcadia.url}/capture`);
  await page.getByPlaceholder("Say anything — Arcadia will route it.").fill("Maybe we should do something with Pinterest for Rebuster.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Captured in Back Burner.")).toBeVisible();
  await page.goto(`${arcadia.url}/back-burner`);
  await expect(page.getByText("Maybe we should do something with Pinterest for Rebuster.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Promote to Action" })).toBeVisible();
  const counts = withDatabase(arcadia.root, (db) => ({
    asks: scalar(db, "SELECT COUNT(*) AS count FROM ask_requests"),
    backBurner: scalar(db, "SELECT COUNT(*) AS count FROM back_burner_items WHERE status IN ('incubating','opportunistic')"),
    planningActions: scalar(db, "SELECT COUNT(*) AS count FROM work_items WHERE raw_input LIKE '%Pinterest%'"),
    decisions: scalar(db, "SELECT COUNT(*) AS count FROM review_items"),
    runs: scalar(db, "SELECT COUNT(*) AS count FROM execution_runs"),
    invocations: scalar(db, "SELECT COUNT(*) AS count FROM codex_invocations")
  }));
  expect(counts).toMatchObject({ asks: 1, backBurner: 1, planningActions: 0, decisions: 0, runs: 0, invocations: 0 });
  expect(arcadia.fakeInvocationCount()).toBe(0);
});

test("exact status-report request uses Autonomous deterministic execution", async ({ page, arcadia }) => {
  await submitAsk(page, arcadia, STATUS_REQUEST);
  const state = withDatabase(arcadia.root, (db) => ({
    action: db.prepare("SELECT * FROM work_items WHERE raw_input = ? ORDER BY created_at DESC LIMIT 1").get(STATUS_REQUEST) as any,
    run: db.prepare(
      "SELECT er.* FROM execution_runs er JOIN work_items wi ON wi.id = er.work_item_id WHERE wi.raw_input = ? ORDER BY er.created_at DESC LIMIT 1"
    ).get(STATUS_REQUEST) as any,
    artifact: db.prepare(
      "SELECT a.* FROM artifacts a JOIN work_items wi ON wi.id = a.work_item_id WHERE wi.raw_input = ? AND a.artifact_type = 'status_report'"
    ).get(STATUS_REQUEST) as any,
    decisions: scalar(db, "SELECT COUNT(*) AS count FROM review_items"),
    invocations: scalar(db, "SELECT COUNT(*) AS count FROM codex_invocations")
  }));
  expect(state.action.work_classification).toBe("autonomous");
  expect(state.run.status).toBe("completed");
  expect(state.run.mission_log_id).toBeTruthy();
  expect(state.artifact.status).toBe("ready");
  expect(state.artifact.path).toBe("reports/status.md");
  expect(state.decisions).toBe(0);
  expect(state.invocations).toBe(0);
  expect(arcadia.fakeInvocationCount()).toBe(0);
  const report = await page.request.get(`${arcadia.url}/api/file/reports/status.md`);
  expect(report.status()).toBe(200);
});

test("non-zero planning executor exit remains failed and recoverable", async ({ page, arcadia }) => {
  arcadia.setMode("nonzero");
  await submitAsk(page, arcadia, CANONICAL_REQUEST);
  await page.getByRole("button", { name: "Approve & Run" }).click();
  const failed = await waitForRun(arcadia, (row) => row.status === "failed");
  const original = planningState(arcadia);
  expect(original.invocation?.status).toBe("failed");
  expect(original.action?.status).toBe("blocked");
  expect(original.runArtifactTypes).toEqual(expect.arrayContaining([
    "planning_executor_diagnostic",
    "planning_partial_artifact",
    "planning_artifact_validation"
  ]));
  expect(failed.mission_log_id).toBeTruthy();

  await page.goto(`${arcadia.url}/runs/${failed.id}`);
  await page.getByRole("button", { name: "Request Retry" }).click();
  await expect(page.getByText(/Retry Decision/)).toBeVisible();
  const retryBefore = withDatabase(arcadia.root, (db) => ({
    count: scalar(db, "SELECT COUNT(*) AS count FROM execution_runs"),
    decision: db.prepare(
      "SELECT * FROM review_items WHERE resolved_intent = 'CodexPlanningRetryApproval' ORDER BY created_at DESC LIMIT 1"
    ).get() as any
  }));
  expect(retryBefore.count).toBe(1);
  expect(retryBefore.decision.status).toBe("open");

  arcadia.setMode("success");
  await page.goto(`${arcadia.url}/review`);
  await page.getByRole("button", { name: "Approve & Run" }).click();
  const retry = await waitForRun(arcadia, (row) => row.retry_of_run_id === failed.id && row.status === "completed");
  expect(retry.id).not.toBe(failed.id);
  const after = planningState(arcadia);
  expect(after.runCount).toBe(2);
  expect(withDatabase(arcadia.root, (db) =>
    (db.prepare("SELECT status FROM execution_runs WHERE id = ?").get(failed.id) as { status: string }).status
  )).toBe("failed");
});

async function submitAsk(page: Page, arcadia: E2EWorkspace, request: string) {
  await page.goto(arcadia.url);
  await page.getByPlaceholder("Ask Arcadia").fill(request);
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText(/Action created\.|Captured in Back Burner\./)).toBeVisible();
}

function planningState(arcadia: E2EWorkspace) {
  return withDatabase(arcadia.root, (db) => {
    const action = db.prepare(
      "SELECT * FROM work_items WHERE raw_input = ? ORDER BY created_at DESC LIMIT 1"
    ).get(CANONICAL_REQUEST) as any;
    const plan = action
      ? db.prepare("SELECT * FROM execution_plans WHERE work_item_id = ? ORDER BY created_at DESC LIMIT 1").get(action.id) as any
      : null;
    const decision = plan
      ? db.prepare(
          "SELECT * FROM review_items WHERE plan_id = ? AND resolved_intent = 'CodexPlanningRunApproval' ORDER BY created_at DESC LIMIT 1"
        ).get(plan.id) as any
      : null;
    const invocation = plan
      ? db.prepare("SELECT * FROM codex_invocations WHERE plan_id = ? ORDER BY created_at DESC LIMIT 1").get(plan.id) as any
      : null;
    const acceptance = plan
      ? db.prepare(
          "SELECT * FROM review_items WHERE plan_id = ? AND resolved_intent = 'CodexPlanningArtifactAcceptance' ORDER BY created_at DESC LIMIT 1"
        ).get(plan.id) as any
      : null;
    const validationDecision = plan
      ? db.prepare(
          "SELECT * FROM review_items WHERE plan_id = ? AND resolved_intent = 'codex_planning_artifact_validation' ORDER BY created_at DESC LIMIT 1"
        ).get(plan.id) as any
      : null;
    const finalArtifact = action
      ? db.prepare(
          "SELECT * FROM artifacts WHERE work_item_id = ? AND artifact_type IN ('planning_artifact','planning_partial_artifact') ORDER BY created_at DESC LIMIT 1"
        ).get(action.id) as any
      : null;
    const validationArtifact = action
      ? db.prepare(
          "SELECT * FROM artifacts WHERE work_item_id = ? AND artifact_type = 'planning_artifact_validation' ORDER BY created_at DESC LIMIT 1"
        ).get(action.id) as any
      : null;
    const latestRun = plan
      ? db.prepare("SELECT id FROM execution_runs WHERE plan_id = ? ORDER BY created_at DESC LIMIT 1").get(plan.id) as { id: string } | undefined
      : undefined;
    const runArtifactTypes = latestRun
      ? (db.prepare(
          "SELECT a.artifact_type FROM run_artifacts ra JOIN artifacts a ON a.id = ra.artifact_id WHERE ra.run_id = ?"
        ).all(latestRun.id) as Array<{ artifact_type: string }>).map((row) => row.artifact_type)
      : [];
    return {
      action,
      plan,
      decision,
      invocation,
      acceptance,
      validationDecision,
      finalArtifact,
      validationArtifact,
      runArtifactTypes,
      runCount: plan ? scalar(db, "SELECT COUNT(*) AS count FROM execution_runs WHERE plan_id = ?", plan.id) : 0,
      pathlessExpectedCount: action
        ? scalar(db, "SELECT COUNT(*) AS count FROM artifacts WHERE work_item_id = ? AND artifact_type = 'expected_artifact' AND path IS NULL", action.id)
        : 0
    };
  });
}

async function waitForRun(
  arcadia: E2EWorkspace,
  predicate: (row: any) => boolean
): Promise<any> {
  let result: any = null;
  await waitFor(() => {
    const rows = withDatabase(arcadia.root, (db) =>
      db.prepare("SELECT * FROM execution_runs ORDER BY created_at DESC").all() as any[]
    );
    result = rows.find(predicate) ?? null;
    return Boolean(result);
  });
  return result;
}

async function waitFor(predicate: () => boolean, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Timed out waiting for persisted state.");
}

async function assertEvidenceFiles(page: Page, arcadia: E2EWorkspace, runId: string) {
  const paths = withDatabase(arcadia.root, (db) => {
    const run = db.prepare("SELECT mission_log_id FROM execution_runs WHERE id = ?").get(runId) as { mission_log_id: string };
    const log = db.prepare("SELECT markdown_path FROM mission_logs WHERE id = ?").get(run.mission_log_id) as { markdown_path: string };
    const artifacts = db.prepare(
      "SELECT a.path FROM run_artifacts ra JOIN artifacts a ON a.id = ra.artifact_id WHERE ra.run_id = ? AND a.path IS NOT NULL"
    ).all(runId) as Array<{ path: string }>;
    return [log.markdown_path, ...artifacts.map((artifact) => artifact.path)];
  });
  for (const filePath of paths) {
    const response = await page.request.get(
      `${arcadia.url}/api/file/${filePath.split("/").map(encodeURIComponent).join("/")}`
    );
    expect(response.status(), filePath).toBe(200);
  }
}

function scalar(db: any, sql: string, ...parameters: unknown[]): number {
  return Number((db.prepare(sql).get(...parameters) as { count: number }).count);
}
