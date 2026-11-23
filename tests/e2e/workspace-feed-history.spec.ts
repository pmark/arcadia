import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { freePort, startProcess, waitForHttp } from "./fixtures/processes";

const runStep = (id: string, title: string) => ({ id: `card-script-${id}`, order: 0, kind: "run", title, click: "Run", href: `#card-script-${id}`, pinnedHeadSha: null, unblocks: "Unblocks the next batch", waitingOn: null, waitingFor: null, waitCode: null, reviewNote: null, advisoryBotFindings: 0, reviewWarning: null });
const A = "start-run-standing-plan-e-press-successor-prove-20261117a";
const B = "start-run-standing-plan-e-press-successor-prove-20261117b";
const LIVE = "start-run-live-card";
const steps = [runStep(LIVE, "START the live batch"), runStep(A, "START batch E (voided)"), runStep(B, "START batch E (pressed)")];
const nextSteps = { state: "now", nowStep: steps[0], steps, hidden: 0, total: 3, ignored: 0, invalidPrs: 0, unavailable: [], waitingAhead: [], waitingSummary: null, otherRepositories: 0, inventoryStale: false, inventoryCheckedAt: null, repo: "pmark/arcadia", heads: {}, outOfDate: false, closedSinceInventory: 0 };
const ended = { cards: [
  { id: A, title: "START batch E (voided)", state: "voided", at: "2026-11-17T18:51:38.836Z" },
  { id: B, title: "START batch E (pressed)", state: "pressed", at: "2026-11-17T19:00:12.701Z" }
] };

test("consumed operator cards leave Your move and stay findable under the history filter", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const repo = path.resolve(import.meta.dirname, "../..");
  const temp = await mkdtemp(path.join(os.tmpdir(), "arcadia-workspace-feed-history-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = startProcess(process.execPath, [path.join(repo, "apps/dashboard/node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: path.join(repo, "apps/dashboard"), env: { ...process.env, HOME: temp, ARCADIA_WORKSPACE: path.join(temp, "unconfigured") }, logPath: path.join(temp, "next.log") });
  const writes: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname;
    if (request.method() !== "GET") { writes.push(endpoint); return route.abort(); }
    if (endpoint === "/api/approvals") return route.fulfill({ json: { source: "todo", note: null, approvals: [] } });
    if (endpoint === "/api/next-steps") return route.fulfill({ json: nextSteps });
    if (endpoint === "/api/workspace/card-history") return route.fulfill({ json: ended });
    return route.abort();
  });
  try {
    await waitForHttp(`${url}/workspace/feed`, server);
    await page.goto(`${url}/workspace/feed`);
    const feed = page.getByRole("region", { name: "Messages from Arcadia" });
    const move = feed.getByRole("region", { name: "Your move" });
    await expect(move.getByText("START the live batch")).toBeVisible();
    await expect(move.getByText("START batch E")).toHaveCount(0);
    await expect(feed.getByRole("region", { name: "History" })).toHaveCount(0);

    await feed.getByRole("button", { name: "History (2 ended cards)" }).click();
    const history = feed.getByRole("region", { name: "History" });
    await expect(history.getByText("START batch E (voided)")).toBeVisible();
    await expect(history).toContainText("Voided");
    await expect(history.getByText("START batch E (pressed)")).toBeVisible();
    await expect(history).toContainText("Pressed");
    await expect(history).toContainText(/Nov 1[67], .* (AM|PM) \w+/);
    await expect(move.getByText("START batch E")).toHaveCount(0);

    await feed.getByRole("button", { name: "History (2 ended cards)" }).click();
    await expect(history).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await testInfo.attach("feed-history", { body: await page.screenshot(), contentType: "image/png" });
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await server.stop();
    await rm(temp, { recursive: true, force: true });
  }
});
