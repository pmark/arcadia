import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DashboardAgentSession } from "../../apps/dashboard/lib/types";
import type { ProjectContinuationResponse } from "../../apps/dashboard/lib/arcadia-cli";
import type { AllPlansResponse, PlanDetailResponse } from "../../apps/dashboard/lib/plans-types";
import { freePort, startProcess, waitForHttp } from "./fixtures/processes";

const counts = { open: 2, in_progress: 0, done: 0, blocked: 0 };
const goPlan = { slug: "first-website", status: "active", governed: true, milestone: "A small garden on the web", isActivePlan: true, actionCounts: counts, activationNote: null, relativePath: "docs/plans/first-website.md" };
const draftPlan = { ...goPlan, slug: "later-ideas", status: "draft", milestone: "Ideas for later", isActivePlan: false, relativePath: "docs/plans/later-ideas.md" };
const staleActive = { ...goPlan, slug: "old-greenhouse", milestone: "A greenhouse we stopped building", isActivePlan: false, relativePath: "docs/plans/old-greenhouse.md" };
const pitch = { ...draftPlan, slug: "night-lights", status: "proposed", governed: false, milestone: "Lights for evening visits", actionCounts: null, relativePath: "docs/plans/night-lights.md" };
const finished = { ...goPlan, slug: "fence", status: "complete", milestone: "A fence around the beds", isActivePlan: false, actionCounts: { open: 0, in_progress: 0, done: 3, blocked: 0 }, relativePath: "docs/plans/fence.md" };
// Listed in the order a Project returns them: Go's Plan is not first.
const portfolio: AllPlansResponse = { generatedAt: "2030-01-01T00:00:00.000Z", projects: [{ id: "garden", slug: "moon-garden", name: "Moon garden", status: "active", activePlan: goPlan.slug, plans: [finished, draftPlan, staleActive, goPlan, pitch], error: null }] };
function detail(plan: typeof goPlan, actions: Array<{ key: string; title: string }>): PlanDetailResponse {
  return { project: { id: "garden", slug: "moon-garden", name: "Moon garden" }, plan, progress: { schema: "fixture", source: { planSlug: plan.slug, planPath: plan.relativePath, updated: "2030-01-01" }, counts: { ...counts, deferred: 0, total: actions.length }, isActivePlan: plan.isActivePlan, current: null, currentNote: null, next: [], blocked: [], actions: actions.map(a => ({ ...a, status: "open", dependsOn: [] })), note: "Fixture records" } };
}
const details: Record<string, PlanDetailResponse> = {
  "first-website": detail(goPlan, [{ key: "moon-garden/review-phone", title: "Review the page on a phone" }, { key: "moon-garden/write-copy", title: "Write the welcome copy" }]),
  "later-ideas": detail(draftPlan, [{ key: "moon-garden/sketch-pond", title: "Sketch the pond" }])
};
// Shaped like real Go output: a dispatchable Action has every required Decision resolved.
function continuation(overrides: Partial<ProjectContinuationResponse> = {}, responsibility = "agent", authorization = "A coding agent may implement this using normal repository authority."): ProjectContinuationResponse {
  return {
    context: {
      repoRoot: "/repo", projectSlug: "moon-garden", projectName: "Moon garden", projectStatus: "active", activePlan: "first-website", planPath: goPlan.relativePath, planStatus: "active", planTokenImpact: "small", planTokenBudget: "",
      milestone: "A small garden on the web",
      action: { id: "review-phone", title: "Review the page on a phone", status: "open", responsibility, effort: "session", nextAction: "Open the page at phone width and note what breaks", expectedArtifact: "Phone review notes", clarification: "clarified", gapType: null, question: null, confidence: "high", source: null, dependsOn: [], acceptanceCriteria: ["The page has no sideways scroll at 390 px", "Every control is reachable by keyboard"], decisions: [], references: [], execution: null, resolvedExecution: null },
      actionPath: goPlan.relativePath, requiredDecisions: [{ id: "d1", slug: "0001-palette", status: "answered", question: "Which palette?", resolved: true }], authorization
    },
    blockers: [], operatorQuestion: null, dispatchable: true, projectId: "garden", repoRoot: "/repo",
    ...overrides
  };
}

