import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { freePort, startProcess, waitForHttp } from "./fixtures/processes";

const plan = { slug: "first-website", status: "active", governed: true, milestone: "A small garden on the web", isActivePlan: true, actionCounts: { open: 1, in_progress: 0, done: 0, blocked: 0 }, activationNote: null, relativePath: "docs/plans/first-website.md" };
const portfolio = { generatedAt: "2030-01-01T00:00:00.000Z", projects: [{ id: "garden", slug: "moon-garden", name: "Moon garden", status: "active", activePlan: plan.slug, plans: [plan], error: null }] };
const blockingDecision = { kind: "decision", id: "0017", project: "field-notes", title: "Publish the field notes now or after review", detail: null, gateQuestion: "Publish now?", options: [{ key: "A", label: "Now", consequence: null }], blocking: true };
const noSteps = { state: "moving", nowStep: null, steps: [], hidden: 0, total: 0, ignored: 0, invalidPrs: 0, unavailable: [], waitingAhead: 0 };
const noPullRequests = { checkedAt: "2030-01-01T12:00:00Z", stale: false, refreshing: false, refreshError: null, incomplete: false, retainedProjectIds: [], snapshot: { checkedAt: "2030-01-01T12:00:00Z", pullRequests: [], projects: [] } };

type Core = { production: { displayState: string } | null; worker: { running: boolean; heartbeat: { timestamp: null; fresh: boolean; available: boolean } } | null; sessions: { active: Array<{ live: boolean; observedStatus: string }>; recent: [] } | null };
const worker = (running: boolean, fresh: boolean) => ({ running, heartbeat: { timestamp: null, fresh, available: true } });
const core = (displayState: string, over: Partial<Core> = {}): Core => ({ production: { displayState }, worker: worker(true, true), sessions: { active: [], recent: [] }, ...over });

// Each row of the production table in docs/design/relay/workspace-layers.md, Scene point 5.
const ROWS: Array<{ name: string; read: Core | "down"; label: string; words: string }> = [
  { name: "Off", read: core("inactive_idle", { worker: worker(false, false) }), label: "Nothing waiting", words: "Production Off" },
  { name: "finishing", read: core("inactive_finishing"), label: "Work moving", words: "Production finishing" },
  { name: "On and idle", read: core("active_idle"), label: "All clear", words: "Production on, idle" },
  { name: "building", read: core("active_building"), label: "Work moving", words: "Production building" },
  { name: "a stalled Session", read: core("active_building", { sessions: { active: [{ live: true, observedStatus: "stalled" }], recent: [] } }), label: "Blocked", words: "1 Session stalled" },
  { name: "a silent worker", read: core("active_building", { worker: worker(true, false) }), label: "Blocked", words: "Worker not responding" },
  { name: "an unreadable store", read: core("observation_unavailable"), label: "Signal loss", words: "Can't read production" },
  { name: "a failed part of the read", read: core("inactive_idle", { worker: null }), label: "Signal loss", words: "Can't read production" },
  { name: "a failed read", read: "down", label: "Signal loss", words: "Can't read production" }
];

