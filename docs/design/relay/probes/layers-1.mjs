// Probe layers-1: can the Scene carry status behind the View and Relay, and does text stay legible on every sky?
// Run: node docs/design/relay/probes/layers-1.mjs (needs Playwright's chromium). It renders the throwaway prototype,
// which uses the real sky and weather drawing code, and reads pixels. Nothing touches Arcadia.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../../prototypes/relay-workspace-layers.html"), "utf8");
const shotDir = process.argv[2] ?? null;
const SKIES = ["dawn", "day", "dusk", "night"], SCHEMES = ["dark", "light"], STATUS = ["clear", "active", "attention", "storm", "static"];
const VIEWPORTS = { phone: { width: 390, height: 844 }, laptop: { width: 1440, height: 900 } };
const TEXT = ["#wordmark", "#pill-label", "#pill-weather", "#reasons li", "#read-at", ".crumbs a", ".crumbs [aria-current]", ".card h1", ".card h2", ".card p", ".card dt", ".card dd", ".row strong", ".row span", ".route-name", ".stop-link", ".ask", ".answer strong", ".answer span", ".depth summary", ".activity", ".ghost", ".chip-btn", "#input", "#chip", "#pin-text", ".mine", ".where", ".reply p", ".fact"];
const KEYBOARD_H = 500;

const inPage = ({ TEXT, visibleH }) => {
  const W = innerWidth, H = innerHeight, seenH = visibleH ?? H;
  const off = document.createElement("canvas"); off.width = W; off.height = H;
  const g = off.getContext("2d", { willReadFrequently: true });
  for (const id of ["sky", "stars", "wx"]) g.drawImage(document.getElementById(id), 0, 0, W, H);
  const data = g.getImageData(0, 0, W, H).data;
  const px = (x, y) => { const i = (Math.floor(y) * W + Math.floor(x)) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const parse = c => { const m = c.match(/[\d.]+/g).map(Number); return { rgb: m.slice(0, 3), a: m.length > 3 ? (c.includes("/") || c.startsWith("rgba") ? m[3] : 1) : 1 }; };
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const over = (top, a, under) => top.map((v, i) => v * a + under[i] * (1 - a));
  const ratio = (a, b) => { const [l, d] = [lum(a), lum(b)].sort((x, y) => y - x); return (l + 0.05) / (d + 0.05); };
  const lab = c => { const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; const [r, gg, b] = c.map(lin); const X = f((0.4124 * r + 0.3576 * gg + 0.1805 * b) / 0.95047), Y = f(0.2126 * r + 0.7152 * gg + 0.0722 * b), Z = f((0.0193 * r + 0.1192 * gg + 0.9505 * b) / 1.08883); return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)]; };

  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && r.bottom > 0 && r.top < seenH; };
  const surfacesOf = el => { const out = []; for (let n = el; n && !n.classList?.contains("plane"); n = n.parentElement) { const b = parse(getComputedStyle(n).backgroundColor); if (b.a > 0) out.unshift(b); } return out; };
  const text = [];
  for (const sel of TEXT) for (const el of document.querySelectorAll(sel)) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect(), fg = parse(getComputedStyle(el).color).rgb, chain = surfacesOf(el);
    let worst = Infinity;
    for (let y = Math.max(0, r.top); y < Math.min(H - 1, r.bottom); y += 3) for (let x = Math.max(0, r.left); x < Math.min(W - 1, r.right); x += 3) {
      const bg = chain.reduce((acc, s) => over(s.rgb, s.a, acc), px(x, y));
      worst = Math.min(worst, ratio(fg, bg));
    }
    if (worst !== Infinity) text.push({ sel, worst: +worst.toFixed(2), bare: chain.length === 0 });
  }
  // Open sky: every 8 px, does the point land on nothing but the Scene?
  const opaque = el => { for (let n = el; n && !n.classList?.contains("plane"); n = n.parentElement) if (parse(getComputedStyle(n).backgroundColor).a > 0.3) return true; return false; };
  const sky = [];
  let total = 0;
  for (let y = 4; y < seenH; y += 8) for (let x = 4; x < W; x += 8) {
    total++;
    const hit = document.elementsFromPoint(x, y).find(e => !["HTML", "BODY"].includes(e.tagName) && e.id !== "world" && e.id !== "stack" && !e.classList.contains("plane") && !["sky", "stars", "wx", "scene"].includes(e.id) && !e.closest("#proto-toggle"));
    const free = !hit || !opaque(hit);
    if (free) sky.push([`${x},${y}`, lab(px(x, y))]);
  }
  const chip = document.getElementById("chip").getBoundingClientRect(), form = document.getElementById("composer").getBoundingClientRect();
  return { text, skyFraction: +(sky.length / total).toFixed(3), sky, chipTop: Math.round(chip.top), composerBottom: Math.round(form.bottom) };
};

