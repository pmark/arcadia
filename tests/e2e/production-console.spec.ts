import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test as base } from "@playwright/test";
import { withDatabase } from "../../src/db/connection.js";
import { createCodexInvocation, createProjectWithInitialWork, getWorkItem } from "../../src/db/repositories.js";
import { ensureBuiltInSkills } from "../../src/execution/skills.js";
import { createE2EWorkspace, type E2EWorkspace } from "./fixtures/workspace";

/**
 * The Production console end to end at phone width, against a real isolated
 * workspace: production state, the queue in batches with a dependency, a
 * Launch preview that is never confirmed, and a finished Session with its
 * exit code and recorded log.
 */

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

function action(id: string, title: string, dependsOn: string[] = []): string {
  return [
    `  - id: ${id}`,
    `    title: ${title}`,
    "    status: open",
    "    responsibility: agent",
    "    effort: session",
    `    next_action: Finish ${id}.`,
    `    expected_artifact: docs/${id}.md`,
    "    clarification: clarified",
    "    acceptance_criteria:",
    `      - ${id} is finished.`,
    `    depends_on: [${dependsOn.join(", ")}]`,
    "    decisions: []",
    "    references: []"
  ].join("\n");
}

function seedPlan(root: string): void {
  const repo = path.join(root, "repos", "arcadia");
  mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), [
    "---",
    "arcadia: v1",
    "type: project",
    "slug: arcadia",
    "name: Arcadia",
    "status: active",
    "goal: Make daily project planning reliable.",
    "milestone: Production console",
    "active_plan: console-plan",
    "current_action: current-action",
    "updated: 2026-10-09",
    "---",
    "",
    "# Arcadia",
    ""
  ].join("\n"));
  writeFileSync(path.join(repo, "docs/plans/console-plan.md"), [
    "---",
    "arcadia: v1",
    "type: plan",
    "slug: console-plan",
    "project: arcadia",
    "status: active",
    "milestone: Production console",
    "current_action: current-action",
    "token_impact: medium",
    "token_budget: One bounded pass.",
    "recommended_model: gpt-5.6-terra",
    "updated: 2026-10-09",
    "actions:",
    action("current-action", "Ship the pointer Action"),
    action("second-action", "Ship the second ready Action"),
    action("third-action", "Ship the dependent Action", ["second-action"]),
    "questions: []",
    "---",
    "",
    "# Console plan",
    ""
  ].join("\n"));
}

/** A finished Session with an exit code and a recorded log, as headless launch leaves them. */
function seedFinishedSession(root: string): string {
  const sessionId = "session_console_e2e";
  withDatabase(root, (db) => {
    ensureBuiltInSkills(db);
    const created = createProjectWithInitialWork(db, {
      name: "Console proof", mission: "Show a finished Session.", status: "active",
      currentMilestone: "Proof", nextAction: "Build proof", workClassification: "agent"
    });
    const work = getWorkItem(db, created.workItem.id)!;
    createCodexInvocation(db, {
      id: "packet_console_e2e", purpose: "build", agentProfile: "fake_build", workspaceScope: root,
      command: "fake", promptPath: "prompts/console/prompt.md", jsonlOutputPath: "prompts/console/out.jsonl",
      finalMessagePath: "prompts/console/final.md", status: "packet_created", workItemId: work.id
    });
    db.prepare(`INSERT INTO agent_sessions (
        id, project_id, project_slug, repository_path, plan_path, plan_slug, action_id, work_item_id,
        packet_id, packet_path, packet_sha256, authorizing_decisions_json, execution_profile_json,
        provider_profile, provider, model, effort, provider_mapping_id, provider_binding_id,
        base_revision, branch, worktree_path, provider_session_id, display_name, terminal_transport,
        tmux_session_name, host, status, prepared_at, started_at, ended_at, exit_status, created_at, updated_at
      ) VALUES (
        @id, @project_id, @project_slug, '/tmp/console-repo', 'docs/plans/p.md', 'p', 'finished-action', @work_item_id,
        'packet_console_e2e', 'prompts/console/prompt.md', 'sha', '[]', NULL,
        'fake_build', 'claude-code-cli', 'sonnet', 'high', NULL, NULL,
        '0000000', 'claude/finished-action', '/tmp/console-worktree', 'native-console', 'Console proof', 'tmux',
        'arcadia-console-proof', 'host.local', 'completed', '2026-10-09T08:00:00.000Z', '2026-10-09T08:00:05.000Z',
        '2026-10-09T08:12:05.000Z', 0, '2026-10-09T08:00:00.000Z', '2026-10-09T08:12:05.000Z'
      )`).run({ id: sessionId, project_id: created.project.id, project_slug: created.project.slug, work_item_id: work.id });
  });
  const logDirectory = path.join(root, ".arcadia", "sessions");
  mkdirSync(logDirectory, { recursive: true });
  writeFileSync(path.join(logDirectory, `${sessionId}.log`), "starting work\nran validation: 12 passed\nall checks green\n");
  return sessionId;
}

test("the Production console drives and monitors production at phone width", async ({ page, arcadia }) => {
  seedPlan(arcadia.root);
  seedFinishedSession(arcadia.root);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${arcadia.url}/production`);

  // Global strip: the production state as Arcadia reports it, and the pause control honestly disabled.
  await expect(page.getByText("Managed production")).toBeVisible();
  await expect(page.getByText(/Inactive · Idle/)).toBeVisible();
  const pauseAll = page.getByRole("button", { name: "Pause all" });
  await expect(pauseAll).toBeDisabled();

  // Projects first: one card per Project, its Plan and the Action production would pick now.
  const projects = page.getByRole("list", { name: "Projects in the production scope" });
  await expect(projects.getByText("Arcadia", { exact: true })).toBeVisible();
  await expect(projects.getByText(/Would pick now:/)).toBeVisible();

  // The queue in batches: the two ready Actions share one repository, so they are batch 1 and batch 2.
  await page.getByRole("tab", { name: "Batches" }).click();
  await expect(page.getByText(/Batch 1 · 1 Action · first in each repository/)).toBeVisible();
  await expect(page.getByText("Ship the pointer Action")).toBeVisible();
  await expect(page.getByText("Ship the second ready Action")).toBeVisible();

  // Queue order names the dependency.
  await page.getByRole("tab", { name: "Queue order" }).click();
  await expect(page.getByText("Waits on Ship the second ready Action")).toBeVisible();
  await page.getByRole("tab", { name: "Batches" }).click();

  // The finished Session: exit code, and the recorded log read through the tail route.
  await expect(page.getByText(/exit 0/).first()).toBeVisible();
  await page.getByRole("button", { name: /Build proof|finished-action/ }).first().click();
  await expect(page.getByText(/ran validation: 12 passed/)).toBeVisible();

  // Nothing overflows the phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.screenshot({ path: test.info().outputPath("production-375.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: test.info().outputPath("production-375-dark.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });

  // Launch opens a preview with its consequences; this test never confirms it.
  await page.getByRole("button", { name: /Launch…/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Launch one Action as a Session")).toBeVisible();
  await expect(dialog.getByText(/Launch preview|Nothing was launched|Step 1 of 2/)).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: /Cancel|Close/ }).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
