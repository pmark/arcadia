import { expect, test } from "@playwright/test";
import { createE2EWorkspace } from "./fixtures/workspace.js";
import { withDatabase } from "../../src/db/connection.js";
import { registerRecurringSchedule, recurringScheduleStatus } from "../../src/recurring/scheduler.js";

test("Clock manages existing schedule timing and enabled state through real guarded CLI routes", async ({ page }) => {
  const fixture = await createE2EWorkspace();
  try {
    await page.goto(`${fixture.url}/clock`);
    await expect(page.getByText("No recurring schedules are registered yet.")).toBeVisible();
    withDatabase(fixture.root, (db) => registerRecurringSchedule(db, { schema: "arcadia-recurring-schedule-v1", id: "field-notes-ship", project: "arcadia", cadence: "weekly", weekday: 1, timezone: "America/Los_Angeles", time: "09:00", starts_at: "2030-01-01T00:00:00.000Z", desired_result: "Collect shipped evidence.", acceptance: ["Claims checked."] }));
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("heading", { name: "field notes ship" })).toBeVisible();
    await expect(page.getByText("Every Monday at 09:00")).toBeVisible();
    await page.getByRole("button", { name: "Enable", exact: true }).click();
    await expect(page.getByText("Schedule enabled.")).toBeVisible();
    expect(withDatabase(fixture.root, (db) => recurringScheduleStatus(db).schedules[0].enabled)).toBe(true);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(page.getByText("Schedule paused.")).toBeVisible();
    await page.getByRole("button", { name: "Edit timing", exact: true }).click();
    await page.getByRole("combobox", { name: "Repeat", exact: true }).selectOption("monthly");
    await page.getByLabel("Day of month (1–28)", { exact: true }).fill("2");
    await page.getByLabel("Time", { exact: true }).fill("10:00");
    await page.getByRole("button", { name: "Save timing", exact: true }).click();
    await expect(page.getByText("Day 2 of each month at 10:00")).toBeVisible();
    const saved = withDatabase(fixture.root, (db) => recurringScheduleStatus(db).schedules[0]);
    expect(saved.enabled).toBe(false);
    expect(saved.definition).toMatchObject({ cadence: "monthly", day: 2, time: "10:00" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // Foreign browser origin is rejected by the actual route before mutation.
    const foreign = await page.request.post(`${fixture.url}/api/clock`, { headers: { "sec-fetch-site": "cross-site" }, data: { action: "enable", id: saved.definition.id, expected: saved.fingerprint } });
    expect(foreign.status()).toBe(403);
    expect(withDatabase(fixture.root, (db) => recurringScheduleStatus(db).schedules[0].enabled)).toBe(false);
  } finally { await fixture.stop(false); }
});