const direction = (page: Page) => page.getByRole("region", { name: "Direction" });
/** Go's rendered result, apart from the visually hidden announcement that repeats it for screen readers. */
const result = (page: Page) => direction(page).locator(".workspace-go-result");
/** Go's next move is one line until it's asked for. Asking is what reads Go. */
const openNextMove = async (page: Page) => {
  const next = direction(page).locator(".route-next");
  await next.waitFor();
  if (!await next.evaluate(element => (element as HTMLDetailsElement).open)) await next.locator("summary").click();
};
const subject = (page: Page) => page.locator(".route-subject");
const crumb = (page: Page, name: string) => page.getByRole("navigation", { name: "Selected context" }).getByRole("link", { name });

for (const width of [390, 1280]) test(`workspace Continue gives visible feedback and Session progress at ${width}px`, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const repo = path.resolve(import.meta.dirname, "../..");
  const temp = await mkdtemp(path.join(os.tmpdir(), "arcadia-workspace-continue-"));
  const port = await freePort(), url = `http://127.0.0.1:${port}`;
  const server = startProcess(process.execPath, [path.join(repo, "apps/dashboard/node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: path.join(repo, "apps/dashboard"), env: { ...process.env, HOME: temp, ARCADIA_WORKSPACE: path.join(temp, "unconfigured") }, logPath: path.join(temp, "next.log") });
  let writes = 0, gated = false, restored = false, lookupFailed = false, pointerMoved = false;
  const durable: DashboardAgentSession = {
    id: "fixture-session", projectId: "garden", projectName: "Moon garden", actionId: "review-phone", actionTitle: "Review the page on a phone", planSlug: "first-website", packetPath: "fixture", provider: "codex-cli", model: "configured-model", effort: "medium", host: "host", worktreePath: "/fixture", branch: "codex/fixture", nativeSessionId: "native-fixture", tmuxSessionName: "fixture-tmux", status: "running", statusLabel: "Running", live: true, observedStatus: "running", preparedAt: new Date().toISOString(), startedAt: new Date().toISOString(), observedAt: new Date().toISOString(), reattachCommand: "tmux attach -t fixture", resumeCommand: null, resumeNotice: null, phoneLimitationNotice: "Use the log on a phone."
  };
  let outcome: "drift" | "launched" | "reused" | "unknown" | "server-error" | "missing-receipt" = "drift";
  let release: (() => void) | null = null;
  let barrier: Promise<void> | null = null;
  const hold = () => { barrier = new Promise<void>(resolve => { release = resolve; }); };
  const resume = () => { release?.(); barrier = null; };
  const preview = { requestId: "workspace-continue:stable-fixture", resolutionId: "fixture-resolution", previewFingerprint: "fixture-preview", actionDocRef: "plan/first-website#review-phone", ready: true, prerequisites: [],
    selection: { provider: "codex", model: "configured-model", effort: "configured-effort" }, target: { projectId: "garden", plan: "first-website", action: "review-phone" }, owner: "agent",
    limits: { actions: 1, sessions: 1, automaticNextAction: false, authorizationHours: 24, timeLimit: "Existing Session limits apply.", tokenBudget: "one bounded pass" } };
  await page.route("**/api/**", async route => {
    const request = route.request(), endpoint = new URL(request.url()).pathname;
    if (endpoint === "/api/projects/garden/action-session") {
      if (lookupFailed) return route.fulfill({ status: 503, json: { error: "Recorded Sessions unavailable" } });
      const lookup = new URL(request.url()).searchParams;
      const matches = lookup.get("action") === durable.actionId && lookup.get("plan") === durable.planSlug;
      return route.fulfill({ json: { known: true, observedAt: new Date().toISOString(), projectSlug: "moon-garden", session: restored && matches ? durable : null } });
    }
    if (endpoint === "/api/sessions/fixture-session") return route.fulfill({ json: { known: true, observedAt: new Date().toISOString(), projectSlug: "moon-garden", session: durable } });
    if (endpoint === "/api/sessions/missing-session") return route.fulfill({ json: { known: true, observedAt: new Date().toISOString(), session: null } });
    if (endpoint === "/api/plans") return route.fulfill({ json: portfolio });
    // The record says this is the current Action, so Next move asks Go and opens by itself when Go says it's ready.
    if (endpoint === "/api/plans/moon-garden/first-website") return route.fulfill({ json: { ...details["first-website"], progress: { ...details["first-website"].progress, current: { key: "moon-garden/review-phone", title: "Review the page on a phone", status: "open", waitingOn: [], basis: "project_current_action" } } } });
    if (endpoint === "/api/projects/garden/go-context") { const resolution = continuation(); if (pointerMoved && resolution.context) resolution.context.action.id = "write-copy"; return route.fulfill({ json: { resolution, resolutionId: "fixture-resolution", observedAt: new Date().toISOString(), error: null } }); }
    if (endpoint === "/api/sessions/fixture-session/log") return route.fulfill({ json: { available: true, text: "Implementing the phone review…", size: 31, reset: true, truncated: false } });
    if (endpoint === "/api/projects/garden/go-continue") {
      if (request.method() === "GET") {
        if (barrier) await barrier;
        return route.fulfill({ json: { ...preview, ready: !gated, prerequisites: gated ? ["Approval required"] : [] } });
      }
      ++writes;
      expect(request.postDataJSON()).toMatchObject({ requestId: preview.requestId, previewFingerprint: preview.previewFingerprint, resolutionId: preview.resolutionId, confirmOperatorLaunch: true });
      if (barrier) await barrier;
      if (outcome === "drift") return route.fulfill({ status: 409, json: { error: "Go's resolution changed.", details: { changedFacts: { provider: "changed-provider" }, freshRead: true } } });
      if (outcome === "unknown") return route.abort("failed");
      if (outcome === "server-error") return route.fulfill({ status: 500, json: { error: "Host response lost" } });
      if (outcome === "missing-receipt") return route.fulfill({ json: { message: "No structured receipt" } });
      return route.fulfill({ json: { result: { reused: outcome === "reused", session: { id: "fixture-session", observedStatus: "running", reattachCommand: "", worktree_path: "/fixture" } } } });
    }
    return route.abort();
  });
  try {
    await waitForHttp(`${url}/workspace`, server);
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${url}/workspace/projects/moon-garden/plans/first-website/actions/review-phone`);
    const control = direction(page).getByRole("button", { name: "Continue", exact: true });
    const panel = page.getByRole("region", { name: "Continue preview" });
    const confirm = panel.getByRole("button", { name: "Confirm Continue for this Action" });
    const heading = (name: string) => direction(page).getByRole("heading", { name, exact: true });
    hold();
    await control.focus(); await page.keyboard.press("Enter");
    await expect(direction(page).getByRole("button", { name: "Reading preview…" })).toBeDisabled();
    await expect(heading("Reading the protected preview…")).toBeFocused();
    await expect(heading("Reading the protected preview…")).toBeInViewport();
    resume();
    await expect(heading("Continue this one Action")).toBeFocused();
    await expect(heading("Continue this one Action")).toBeInViewport();
    await expect(panel).toContainText("first-website · review-phone");
    await expect(panel).toContainText("codex · configured-model · configured-effort");
    await expect(panel).toContainText("One Action and at most one Session");
    await expect(panel).toContainText("It never merges, integrates or turns production on");
    await page.screenshot({ path: testInfo.outputPath("continue-preview.png"), fullPage: true });
    expect(writes).toBe(0);
    hold(); await confirm.click();
    await expect(heading("Requesting this Action…")).toBeFocused();
    await expect(heading("Requesting this Action…")).toBeInViewport();
    await expect(confirm).toHaveCount(0);
    await expect.poll(() => writes).toBe(1);
    resume();
    await expect(heading("Continue needs attention")).toBeFocused();
    await expect(direction(page)).toContainText("changed-provider");
    await direction(page).getByRole("button", { name: "Read Go again" }).click();
    gated = true;
    await control.click();
    await expect(panel).toContainText("Approval required");
    await expect(confirm).toBeDisabled();
    await panel.getByRole("button", { name: "Cancel" }).click();
    gated = false;
    expect(writes).toBe(1);
    for (const state of ["launched", "reused"] as const) {
      outcome = state;
      await control.click(); await confirm.click();
      await expect(heading(state === "launched" ? "Session launched" : "Reused existing Session")).toBeFocused();
      await expect(heading(state === "launched" ? "Session launched" : "Reused existing Session")).toBeInViewport();
      const receipt = page.getByRole("region", { name: "Session receipt" });
      await expect(receipt).toContainText("fixture-session");
      await expect(receipt.getByRole("link", { name: "View Session" })).toHaveAttribute("href", "/sessions/fixture-session");
      await expect(receipt.getByLabel("Log for Session fixture-session")).toContainText("Implementing the phone review…");
      if (state === "launched") await page.screenshot({ path: testInfo.outputPath("continue-session.png"), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await direction(page).getByRole("button", { name: "Read Go again" }).click();
    }
    for (const state of ["unknown", "server-error", "missing-receipt"] as const) {
      outcome = state;
      await control.click(); await confirm.click();
      await expect(heading("Launch outcome unknown")).toBeFocused();
      await expect(heading("Launch outcome unknown")).toBeInViewport();
      await expect(direction(page)).toContainText(preview.requestId);
      await expect(direction(page).getByRole("link", { name: "Check Sessions and runs", exact: true })).toHaveAttribute("href", "/production");
      await expect(control).toHaveCount(0);
      await expect(confirm).toHaveCount(0);
      await expect(direction(page).getByRole("button", { name: "Read Go again" })).toHaveCount(0);
      if (state === "unknown") {
        const checked = page.waitForResponse(response => response.url().includes("/action-session?"));
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await checked;
        await expect(heading("Launch outcome unknown")).toBeVisible();
        await expect(direction(page)).toContainText(preview.requestId);
        // A failed focus read must not erase the unknown request or enable another launch.
        lookupFailed = true;
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(direction(page).getByRole("alert")).toContainText("Recorded Sessions unavailable");
        await expect(heading("Launch outcome unknown")).toBeVisible();
        await expect(direction(page)).toContainText(preview.requestId);
        lookupFailed = false;
        await direction(page).getByRole("button", { name: "Check Sessions again" }).click();
        await expect(direction(page).getByRole("alert")).toHaveCount(0);
        await expect(heading("Launch outcome unknown")).toBeVisible();
      }
      await page.reload();
    }
    expect(writes).toBe(6);
    await expect(control).toBeVisible();
    restored = true;
    // A Session can appear while this workspace is open in another browser.
    // Returning through same-Project navigation must re-read, even if Go is cached.
    await crumb(page, "A small garden on the web").click();
    await subject(page).getByRole("link", { name: /Write the welcome copy/ }).click();
    await expect(page).toHaveURL(`${url}/workspace/projects/moon-garden/plans/first-website/actions/write-copy`);
    await page.goBack();
    await page.goBack();
    const card = page.getByRole("region", { name: "This Action's Session", exact: true });
    await expect(card.getByRole("link", { name: "View Session", exact: true })).toHaveAttribute("href", "/sessions/fixture-session");
    await expect(control).toHaveCount(0);
    // Returning focus also refreshes a previously empty observation.
    restored = false;
    await direction(page).getByRole("button", { name: "Read again", exact: true }).click();
    await expect(control).toBeVisible();
    restored = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(card.getByRole("link", { name: "View Session", exact: true })).toBeVisible();
    await expect(control).toHaveCount(0);
    await card.getByRole("link", { name: "View Session", exact: true }).click();
    await expect(page).toHaveURL(`${url}/sessions/fixture-session`);
    await expect(page.getByRole("heading", { name: "Session fixture-session", exact: true })).toBeFocused();
    const selected = page.getByRole("region", { name: "Selected Session" });
    await expect(selected).toContainText("fixture-session");
    await expect(selected.getByLabel("Log for Session fixture-session")).toContainText("Implementing the phone review…");
    await page.screenshot({ path: testInfo.outputPath("selected-session.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.reload();
    await expect(selected.getByLabel("Log for Session fixture-session")).toBeVisible();
    await page.getByRole("link", { name: "Back to this Action" }).click();
    await expect(card.getByRole("link", { name: "View Session" })).toBeVisible();
    pointerMoved = true;
    await page.reload();
    // Go's work has moved on, so this Action's Next move waits to be asked for, and its Session is one tap away.
    await openNextMove(page);
    await expect(card.getByRole("link", { name: "View Session" })).toBeVisible();
    await expect(card).toContainText("review-phone");
    await page.screenshot({ path: testInfo.outputPath("restored-session.png"), fullPage: true });
    pointerMoved = false;
    durable.status = "completed"; durable.statusLabel = "Completed"; durable.observedStatus = "completed"; durable.live = false;
    await page.reload();
    await expect(card).toContainText("Latest Session for this Action");
    await expect(control).toBeHidden();
    await card.getByText("Continue options for this Action").click();
    await expect(control).toBeVisible();
    lookupFailed = true;
    await page.reload();
    await expect(direction(page).getByRole("alert")).toContainText("Recorded Sessions unavailable");
    await expect(control).toHaveCount(0);
    lookupFailed = false;
    await direction(page).getByRole("button", { name: "Check Sessions again" }).click();
    await expect(card.getByRole("link", { name: "View Session" })).toBeVisible();
    await page.goto(`${url}/sessions/missing-session`);
    await expect(page.getByText("No recorded Session matches this link.", { exact: false })).toBeVisible();
    expect(writes).toBe(6);
  } finally { resume(); await server.stop(); await rm(temp, { recursive: true, force: true }); }
});

test("workspace renders Go's next move for the selected Project without choosing work itself", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const repo = path.resolve(import.meta.dirname, "../..");
  const temp = await mkdtemp(path.join(os.tmpdir(), "arcadia-workspace-go-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = startProcess(process.execPath, [path.join(repo, "apps/dashboard/node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: path.join(repo, "apps/dashboard"), env: { ...process.env, HOME: temp, ARCADIA_WORKSPACE: path.join(temp, "unconfigured") }, logPath: path.join(temp, "next.log") });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && /same key/i.test(message.text())) errors.push(message.text()); });
  let goMode: "ready" | "gated" | "not-agent" | "none" | "failed" | "malformed" | "html" | "elsewhere" | "missing" = "ready";
  let goReads = 0;
  const mutations: string[] = [];
  await page.route("**/api/**", async route => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname;
    if (request.method() !== "GET") mutations.push(`${request.method()} ${endpoint}`);
    if (endpoint === "/api/projects/garden/action-session") return route.fulfill({ json: { known: true, observedAt: new Date().toISOString(), session: null } });
    if (endpoint === "/api/plans") return route.fulfill({ json: portfolio });
    const plan = endpoint.match(/^\/api\/plans\/moon-garden\/([^/]+)$/)?.[1];
    if (plan && details[plan]) return route.fulfill({ json: details[plan] });
    if (endpoint === "/api/projects/garden/go-context") {
      ++goReads;
      if (goMode === "failed") return route.fulfill({ status: 503, json: { error: "Fixture Go read refused" } });
      if (goMode === "html") return route.fulfill({ status: 502, contentType: "text/html", body: "<html>Bad gateway</html>" });
      if (goMode === "malformed") return route.fulfill({ json: { project: {} } });
      const body = goMode === "gated"
        ? continuation({ dispatchable: false, operatorQuestion: "Approve the garden palette first?", blockers: [
          { relativePath: "docs/plans/first-website.md", field: "depends_on", message: "Finish \"Pick the plants\" first", remedy: "Complete the plant list" },
          { relativePath: "docs/decisions/0002-pond.md", field: "status", message: "Decision 0002 is open", remedy: "Answer Decision 0002 on the Review page" }
        ] })
        : goMode === "not-agent" ? continuation({ dispatchable: false }, "requires_review", "The operator must act, approve, or decide. A coding agent must not implement this.")
          : goMode === "none" ? continuation({ context: null, dispatchable: false })
            : goMode === "elsewhere" || goMode === "missing" ? (() => { const c = continuation(); return { ...c, context: { ...c.context!, activePlan: goMode === "elsewhere" ? "old-greenhouse" : "new-plan" } }; })()
              : continuation();
      return route.fulfill({ json: { project: { id: "garden" }, resolution: body, resolutionId: "fixture-resolution", observedAt: "2030-01-01T09:30:00.000Z", error: null } });
    }
    return route.abort();
  });
  const readAgain = async (expected: number) => {
    await direction(page).getByRole("button", { name: "Read again" }).click();
    await expect.poll(() => goReads).toBe(expected);
  };
  try {
    await waitForHttp(`${url}/workspace`, server);
    await page.clock.install({ time: new Date("2030-01-01T09:30:00.000Z") });
    await page.setViewportSize({ width: 1440, height: 1000 });

    // Portfolio: Go is never asked without a verified Project, so there's no next move to show.
    await page.goto(`${url}/workspace`);
    await expect(page.getByRole("heading", { name: "Your work, in view" })).toBeVisible();
    await expect(direction(page).locator(".route-next")).toHaveCount(0);
    expect(goReads).toBe(0);

    // Project: the record's active Plan leads, and Go isn't read until it's asked for.
    await page.getByRole("link", { name: /Moon garden: Project/ }).click();
    await expect(subject(page).getByRole("heading", { name: "Recorded active Plan" })).toBeVisible();
    await expect(direction(page).locator(".route-next summary")).toContainText("Ask Go");
    expect(goReads).toBe(0);

    // Asking: Go's own resolution, its milestone and Plan, and the existing control that starts work.
    await openNextMove(page);
    await expect(result(page).getByText("Ready to continue")).toBeVisible();
    await expect(result(page).getByText("Review the page on a phone")).toBeVisible();
    await expect(result(page).getByText("Open the page at phone width and note what breaks")).toBeVisible();
    await expect(result(page).getByText(/^From Go · read at/)).toBeVisible();
    await expect(direction(page).locator(".route-next summary")).toContainText("Ready to continue");
    await expect(direction(page).getByRole("link", { name: "this Project's page" })).toHaveAttribute("href", "/projects/garden");
    await page.getByText("Read the full record").click();
    const record = page.locator(".route-record-body");
    await expect(record).toContainText("Go is working toward");
    await expect(record.getByText(/^From Go · read at/)).toBeVisible();
    await expect(record).toContainText("first-website");
    // Go's Plan leads; other active Plans, drafts and finished Plans wait behind disclosures.
    await expect(subject(page).getByRole("heading", { name: "Go's current Plan" })).toBeVisible();
    const firstPlan = subject(page).locator(".route-rows .route-row").first();
    await expect(firstPlan).toContainText("A small garden on the web");
    await expect(firstPlan).toContainText("0 of 2 done");
    await expect(subject(page).getByRole("link", { name: /A greenhouse we stopped building/ })).toBeHidden();
    await subject(page).getByText("Also marked active (1)").click();
    await expect(subject(page).getByRole("link", { name: /A greenhouse we stopped building/ })).toBeVisible();
    await expect(subject(page).getByRole("link", { name: /Ideas for later/ })).toBeHidden();
    await expect(subject(page).getByRole("link", { name: /A fence around the beds/ })).toBeHidden();
    await subject(page).getByText("Not yet active (2)").click();
    await expect(subject(page).getByRole("link", { name: /Ideas for later/ })).toBeVisible();
    await expect(subject(page).getByRole("link", { name: /Lights for evening visits/ })).toBeVisible();
    await subject(page).getByText("Finished (1)").click();
    await expect(subject(page).getByRole("link", { name: /A fence around the beds/ })).toContainText("3 of 3 done");
    await page.screenshot({ path: testInfo.outputPath("go-project-desktop.png") });

    // Go's Plan: the route marks Go's current Action; navigation alone never re-asks Go.
    await firstPlan.click();
    await expect(subject(page).locator(".route-stops").getByRole("link", { name: /Go's current Action: Review the page on a phone/ })).toBeVisible();
    await expect(subject(page).locator(".route-stops").getByRole("link", { name: /Write the welcome copy/ })).toBeVisible();
    await openNextMove(page);
    await expect(direction(page).getByRole("link", { name: "Show Go's current Action" })).toBeVisible();

    // Another Action in Go's Plan: the selection is named as not Go's current work.
    await subject(page).getByRole("link", { name: /Write the welcome copy/ }).click();
    await expect(page.getByRole("heading", { name: "Write the welcome copy", exact: true })).toBeVisible();
    await openNextMove(page);
    await expect(result(page).getByText("Go's current Action in this Plan is")).toBeVisible();
    await page.getByText("Read the full record").click();
    await expect(page.getByRole("heading", { name: "What Go has for this Action" })).toHaveCount(0);

    // Draft keeps its target through navigation, as before.
    await page.getByRole("textbox").fill("Make the welcome friendlier");
    await page.getByRole("button", { name: "Put down", exact: true }).click();
    await direction(page).getByRole("link", { name: "Review the page on a phone" }).click();
    await expect(page.getByRole("heading", { name: "Review the page on a phone", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveValue("Make the welcome friendlier");
    await page.getByRole("textbox").focus();
    await expect(page.getByText("Your unsent draft keeps its original target.")).toBeVisible();
    await page.getByRole("button", { name: "Put down", exact: true }).click();

    // Go's current Action: the record shows what Go has for it, with acceptance behind disclosure.
    await openNextMove(page);
    await expect(result(page).getByText("This is Go's current Action.")).toBeVisible();
    await page.getByText("Read the full record").click();
    await expect(page.getByRole("heading", { name: "What Go has for this Action" })).toBeVisible();
    await expect(page.locator(".route-record-body")).toContainText("Phone review notes");
    await expect(page.locator(".route-record-body")).toContainText("Which palette? · answered");
    await expect(page.getByText("The page has no sideways scroll at 390 px")).toBeHidden();
    await page.getByText("Acceptance criteria (2)").click();
    await expect(page.getByText("The page has no sideways scroll at 390 px")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("go-action-desktop.png"), fullPage: true });
    expect(goReads).toBe(1);

    // No timer reads Go, and neither does moving around. After five minutes, the next time it's asked for reads it once.
    await page.clock.fastForward("06:00");
    expect(goReads).toBe(1);
    await crumb(page, "A small garden on the web").click();
    await expect(subject(page).locator(".route-stops")).toBeVisible();
    expect(goReads).toBe(1);
    await openNextMove(page);
    await expect.poll(() => goReads).toBe(2);
    await subject(page).locator(".route-stops").getByRole("link", { name: /Go's current Action: Review the page on a phone/ }).click();
    await expect(page.getByRole("heading", { name: "Review the page on a phone", exact: true })).toBeVisible();
    await openNextMove(page);
    expect(goReads).toBe(2);

    // A different Plan: Go's work is elsewhere, and selecting it changes nothing.
    await page.goto(`${url}/workspace/projects/moon-garden/plans/later-ideas`);
    await openNextMove(page);
    await expect(result(page).getByText(/Go's current work is in Plan/)).toBeVisible();
    await expect(direction(page).getByRole("link", { name: "first-website" })).toHaveAttribute("href", "/workspace/projects/moon-garden/plans/first-website/actions/review-phone");
    expect(goReads).toBe(3);

    // Waiting: Go's question, then every blocker with its own remedy.
    goMode = "gated";
    await readAgain(4);
    await expect(result(page).getByText("Waiting", { exact: true })).toBeVisible();
    await expect(result(page).getByText("Ready to continue")).toHaveCount(0);
    await expect(result(page).getByText("Approve the garden palette first?")).toBeVisible();
    const blockers = result(page).locator(".workspace-go-blockers li");
    await expect(blockers).toHaveText(["Finish \"Pick the plants\" first Complete the plant list", "Decision 0002 is open Answer Decision 0002 on the Review page"]);

    // Unblocked but not an agent's: Go's authorization says whose it is.
    goMode = "not-agent";
    await readAgain(5);
    await expect(result(page).getByText("Not an agent's to take")).toBeVisible();
    await expect(result(page).getByText("The operator must act, approve, or decide. A coding agent must not implement this.")).toBeVisible();

    // A failed read keeps the last good one, labelled everywhere it shows; malformed and non-JSON replies likewise.
    await direction(page).getByRole("link", { name: "first-website" }).click();
    await expect(page.getByRole("heading", { name: "Review the page on a phone", exact: true })).toBeVisible();
    await crumb(page, "A small garden on the web").click();
    const goMarker = subject(page).locator(".route-stops").getByRole("link", { name: /Go's current Action/ });
    await expect(goMarker).toHaveCount(1);
    await openNextMove(page);
    goMode = "failed";
    await readAgain(6);
    // The route's marker is withheld once Go is known to have failed since; the record labels its details.
    await expect(goMarker).toHaveCount(0);
    await subject(page).locator(".route-stops").getByRole("link", { name: /Review the page on a phone/ }).click();
    await expect(page.getByRole("heading", { name: "Review the page on a phone", exact: true })).toBeVisible();
    await openNextMove(page);
    await page.getByText("Read the full record").click();
    await expect(page.locator(".route-record-body").getByText(/last good read; Go could not be read since/)).toBeVisible();
    await expect(direction(page).getByRole("alert")).toContainText("Go could not be read: Fixture Go read refused");
    await expect(direction(page).getByRole("alert")).toContainText("What follows is Go's last good read.");
    await expect(result(page).getByText("Not an agent's to take")).toBeVisible();
    await expect(result(page).getByText(/last good read; Go could not be read since/)).toBeVisible();
    goMode = "malformed";
    await readAgain(7);
    await expect(direction(page).getByRole("alert")).toContainText("Go could not be read: the reply was not a Go resolution. What follows is Go's last good read.");
    await expect(result(page).getByText("Not an agent's to take")).toBeVisible();
    goMode = "html";
    await readAgain(8);
    await expect(direction(page).getByRole("alert")).toContainText("Go could not be read: the Go context route answered 502.");
    // The Plan list still leads with Go's last good Plan, labelled as such.
    await page.getByRole("navigation", { name: "Selected context" }).getByRole("link", { name: "Moon garden" }).click();
    await expect(subject(page).getByRole("heading", { name: "Go's current Plan · last good read" })).toBeVisible();

    // No good read at all (a reload keeps nothing): nothing is shown in its place.
    goMode = "failed";
    await page.goto(`${url}/workspace/projects/moon-garden`);
    await openNextMove(page);
    await expect(direction(page).getByRole("alert")).toContainText("Nothing is shown in its place.");
    await expect(result(page).getByText(/^From Go/)).toHaveCount(0);
    await page.getByText("Read the full record").click();
    await expect(page.locator(".route-record-body")).not.toContainText("Go is working toward");
    await expect(subject(page).getByRole("heading", { name: "Recorded active Plan" })).toBeVisible();
    await expect(page.getByText("Their status says active, but Go is not working on them.")).toHaveCount(0);

    // No current Action: said plainly.
    goMode = "none";
    const before = goReads;
    await readAgain(before + 1);
    await expect(result(page).getByText("No current Action", { exact: true })).toBeVisible();
    await expect(result(page).getByText("Go found no current Action for this Project.")).toBeVisible();

    // Go names a Plan other than the recorded one: Context follows Go, not the record.
    const context2 = subject(page);
    goMode = "elsewhere";
    await readAgain(goReads + 1);
    await expect(context2.getByRole("heading", { name: "Go's current Plan", exact: true })).toBeVisible();
    await expect(context2.locator(".route-rows .route-row").first()).toContainText("A greenhouse we stopped building");
    await context2.getByText("Also marked active (1)").click();
    await expect(context2.getByText("Their status says active, but Go is not working on them.")).toBeVisible();
    // Go names a Plan the list lacks: the recorded Plan leads under its own label, with a note.
    goMode = "missing";
    await readAgain(goReads + 1);
    await expect(context2.getByRole("heading", { name: "Recorded active Plan" })).toBeVisible();
    await expect(context2.getByRole("heading", { name: "Go's current Plan", exact: true })).toHaveCount(0);
    await expect(context2.getByText("Go names Plan new-plan, which this list does not include yet. Refresh to read the list again.")).toBeVisible();

    // Phone: the subject, then Direction, on screen and in reading order, with no sideways scroll.
    goMode = "ready";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${url}/workspace/projects/moon-garden/plans/first-website/actions/review-phone`);
    await openNextMove(page);
    await expect(result(page).getByText("This is Go's current Action.")).toBeVisible();
    const top = async (selector: string) => (await page.locator(selector).boundingBox())!.y;
    expect(await top(".route-subject")).toBeLessThan(await top(".workspace-direction"));
    expect(await page.evaluate(() => Boolean(document.querySelector(".route-subject")!.compareDocumentPosition(document.querySelector(".workspace-direction")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("go-action-phone.png"), fullPage: true });

    // Keyboard: Read again is next after Next move, visibly focused, and keeps focus while Go is read.
    await direction(page).locator(".route-next summary").focus();
    await page.keyboard.press("Tab");
    const again = direction(page).getByRole("button", { name: "Read again" });
    await expect(again).toBeFocused();
    expect(await again.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
    await page.keyboard.press("Enter");
    await expect(again).toBeFocused();

    // Desktop places the subject beside Direction without changing reading order.
    await page.setViewportSize({ width: 1440, height: 1000 });
    expect(await page.locator(".route-subject").boundingBox().then(b => b!.x)).toBeLessThan(await page.locator(".workspace-direction").boundingBox().then(b => b!.x));

    // The workspace only read: no request it made could change anything.
    expect(mutations).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await server.stop();
    await testInfo.attach("preview-log", { path: path.join(temp, "next.log"), contentType: "text/plain" });
    await rm(temp, { recursive: true, force: true });
  }
});
