import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { freePort, startProcess, waitForHttp } from "./fixtures/processes";

const plan = { slug: "first-website", status: "active", governed: true, milestone: "A small garden on the web", isActivePlan: true, actionCounts: { open: 1, in_progress: 0, done: 0, blocked: 0 }, activationNote: null, relativePath: "docs/plans/first-website.md" };
const portfolio = { generatedAt: "2030-01-01T00:00:00.000Z", projects: [{ id: "garden", slug: "moon-garden", name: "Moon garden", status: "active", activePlan: plan.slug, plans: [plan], error: null }] };
const detail = { project: { id: "garden", slug: "moon-garden", name: "Moon garden" }, plan, progress: { schema: "fixture", source: { planSlug: plan.slug, planPath: plan.relativePath, updated: "2030-01-01" }, counts: { open: 1, in_progress: 0, done: 0, blocked: 0, deferred: 0, total: 1 }, isActivePlan: true, current: null, currentNote: null, next: [], blocked: [], actions: [{ key: "moon-garden/review-phone", title: "Review the page on a phone", status: "open", dependsOn: [] }] } };
const decision = { kind: "decision", id: "0017", project: "field-notes", title: "Publish the field notes now or after review", detail: null, gateQuestion: "Publish now?", options: [{ key: "A", label: "Now", consequence: null }], blocking: true, todoKey: "decision:field-notes:0017", href: "/todo/decision/field-notes/0017", createdAt: "2030-01-01T00:00:00.000Z" };

/** How long a tap on a route may take to change the address and the screen. About ten times what it takes today, and fixed, so a slower page delay can't loosen it. */
const TAP_LIMIT_MS = 1_000;

test("every tap answers at once and says what it's opening, however slow the page is", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const repo = path.resolve(import.meta.dirname, "../..");
  const temp = await mkdtemp(path.join(os.tmpdir(), "arcadia-workspace-activity-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = startProcess(process.execPath, [path.join(repo, "apps/dashboard/node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: path.join(repo, "apps/dashboard"), env: { ...process.env, HOME: temp, ARCADIA_WORKSPACE: temp }, logPath: path.join(temp, "next.log") });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint === "/api/plans") return route.fulfill({ json: portfolio });
    if (endpoint === "/api/plans/moon-garden/first-website") return route.fulfill({ json: detail });
    if (endpoint === "/api/approvals") return route.fulfill({ json: { source: "todo", note: null, approvals: [decision] } });
    return route.abort();
  });
  // Every page load is slow on purpose: what matters is what the screen does in the meantime.
  let delayMs = 3_000;
  await page.route(/\/(workspace\/feed|workspace\/projects\/|todo)/, async route => {
    if (route.request().resourceType() === "fetch" || route.request().resourceType() === "document") await new Promise(resolve => setTimeout(resolve, delayMs));
    await route.continue();
  });
  const activity = page.locator(".workspace-activity");
  try {
    await waitForHttp(`${url}/workspace`, server);
    await page.goto(`${url}/workspace#dusk`);
    await expect(page.getByRole("heading", { name: "Your work, in view" })).toBeVisible();
    await expect(activity).toHaveText("");

    // A route needs no page: the tap moves the address and the screen before any page could arrive.
    // Timed inside the page, so it counts the browser's work and not the test runner's round trips.
    const project = page.getByRole("link", { name: /Moon garden/ });
    await page.evaluate(() => {
      document.addEventListener("click", () => {
        const tapped = performance.now();
        const check = () => {
          if (location.pathname.endsWith("/projects/moon-garden") && document.querySelector("#workspace-title")?.textContent === "Moon garden") (window as unknown as { tapMs: number }).tapMs = performance.now() - tapped;
          else requestAnimationFrame(check);
        };
        check();
      }, { capture: true, once: true });
    });
    await project.click({ noWaitAfter: true });
    await expect(page).toHaveURL(/\/projects\/moon-garden$/);
    await expect(page.locator("#workspace-title")).toHaveText("Moon garden");
    // The page's check runs on its next frame, which can come just after the waits above.
    await page.waitForFunction(() => (window as unknown as { tapMs?: number }).tapMs !== undefined);
    expect(await page.evaluate(() => (window as unknown as { tapMs: number }).tapMs)).toBeLessThan(TAP_LIMIT_MS);
    await expect(activity).toHaveText("");

    // A link to a page says what it's opening, before the page does, and clears when it arrives. Back works and clears it too.
    await page.getByRole("link", { name: "Feed" }).click({ noWaitAfter: true });
    await expect(activity).toContainText("Opening what's waiting...", { timeout: 1_000 });
    await expect(page.getByRole("link", { name: "Feed" })).toHaveAttribute("data-opening", "");
    await testInfo.attach("activity-phone", { body: await page.screenshot(), contentType: "image/png" });
    // A prefetch and the navigation can each be held, one after the other.
    await expect(page).toHaveURL(/\/workspace\/feed$/, { timeout: 30_000 });
    await expect(activity).toHaveText("");
    await page.goBack();
    await expect(page).toHaveURL(/\/projects\/moon-garden$/);
    await expect(activity).toHaveText("");

    // A page that stays slow says the tap was received. A fresh load empties the router's cache, and this address isn't delayed.
    delayMs = 14_000;
    await page.goto(`${url}/workspace`);
    await expect(page.getByRole("heading", { name: "Your work, in view" })).toBeVisible();
    await page.getByRole("link", { name: "Feed" }).click({ noWaitAfter: true });
    await expect(activity).toContainText("Opening what's waiting...", { timeout: 1_000 });
    await expect(activity).toContainText("Your tap was received", { timeout: 13_000 });
    // A prefetch and the navigation can each be held, one after the other.
    await expect(page).toHaveURL(/\/workspace\/feed$/, { timeout: 45_000 });
    await expect(activity).toHaveText("");
    delayMs = 5_000;
    await page.goto(`${url}/workspace`);
    await expect(page.getByRole("heading", { name: "Your work, in view" })).toBeVisible();

    // Back before a page arrives abandons it, so the line clears instead of claiming work that isn't happening.
    await page.getByRole("link", { name: "Feed" }).click({ noWaitAfter: true });
    await expect(activity).toContainText("Opening what's waiting...", { timeout: 1_000 });
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));
    await expect(activity).toHaveText("");
    delayMs = 500;
    await page.getByRole("link", { name: "Feed" }).click();
    await expect(page).toHaveURL(/\/workspace\/feed$/, { timeout: 30_000 });

    // A Decision says so as it opens.
    const item = page.getByRole("region", { name: "Waiting on you" }).getByRole("link").first();
    await expect(item).toHaveAttribute("href", /\/todo\/decision\//);
    delayMs = 1_500;
    await item.click({ noWaitAfter: true });
    await expect(activity).toContainText("Opening this Decision...", { timeout: 1_000 });
    await expect(page).toHaveURL(/\/todo\/decision\//, { timeout: 15_000 });

    expect(errors).toEqual([]);
  } finally {
    await server.stop();
    await testInfo.attach("preview-log", { path: path.join(temp, "next.log"), contentType: "text/plain" });
    await rm(temp, { recursive: true, force: true });
  }
});
