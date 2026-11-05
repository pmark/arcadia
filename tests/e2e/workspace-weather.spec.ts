import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { freePort, startProcess, waitForHttp } from "./fixtures/processes";

const NONE = { blocking: 0, yours: 0, failing: 0, others: 0, prs: 0 };
const production = { displayState: "active_idle", workerRunning: true, heartbeatFresh: true, liveSessions: 0, stalledSessions: 0 };

// How many sampled pixels of the weather changed clearly since the last call, and how strong its colour is. A slow breath changes neither count by much.
const installSampler = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __sample: () => { moved: number; alpha: number }; __previous?: number[] };
  w.__sample = () => {
    const canvas = document.querySelector(".workspace-weather") as HTMLCanvasElement;
    const data = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data ?? [];
    const small: number[] = [];
    let total = 0;
    for (let i = 3; i < data.length; i += 4 * 3) { small.push(data[i]); total += data[i]; }
    const moved = w.__previous ? small.filter((value, i) => Math.abs(value - (w.__previous as number[])[i]) > 24).length : 0;
    w.__previous = small;
    return { moved, alpha: total / small.length / 255 };
  };
});
const sample = (page: Page) => page.evaluate(() => (window as unknown as { __sample: () => { moved: number; alpha: number } }).__sample());
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** The most and least the weather moved across a few half-second steps. */
async function motion(page: Page, steps: number) {
  await sample(page);
  const moved: number[] = [];
  for (let i = 0; i < steps; i++) { await pause(500); moved.push((await sample(page)).moved); }
  return { most: Math.max(...moved), least: Math.min(...moved) };
}

test("a change lands vividly and settles, reopening on the same news stays calm, and reduced motion stays still", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const repo = path.resolve(import.meta.dirname, "../..");
  const temp = await mkdtemp(path.join(os.tmpdir(), "arcadia-workspace-weather-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const server = startProcess(process.execPath, [path.join(repo, "apps/dashboard/node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: path.join(repo, "apps/dashboard"), env: { ...process.env, HOME: temp, ARCADIA_WORKSPACE: temp }, logPath: path.join(temp, "next.log") });
  let counts = NONE;
  const fixture = async (target: Page) => target.route("**/api/**", route => {
    if (new URL(route.request().url()).pathname !== "/api/workspace/status") return route.abort();
    const asOf = Date.now();
    return route.fulfill({ json: { generatedAt: new Date().toISOString(), counts, production, sources: { "To-do list": { asOf, failed: false }, "next steps": { asOf, failed: false }, "pull requests": { asOf, failed: false }, production: { asOf, failed: false } } } });
  });
  const label = (target: Page, text: string) => expect(target.locator(".workspace-status b")).toHaveText(text, { timeout: 20_000 });
  try {
    await waitForHttp(`${url}/workspace`, server);
    await fixture(page);
    await page.goto(`${url}/workspace#dusk`);
    await label(page, "All clear");
    await installSampler(page);

    // The storm lands: dust everywhere, for a few seconds.
    counts = { ...NONE, blocking: 3, yours: 3 };
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await label(page, "Blocked");
    const landing = await motion(page, 4);

    // Then it settles, still plainly a storm's colour but with the dust almost gone.
    await pause(5_000);
    const settled = await motion(page, 4);
    expect(landing.most, `landing ${landing.most}, settled ${settled.least}`).toBeGreaterThan(settled.least * 4);
    expect((await sample(page)).alpha).toBeGreaterThan(0.1);
    expect(await page.evaluate(() => localStorage.getItem("workspace-sky-seen"))).toBe("storm");

    // Reopening on the same news crossfades in and stays calm.
    await page.reload();
    await label(page, "Blocked");
    await installSampler(page);
    await pause(1_500);
    const reopened = await motion(page, 4);
    expect(reopened.most, `reopened ${reopened.most}, landing ${landing.most}`).toBeLessThan(landing.most / 2);

    // Reduced motion: the same colour, with nothing moving at all.
    const still = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
    const stillPage = await still.newPage();
    await fixture(stillPage);
    await stillPage.goto(`${url}/workspace#dusk`);
    await label(stillPage, "Blocked");
    await installSampler(stillPage);
    await pause(1_000);
    expect((await motion(stillPage, 3)).most).toBe(0);
    await still.close();
  } finally {
    await server.stop();
    await rm(temp, { recursive: true, force: true });
  }
});
