import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AllPlansResponse, PlanDetailResponse, PlanSummariesResponse } from "../../apps/dashboard/lib/plans-types";
import { freePort, startProcess, waitForHttp } from "./fixtures/processes";

const counts = { open: 2, in_progress: 0, done: 0, blocked: 0 };
const goPlan = { slug: "first-website", status: "active", governed: true, milestone: "A small garden on the web", isActivePlan: true, actionCounts: counts, activationNote: null, relativePath: "docs/plans/first-website.md" };
const draftPlan = { ...goPlan, slug: "later-ideas", status: "draft", milestone: "Ideas for later", isActivePlan: false, relativePath: "docs/plans/later-ideas.md" };
const portfolio: AllPlansResponse = { generatedAt: "2030-01-01T00:00:00.000Z", projects: [{ id: "garden", slug: "moon-garden", name: "Moon garden", status: "active", activePlan: goPlan.slug, plans: [goPlan, draftPlan], error: null }] };
const detail: PlanDetailResponse = { project: { id: "garden", slug: "moon-garden", name: "Moon garden" }, plan: goPlan, progress: { schema: "fixture", source: { planSlug: goPlan.slug, planPath: goPlan.relativePath, updated: "2030-01-01" }, counts: { ...counts, deferred: 0, total: 2 }, isActivePlan: true, current: null, currentNote: null, next: [], blocked: [], actions: [
  { key: "moon-garden/review-phone", title: "Review the page on a phone. Recommended role: implementer, standard tier.", status: "open", dependsOn: [] },
  { key: "moon-garden/write-copy", title: "Write the welcome copy", status: "open", dependsOn: [] }
], note: "Fixture records" } };
function summaries(actionState: "fresh" | "stale"): PlanSummariesResponse {
  return { project: "moon-garden", generatedAt: "2030-01-01", plans: {
    "first-website": { state: actionState === "fresh" ? "fresh" : "stale", actions: { "review-phone": actionState, "write-copy": "missing" }, summary: {
      schema: "arcadia-plan-summary-v1", generated: true, plan: "first-website", source: goPlan.relativePath, source_fingerprint: "0000000000000000", written: "2030-01-01", author: "Clara (fixture)",
      title: "A garden anyone can visit online", purpose: "Give the garden a small website so neighbours can find it.", serves: "The Project goal: share the garden.", done_when: "The site is live and readable on a phone.",
      reading_note: "Inference: the copy may wait for photos.",
      actions: [{ id: "review-phone", source_fingerprint: "1111111111111111", title: "Check the site on a phone", why: "Most visitors will arrive on a phone, so it has to read well there.", done_when: "Every page reads without sideways scrolling at 390 px." }]
    } },
    "later-ideas": { state: "missing", summary: null, actions: {} }
  } };
}

