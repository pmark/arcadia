import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { freePort, startProcess, waitForHttp, type TrackedProcess } from "./fixtures/processes";

const plan = { slug: "first-website", status: "active", governed: true, milestone: "A small garden on the web", isActivePlan: true, actionCounts: { open: 1, in_progress: 0, done: 0, blocked: 0 }, activationNote: null, relativePath: "docs/plans/first-website.md" };
const portfolio = { generatedAt: "2030-01-01T00:00:00.000Z", projects: [{ id: "garden", slug: "moon-garden", name: "Moon garden", status: "active", activePlan: plan.slug, plans: [plan], error: null }] };
const detail = { project: { id: "garden", slug: "moon-garden", name: "Moon garden" }, plan, progress: { schema: "fixture", source: { planSlug: plan.slug, planPath: plan.relativePath, updated: "2030-01-01" }, counts: { open: 1, in_progress: 0, done: 0, blocked: 0, deferred: 0, total: 1 }, isActivePlan: true, current: null, currentNote: null, next: [], blocked: [], actions: [{ key: "moon-garden/review-phone", title: "Review the page on a phone", status: "open", dependsOn: [] }] } };
const NONE = { blocking: 0, yours: 0, failing: 0, others: 0, prs: 0 };
const ACTION_URL = "/workspace/projects/moon-garden/plans/first-website/actions/review-phone";

type World = { plans: "ready" | "failing" | "slow"; ask: "ok" | "lost" | "refused"; receipt: "missing" | "ready"; posts: Array<Record<string, unknown>>; blocking: number };
const relay = (page: Page) => page.locator(".relay");
const field = (page: Page) => page.getByRole("textbox", { name: "What would you like to do?" });
const put = (page: Page) => page.getByRole("button", { name: "Put down", exact: true });
const height = (page: Page) => relay(page).getAttribute("data-height");
const expectHeight = (page: Page, value: string) => expect(relay(page)).toHaveAttribute("data-height", value);
/** Waits until nothing in Relay is still moving, so a box read next is where it settled. */
const settled = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined))));

