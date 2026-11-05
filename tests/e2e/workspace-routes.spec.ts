import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProjectContinuationResponse } from "../../apps/dashboard/lib/arcadia-cli";
import type { AllPlansResponse, PlanDetailResponse, PlanRow, PlanSummariesResponse } from "../../apps/dashboard/lib/plans-types";
import { freePort, startProcess, waitForHttp } from "./fixtures/processes";

// Real agent-written text from Arcadia's own active Plan: long, technical and not for the operator's first glance.
const MILESTONE = "Arcadia runs production unattended on its own repository on the Claude provider: the worker launches a Session, preserves a reviewed PR, merges it through the PR when it is not authority-adjacent, and continues to the next Action within a spend bound, with operator touches limited to authority-adjacent merges.";
const LONG_TITLE = "A QA verdict whose only failure is the host-written operator QA plan uses no repair rounds, stops blocking, and files an Issue; and the plan renderer inspects what it writes before it writes it so that the REMOTE_TAIL_MARKER never lands.";
const TAIL = "REMOTE_TAIL_MARKER";

const planRow = (slug: string, counts: Partial<NonNullable<PlanRow["actionCounts"]>>, extra: Partial<PlanRow> = {}): PlanRow => ({ slug, status: "active", governed: true, milestone: MILESTONE, isActivePlan: true, actionCounts: { open: 0, in_progress: 0, done: 0, blocked: 0, ...counts }, activationNote: null, relativePath: `docs/plans/${slug}.md`, ...extra });
const route = planRow("long-route", { done: 3, open: 3, blocked: 1 });
const draft = planRow("later-ideas", { open: 1 }, { status: "draft", isActivePlan: false, milestone: "Ideas for later" });
const project = (slug: string, name: string, status: string, plans: PlanRow[] | null, error: string | null = null) => ({ id: `id-${slug}`, slug, name, status, activePlan: plans?.[0]?.slug ?? null, plans, error });
const portfolio: AllPlansResponse = {
  generatedAt: "2030-01-01T00:00:00.000Z",
  projects: [
    project("arcadia", "Arcadia", "active", [route, draft]),
    project("quiet", "Quiet project", "active", [planRow("quiet-plan", { done: 2 })]),
    project("broken", "Broken project", "active", null, "No repository path is configured, so its plans cannot be read."),
    project("three", "Third project", "active", [planRow("three-plan", { open: 2 })]),
    project("four", "Fourth project", "active", [planRow("four-plan", { in_progress: 1, open: 1 })]),
    project("five", "Fifth project", "active", [planRow("five-plan", { open: 1 })]),
    project("six", "Sixth project", "active", [planRow("six-plan", { open: 1 })]),
    project("paused", "Paused project", "paused", [planRow("paused-plan", { open: 1 })])
  ]
};
const action = (id: string, status: string, title: string) => ({ key: `arcadia/${id}`, status, title, dependsOn: [] });
const actions = [
  action("first-done", "done", "The first Action that already landed"),
  action("second-done", "done", LONG_TITLE),
  action("third-done", "done", "The third Action that already landed"),
  action("the-current", "open", LONG_TITLE),
  action("next-one", "open", "The next Action on the route"),
  action("stuck-one", "blocked", "An Action the record says is blocked"),
  action("later-one", "open", "A later Action still ahead")
];
const detail: PlanDetailResponse = { project: { id: "id-arcadia", slug: "arcadia", name: "Arcadia" }, plan: route, progress: { schema: "fixture", source: { planSlug: route.slug, planPath: route.relativePath, updated: "2030-01-01" }, counts: { open: 3, in_progress: 0, done: 3, blocked: 1, deferred: 0, total: 7 }, isActivePlan: true, current: { key: "arcadia/the-current", title: LONG_TITLE, status: "open", waitingOn: [], basis: "project_current_action" }, currentNote: null, next: [], blocked: [{ key: "arcadia/stuck-one", title: "An Action the record says is blocked", status: "blocked", waitingOn: [], reason: "Waiting on a review that has not happened" }], actions, note: "Fixture records" } };
const summaries: PlanSummariesResponse = { project: "arcadia", generatedAt: "2030-01-01", plans: { [route.slug]: { state: "fresh", planFresh: false, summary: null, actions: {} } } };
const journey = { schema: "arcadia-plan-journey-v1", generatedAt: "2030-01-01", project: "arcadia", plan: { slug: route.slug, milestone: MILESTONE, active: true }, context: {}, northStar: null, warnings: [], actions: [{ id: "the-current", title: "The current Action", status: "open", current: true, journey: { activity: { phase: "blocked", headline: "Stopped: QA fail", since: null, yourMove: null }, destination: { reached: false }, counts: { victories: 1, cleared: 0, open: 1 } } }] };
function continuation(): ProjectContinuationResponse {
  return {
    context: {
      repoRoot: "/repo", projectSlug: "arcadia", projectName: "Arcadia", projectStatus: "active", activePlan: route.slug, planPath: route.relativePath, planStatus: "active", planTokenImpact: "small", planTokenBudget: "", milestone: MILESTONE,
      action: { id: "the-current", title: LONG_TITLE, status: "open", responsibility: "agent", effort: "session", nextAction: "Do the next thing", expectedArtifact: "A pull request", clarification: "clarified", gapType: null, question: null, confidence: "high", source: null, dependsOn: [], acceptanceCriteria: ["It works"], decisions: [], references: [], execution: null, resolvedExecution: null },
      actionPath: route.relativePath, requiredDecisions: [], authorization: "A coding agent may implement this."
    },
    blockers: [], operatorQuestion: null, dispatchable: true, projectId: "id-arcadia", repoRoot: "/repo"
  };
}

