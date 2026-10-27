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
const mergeStep = { id: "merge-1768", order: 0, kind: "merge", title: "Merge #1768", click: "Merge", href: "https://github.com/pmark/arcadia/pull/1768", pinnedHeadSha: null, unblocks: "Unblocks the presence Plan", waitingOn: null, waitingFor: null, waitCode: null, reviewNote: null, advisoryBotFindings: 0, reviewWarning: null };
const nextSteps = { state: "now", nowStep: mergeStep, steps: [mergeStep], hidden: 0, total: 1, ignored: 0, invalidPrs: 0, unavailable: [], waitingAhead: [], waitingSummary: null, otherRepositories: 0, inventoryStale: false, inventoryCheckedAt: null, repo: "pmark/arcadia", heads: {}, outOfDate: false, closedSinceInventory: 0 };
const pr: DashboardOutstandingPullRequest = { projectId: "arcadia", projectName: "Arcadia", repositoryPath: "/repo", repository: "pmark/arcadia", number: 1768, title: "Propose operator presence draft Plan and prototype", url: "https://github.com/pmark/arcadia/pull/1768", state: "OPEN", isDraft: false, mergeStateStatus: "CLEAN", headBranch: "claude/presence", baseBranch: "main", author: "pmark", reviewDecision: null, createdAt: "2030-01-01T10:00:00Z", updatedAt: "2030-01-01T11:00:00Z", checks: [], readiness: "ready", readinessLabel: "Ready for review", summary: "", briefing: null };
const inventory = { checkedAt: "2030-01-01T12:00:00Z", stale: false, refreshing: false, refreshError: null, incomplete: false, retainedProjectIds: [], snapshot: { generatedAt: "2030-01-01T12:00:00Z", projectsScanned: 1, pullRequests: [pr], errors: [], counts: { total: 1, blocked: 0, checksFailing: 0, checksPending: 0, drafts: 0, ready: 1, mergeReady: 0, unknown: 0 } } };