async function serve(page: Page, world: World): Promise<{ url: string; server: TrackedProcess; temp: string }> {
  const repo = path.resolve(import.meta.dirname, "../..");
  const temp = await mkdtemp(path.join(os.tmpdir(), "arcadia-workspace-relay-"));
  const port = await freePort();
  const server = startProcess(process.execPath, [path.join(repo, "apps/dashboard/node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: path.join(repo, "apps/dashboard"), env: { ...process.env, HOME: temp, ARCADIA_WORKSPACE: temp }, logPath: path.join(temp, "next.log") });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname;
    if (endpoint === "/api/ask") {
      const body = request.postDataJSON() as Record<string, unknown>;
      world.posts.push(body);
      if (world.ask === "lost") return route.abort("failed");
      if (world.ask === "refused") return route.fulfill({ status: 400, json: { error: "That Action no longer exists." } });
      return route.fulfill({ json: body.directionTarget
        ? { message: "Direction submitted.", direction: { requestId: body.requestId, content: body.request, target: body.directionTarget, fingerprint: "a".repeat(64), disposition: "accepted", state: "submitted", lastSupportedState: "submitted", reason: null, evidence: [] } }
        : { message: "Recorded your request.", result: { result: { status: "captured", summary: "Recorded your request." } } } });
    }
    if (endpoint === "/api/ask/show") {
      if (world.receipt === "missing") return route.fulfill({ status: 400, json: { error: "No Ask capture, request, or ask matches this id." } });
      const id = new URL(request.url()).searchParams.get("id");
      const original = world.posts.find(post => post.requestId === id);
      return route.fulfill({ json: { capture: { id: "capture-1", requestId: id, originalText: original?.request ?? "Recovered", ingressSource: "dashboard.ask", capturedAt: "2030-01-01", status: "processed", relatedReviewId: null, outcomes: [] }, asks: [], ...(original?.directionTarget ? { direction: { requestId: id, content: original.request, target: original.directionTarget, fingerprint: "a".repeat(64), disposition: "accepted", state: "submitted", lastSupportedState: "submitted", reason: null, evidence: [] } } : {}) } });
    }
    if (endpoint === "/api/plans") {
      if (world.plans === "failing") return route.fulfill({ status: 503, json: { error: "Fixture read refused" } });
      if (world.plans === "slow") await new Promise(resolve => setTimeout(resolve, 2_500));
      return route.fulfill({ json: portfolio });
    }
    if (endpoint === "/api/plans/moon-garden/first-website") return route.fulfill({ json: detail });
    if (endpoint === "/api/workspace/status") {
      const asOf = Date.now();
      return route.fulfill({ json: { generatedAt: new Date().toISOString(), counts: { ...NONE, blocking: world.blocking, yours: world.blocking }, production: { displayState: "inactive_idle", workerRunning: false, heartbeatFresh: false, liveSessions: 0, stalledSessions: 0 }, sources: { "To-do list": { asOf, failed: false }, "next steps": { asOf, failed: false }, "pull requests": { asOf, failed: false }, production: { asOf, failed: false } } } });
    }
    return route.abort();
  });
  await waitForHttp(`http://127.0.0.1:${port}/workspace`, server);
  return { url: `http://127.0.0.1:${port}`, server, temp };
}

async function stop(ctx: { server: TrackedProcess; temp: string }) {
  await ctx.server.stop();
  await rm(ctx.temp, { recursive: true, force: true });
}

const newWorld = (over: Partial<World> = {}): World => ({ plans: "ready", ask: "ok", receipt: "ready", posts: [], blocking: 0, ...over });

/** What a person actually sees of an element's text colour against what's behind it, with the surface composited over a white sky as the worst case. */
const CONTRAST_CHECK = () => {
  const parse = (value: string) => { const m = value.match(/[\d.]+/g)!.map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
  const over = (top: { r: number; g: number; b: number; a: number }, under: { r: number; g: number; b: number; a: number }) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const lum = ({ r, g, b }: { r: number; g: number; b: number }) => { const c = [r, g, b].map(v => { const s = v / 255; return s <= .03928 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const backdrop = (el: Element, stopAt: Element) => {
    const layers: Array<{ r: number; g: number; b: number; a: number }> = [];
    for (let node: Element | null = el; node; node = node === stopAt ? null : node.parentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg.a > 0) layers.push(bg);
    }
    let result = { r: 255, g: 255, b: 255, a: 1 };
    const surface = stopAt.querySelector(".relay-surface");
    if (surface && getComputedStyle(surface).opacity !== "0") result = over(parse(getComputedStyle(surface).backgroundColor), result);
    for (const layer of layers.reverse()) result = over(layer, result);
    return result;
  };
  const root = document.querySelector(".relay")!;
  const worst: Array<{ text: string; ratio: number }> = [];
  for (const el of root.querySelectorAll<HTMLElement>("p,b,button:not(:disabled),label,summary,h2,h3,textarea,code,a")) {
    if (el.closest("[inert]") || !el.getClientRects().length) continue;
    const fg = parse(getComputedStyle(el).color);
    const bg = backdrop(el, root);
    const a = lum(fg), b = lum(bg);
    worst.push({ text: (el.textContent || el.tagName).slice(0, 40), ratio: Math.round((Math.max(a, b) + .05) / (Math.min(a, b) + .05) * 100) / 100 });
  }
  return worst.sort((x, y) => x.ratio - y.ratio).slice(0, 5);
};

for (const size of [{ name: "phone", width: 390, height: 844 }, { name: "keyboard height", width: 390, height: 500 }, { name: "desktop", width: 1440, height: 900 }]) {
  test(`Relay is modal, available from every view, and keeps its Ask at ${size.name}`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const world = newWorld();
    const ctx = await serve(page, world);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: size.width, height: size.height });
    try {
      // At rest it's a real field at the thumb, and the View underneath works.
      await page.goto(`${ctx.url}/workspace#dusk`);
      await expect(page.getByRole("heading", { name: "Your work, in view" })).toBeVisible();
      await expect(field(page)).toBeVisible();
      await expect(field(page)).toBeEnabled();
      await expectHeight(page, "rest");
      await expect(field(page)).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await testInfo.attach(`rest-${size.name}`, { body: await page.screenshot(), contentType: "image/png" });
      await page.getByRole("link", { name: /Project · active Moon garden/ }).click();
      await expect(page.getByRole("heading", { name: "Moon garden" })).toBeVisible();

      // It's on the Feed too, where there's no subject, so it says it's using the whole portfolio.
      await page.getByRole("link", { name: "Feed" }).click();
      await expect(page).toHaveURL(/\/workspace\/feed$/);
      await field(page).focus();
      await expect(relay(page).locator(".relay-chip")).toContainText("whole portfolio");
      await expect(page.getByRole("dialog", { name: "Relay", exact: true })).toBeVisible();
      await put(page).click();
      await expectHeight(page, "rest");
      await page.goBack();
      await expect(page.getByRole("heading", { name: "Moon garden" })).toBeVisible();

      // Opening: the View goes inert and recedes, the chip and the field are on screen, and the strip stays readable.
      await page.goto(`${ctx.url}${ACTION_URL}#dusk`);
      await expect(page.getByRole("heading", { name: "Review the page on a phone", exact: true })).toBeVisible();
      await field(page).focus();
      await expectHeight(page, "answer");
      await settled(page);
      const view = page.locator(".relay-view");
      await expect(view).toHaveAttribute("inert", "");
      expect(Number(await view.evaluate(el => getComputedStyle(el).opacity))).toBeLessThan(1);
      await expect(relay(page).locator(".relay-chip")).toContainText("Moon garden");
      for (const visible of [relay(page).locator(".relay-chip"), field(page), page.getByRole("button", { name: "Send new Ask", exact: true })]) await expect(visible).toBeInViewport({ ratio: 1 });
      const pill = page.locator(".workspace-status summary");
      await expect(pill).toBeInViewport({ ratio: 1 });
      const strip = await pill.boundingBox();
      const sheet = await relay(page).boundingBox();
      expect(sheet!.y).toBeGreaterThanOrEqual(strip!.y + strip!.height);
      // The scrim is clear over the strip, so the pill's words aren't dimmed.
      const stripClear = await page.locator(".relay-scrim").evaluate(el => getComputedStyle(el).backgroundImage);
      expect(stripClear).toMatch(/^linear-gradient\(rgba\(0, 0, 0, 0\)/);
      await expect(page.locator(".workspace-header")).not.toHaveAttribute("inert", "");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await testInfo.attach(`answer-${size.name}`, { body: await page.screenshot(), contentType: "image/png" });

      // Text and controls hold 4.5:1 with a white sky behind the surface.
      const worst = await page.evaluate(CONTRAST_CHECK);
      for (const item of worst) expect(item.ratio, item.text).toBeGreaterThanOrEqual(4.5);

      // A tap outside only puts Relay down. It doesn't press what's under it, even on a link.
      const link = await page.getByRole("link", { name: "Portfolio", exact: true }).boundingBox().catch(() => null);
      await put(page).click();
      await expectHeight(page, "rest");
      await settled(page);
      const portfolioLink = page.getByRole("link", { name: "Portfolio", exact: true });
      const box = link ?? await portfolioLink.boundingBox();
      await field(page).focus();
      await expectHeight(page, "answer");
      await settled(page);
      const before = page.url();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await expectHeight(page, "rest");
      expect(page.url()).toBe(before);
      await expect(page.getByRole("heading", { name: "Review the page on a phone", exact: true })).toBeVisible();
      await expect(view).not.toHaveAttribute("inert", "");
      await expect(page.locator(".workspace-activity")).toHaveText("");

      // The chevron and the grip reach the whole thread, without pressing the field, and it's still modal.
      await page.getByRole("button", { name: "Show the whole thread" }).click();
      await expectHeight(page, "thread");
      await settled(page);
      await expect(page.getByText(/One exchange is shown at a time/)).toBeVisible();
      await expect(pill).toBeInViewport({ ratio: 1 });
      await testInfo.attach(`thread-${size.name}`, { body: await page.screenshot(), contentType: "image/png" });
      await page.keyboard.press("Escape");
      await expectHeight(page, "answer");
      await settled(page);
      const grip = await relay(page).locator(".relay-head").boundingBox();
      await page.mouse.move(grip!.x + 40, grip!.y + 20);
      await page.mouse.down();
      await page.mouse.move(grip!.x + 40, grip!.y - 60, { steps: 4 });
      await expect(relay(page)).toHaveAttribute("data-pulling", "");
      await page.mouse.up();
      await expectHeight(page, "thread");
      await page.getByRole("button", { name: "Show less", exact: true }).click();
      await expectHeight(page, "answer");

      // Ask keeps its receipt loop: durable identity first, and the answer shows in place while the View stays put.
      await field(page).fill("Water the moon garden");
      await page.getByRole("button", { name: "Send new Ask", exact: true }).click();
      await expect(page.getByText("Recorded your request.", { exact: true })).toBeVisible();
      expect(world.posts).toHaveLength(1);
      expect(world.posts[0].projectId).toBe("garden");
      await expect(field(page)).toHaveValue("");
      expect(page.url()).toContain(`receipt=${encodeURIComponent(String(world.posts[0].requestId))}`);
      await expectHeight(page, "answer");
      expect(errors).toEqual([]);
    } finally { await stop(ctx); }
  });
}

test("the keyboard works it: slash, Escape down a height, focus returns, and focus stays inside", async ({ page }) => {
  test.setTimeout(120_000);
  const world = newWorld();
  const ctx = await serve(page, world);
  await page.setViewportSize({ width: 1280, height: 800 });
  try {
    await page.goto(`${ctx.url}/workspace/projects/moon-garden#dusk`);
    await expect(page.getByRole("heading", { name: "Moon garden" })).toBeVisible();
    // Slash from a control returns there, and typing in a field isn't stolen.
    const wordmark = page.getByRole("link", { name: "arcadia", exact: true });
    await wordmark.focus();
    await page.keyboard.press("/");
    await expect(field(page)).toBeFocused();
    await expectHeight(page, "answer");
    await page.keyboard.type("a/b");
    await expect(field(page)).toHaveValue("a/b");
    // Tab stays inside the open sheet, both ways.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".relay")))).toBe(true);
    }
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".relay")))).toBe(true);
    }
    await page.getByRole("button", { name: "Whole thread", exact: true }).click();
    await expectHeight(page, "thread");
    await page.keyboard.press("Escape");
    await expectHeight(page, "answer");
    await expect(field(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expectHeight(page, "rest");
    await expect(wordmark).toBeFocused();
    await expect(field(page)).toHaveValue("a/b");
    // Opened with no earlier focus, it comes back to the capsule's button, which doesn't reopen anything.
    await wordmark.evaluate(element => (element as HTMLElement).blur());
    await page.keyboard.press("/");
    await expectHeight(page, "answer");
    await page.keyboard.press("Escape");
    await expectHeight(page, "rest");
    await expect(page.getByRole("button", { name: /Show the whole thread/ })).toBeFocused();
    // Assistive tech: a labelled modal dialog when open, and the thread is a polite live region.
    await field(page).focus();
    const dialog = page.getByRole("dialog", { name: "Relay", exact: true });
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await field(page).fill("Say it");
    await page.getByRole("button", { name: "Send new Ask", exact: true }).click();
    await expect(page.getByRole("region", { name: "Latest Ask" })).toHaveAttribute("aria-live", "polite");
    // A native modal owns Escape and slash until it closes: its own close doesn't also move Relay.
    await page.evaluate(() => { const d = document.createElement("dialog"); d.id = "fixture"; document.querySelector(".relay-scroll")!.append(d); d.showModal(); d.addEventListener("cancel", () => d.remove()); });
    await page.keyboard.press("/");
    await page.keyboard.press("Escape");
    await expect(page.locator("#fixture")).toHaveCount(0);
    await expectHeight(page, "answer");
  } finally { await stop(ctx); }
});

