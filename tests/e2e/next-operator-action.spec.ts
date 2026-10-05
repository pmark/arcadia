import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createE2EWorkspace } from "./fixtures/workspace.js";

// Fixture data only: every launch is intercepted and refused, so no host action runs.
const G6 = "preflight-three-action-rehearsal-2026-10-05";
const G7 = "grant-production-three-action-rehearsal-2026-10-05";
const G8 = "restore-terminal-off-three-action-rehearsal-2026-10-05";
const minute = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const shots = path.resolve(import.meta.dirname, "../../tmp/next-operator-action");

function library(passAt: number) {
  const card = (id: string, title: string, extra: Record<string, unknown>) => ({
    id, title, problem: `${title} problem.`, desiredEffect: `${title} effect.`,
    authority: { does: ["Fixture only"], never_does: ["Launch anything from this test"] },
    success: { effect: "Done.", next: "Continue." }, failure: { effect: "Nothing changed.", next: "Read the handoff before pressing anything." },
    modifiedAt: iso(passAt), updatedAt: iso(passAt), nextAfter: null, lastRunReceipt: null, ...extra
  });
  return [
    card(G8, "G8 (run 2): Restore and prove terminal Off after the second three-Action rehearsal", { repeatable: true,
      state: { status: "succeeded", startedAt: iso(passAt - 5 * minute), finishedAt: iso(passAt - 2 * minute) },
      lastRunReceipt: { outcome: "succeeded", startedAt: iso(passAt - 5 * minute), finishedAt: iso(passAt - 2 * minute) } }),
    card(G7, "G7 (run 2): Grant the second disposable three-Action rehearsal at the reset fixture head", { kind: "grant", repeatable: false,
      state: { status: "available" },
      nextAfter: { id: G6, within_minutes: 30, voided_by: [G8, "recover-arcadia-host-services"], when_production: "inactive" } }),
    card(G6, "G6 (run 2): Preflight the second three-Action rehearsal at the reset fixture head", { repeatable: true,
      state: { status: "succeeded", startedAt: iso(passAt - 20_000), finishedAt: iso(passAt) },
      lastRunReceipt: { outcome: "succeeded", startedAt: iso(passAt - 20_000), finishedAt: iso(passAt) } }),
    card("reinstall-go-broker", "Reinstall the go-broker", { repeatable: true, state: { status: "available" } })
  ];
}

async function mock(page: Page, fixture: { passAt: number; productionActive: boolean }, launches: string[]) {
  await page.route("**/api/operator-script", async (route) => {
    if (route.request().method() === "POST") {
      launches.push((route.request().postDataJSON() as { id: string }).id);
      return route.fulfill({ status: 409, json: { error: "Fixture: launch intercepted; nothing ran." } });
    }
    return route.fulfill({ json: { scripts: library(fixture.passAt) } });
  });
  await page.route("**/api/production-control*", (route) => route.fulfill({ json: {
    production: { read: { status: "ok", policy: { desiredState: fixture.productionActive ? "active" : "inactive" }, observedAt: iso(Date.now()) } },
    worker: { running: true, heartbeat: { timestamp: null, fresh: true, available: true } }
  } }));
}

test("isolates G7 with its live deadline and confirms an off-path G8 press before launching", async ({ page }) => {
  mkdirSync(shots, { recursive: true });
  const arcadia = await createE2EWorkspace();
  const launches: string[] = [];
  try {
    await mock(page, { passAt: Date.now() - 3 * minute, productionActive: false }, launches);
    await page.goto(`${arcadia.url}/actions`);
    const panel = page.getByRole("region", { name: "Do this next" });
    await expect(panel.getByText("Do this next", { exact: true })).toBeVisible();
    await expect(panel.getByTestId("next-action-instruction")).toHaveText(/^Read this card, then run G7 \(run 2\) before .+, while its G6 \(run 2\) pass is still valid\.$/);
    await expect(panel.getByRole("heading", { name: /^G7 \(run 2\): Grant the second disposable/ })).toBeVisible();
    await expect(panel.getByTestId("next-action-deadline")).toContainText(/Deadline .+(2[67]|28):\d\d\s*left/);
    // Exactly one next action; G7 is not repeated in the list below.
    await expect(page.getByTestId(`operator-action-${G7}`)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Other actions (not next)" })).toBeVisible();
    const box = await panel.boundingBox();
    const others = await page.getByRole("region", { name: "Other operator actions" }).boundingBox();
    expect(box && others && box.y + box.height <= others.y).toBe(true);
    await page.screenshot({ path: path.join(shots, "window-open-390.png"), fullPage: true });

    const g8 = page.getByTestId(`operator-action-${G8}`);
    await g8.getByRole("button", { name: "Run" }).click();
    const confirm = g8.getByRole("alertdialog", { name: "Not your next action" });
    await expect(confirm).toContainText("Your next action is G7 (run 2), before");
    await expect(confirm).toContainText("Running G8 (run 2) now undoes G6 (run 2)'s pass that G7 (run 2) needs, so you would have to run G6 (run 2) again before G7 (run 2).");
    await page.screenshot({ path: path.join(shots, "confirm-off-path-g8-390.png"), fullPage: false });
    await confirm.getByRole("button", { name: "Keep my place" }).click();
    await expect(confirm).toHaveCount(0);
    expect(launches).toEqual([]);

    await g8.getByRole("button", { name: "Run" }).click();
    await g8.getByRole("button", { name: "Run G8 (run 2) anyway" }).click();
    await expect.poll(() => launches).toEqual([G8]);
    // The next action itself launches without a confirmation; the existing endpoint gates are unchanged.
    await panel.getByRole("button", { name: "Run" }).click();
    await expect.poll(() => launches).toEqual([G8, G7]);
    await expect(page.getByText("Fixture: launch intercepted; nothing ran.")).toBeVisible();
  } finally { await arcadia.stop(false); }
});

test("falls back to G6 after the window expires and says plainly when nothing needs the operator", async ({ page }) => {
  mkdirSync(shots, { recursive: true });
  const arcadia = await createE2EWorkspace();
  const fixture = { passAt: Date.now() - 31 * minute, productionActive: false };
  try {
    await mock(page, fixture, []);
    await page.goto(`${arcadia.url}/actions`);
    const panel = page.getByRole("region", { name: "Do this next" });
    await expect(panel.getByTestId("next-action-instruction")).toHaveText(/^Run G6 \(run 2\) again: its last pass expired at .+, so G7 \(run 2\) would refuse it\.$/);
    await expect(panel.getByRole("heading", { name: /^G6 \(run 2\): Preflight/ })).toBeVisible();
    await expect(panel.getByTestId("next-action-deadline")).toHaveCount(0);
    await page.screenshot({ path: path.join(shots, "window-expired-390.png"), fullPage: false });

    fixture.passAt = Date.now() - 3 * minute; fixture.productionActive = true;
    await page.reload();
    await expect(panel).toContainText("Nothing needs you right now.");
    await expect(panel).toContainText("Production is Active");
    await expect(page.getByRole("heading", { name: "All actions" })).toBeVisible();
    await page.screenshot({ path: path.join(shots, "nothing-pending-390.png"), fullPage: false });
  } finally { await arcadia.stop(false); }
});
