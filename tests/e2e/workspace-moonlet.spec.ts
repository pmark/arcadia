import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DashboardOutstandingPullRequest } from "../../apps/dashboard/lib/types";
import { freePort, startProcess, waitForHttp } from "./fixtures/processes";

const approvals = {
  source: "todo", note: null,
  approvals: [
    { kind: "decision", id: "0017", project: "field-notes", title: "Publish the field notes now or after review", detail: null, gateQuestion: "Publish now or after review?", options: [], evidence: [], sourceEvidence: [], cost: "", createdAt: "2030-01-01T09:00:00Z", readOnly: false, blocking: true, staleReason: null, answer: null, answerVia: [], origin: null, todoKey: "decision:field-notes/0017", href: "/todo/decision/field-notes/0017", requestId: null, aliases: [], acceptable: null, acceptWhy: null, buildPacket: false },
    { kind: "agent_ask", id: "ask-1", project: "arcadia", title: "Add the planting guide", detail: "Proposed by Rowan", gateQuestion: null, options: [], evidence: [], sourceEvidence: [], cost: "", createdAt: "2030-01-01T08:00:00Z", readOnly: false, blocking: false, staleReason: null, answer: null, answerVia: [], origin: null, todoKey: "agent_ask:arcadia/ask-1", href: "/todo/agent_ask/arcadia/ask-1", requestId: "ask-1", aliases: [], acceptable: null, acceptWhy: null, buildPacket: false }
  ]
};
const mergeStep = { id: "merge-1768", order: 0, kind: "merge", title: "Merge #1768", click: "Merge", href: "https://github.com/pmark/arcadia/pull/1768", pinnedHeadSha: null, unblocks: "Unblocks the moonlet Plan", waitingOn: null, waitingFor: null, waitCode: null, reviewNote: null, advisoryBotFindings: 0, reviewWarning: null };
const nextSteps = { state: "now", nowStep: mergeStep, steps: [mergeStep], hidden: 0, total: 1, ignored: 0, invalidPrs: 0, unavailable: [], waitingAhead: [], waitingSummary: null, otherRepositories: 0, inventoryStale: false, inventoryCheckedAt: null, repo: "pmark/arcadia", heads: {}, outOfDate: false, closedSinceInventory: 0 };
const pr: DashboardOutstandingPullRequest = { projectId: "arcadia", projectName: "Arcadia", repositoryPath: "/repo", repository: "pmark/arcadia", number: 1768, title: "Propose operator moonlet draft Plan and prototype", url: "https://github.com/pmark/arcadia/pull/1768", state: "OPEN", isDraft: false, mergeStateStatus: "CLEAN", headBranch: "claude/moonlet", baseBranch: "main", author: "pmark", reviewDecision: null, createdAt: "2030-01-01T10:00:00Z", updatedAt: "2030-01-01T11:00:00Z", checks: [], readiness: "ready", readinessLabel: "Ready for review", summary: "", briefing: null };
const inventory = { checkedAt: "2030-01-01T12:00:00Z", stale: false, refreshing: false, refreshError: null, incomplete: false, retainedProjectIds: [], snapshot: { generatedAt: "2030-01-01T12:00:00Z", projectsScanned: 1, pullRequests: [pr], errors: [], counts: { total: 1, blocked: 0, checksFailing: 0, checksPending: 0, drafts: 0, ready: 1, mergeReady: 0, unknown: 0 } } };