test("gates stay: an unverified view, a vanished target and an earlier uncertain send are all refused", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const world = newWorld({ plans: "failing" });
  const ctx = await serve(page, world);
  await page.setViewportSize({ width: 390, height: 844 });
  const send = () => page.getByRole("button", { name: "Send new Ask", exact: true });
  const direction = () => page.getByRole("checkbox", { name: "Send as a direction to this context" });
  try {
    // The View's read fails. Relay still opens at once and takes a draft, and says why sending is held.
    await page.goto(`${ctx.url}${ACTION_URL}#dusk`);
    await field(page).focus();
    await expectHeight(page, "answer");
    await field(page).fill("Keep this thought");
    await expect(send()).toBeDisabled();
    await expect(direction()).toBeDisabled();
    await expect(page.getByText(/couldn't confirm this view/)).toBeVisible();
    await testInfo.attach("view-failing", { body: await page.screenshot(), contentType: "image/png" });
    expect(world.posts).toEqual([]);

    // Only an explicit tap may use the whole portfolio, and then no Project, Plan or Action goes with it.
    await page.getByRole("button", { name: "Ask the whole portfolio instead", exact: true }).click();
    await expect(relay(page).locator(".relay-chip")).toContainText("whole portfolio");
    await expect(direction()).toBeDisabled();
    world.ask = "ok";
    await send().click();
    await expect(page.getByText("Recorded your request.", { exact: true })).toBeVisible();
    expect(world.posts[0]).toMatchObject({ request: "Keep this thought" });
    expect(world.posts[0].projectId).toBeUndefined();
    expect(world.posts[0].directionTarget).toBeUndefined();

    // A slow View never holds up Relay: it opens and takes typing while the read is out, with a line saying so.
    await page.evaluate(() => localStorage.clear());
    world.posts.length = 0;
    world.plans = "slow";
    await page.goto(`${ctx.url}${ACTION_URL}#dusk`);
    await field(page).focus();
    await expectHeight(page, "answer");
    await field(page).fill("Typed before the read landed");
    await expect(page.getByRole("status").filter({ hasText: "Reading this view" })).toBeVisible();
    await expect(send()).toBeDisabled();
    // Once it lands, a draft typed during the read belongs to the verified view, not to a guess.
    await expect(send()).toBeEnabled({ timeout: 15_000 });
    await expect(relay(page).locator(".relay-chip")).toContainText("Moon garden");
    world.plans = "ready";

    // A direction names its exact target. A refusal from Arcadia (a vanished target) is shown and never resent.
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${ctx.url}${ACTION_URL}#dusk`);
    await field(page).fill("Direct this Action");
    await expect(direction()).toBeEnabled();
    await direction().check();
    await expect(relay(page)).toContainText("Records a direction for Moon garden / first-website / Review the page on a phone");
    world.ask = "refused"; world.receipt = "missing";
    await page.getByRole("button", { name: "Send direction", exact: true }).click();
    await expect(page.getByText("That Action no longer exists.", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Direction · unknown", exact: true })).toBeVisible();
    expect(world.posts).toHaveLength(1);

    // While that outcome is uncertain, nothing new can go, ordinary or direction, and Retry is the original unchanged.
    await field(page).fill("A second thought");
    await expect(page.getByRole("button", { name: "Send direction", exact: true })).toBeDisabled();
    await direction().uncheck();
    await expect(send()).toBeDisabled();
    const original = world.posts[0];
    world.ask = "ok"; world.receipt = "ready";
    await page.getByRole("button", { name: "Retry original unchanged Ask" }).click();
    await expect.poll(() => world.posts.length).toBe(2);
    expect(world.posts[1]).toEqual(original);
    await expect(field(page)).toHaveValue("A second thought");
  } finally { await stop(ctx); }
});

test("navigation keeps the draft's target, a status change moves nothing, and blocked storage still works", async ({ page }) => {
  test.setTimeout(150_000);
  const world = newWorld();
  const ctx = await serve(page, world);
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    await page.goto(`${ctx.url}${ACTION_URL}#dusk`);
    await expect(page.getByRole("heading", { name: "Review the page on a phone", exact: true })).toBeVisible();
    await field(page).fill("About this exact Action");
    await put(page).click();
    await page.getByRole("link", { name: "Feed" }).click();
    await expect(page).toHaveURL(/\/workspace\/feed$/);
    await expect(field(page)).toHaveValue("About this exact Action");
    await field(page).focus();
    await expect(relay(page).locator(".relay-chip")).toContainText("Moon garden");
    await expect(page.getByText(/Your unsent draft keeps its original target/)).toBeVisible();

    // A status change with Relay open touches the sky and the pill, and nothing in Relay.
    await settled(page);
    const box = await relay(page).boundingBox();
    const summary = page.locator(".workspace-status summary");
    world.blocking = 1;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(summary).toContainText("Blocked");
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveValue("About this exact Action");
    expect(await relay(page).boundingBox()).toEqual(box);
    expect(await height(page)).toBe("answer");

    // Relay never speaks first: nothing a read brings opens it.
    await put(page).click();
    world.blocking = 0;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(500);
    expect(await height(page)).toBe("rest");

    // "Use this view" moves the draft to what's on screen.
    await page.goto(`${ctx.url}/workspace#dusk`);
    await expect(page.getByRole("heading", { name: "Your work, in view" })).toBeVisible();
    await field(page).focus();
    await page.getByRole("button", { name: "Use this view", exact: true }).click();
    await expect(relay(page).locator(".relay-chip")).toContainText("whole portfolio");

    // Blocked storage: Relay still opens and sends, and says what's at risk.
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("Fixture storage refused"); }; });
    await field(page).fill("No storage request");
    await expect(page.getByRole("alert").filter({ hasText: "Browser storage" })).toBeVisible();
    await page.getByRole("button", { name: "Send new Ask", exact: true }).click();
    await expect(page.getByText("Recorded your request.", { exact: true })).toBeVisible();
  } finally { await stop(ctx); }
});