const browser = await chromium.launch();
const out = { viewports: {} };
for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${html}</body></html>`);
  const res = { states: {}, worstText: {} };
  // "extras" adds the Plan view's headings, the starter suggestions and the pinned-draft line. Its sky isn't reported.
  const heights = vpName === "phone" ? ["rest", "peek", "open", "keyboard", "extras"] : ["rest", "peek", "open", "extras"];
  for (const relay of heights) {
    // "keyboard" simulates the soft keyboard as a 344 px inset; it can't reproduce iOS Safari's own behaviour.
    const visibleH = relay === "keyboard" ? KEYBOARD_H : viewport.height;
    await page.evaluate(([r, kb]) => {
      const p = window.relayProto;
      document.querySelectorAll("#thread .msg").forEach(m => m.remove());
      document.documentElement.style.setProperty("--kb", `${kb}px`);
      p.setHeight("rest");
      // The reasons panel and a menu answer, so their text and controls get sampled too.
      document.getElementById("reasons").hidden = r !== "rest";
      if (r === "extras") {
        const input = document.getElementById("input");
        input.value = "A draft"; input.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector(".crumbs a:nth-of-type(3)")?.click();
        p.setHeight("peek");
      } else if (r !== "rest") { p.send("the qa thing from before"); p.send("What needs me?"); p.setHeight(r === "keyboard" ? "peek" : r); }
    }, [relay, viewport.height - visibleH]);
    const grid = {};
    for (const scheme of SCHEMES) for (const sky of SKIES) {
      const skyByStatus = {};
      let fraction = 0;
      for (const status of STATUS) {
        await page.evaluate(([s, c, st]) => { const p = window.relayProto; p.setScheme(c); p.setSky(s); p.setStatus(st); p.paint(); }, [sky, scheme, status]);
        const r = await page.evaluate(inPage, { TEXT, visibleH });
        res.geometry ??= {}; res.geometry[relay] = { chipTop: r.chipTop, composerBottom: r.composerBottom, visibleH };
        skyByStatus[status] = r.sky; fraction = r.skyFraction;
        for (const t of r.text) { const k = t.sel; if (!res.worstText[k] || t.worst < res.worstText[k].worst) res.worstText[k] = { worst: t.worst, bare: t.bare, at: `${scheme} ${sky} ${status} ${relay}` }; }
        if (shotDir && relay !== "open" && scheme === "dark" && sky === "dusk") await page.screenshot({ path: join(shotDir, `${vpName}-${relay}-${status}.png`) });
      }
      const dist = {};
      for (const a of STATUS) for (const b of STATUS) if (a < b) {
        // Compare only points that are open sky in both readings; the pill's width changes with its words.
        const other = new Map(skyByStatus[b]);
        let sum = 0, n = 0;
        for (const [key, v] of skyByStatus[a]) { const w = other.get(key); if (w) { sum += Math.hypot(...v.map((c, j) => c - w[j])); n++; } }
        dist[`${a}-${b}`] = n ? +(sum / n).toFixed(1) : 0;
      }
      grid[`${scheme} ${sky}`] = { skyFraction: fraction, dist, closest: Object.entries(dist).sort((x, y) => x[1] - y[1])[0] };
    }
    res.states[relay] = grid;
  }
  // Rough draw cost at phone pixel density with 4x CPU slowdown. Not a real phone; a budget check only.
  if (vpName === "phone") {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    res.drawMsPerFrame = {};
    for (const status of STATUS) res.drawMsPerFrame[status] = await page.evaluate(st => { const p = window.relayProto; p.setStatus(st); const t0 = performance.now(); for (let i = 0; i < 60; i++) p.paint(); return +((performance.now() - t0) / 60).toFixed(2); }, status);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
  out.viewports[vpName] = res;
  await ctx.close();
}
await browser.close();
writeFileSync(join(here, "layers-1-results.json"), `${JSON.stringify(out, null, 1)}\n`);
for (const [vp, r] of Object.entries(out.viewports)) {
  console.log(`\n== ${vp}`);
  for (const [k, v] of Object.entries(r.worstText)) console.log(`  ${String(v.worst).padStart(5)}  ${k}${v.bare ? " (bare sky)" : ""}  @ ${v.at}`);
  for (const [relay, grid] of Object.entries(r.states)) {
    const rows = Object.entries(grid);
    const min = rows.reduce((m, [k, g]) => g.closest[1] < m[1] ? [k, g.closest[1], g.closest[0]] : m, ["", Infinity, ""]);
    console.log(`  relay=${relay}: open sky ${rows[0][1].skyFraction * 100}% ; closest pair ${min[2]} dE ${min[1]} at ${min[0]}`);
  }
  if (r.drawMsPerFrame) console.log("  draw ms/frame @4x:", JSON.stringify(r.drawMsPerFrame));
}