const luminance = (rgb: number[]) => { const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const parse = (color: string) => { const n = color.match(/[\d.]+/g)!.map(Number); return { rgb: n.slice(0, 3), alpha: n[3] ?? 1 }; };
/** Contrast of an element's text against its surface, laid over the worst sky: plain white. */
async function contrastOverWhite(page: Page, selector: string, surface: string) {
  const { color, background } = await page.evaluate(([s, b]) => ({ color: getComputedStyle(document.querySelector(s)!).color, background: getComputedStyle(document.querySelector(b)!).backgroundColor }), [selector, surface]);
  const bg = parse(background), fg = parse(color);
  const over = bg.rgb.map(v => v * bg.alpha + 255 * (1 - bg.alpha));
  const [hi, lo] = [luminance(fg.rgb), luminance(over)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

test("routes: a tap moves at once, the shape comes first, and the agents' text waits until asked for", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const repo = path.resolve(import.meta.dirname, "../..");
  const temp = await mkdtemp(path.join(os.tmpdir(), "arcadia-workspace-routes-"));
  const port = await freePort(), url = `http://127.0.0.1:${port}`;
  const server = startProcess(process.execPath, [path.join(repo, "apps/dashboard/node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: path.join(repo, "apps/dashboard"), env: { ...process.env, HOME: temp, ARCADIA_WORKSPACE: temp }, logPath: path.join(temp, "next.log") });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const reads: string[] = [];
  const posts: string[] = [];
  let pages = 0;
  page.on("request", request => {
    if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/")) posts.push(request.url());
    // A page request a tap would have to wait for. Prefetches of ordinary links in the layout don't count.
    if (request.isNavigationRequest() || (new URL(request.url()).searchParams.has("_rsc") && !request.headers()["next-router-prefetch"])) pages += 1;
  });
  let hold: Promise<void> | null = null;
  let release: () => void = () => {};
  const holdReads = () => { hold = new Promise<void>(resolve => { release = () => { hold = null; resolve(); }; }); };
  let detailMode: "ok" | "fail" = "ok";
  await page.route("**/api/**", async route => {
    const address = new URL(route.request().url()), endpoint = address.pathname;
    reads.push(endpoint + address.search);
    if (endpoint === "/api/plans") return route.fulfill({ json: portfolio });
    if (endpoint === `/api/plans/arcadia/long-route`) {
      if (hold) await hold;
      return detailMode === "fail" ? route.fulfill({ status: 503, json: { error: `Could not read this Plan: ${"the repository lock was held by another process. ".repeat(12)}` } }) : route.fulfill({ json: detail });
    }
    if (endpoint === "/api/plan-summaries/arcadia") return route.fulfill({ json: summaries });
    if (endpoint === "/api/projects/id-arcadia/go-context") return route.fulfill({ json: { project: "arcadia", observedAt: new Date().toISOString(), resolution: continuation(), resolutionId: "fixture-resolution" } });
    if (endpoint === "/api/projects/id-arcadia/action-session") return route.fulfill({ json: { known: true, observedAt: new Date().toISOString(), session: null } });
    if (endpoint === "/api/journey/arcadia/plan/long-route") return route.fulfill({ json: journey });
    // An answer in another shape can't take the view down.
    if (endpoint === "/api/journey/arcadia/the-current") return route.fulfill({ json: { schema: "something-else" } });
    return route.abort();
  });
  const title = page.locator("#workspace-title");
  const reading = page.locator(".route-reading").first();
  const readsOf = (fragment: string) => reads.filter(r => r.includes(fragment));
  const sideways = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  try {
    await waitForHttp(`${url}/workspace`, server);
    await page.goto(`${url}/workspace`);

    // A portfolio is a few routes, worst first; every other Project waits behind one disclosure.
    await expect(title).toHaveText("Your work, in view");
    const rows = page.locator(".route-rows").first().locator(".route-row");
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toContainText("Arcadia");
    await expect(rows.first()).toContainText("3 of 7 done · 1 blocked");
    await expect(page.locator(".route-rows").first().getByText("Can't read its Plans")).toBeVisible();
    await expect(page.getByRole("link", { name: /Paused project/ })).toBeHidden();
    await page.getByText("All other Projects (3)").click();
    await expect(page.getByRole("link", { name: /Paused project/ })).toBeVisible();
    expect(await sideways()).toBe(false);
    await testInfo.attach("portfolio-phone", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    for (const selector of [".route-row-words", ".route-kind", "#workspace-title"]) {
      const surface = selector === ".route-row-words" ? ".route-row" : ".route-card";
      expect(await contrastOverWhite(page, selector, surface)).toBeGreaterThanOrEqual(4.5);
    }

    // No expensive read on the default views, and no page request for a tap.
    pages = 0;
    await rows.first().click();
    await expect(page).toHaveURL(/\/workspace\/projects\/arcadia$/);
    await expect(title).toHaveText("Arcadia");
    await expect(page.getByRole("heading", { name: "Recorded active Plan" })).toBeVisible();
    const planLink = page.getByRole("link", { name: /Plan, Active\. 3 of 7 done/ });
    await expect(planLink).toContainText("Arcadia runs production unattended");
    await expect(planLink).not.toContainText("the worker launches");
    await expect(page.getByRole("link", { name: /Ideas for later/ })).toBeHidden();
    await page.getByText("Not yet active (1)").click();
    await expect(page.getByRole("link", { name: /Ideas for later/ })).toBeVisible();
    expect(readsOf("plan-summaries").every(r => r.includes("brief=1"))).toBe(true);

    // The tap changes the route and the screen before the record arrives, and says what it's reading.
    holdReads();
    const tapped = Date.now();
    await planLink.click({ noWaitAfter: true });
    await expect(page).toHaveURL(/\/plans\/long-route$/, { timeout: 2_000 });
    await expect(title).toHaveText("Long route", { timeout: 2_000 });
    await expect(reading).toHaveText("Reading this Plan...", { timeout: 2_000 });
    expect(Date.now() - tapped).toBeLessThan(3_000);
    await expect(page.locator(".route-bones")).toBeVisible();
    await testInfo.attach("plan-reading-phone", { body: await page.screenshot(), contentType: "image/png" });

    // A slow read is allowed, and silent waiting isn't.
    await expect(reading).toContainText("your tap was received", { timeout: 12_000 });
    release();

    // A Plan is one route with named stops, in plain short words. The agents' text stays out.
    await expect(page.locator(".route-stops")).toBeVisible();
    await expect(reading).toHaveText("");
    await expect(title).toHaveText(/^Arcadia runs production unattended on its own repository.*…$/);
    await expect(page.getByText("Shortened from the record.")).toBeVisible();
    await expect(page.locator(".route-figure")).toHaveAttribute("aria-label", "Route of this Plan: 3 of 7 done · 1 blocked.");
    await expect(page.locator(".route-figure figcaption")).toHaveText("3 of 7 done · 1 blocked");
    const stops = page.locator(".route-stops");
    await expect(stops.locator(".mark-here")).toContainText("Current Action");
    await expect(stops.locator(".mark-blocked")).toContainText("An Action the record says is blocked");
    await expect(stops.getByRole("link", { name: /The first Action that already landed/ })).toBeHidden();
    await stops.getByText("3 done").click();
    await expect(stops.getByRole("link", { name: /The first Action that already landed/ })).toBeVisible();
    await stops.getByText("3 done").click();
    await stops.getByText("1 more ahead").click();
    await expect(stops.getByRole("link", { name: /A later Action still ahead/ })).toBeVisible();
    expect(await page.locator("main").evaluate((main, tail) => (main as HTMLElement).innerText.includes(tail), TAIL)).toBe(false);
    expect(await sideways()).toBe(false);
    await testInfo.attach("plan-phone", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

    // Nothing behind depth has been read yet, and no page request was needed for any tap.
    expect(pages).toBe(0);
    expect(readsOf("go-context")).toEqual([]);
    expect(readsOf("action-session")).toEqual([]);
    expect(readsOf("/api/journey")).toEqual([]);
    expect(readsOf("/api/approvals")).toEqual([]);
    expect(readsOf("/api/next-steps")).toEqual([]);
    expect(readsOf("plan-summaries").at(-1)).toContain("plan=long-route");

    // "Read the full record" loads the rest only when asked: every Action, the whole text, the Journey.
    await page.getByText("Read the full record").click();
    const record = page.locator(".route-record-body");
    await expect(record).toContainText(MILESTONE);
    await expect(record).toContainText(TAIL);
    await expect(record).toContainText("Every Action (7)");
    await expect(record).toContainText("Waiting on a review that has not happened");
    await expect(record).toContainText("Stopped: QA fail");
    await expect(record.getByRole("link", { name: "Open the whole Journey" })).toHaveAttribute("href", /\/journey\/arcadia\/plan\/long-route$/);
    expect(readsOf("/api/journey/arcadia/plan/long-route")).toHaveLength(1);
    expect(await sideways()).toBe(false);

    // Go's next move and its protected Continue stay reachable. Asking is what reads Go.
    const next = page.locator(".route-next");
    await expect(next.locator("summary")).toContainText("Ask Go");
    await next.locator("summary").click();
    await expect(next.locator("summary")).toContainText("Ready to continue");
    await expect(next.getByRole("button", { name: "Read again" })).toBeVisible();
    await expect(next.getByRole("button", { name: /^(Preview )?Continue/ })).toBeVisible();
    expect(readsOf("go-context")).toHaveLength(1);

    // An Action is one sentence. On another Action, Go stays one line.
    await stops.getByRole("link", { name: /The next Action on the route/ }).click();
    await expect(title).toHaveText("The next Action on the route");
    await expect(page.locator(".route-kind")).toHaveText("Action · Open");
    await expect(page.locator(".route-figure figcaption")).toHaveText("Stop 5 of 7");
    await expect(next).not.toHaveAttribute("open", "");

    // The Action the record says is current asks Go at once, and opens with Continue because Go says it's ready.
    await page.goBack();
    await expect(stops.locator(".mark-here a")).toBeVisible();
    await stops.locator(".mark-here a").click();
    await expect(title).toHaveText(/^A QA verdict whose only failure.*…$/);
    expect(await title.textContent().then(text => text!.length)).toBeLessThanOrEqual(72);
    await expect(page.locator(".route-kind")).toHaveText("Action · Open · Current Action");
    await expect(next).toHaveAttribute("open", "");
    await expect(next.getByRole("button", { name: /^(Preview )?Continue/ })).toBeVisible();
    await expect(next).toContainText("This is Go's current Action.");
    await testInfo.attach("action-phone", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.getByText("Read the full record").click();
    await expect(page.locator(".route-record-body")).toContainText(TAIL);
    await expect(page.locator(".route-record-body")).toContainText("What Go has for this Action");
    await expect(page.locator(".route-record-body")).toContainText("The Journey's answer couldn't be read.");
    expect(await sideways()).toBe(false);

    // Back and Forward work through every level, and through a page that isn't a route.
    expect(pages).toBe(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/plans\/long-route$/);
    await expect(page.locator(".route-stops")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/projects\/arcadia$/);
    await expect(title).toHaveText("Arcadia");
    await page.goForward();
    await expect(page).toHaveURL(/\/plans\/long-route$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/actions\/the-current$/);
    await expect(page.locator(".route-kind")).toHaveText("Action · Open · Current Action");
    await page.getByRole("link", { name: "Feed" }).click();
    await expect(page).toHaveURL(/\/workspace\/feed$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/actions\/the-current$/);
    await expect(page.locator(".route-kind")).toHaveText("Action · Open · Current Action");
    await page.goBack();
    await expect(page).toHaveURL(/\/plans\/long-route$/);
    await expect(page.locator(".route-stops")).toBeVisible();
    await page.reload();
    await expect(page.locator(".route-stops")).toBeVisible();
    await page.getByRole("navigation", { name: "Selected context" }).getByRole("link", { name: "Portfolio" }).click();
    await expect(title).toHaveText("Your work, in view");

    // A failed read says so in short words, the screen still moved, and Refresh recovers.
    await page.goto(`${url}/workspace/projects/arcadia/plans/long-route`);
    await expect(page.locator(".route-stops")).toBeVisible();
    detailMode = "fail";
    await page.getByRole("button", { name: "Refresh" }).click();
    const failed = page.getByRole("alert").filter({ hasText: "Context unavailable" });
    await expect(failed).toContainText("Could not read this Plan");
    expect(await failed.innerText().then(text => text.length)).toBeLessThan(300);
    await expect(reading).toHaveText("");
    expect(await sideways()).toBe(false);
    await testInfo.attach("failed-phone", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    detailMode = "ok";
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.locator(".route-stops")).toBeVisible();
    await expect(failed).toHaveCount(0);

    // A record that isn't there is named, and never drawn as an empty route.
    await page.goto(`${url}/workspace/projects/arcadia/plans/long-route/actions/not-an-action`);
    await expect(page.getByText("This Action is not in the selected Plan.")).toBeVisible();
    await page.goto(`${url}/workspace/projects/nowhere`);
    await expect(page.getByText("This Project is not in the workspace.")).toBeVisible();

    // Light sky, and a wide screen.
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`${url}/workspace/projects/arcadia/plans/long-route`);
    await expect(page.locator(".route-stops")).toBeVisible();
    await testInfo.attach("plan-phone-light", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator(".route-stops")).toBeVisible();
    expect(await sideways()).toBe(false);
    await testInfo.attach("plan-desktop-light", { body: await page.screenshot(), contentType: "image/png" });

    // The workspace only read.
    expect(posts).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    release();
    await server.stop();
    await testInfo.attach("preview-log", { path: path.join(temp, "next.log"), contentType: "text/plain" });
    await rm(temp, { recursive: true, force: true });
  }
});
