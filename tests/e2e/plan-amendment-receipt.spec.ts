import { expect, test } from "@playwright/test";
import { createE2EWorkspace } from "./fixtures/workspace.js";

test("Runs explains a durable Plan-amendment refusal and exposes its canonical receipt", async ({ page }) => {
  const arcadia = await createE2EWorkspace();
  let launches = 0;
  try {
    await page.route("**/api/approvals", route => route.fulfill({ json: { approvals: [] } }));
    await page.route("**/api/operator-script", route => {
      if (route.request().method() === "POST") launches++;
      return route.fulfill({ json: { scripts: [{
        id: "fixture-plan-amendment", title: "Accept pinned Plan scope", desiredEffect: "Replace one Action acceptance list.",
        authority: { does: ["Apply one pinned amendment"], never_does: ["Change queue or pointer"] },
        repeatable: false, state: { status: "failed", exitCode: 1 }, updatedAt: "2026-09-30T12:00:00Z",
        receipt: { reason: "PUBLICATION_FAILED", message: "Settlement is committed locally; origin refused publication.",
          next: "Restore origin and retry this same action without a second settlement.", runDirectory: "runs/fixture",
          settlement: { applied: true, documentsCommit: "fixture-exact-commit", proposalRequestId: "fixture-proposal" } }
      }] } });
    });
    await page.goto(`${arcadia.url}/runs`);
    await expect(page.getByText("Settlement is committed locally; origin refused publication.", { exact: true })).toBeVisible();
    await expect(page.getByText("Next: Restore origin and retry this same action without a second settlement.")).toBeVisible();
    await page.getByText("Receipt: PUBLICATION_FAILED", { exact: true }).click();
    await expect(page.locator("pre").filter({ hasText: "fixture-exact-commit" })).toBeVisible();
    expect(launches).toBe(0);
  } finally { await arcadia.stop(false); }
});