test("every Workspace view shows system status, and a status change moves nothing else", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const repo = path.resolve(import.meta.dirname, "../..");
  const temp = await mkdtemp(path.join(os.tmpdir(), "arcadia-workspace-scene-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = startProcess(process.execPath, [path.join(repo, "apps/dashboard/node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: path.join(repo, "apps/dashboard"), env: { ...process.env, HOME: temp, ARCADIA_WORKSPACE: temp }, logPath: path.join(temp, "next.log") });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const writes: string[] = [];
  const counts: Record<string, number> = {};
  let production: Core | "down" = core("inactive_idle");
  let approvals: unknown[] = [];
  let holdReads = false;
  await page.route("**/api/**", async route => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname;
    if (request.method() !== "GET") { writes.push(endpoint); return route.abort(); }
    counts[endpoint] = (counts[endpoint] ?? 0) + 1;
    if (holdReads && endpoint !== "/api/plans") await new Promise(resolve => setTimeout(resolve, 1_500));
    if (endpoint === "/api/plans") return route.fulfill({ json: portfolio });
    if (endpoint === "/api/approvals") return route.fulfill({ json: { source: "todo", note: null, approvals } });
    if (endpoint === "/api/next-steps") return route.fulfill({ json: noSteps });
    if (endpoint === "/api/pull-requests") return route.fulfill({ json: noPullRequests });
    if (endpoint === "/api/production-console") return production === "down" ? route.fulfill({ status: 503, json: { error: "Fixture" } }) : route.fulfill({ json: production });
    return route.abort();
  });
  const pill = page.locator(".workspace-status");
  const summary = pill.locator("summary");
  const nudgeReads = (target: Page) => target.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  try {
    await waitForHttp(`${url}/workspace/feed`, server);

    // First load makes no claim: no weather, a hollow dot and "Reading", never a clear sky.
    holdReads = true;
    await page.goto(`${url}/workspace#dusk`);
    await expect(summary).toContainText("Reading");
    await expect(page.locator(".workspace-status-dot.sky-reading")).toHaveCount(1);
    holdReads = false;
    await expect(summary).toContainText("Nothing waiting");
    await expect(summary).toContainText("Production Off");
    await expect(summary).not.toContainText("All clear");

    // Status follows every route, with one weather canvas that navigation doesn't restart.
    await page.locator(".workspace-weather").evaluate(node => { (node as HTMLElement).dataset.kept = "yes"; });
    await page.getByRole("link", { name: /Project · active Moon garden/ }).click();
    await expect(page.getByRole("heading", { name: "Moon garden" })).toBeVisible();
    await expect(page).toHaveURL(/\/projects\/moon-garden$/);
    await expect(summary).toBeVisible();
    await page.getByRole("link", { name: "Feed" }).click();
    await expect(page).toHaveURL(/\/workspace\/feed$/);
    await expect(summary).toBeVisible();
    await expect(page.locator(".workspace-weather")).toHaveCount(1);
    await expect(page.locator(".workspace-weather")).toHaveAttribute("data-kept", "yes");
    await page.goBack();
    await expect(page).toHaveURL(/\/projects\/moon-garden$/);

    // A status change shows at the next read, and moves nothing but the Scene.
    const title = page.locator("#workspace-title");
    const draft = page.getByLabel("What would you like to do?");
    await draft.fill("An unsent thought");
    await draft.focus();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    approvals = [blockingDecision];
    await nudgeReads(page);
    await expect(summary).toContainText("Blocked");
    await expect(page).toHaveURL(/\/projects\/moon-garden$/);
    await expect(title).toHaveText("Moon garden");
    await expect(draft).toHaveValue("An unsent thought");
    await expect(draft).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    await expect(pill).not.toHaveAttribute("open");

    // Reasons link to where the operator can act.
    await summary.click();
    await expect(pill.getByRole("link", { name: "1 blocking item for you" })).toHaveAttribute("href", "/workspace/feed");
    await page.keyboard.press("Escape");
    await expect(pill).not.toHaveAttribute("open");
    await expect(summary).toBeFocused();

    // Better news has to hold, so a flicker can't clear the sky at the next read.
    approvals = [];
    await nudgeReads(page);
    await expect.poll(() => counts["/api/approvals"] ?? 0).toBeGreaterThan(0);
    await page.waitForTimeout(1_000);
    await expect(summary).toContainText("Blocked");

    // Each row of the production table reads as designed, and only On may say All clear.
    await page.goto(`${url}/workspace#dusk`);
    for (const row of ROWS) {
      production = row.read;
      await page.reload();
      await expect(summary, row.name).toContainText(row.label);
      await expect(summary, row.name).toContainText(row.words);
      if (row.label !== "All clear") await expect(summary, row.name).not.toContainText("All clear");
    }
    production = core("inactive_idle");

    // One shared set of reads per window: navigating doesn't fetch them again.
    await page.reload();
    await expect(summary).toContainText("Nothing waiting");
    await page.waitForLoadState("networkidle");
    const before = { ...counts };
    await page.getByRole("link", { name: /Project · active Moon garden/ }).click();
    await expect(page).toHaveURL(/\/projects\/moon-garden$/);
    await page.getByRole("link", { name: "Feed" }).click();
    await expect(page).toHaveURL(/\/workspace\/feed$/);
    for (const endpoint of ["/api/production-console", "/api/pull-requests"]) expect(counts[endpoint]).toBe(before[endpoint]);

    // Phone width: the top strip stays open sky, and the page doesn't scroll sideways.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${url}/workspace#dusk`);
    await expect(summary).toContainText("Production Off");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(page.locator(".workspace-header")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    // The reasons panel stays on screen wherever the pill wraps to.
    await summary.click();
    const panel = await page.locator(".workspace-status-panel").boundingBox();
    expect(panel?.x).toBeGreaterThanOrEqual(0);
    expect((panel?.x ?? 0) + (panel?.width ?? 0)).toBeLessThanOrEqual(390);
    await testInfo.attach("scene-phone", { body: await page.screenshot(), contentType: "image/png" });

    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await server.stop();
    await testInfo.attach("preview-log", { path: path.join(temp, "next.log"), contentType: "text/plain" });
    await rm(temp, { recursive: true, force: true });
  }
});
