import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProjectContinuationResponse } from "../../apps/dashboard/lib/arcadia-cli";
import type { AllPlansResponse, PlanDetailResponse } from "../../apps/dashboard/lib/plans-types";
import { freePort, startProcess, waitForHttp } from "./fixtures/processes";

const counts = { open: 2, in_progress: 0, done: 0, blocked: 0 };
const goPlan = { slug: "first-website", status: "active", governed: true, milestone: "A small garden on the web", isActivePlan: true, actionCounts: counts, activationNote: null, relativePath: "docs/plans/first-website.md" };
const draftPlan = { ...goPlan, slug: "later-ideas", status: "draft", milestone: "Ideas for later", isActivePlan: false, relativePath: "docs/plans/later-ideas.md" };
const portfolio: AllPlansResponse = { generatedAt: "2030-01-01T00:00:00.000Z", projects: [{ id: "garden", slug: "moon-garden", name: "Moon garden", status: "active", activePlan: goPlan.slug, plans: [goPlan, draftPlan], error: null }] };
function detail(plan: typeof goPlan, actions: Array<{ key: string; title: string }>): PlanDetailResponse {
  return { project: { id: "garden", slug: "moon-garden", name: "Moon garden" }, plan, progress: { schema: "fixture", source: { planSlug: plan.slug, planPath: plan.relativePath, updated: "2030-01-01" }, counts: { ...counts, deferred: 0, total: actions.length }, isActivePlan: plan.isActivePlan, current: null, currentNote: null, next: [], blocked: [], actions: actions.map(a => ({ ...a, status: "open", dependsOn: [] })), note: "Fixture records" } };
}
const details: Record<string, PlanDetailResponse> = {
  "first-website": detail(goPlan, [{ key: "moon-garden/review-phone", title: "Review the page on a phone" }, { key: "moon-garden/write-copy", title: "Write the welcome copy" }]),
  "later-ideas": detail(draftPlan, [{ key: "moon-garden/sketch-pond", title: "Sketch the pond" }])
};
function continuation(overrides: Partial<ProjectContinuationResponse> = {}): ProjectContinuationResponse {
  return {
    context: {
      repoRoot: "/repo", projectSlug: "moon-garden", projectName: "Moon garden", projectStatus: "active", activePlan: "first-website", planPath: goPlan.relativePath, planStatus: "active", planTokenImpact: "small", planTokenBudget: "",
      milestone: "A small garden on the web",
      action: { id: "review-phone", title: "Review the page on a phone", status: "open", responsibility: "agent", effort: "session", nextAction: "Open the page at phone width and note what breaks", expectedArtifact: "Phone review notes", clarification: "clarified", gapType: null, question: null, confidence: "high", source: null, dependsOn: [], acceptanceCriteria: ["The page has no sideways scroll at 390 px", "Every control is reachable by keyboard"], decisions: [], references: [], execution: null, resolvedExecution: null },
      actionPath: goPlan.relativePath, requiredDecisions: [{ id: "d1", slug: "0001-palette", status: "open", question: "Which palette?", resolved: false }], authorization: "operator"
    },
    blockers: [], operatorQuestion: null, dispatchable: true, projectId: "garden", repoRoot: "/repo",
    ...overrides
  };
}

const direction = (page: Page) => page.getByRole("region", { name: "Direction" });