test("only transform and opacity animate, none under reduced motion, and opening does no layout on the canvases' watch", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const world = newWorld();
  const ctx = await serve(page, world);
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    await page.goto(`${ctx.url}${ACTION_URL}#dusk`);
    await expect(page.getByRole("heading", { name: "Review the page on a phone", exact: true })).toBeVisible();
    const client = await page.context().newCDPSession(page);
    await client.send("Performance.enable");
    const layouts = async () => {
      const { metrics } = await client.send("Performance.getMetrics");
      return metrics.find(metric => metric.name === "LayoutCount")!.value;
    };
    await expect.poll(() => page.locator(".workspace-sky").evaluate(canvas => (canvas as HTMLCanvasElement).width)).toBe(390);

    // Sample every frame for a whole open, with all three canvases running behind it.
    const measure = (action: "open" | "close") => page.evaluate(async which => {
      const field = document.querySelector("textarea")!;
      const frames: number[] = [];
      let last = performance.now();
      let running = true;
      const tick = (now: number) => { frames.push(now - last); last = now; if (running) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      if (which === "open") field.focus(); else (document.querySelector(".relay-scrim") as HTMLElement).click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const props = new Set(document.getAnimations().flatMap(animation => animation instanceof CSSTransition ? [animation.transitionProperty] : []));
      await new Promise(resolve => setTimeout(resolve, 400));
      running = false;
      const sorted = [...frames].sort((a, b) => a - b);
      return { properties: [...props], frames: frames.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * .95)], worstMs: sorted[sorted.length - 1] };
    }, action);
    const beforeOpen = await layouts();
    const opened = await measure("open");
    const afterOpen = await layouts();
    const closed = await measure("close");
    const afterClose = await layouts();
    const report = { opened, openLayouts: afterOpen - beforeOpen, closed, closeLayouts: afterClose - afterOpen };
    await testInfo.attach("motion-measurements", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
    console.log(`relay motion: ${JSON.stringify(report)}`);
    // The composer is compositor-only: anything else moving here would mean per-frame layout or paint.
    for (const property of [...opened.properties, ...closed.properties]) expect(["transform", "opacity", "filter"], property).toContain(property);
    expect(opened.properties).toContain("transform");
    expect(opened.properties).toContain("opacity");
    // One layout at the change of height, not one per frame of a transition that lasts many frames.
    expect(report.openLayouts).toBeLessThan(5);
    expect(report.closeLayouts).toBeLessThan(5);

    // Reduced motion: it changes height at once, with nothing animating, and the same things are true.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await field(page).focus();
    await expectHeight(page, "answer");
    expect(await page.evaluate(() => document.getAnimations().filter(a => a instanceof CSSTransition && (a.effect?.getComputedTiming().duration ?? 0) as number > 0 && (a.effect as KeyframeEffect).target?.closest(".relay,.relay-root")).length)).toBe(0);
    await expect(page.locator(".relay-view")).toHaveAttribute("inert", "");
    await page.keyboard.press("Escape");
    await expectHeight(page, "rest");
  } finally { await stop(ctx); }
});

test("a scrolled page keeps the status readable, and doesn't press through or move", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const world = newWorld();
  const ctx = await serve(page, world);
  await page.setViewportSize({ width: 390, height: 500 });
  try {
    await page.goto(`${ctx.url}${ACTION_URL}#dusk`);
    await expect(page.getByRole("heading", { name: "Review the page on a phone", exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 240));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const scrolled = await page.evaluate(() => window.scrollY);
    await field(page).focus();
    await expectHeight(page, "answer");
    await settled(page);
    await expect(page.locator(".relay-status")).toBeInViewport({ ratio: 1 });
    await expect(page.locator(".relay-status")).toContainText("Production Off");
    await testInfo.attach("scrolled-keyboard-height", { body: await page.screenshot(), contentType: "image/png" });
    await put(page).click();
    await expectHeight(page, "rest");
    await expect(page.locator(".relay-status")).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  } finally { await stop(ctx); }
});