test("moonlet page shows the feed, missions and a one-tap mood over the sol sky", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const repo = path.resolve(import.meta.dirname, "../..");
  const temp = await mkdtemp(path.join(os.tmpdir(), "arcadia-workspace-moonlet-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = startProcess(process.execPath, [path.join(repo, "apps/dashboard/node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: path.join(repo, "apps/dashboard"), env: { ...process.env, HOME: temp, ARCADIA_WORKSPACE: path.join(temp, "unconfigured") }, logPath: path.join(temp, "next.log") });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const writes: string[] = [];
  let todoDown = false;
  await page.route("**/api/**", route => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname;
    if (request.method() !== "GET") { writes.push(endpoint); return route.abort(); }
    if (endpoint === "/api/approvals") return todoDown ? route.fulfill({ status: 503, json: { error: "Fixture to-do read refused" } }) : route.fulfill({ json: approvals });
    if (endpoint === "/api/next-steps") return route.fulfill({ json: todoDown ? { ...nextSteps, state: "moving", nowStep: null, steps: [], total: 0 } : nextSteps });
    if (endpoint === "/api/pull-requests") return route.fulfill({ json: todoDown ? { ...inventory, snapshot: { ...inventory.snapshot, pullRequests: [], counts: { ...inventory.snapshot.counts, total: 0, ready: 0 } } } : inventory });
    return route.abort();
  });
  try {
    await waitForHttp(`${url}/workspace/moonlet`, server);
    await page.goto(`${url}/workspace/moonlet#dusk`);

    // Feed: your move, then what waits on you, then pull requests; each links to the control that already answers it.
    const feed = page.getByRole("region", { name: "Messages from Arcadia" });
    await expect(feed.getByRole("region", { name: "Your move" }).getByRole("link", { name: /Merge #1768/ })).toHaveAttribute("href", "https://github.com/pmark/arcadia/pull/1768");
    await expect(feed.getByRole("region", { name: "Waiting on you" }).getByRole("link").first()).toHaveAttribute("href", "/todo/decision/field-notes/0017");
    await expect(feed.getByRole("region", { name: "Waiting on you" })).toContainText("Decision · blocking");
    await expect(feed.getByRole("region", { name: "Pull requests" })).toContainText("Ready for review");

    // Missions: a fixture, collapsed to one line each, expandable to every leg.
    const missions = page.getByRole("complementary", { name: "Missions" });
    await expect(missions.getByText("Sample data")).toBeVisible();
    await expect(missions.getByText("Your move: Answer Decision 0017: publish now or after review")).toBeVisible();
    await expect(missions.getByText("Repair round 1: a date test fails in CI")).toBeHidden();
    await missions.getByText("field-notes", { exact: true }).click();
    await expect(missions.getByText("Repair round 1: a date test fails in CI")).toBeVisible();

    // The sky and the weather layer both paint.
    await expect.poll(() => page.locator(".workspace-sky").evaluate(c => (c as HTMLCanvasElement).getContext("2d")?.getImageData(0, 0, 1, 1).data[3])).toBe(255);
    await expect(page.locator(".moonlet-weather")).toHaveCount(1);

    // One tap picks a momentary state; Escape closes without change.
    const moonlet = page.getByRole("button", { name: /Your moonlet/ });
    await moonlet.click({ force: true });
    await expect(page.getByRole("dialog", { name: "How do you feel?" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "How do you feel?" })).toBeHidden();
    await expect(moonlet).toBeFocused();
    await moonlet.click({ force: true });
    await page.getByRole("button", { name: "Freaking out" }).click();
    await expect(moonlet).toHaveAttribute("aria-label", /Freaking out, calm atmosphere/);
    await expect(page.locator(".moonlet-telemetry")).toContainText("Freaking out");

    // Atmosphere changes the weather and persists across a reload, with the signal display-only.
    await moonlet.click({ force: true });
    await page.getByRole("tab", { name: "Atmosphere" }).click();
    await page.getByRole("button", { name: /Stressed/ }).click();
    await expect(moonlet).toHaveAttribute("aria-label", /stressed atmosphere/);
    await page.reload();
    await expect(page.getByRole("button", { name: /Your moonlet/ })).toHaveAttribute("aria-label", /Freaking out, stressed atmosphere/);
    await page.locator(".moonlet-telemetry summary").click();
    await expect(page.locator(".moonlet-telemetry pre")).toContainText('"authority": "none"');

    // The sticker upload is reachable from the keyboard.
    await moonlet.click({ force: true });
    await page.getByRole("button", { name: "Your own emoji, sticker or GIF" }).click();
    await page.getByRole("textbox", { name: "Any emoji" }).press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.locator(".moonlet-custom input[type=file]")).toBeFocused();
    await page.keyboard.press("Escape");

    // A to-do list that keeps failing ends the loading state with an alert, not a false "nothing waiting".
    todoDown = true;
    await page.reload();
    await expect(page.getByRole("region", { name: "Messages from Arcadia" }).getByRole("alert")).toContainText("Could not read To-do list");
    await expect(page.getByText("Reading your work…")).toBeHidden();
    await expect(page.getByText("Nothing is waiting on you.")).toBeHidden();
    todoDown = false;

    // Phone width: no horizontal page scroll.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await testInfo.attach("moonlet-phone", { body: await page.screenshot(), contentType: "image/png" });
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await server.stop();
    await testInfo.attach("preview-log", { path: path.join(temp, "next.log"), contentType: "text/plain" });
    await rm(temp, { recursive: true, force: true });
  }
});
