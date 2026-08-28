import { expect, test as base, type Page } from "@playwright/test";
import { withDatabase } from "../../src/db/connection.js";
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
