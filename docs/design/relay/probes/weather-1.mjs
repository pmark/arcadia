// Probe weather-1: does the weather have rhythm? Reads only, against a local production build with fixture status.
// Usage: PROBE_OUT=/some/dir node docs/design/relay/probes/weather-1.mjs (after building into apps/dashboard/.live/a).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "../../../..");
const require = createRequire(path.join(repo, "package.json"));
const { webkit, devices } = require("@playwright/test");
const device = { ...(devices["iPhone 15 Pro"] ?? devices["iPhone 15"]) };
delete device.defaultBrowserType;
const out = process.env.PROBE_OUT ?? "/tmp/weather-1";
mkdirSync(out, { recursive: true });
const port = Number(process.env.PROBE_PORT ?? 3071);
const base = `http://127.0.0.1:${port}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const server = spawn(process.execPath, [path.join(repo, "apps/dashboard/node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: path.join(repo, "apps/dashboard"), env: { ...process.env, ARCADIA_DASHBOARD_DIST: ".live/a" }, stdio: "ignore" });
for (let i = 0; i < 120; i++) { try { if ((await fetch(`${base}/workspace`)).ok) break; } catch { /* not up yet */ } await sleep(500); }

const NONE = { blocking: 0, yours: 0, failing: 0, others: 0, prs: 0 };
const facts = displayState => ({ displayState, workerRunning: true, heartbeatFresh: true, liveSessions: 0, stalledSessions: 0 });
const STATES = {
  clear: { counts: NONE, production: facts("active_idle") },
  active: { counts: NONE, production: facts("active_building") },
  attention: { counts: { ...NONE, yours: 2 }, production: facts("active_idle") },
  storm: { counts: { ...NONE, blocking: 3, yours: 3 }, production: facts("active_idle") },
  static: { counts: NONE, production: facts("observation_unavailable") }
};
let state = "clear";
const fixture = () => {
  const asOf = Date.now();
  return { generatedAt: new Date().toISOString(), ...STATES[state], sources: Object.fromEntries(["To-do list", "next steps", "pull requests", "production"].map(name => [name, { asOf, failed: false }])) };
};
const instrument = () => {
  const w = window;
  w.__frames = [];
  const tick = t => { w.__frames.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  w.__sample = () => {
    const canvas = document.querySelector(".workspace-weather");
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const small = [];
    let alpha = 0;
    for (let i = 3; i < data.length; i += 4 * 7) { small.push(data[i]); alpha += data[i]; }
    let moved = 0;
    if (w.__prev) for (let i = 0; i < small.length; i++) if (Math.abs(small[i] - w.__prev[i]) > 24) moved++;
    w.__prev = small;
    const frames = w.__frames.splice(0);
    const gaps = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
    return { moved, alpha: +(alpha / small.length / 255).toFixed(3), fps: gaps.length ? +(1000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length)).toFixed(1) : 0, p95: gaps.length ? +gaps[Math.floor(gaps.length * 0.95)].toFixed(0) : 0 };
  };
};
const results = {};
const browser = await webkit.launch({ executablePath: process.env.PROBE_WEBKIT ?? `${process.env.HOME}/Library/Caches/ms-playwright/webkit-2272/pw_run.sh` });
const open = async (options = {}) => {
  const context = await browser.newContext({ ...device, ...options });
  const page = await context.newPage();
  await page.route("**/api/**", route => {
    if (route.request().method() !== "GET") return route.abort();
    return new URL(route.request().url()).pathname === "/api/workspace/status" ? route.fulfill({ json: fixture() }) : route.abort();
  });
  return { context, page };
};
const series = async (page, seconds, every = 1000) => {
  const rows = [];
  const started = Date.now();
  await page.evaluate(() => window.__sample());
  while (Date.now() - started < seconds * 1000) {
    await sleep(every);
    rows.push({ t: +((Date.now() - started) / 1000).toFixed(1), ...(await page.evaluate(() => window.__sample())) });
  }
  return rows;
};
const poll = page => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
const show = name => console.log(name, JSON.stringify(results[name]));

try {
  // A change on an open page: vivid, then settled.
  {
    const { context, page } = await open();
    state = "clear";
    await page.goto(`${base}/workspace#dusk`, { waitUntil: "domcontentloaded" });
    await page.locator(".workspace-status b", { hasText: "All clear" }).waitFor({ timeout: 30_000 });
    await page.evaluate(instrument);
    await sleep(8_000);
    results.beforeChange = await series(page, 3);
    state = "storm";
    await poll(page);
    await page.locator(".workspace-status b", { hasText: "Blocked" }).waitFor({ timeout: 15_000 });
    const rows = series(page, 14, 500);
    await sleep(1_000);
    await page.screenshot({ path: path.join(out, "change-storm-landing.png") });
    results.change = await rows;
    await page.screenshot({ path: path.join(out, "change-storm-settled.png") });
    show("beforeChange"); show("change");
    // Long enough to catch swells.
    results.settledLong = await series(page, 100, 2000);
    show("settledLong");
    // Reopening on the same news stays calm.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".workspace-status b", { hasText: "Blocked" }).waitFor({ timeout: 30_000 });
    await page.evaluate(instrument);
    results.reopenSame = await series(page, 8);
    show("reopenSame");
    await context.close();
  }
  // Each state: landing and settled.
  for (const name of Object.keys(STATES)) {
    const { context, page } = await open();
    state = name;
    await page.addInitScript(() => { try { localStorage.setItem("workspace-sky-seen", "reading"); } catch { /* fine */ } });
    await page.goto(`${base}/workspace#dusk`, { waitUntil: "domcontentloaded" });
    await page.locator(".workspace-status b").filter({ hasNotText: "Reading" }).waitFor({ timeout: 30_000 });
    await page.evaluate(instrument);
    await sleep(1_000);
    await page.screenshot({ path: path.join(out, `${name}-landing.png`) });
    await sleep(8_000);
    await page.screenshot({ path: path.join(out, `${name}-settled.png`) });
    results[`settled:${name}`] = await series(page, 4);
    show(`settled:${name}`);
    await context.close();
  }
  // Reduced motion: no arrival and no motion.
  {
    const { context, page } = await open({ reducedMotion: "reduce" });
    state = "storm";
    await page.goto(`${base}/workspace#dusk`, { waitUntil: "domcontentloaded" });
    await page.locator(".workspace-status b", { hasText: "Blocked" }).waitFor({ timeout: 30_000 });
    await page.evaluate(instrument);
    await sleep(1_500);
    results.reducedMotion = await series(page, 6);
    show("reducedMotion");
    await context.close();
  }
  // The baseline: the constant storm on a build without the rhythm, if one is named. Reads only.
  if (process.env.PROBE_BASELINE) {
    const context = await browser.newContext({ ...device });
    const page = await context.newPage();
    await page.route("**/*", route => (["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort()));
    await page.goto(`${process.env.PROBE_BASELINE}/workspace#dusk`, { waitUntil: "domcontentloaded" });
    await page.locator(".workspace-status b").filter({ hasNotText: "Reading" }).waitFor({ timeout: 30_000 });
    results.baselineLabel = await page.locator(".workspace-status b").textContent();
    await page.evaluate(instrument);
    await sleep(4_000);
    results.baseline = await series(page, 8);
    await page.screenshot({ path: path.join(out, "baseline-storm.png") });
    console.log("baseline", results.baselineLabel, JSON.stringify(results.baseline));
    await context.close();
  }
} finally {
  writeFileSync(path.join(out, "weather-1-results.json"), `${JSON.stringify(results, null, 1)}\n`);
  await browser.close();
  server.kill();
}