test("workspace shows plain-language summaries, labels stale ones and falls back to the record", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const repo = path.resolve(import.meta.dirname, "../..");
  const temp = await mkdtemp(path.join(os.tmpdir(), "arcadia-workspace-summaries-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = startProcess(process.execPath, [path.join(repo, "apps/dashboard/node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: path.join(repo, "apps/dashboard"), env: { ...process.env, HOME: temp, ARCADIA_WORKSPACE: path.join(temp, "unconfigured") }, logPath: path.join(temp, "next.log") });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let mode: "fresh" | "stale" | "failed" = "fresh";
  let summaryReads = 0;
  const mutations: string[] = [];
  await page.route("**/api/**", async route => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname;
    if (request.method() !== "GET") mutations.push(endpoint);
    if (endpoint === "/api/plans") return route.fulfill({ json: portfolio });
    if (endpoint === "/api/plans/moon-garden/first-website") return route.fulfill({ json: detail });
    if (endpoint === "/api/plan-summaries/moon-garden") {
      ++summaryReads;
      return mode === "failed" ? route.fulfill({ status: 500, json: { error: "Fixture summaries unavailable" } }) : route.fulfill({ json: summaries(mode) });
    }
    return route.abort();
  });
  const context = () => page.getByRole("complementary", { name: "Context" });
  const work = () => page.locator(".workspace-work");
  try {
    await waitForHttp(`${url}/workspace`, server);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${url}/workspace`);
    await expect(page.getByRole("heading", { name: "Your work, in view" })).toBeVisible();
    expect(summaryReads).toBe(0);

    // Project: a summarized Plan reads as its plain title and purpose; an unsummarized one keeps its record.
    await page.goto(`${url}/workspace/projects/moon-garden`);
    const current = context().getByRole("link", { name: /A garden anyone can visit online/ });
    await expect(current).toContainText("Give the garden a small website so neighbours can find it.");
    await expect(current).toContainText("first-website");
    await context().getByText(/^Not yet active/).click();
    await expect(context().getByRole("link", { name: /later-ideas/ })).toContainText("Ideas for later");

    // Plan: why it exists, what it serves, done when, the recorded milestone, and the summary's own label.
    await current.click();
    await expect(page.getByRole("heading", { name: "A garden anyone can visit online", level: 1 })).toBeVisible();
    await expect(work()).toContainText("Why this Plan exists");
    await expect(work()).toContainText("The site is live and readable on a phone.");
    await expect(work()).toContainText("Recorded milestone");
    await expect(work()).toContainText("Inference: the copy may wait for photos.");
    await expect(work().getByText("Plain-language summary. The record governs.")).toBeVisible();
    // Context Actions: the summarized one reads as its title and why; the other keeps its recorded title.
    await expect(context().getByRole("link", { name: /Check the site on a phone/ })).toContainText("Most visitors will arrive on a phone");
    await expect(context().getByRole("link", { name: /Write the welcome copy/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("summaries-plan-desktop.png"), fullPage: true });

    // Action: why it exists and done when, with the recorded title kept behind disclosure.
    await context().getByRole("link", { name: /Check the site on a phone/ }).click();
    await expect(page.getByRole("heading", { name: "Check the site on a phone", level: 1 })).toBeVisible();
    await expect(work()).toContainText("Why it exists");
    await expect(work()).toContainText("Every page reads without sideways scrolling at 390 px.");
    await work().getByText("Recorded title").click();
    await expect(work()).toContainText("Review the page on a phone. Recommended role: implementer, standard tier.");

    // An Action without a summary shows its record and no summary block.
    await context().getByRole("link", { name: /Write the welcome copy/ }).click();
    await expect(page.getByRole("heading", { name: "Write the welcome copy", level: 1 })).toBeVisible();
    await expect(work().getByText(/Plain-language summary/)).toHaveCount(0);

    // Stale: the summary is still shown, labelled as written before the record changed.
    mode = "stale";
    await page.goto(`${url}/workspace/projects/moon-garden/plans/first-website/actions/review-phone`);
    await expect(work().getByText("Plain-language summary, written before this record last changed. The record governs.")).toBeVisible();

    // Failed read: every view falls back to the record, without an error page.
    mode = "failed";
    await page.goto(`${url}/workspace/projects/moon-garden/plans/first-website`);
    await expect(page.getByRole("heading", { name: "first-website", level: 1 })).toBeVisible();
    await expect(work()).toContainText("A small garden on the web");
    await expect(work().getByText(/Plain-language summary/)).toHaveCount(0);
    await expect(context().getByRole("link", { name: /Review the page on a phone/ })).toBeVisible();

    // Phone: no sideways scroll with summaries present.
    mode = "fresh";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${url}/workspace/projects/moon-garden/plans/first-website`);
    await expect(work()).toContainText("Why this Plan exists");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("summaries-plan-phone.png"), fullPage: true });

    expect(mutations).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await server.stop();
    await testInfo.attach("preview-log", { path: path.join(temp, "next.log"), contentType: "text/plain" });
    await rm(temp, { recursive: true, force: true });
  }
});
