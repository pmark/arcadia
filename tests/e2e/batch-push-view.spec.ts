import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test as base } from "@playwright/test";
import { createE2EWorkspace, type E2EWorkspace } from "./fixtures/workspace";

/**
 * The Runs dashboard's push view, end to end against a real workspace and the
 * real `arcadia schedule status` payload: one lane, the boundary that stops it,
 * and the collapsed next push behind it.
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

/**
 * A managed Plan in the Arcadia Project's repository. `current-action` is ready
 * and declared first, so the scheduler has no reason to move the governed
 * pointer while the test runs.
 */
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
    "milestone: Push view",
    "active_plan: push-plan",
    "current_action: current-action",
    "updated: 2026-09-22",
    "---",
    "",
    "# Arcadia",
    ""
  ].join("\n"));

  const block = (lines: string[]) => lines.join("\n");
  const ready = (id: string, title: string) => block([
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
    "    depends_on: []",
    "    decisions: []",
    "    references: []"
  ]);

  writeFileSync(path.join(repo, "docs/plans/push-plan.md"), [
    "---",
    "arcadia: v1",
    "type: plan",
    "slug: push-plan",
    "project: arcadia",
    "status: active",
    "milestone: Push view",
    "current_action: current-action",
    "token_impact: medium",
    "token_budget: One bounded pass.",
    "recommended_model: gpt-5.6-terra",
    "updated: 2026-09-22",
    "actions:",
    ready("current-action", "Ship the pointer Action"),
    ready("second-action", "Ship the second ready Action"),
    block([
      "  - id: operator-proof",
      "    title: Run the operator-only proof",
      "    status: open",
      "    responsibility: requires_review",
      "    effort: session",
      "    next_action: Run the proof from the operator terminal.",
      "    expected_artifact: docs/operator-proof.md",
      "    clarification: clarified",
      "    acceptance_criteria:",
      "      - The proof ran.",
      "    depends_on: []",
      "    decisions: []",
      "    references: []"
    ]),
    block([
      "  - id: parked-action",
      "    title: Parked Action",
      "    status: deferred",
      "    responsibility: agent",
      "    effort: session",
      "    next_action: Finish parked-action.",
      "    expected_artifact: docs/parked-action.md",
      "    clarification: clarified",
      "    acceptance_criteria:",
      "      - parked-action is finished.",
      "    depends_on: []",
      "    decisions: []",
      "    references: []"
    ]),
    "questions: []",
    "---",
    "",
    "# Push plan",
    ""
  ].join("\n"));
}

test("the Runs dashboard shows the push, its boundary, and the collapsed next push", async ({ page, arcadia }) => {
  seedPlan(arcadia.root);
  await page.goto(`${arcadia.url}/runs`);

  await expect(page.getByRole("heading", { name: /This push/ })).toBeVisible();
  await expect(page.getByText("1 lane · 4 token points", { exact: false })).toBeVisible();
  await expect(page.getByText(path.basename(path.join(arcadia.root, "repos", "arcadia")), { exact: true })).toBeVisible();
  await expect(page.getByText("sequence advised", { exact: true })).toBeVisible();
  await expect(page.getByText("Ship the pointer Action")).toBeVisible();
  await expect(page.getByText("Ship the second ready Action")).toBeVisible();

  // The boundary is an actionable prompt, not prose about one.
  await expect(page.getByText("Review needed", { exact: true })).toBeVisible();
  await expect(page.getByText(/requires the operator/)).toBeVisible();

  // The next push is named but not expanded until the operator asks.
  const nextPush = page.getByRole("button", { name: /Next push \(1\)/ });
  await expect(nextPush).toBeVisible();
  await expect(nextPush).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("Parked Action")).toHaveCount(0);

  await nextPush.click();
  await expect(nextPush).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Parked Action")).toBeVisible();
});