test("workspace renders Go's next move for the selected Project without choosing work itself", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const repo = path.resolve(import.meta.dirname, "../..");
  const temp = await mkdtemp(path.join(os.tmpdir(), "arcadia-workspace-go-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = startProcess(process.execPath, [path.join(repo, "apps/dashboard/node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: path.join(repo, "apps/dashboard"), env: { ...process.env, HOME: temp, ARCADIA_WORKSPACE: path.join(temp, "unconfigured") }, logPath: path.join(temp, "next.log") });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let goMode: "ready" | "gated" | "none" | "failed" | "malformed" = "ready";
  let goReads = 0;
  const mutations: string[] = [];
  await page.route("**/api/**", async route => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname;
    if (request.method() !== "GET") mutations.push(`${request.method()} ${endpoint}`);
    if (endpoint === "/api/plans") return route.fulfill({ json: portfolio });
    const plan = endpoint.match(/^\/api\/plans\/moon-garden\/([^/]+)$/)?.[1];
    if (plan && details[plan]) return route.fulfill({ json: details[plan] });
    if (endpoint === "/api/projects/garden/continuation") {
      ++goReads;
      if (goMode === "failed") return route.fulfill({ status: 503, json: { error: "Fixture Go read refused" } });
      if (goMode === "malformed") return route.fulfill({ json: { project: {} } });
      const body = goMode === "gated"
        ? continuation({ dispatchable: false, operatorQuestion: "Approve the garden palette first?", blockers: [{ relativePath: "docs/decisions/0001-palette.md", field: "status", message: "Decision 0001 is open", remedy: "Answer Decision 0001 on the Review page" }] })
        : goMode === "none" ? continuation({ context: null, dispatchable: false }) : continuation();
      return route.fulfill({ json: { project: { id: "garden" }, continuation: body, reviewItems: [] } });
    }
    return route.abort();
  });
  try {
    await waitForHttp(`${url}/workspace`, server);
    await page.clock.setFixedTime(new Date("2030-01-01T09:30:00.000Z"));
    await page.setViewportSize({ width: 1440, height: 1000 });

    // Portfolio: Go is never asked without a verified Project.
    await page.goto(`${url}/workspace`);
    await expect(direction(page).getByText("Choose a Project to see Go's next move.")).toBeVisible();
    expect(goReads).toBe(0);

    // Project: Go's own resolution, its milestone and Plan, and the existing control that starts work.
    await page.getByRole("link", { name: /Project · active Moon garden/ }).click();
    await expect(direction(page).getByText("Ready to continue")).toBeVisible();
    await expect(direction(page).getByText("Review the page on a phone")).toBeVisible();
    await expect(direction(page).getByText("Open the page at phone width and note what breaks")).toBeVisible();
    await expect(direction(page).getByText(/^From Go · read at/)).toBeVisible();
    await expect(direction(page).getByRole("link", { name: "this Project's page" })).toHaveAttribute("href", "/projects/garden");
    await expect(page.locator(".workspace-work")).toContainText("Go is working toward");
    await expect(page.locator(".workspace-work").getByRole("link", { name: "first-website" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go's next move and your Ask ↓" })).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("go-project-desktop.png") });

    // Go's Plan: Context marks Go's current Action; navigation alone never re-asks Go.
    await page.locator(".workspace-work").getByRole("link", { name: "first-website" }).click();
    await expect(page.getByRole("link", { name: /Action · open · Go's current Action Review the page on a phone/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Action · open Write the welcome copy/ })).toBeVisible();
    await expect(direction(page).getByRole("link", { name: "Show Go's current Action" })).toBeVisible();

    // Another Action in Go's Plan: the selection is named as not Go's current work.
    await page.getByRole("link", { name: /Write the welcome copy/ }).click();
    await expect(page.getByRole("heading", { name: "Write the welcome copy", exact: true })).toBeVisible();
    await expect(direction(page).getByText("Go's current Action in this Plan is")).toBeVisible();
    await expect(page.getByRole("heading", { name: "What Go has for this Action" })).toHaveCount(0);

    // Draft keeps its target through navigation, as before.
    await page.getByRole("textbox").fill("Make the welcome friendlier");
    await direction(page).getByRole("link", { name: "Review the page on a phone" }).click();
    await expect(page.getByRole("heading", { name: "Review the page on a phone", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveValue("Make the welcome friendlier");
    await expect(page.getByText("Your unsent draft keeps its original target.")).toBeVisible();

    // Go's current Action: Work shows what Go has for it, with acceptance behind disclosure.
    await expect(direction(page).getByText("This is Go's current Action.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "What Go has for this Action" })).toBeVisible();
    await expect(page.locator(".workspace-work")).toContainText("Phone review notes");
    await expect(page.locator(".workspace-work")).toContainText("Which palette? · open");
    await expect(page.getByText("The page has no sideways scroll at 390 px")).toBeHidden();
    await page.getByText("Acceptance criteria (2)").click();
    await expect(page.getByText("The page has no sideways scroll at 390 px")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("go-action-desktop.png"), fullPage: true });
    expect(goReads).toBe(1);

    // A different Plan: Go's work is elsewhere, and selecting it changes nothing.
    await page.goto(`${url}/workspace/projects/moon-garden/plans/later-ideas`);
    await expect(direction(page).getByText(/Go's current work is in Plan/)).toBeVisible();
    await expect(direction(page).getByRole("link", { name: "first-website" })).toHaveAttribute("href", "/workspace/projects/moon-garden/plans/first-website/actions/review-phone");

    // Waiting: Go's exact gate and remedy, not a guess.
    goMode = "gated";
    await direction(page).getByRole("button", { name: "Read again" }).click();
    await expect(direction(page).getByText("Waiting", { exact: true })).toBeVisible();
    await expect(direction(page).getByText("Approve the garden palette first?")).toBeVisible();
    await expect(direction(page).getByText("Answer Decision 0001 on the Review page")).toBeVisible();

    // A failed read keeps the last good one, labelled; a malformed reply is refused the same way.
    goMode = "failed";
    await direction(page).getByRole("button", { name: "Read again" }).click();
    await expect(direction(page).getByRole("alert")).toContainText("Go could not be read: Fixture Go read refused");
    await expect(direction(page).getByRole("alert")).toContainText("What follows is Go's last good read.");
    await expect(direction(page).getByText("Approve the garden palette first?")).toBeVisible();
    goMode = "malformed";
    await direction(page).getByRole("button", { name: "Read again" }).click();
    await expect(direction(page).getByRole("alert")).toContainText("the reply was not a Go resolution");

    // No good read at all: nothing is shown in its place.
    goMode = "failed";
    await page.goto(`${url}/workspace/projects/moon-garden`);
    await expect(direction(page).getByRole("alert")).toContainText("Nothing is shown in its place.");
    await expect(direction(page).getByText("Ready to continue")).toHaveCount(0);

    // No current Action: said plainly.
    goMode = "none";
    await direction(page).getByRole("button", { name: "Read again" }).click();
    await expect(direction(page).getByText("No current Action", { exact: true })).toBeVisible();
    await expect(direction(page).getByText("Go found no current Action for this Project.")).toBeVisible();

    // Phone: Work first, then Direction, then Context, with no sideways scroll.
    goMode = "ready";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${url}/workspace/projects/moon-garden/plans/first-website/actions/review-phone`);
    await expect(direction(page).getByText("This is Go's current Action.")).toBeVisible();
    const top = async (selector: string) => (await page.locator(selector).boundingBox())!.y;
    expect(await top(".workspace-work")).toBeLessThan(await top(".workspace-direction"));
    expect(await top(".workspace-direction")).toBeLessThan(await top(".workspace-context-panel"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("go-action-phone.png"), fullPage: true });
    // One tap from the top of Work reaches Go's move and the Ask.
    await page.getByRole("link", { name: "Go's next move and your Ask ↓" }).click();
    await expect(page.getByRole("heading", { name: "Next move" })).toBeFocused();
    await expect(page.getByRole("heading", { name: "Next move" })).toBeInViewport();

    // Keyboard: Read again is reachable and visibly focused.
    await page.keyboard.press("Tab");
    await expect(direction(page).getByRole("button", { name: "Read again" })).toBeFocused();
    expect(await direction(page).getByRole("button", { name: "Read again" }).evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");

    // The workspace only read: no request it made could change anything.
    expect(mutations).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await server.stop();
    await testInfo.attach("preview-log", { path: path.join(temp, "next.log"), contentType: "text/plain" });
    await rm(temp, { recursive: true, force: true });
  }
});