test("workspace feed shows work over a status sky, the Journey one tap away, and presence in the profile menu", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const repo = path.resolve(import.meta.dirname, "../..");
  const temp = await mkdtemp(path.join(os.tmpdir(), "arcadia-workspace-feed-"));
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
  // Alpha-weighted red minus blue across the bottom fifth of the weather canvas.
  const weatherWarmth = () => page.locator(".feed-weather").evaluate(node => {
    const canvas = node as HTMLCanvasElement;
    const data = canvas.getContext("2d")?.getImageData(0, Math.floor(canvas.height * 0.8), canvas.width, Math.floor(canvas.height * 0.2)).data;
    let warmth = 0, weight = 0;
    for (let i = 0; data && i < data.length; i += 64) { warmth += (data[i] - data[i + 2]) * data[i + 3]; weight += data[i + 3]; }
    return weight ? warmth / weight : 0;
  });
  try {
    await waitForHttp(`${url}/workspace/feed`, server);
    await page.goto(`${url}/workspace/feed#dusk`);

    // Feed: your move, then what waits on you, then pull requests; each links to the control that already answers it.
    const feed = page.getByRole("region", { name: "Messages from Arcadia" });
    await expect(feed.getByRole("region", { name: "Your move" }).getByRole("link", { name: /Merge #1768/ })).toHaveAttribute("href", "https://github.com/pmark/arcadia/pull/1768");
    await expect(feed.getByRole("region", { name: "Waiting on you" }).getByRole("link").first()).toHaveAttribute("href", "/todo/decision/field-notes/0017");
    await expect(feed.getByRole("region", { name: "Waiting on you" })).toContainText("Decision · blocking");
    await expect(feed.getByRole("region", { name: "Pull requests" })).toContainText("Ready for review");

    // The sky shows system status, in words as well as weather: a blocking Decision is a storm.
    await expect.poll(() => page.locator(".workspace-sky").evaluate(c => (c as HTMLCanvasElement).getContext("2d")?.getImageData(0, 0, 1, 1).data[3])).toBe(255);
    await expect(page.locator(".feed-weather")).toHaveCount(1);
    const sky = page.locator(".feed-sky");
    await expect(sky.locator("summary")).toContainText("Blocked");
    await expect(sky.locator("summary")).toContainText("Dust storm");
    await sky.locator("summary").click();
    await expect(sky).toContainText("1 blocking item for you");
    await sky.locator("summary").click();
    // The weather canvas paints that reading: a storm's rust haze runs red over blue near the ground.
    await expect.poll(weatherWarmth, { timeout: 10_000 }).toBeGreaterThan(40);

    // The Journey button summarises the fleet and what needs you, and on a phone replaces the feed.
    const journeyButton = page.getByRole("button", { name: /^Journey: 4 rovers: 1 blocked, 2 moving, 1 arrived\. 3 items need you\.$/ });
    await expect(journeyButton).toHaveAttribute("aria-expanded", "false");
    await expect(journeyButton.locator(".seg")).toHaveCount(4);
    await journeyButton.click();
    const journey = page.getByRole("region", { name: "Journey" });
    await expect(journey.getByRole("heading", { name: "Journey" })).toBeFocused();
    await expect(feed).toBeHidden();
    await expect(journey.getByText("Sample data")).toBeVisible();
    await expect(journey.getByText("Your move: Answer Decision 0017: publish now or after review")).toBeVisible();
    await journey.getByRole("button", { name: /operator-presence/ }).click();
    await expect(page.getByRole("heading", { name: "operator-presence" })).toBeFocused();
    // An urgent mission stays pinned one tap away; the view does not switch on its own.
    const pinned = page.getByRole("note", { name: "Needs you" });
    await expect(pinned).toContainText("field-notes: Answer Decision 0017");
    await page.getByRole("button", { name: /^Back to the feed\./ }).click();
    await expect(feed).toBeVisible();

    // Opening Journey again, even after a reload, returns to the last screen viewed.
    await page.reload();
    await page.getByRole("button", { name: /^Journey: / }).click();
    await expect(page.getByRole("heading", { name: "operator-presence" })).toBeFocused();
    await pinned.getByRole("button").click();
    await expect(page.getByRole("heading", { name: "field-notes" })).toBeFocused();
    await expect(page.getByText("Repair round 1: a date test fails in CI")).toBeVisible();
    await page.getByRole("button", { name: "← All missions" }).click();
    await expect(page.getByRole("heading", { name: "Journey" })).toBeFocused();
    await page.getByRole("button", { name: /^Back to the feed\./ }).click();

    // Presence lives in the profile menu, quiet by default: no face, no animation.
    const profile = page.getByRole("button", { name: /^Your presence:/ });
    await expect(profile).toHaveAttribute("aria-label", "Your presence: Calm overall. Change it.");
    await expect(page.locator(".presence-moonlet")).toHaveCount(0);
    await profile.click();
    const menu = page.getByRole("dialog", { name: "Your presence" });
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(profile).toBeFocused();
    // Tabbing out closes it too, so focus never lands on controls hidden beneath it.
    await profile.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    await expect(profile).toBeFocused();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    await expect(menu).toBeHidden();
    await profile.click();
    await menu.getByRole("button", { name: "Freaking out" }).click();
    await menu.getByRole("button", { name: "Stressed" }).click();
    await expect(profile).toHaveAttribute("aria-label", /^Your presence: Freaking out for 5 more min · Stressed overall\./);
    // The operator's condition never changes the sky.
    await expect(sky.locator("summary")).toContainText("Blocked");

    // The signal is display-only, and the sticker upload is reachable from the keyboard.
    await menu.getByText("Signal", { exact: true }).click();
    await expect(menu.locator("pre")).toContainText('"authority": "none"');
    await menu.getByRole("button", { name: "Your own" }).click();
    await menu.getByRole("textbox", { name: "Any emoji" }).press("Tab");
    await page.keyboard.press("Tab");
    await expect(menu.locator("input[type=file]")).toBeFocused();

    // Expressive brings the moonlet avatar back as an option, and both settings persist.
    await menu.getByRole("button", { name: /^Expressive/ }).click();
    await expect(page.locator(".presence-moonlet")).toHaveAttribute("data-face", "shock");
    await page.reload();
    await expect(page.getByRole("button", { name: /^Your presence: Freaking out/ })).toBeVisible();
    await expect(page.locator(".presence-moonlet")).toHaveCount(1);

    // A browser that refuses to keep a custom state says so, and the panel stays open to show why.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- re-applied below with the real receiver.
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key.includes("custom")) throw new DOMException("Fixture: storage full", "QuotaExceededError");
        return setItem.call(this, key, value);
      };
    });
    await page.getByRole("button", { name: /^Your presence/ }).click();
    await page.getByRole("dialog", { name: "Your presence" }).getByRole("button", { name: "Your own" }).click();
    await page.getByRole("textbox", { name: "Any emoji" }).fill("🛰️");
    await page.getByRole("button", { name: "Use", exact: true }).click();
    await expect(page.getByText(/This browser would not keep it/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Your presence: Custom/ })).toBeVisible();
    await page.keyboard.press("Escape");

    // A to-do list that keeps failing ends the loading state with an alert, not a false "nothing waiting".
    todoDown = true;
    await page.reload();
    await expect(page.getByRole("region", { name: "Messages from Arcadia" }).getByRole("alert")).toContainText("Could not read To-do list");
    await expect(page.getByText("Reading your work…")).toBeHidden();
    await expect(page.getByText("Nothing is waiting on you.")).toBeHidden();
    await expect(sky.locator("summary")).toContainText("Signal loss");
    await expect.poll(weatherWarmth, { timeout: 10_000 }).toBeLessThan(10);
    todoDown = false;

    // Phone width: no horizontal page scroll.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await testInfo.attach("feed-phone", { body: await page.screenshot(), contentType: "image/png" });

    // Wide: the Journey opens beside the feed instead of replacing it.
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.reload();
    await page.getByRole("button", { name: /^Journey: / }).click();
    await expect(page.getByRole("region", { name: "Messages from Arcadia" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Journey" })).toBeVisible();
    await testInfo.attach("feed-wide", { body: await page.screenshot(), contentType: "image/png" });
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await server.stop();
    await testInfo.attach("preview-log", { path: path.join(temp, "next.log"), contentType: "text/plain" });
    await rm(temp, { recursive: true, force: true });
  }
});
