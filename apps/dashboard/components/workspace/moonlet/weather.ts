import { ATMOSPHERES, type AtmosphereId, type MoodState } from "../../../lib/operator-mood";

/**
 * The operator's atmosphere, drawn as weather over the sol sky. The sky
 * controller (../sky/controller.ts) stays untouched: this layer only reads the
 * `--night` property it publishes on the workspace surface, so weather never
 * changes the time of day. Each atmosphere has a weight that eases toward 1
 * when chosen and 0 otherwise, so changes crossfade in about two seconds.
 */
type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as RGB;
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as RGB;
const rgb = (c: RGB, a = 1) => `rgb(${c[0]} ${c[1]} ${c[2]} / ${a})`;
const NUMERIC = ["dust", "wind", "rise", "aurora", "clouds", "vignette"] as const;
const COLORED = ["tint", "haze", "veil"] as const;
type Blend = Record<(typeof NUMERIC)[number], number> & Record<(typeof COLORED)[number], [RGB, number]>;

function seeded(n: number) { let s = n; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

export function mountWeather(canvas: HTMLCanvasElement, surface: HTMLElement, read: () => Pick<MoodState, "atmosphere" | "now">) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const g = ctx;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const weights = Object.fromEntries(ATMOSPHERES.map(a => [a.id, a.id === read().atmosphere ? 1 : 0])) as Record<AtmosphereId, number>;
  let W = 0, H = 0, raf = 0, last = performance.now();
  let dust: Array<{ x: number; y: number; s: number; v: number; o: number }> = [];
  let motes: typeof dust = [];
  let clouds: Array<{ x: number; y: number; r: number; v: number; o: number }> = [];

  function resize() {
    W = innerWidth; H = innerHeight;
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rd = seeded(99); dust = Array.from({ length: 340 }, () => ({ x: rd() * W, y: rd() * H, s: rd() * 1.6 + 0.4, v: rd() * 0.8 + 0.4, o: rd() }));
    const rm = seeded(41); motes = Array.from({ length: 60 }, () => ({ x: rm() * W, y: rm() * H, s: rm() * 1.4 + 0.6, v: rm() * 0.8 + 0.4, o: rm() }));
    const rc = seeded(17); clouds = Array.from({ length: 7 }, () => ({ x: rc() * W, y: H * (0.08 + rc() * 0.55), r: 80 + rc() * 140, v: 0.3 + rc() * 0.6, o: 0.6 + rc() * 0.4 }));
    draw(performance.now());
  }

  function blend(): Blend {
    const out = { tint: [[0, 0, 0], 0], haze: [[0, 0, 0], 0], veil: [[0, 0, 0], 0], dust: 0, wind: 0, rise: 0, aurora: 0, clouds: 0, vignette: 0 } as Blend;
    let sum = 0;
    for (const a of ATMOSPHERES) {
      const w = weights[a.id]; if (w < 0.001) continue; sum += w;
      for (const c of COLORED) { const p = a.weather[c]; if (p) { const col = hex(p[0]), alpha = p[1] * w; out[c] = [out[c][0].map((v, i) => v + col[i] * alpha) as RGB, out[c][1] + alpha]; } }
      for (const n of NUMERIC) out[n] += (a.weather[n] ?? 0) * w;
    }
    for (const c of COLORED) if (out[c][1] > 0) out[c] = [out[c][0].map(v => Math.round(v / out[c][1])) as RGB, sum ? out[c][1] / sum : 0];
    if (sum) for (const n of NUMERIC) out[n] /= sum;
    return out;
  }

  function moon(x: number, y: number, r: number, alpha: number) {
    g.globalAlpha = alpha;
    const grad = g.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
    grad.addColorStop(0, "#e9dcd2"); grad.addColorStop(1, "#6d5c58");
    g.fillStyle = grad; g.beginPath(); g.ellipse(x, y, r * 1.08, r * 0.9, -0.4, 0, 7); g.fill();
    g.globalAlpha = 1;
  }
  function label(text: string, x: number, y: number, lit: string | null, alpha: number, right: boolean) {
    g.font = "12px system-ui, sans-serif"; g.textBaseline = "middle"; g.textAlign = right ? "right" : "left";
    g.fillStyle = `rgb(243 236 230 / ${0.72 * alpha})`; g.fillText(text, x, y);
    if (!lit) return;
    g.textAlign = "left"; g.fillStyle = `rgb(229 143 111 / ${alpha})`;
    g.fillText(` · ${lit}`, right ? x : x + g.measureText(text).width, y);
  }

  function draw(now: number) {
    const dt = Math.min(100, now - last); last = now;
    const still = reduce.matches, k = still ? 1 : 1 - Math.exp(-dt / 600), { atmosphere, now: state } = read();
    for (const a of ATMOSPHERES) weights[a.id] += ((a.id === atmosphere ? 1 : 0) - weights[a.id]) * k;
    const b = blend(), move = still ? 0 : 1;
    const night = Number(getComputedStyle(surface).getPropertyValue("--night")) || 0;
    g.clearRect(0, 0, W, H);
    // Phobos (fear) and Deimos (dread) belong to the sky, so weather veils them too.
    const show = 0.35 + 0.65 * night, pr = Math.max(16, Math.min(W, H) * 0.045);
    moon(W * 0.8, H * 0.18, pr, show); moon(W * 0.9, H * 0.28, 5, show);
    label("Phobos", W * 0.8 - pr - 14, H * 0.18 - pr, state?.moon === "phobos" ? "fear" : null, show, true);
    label("Deimos", W * 0.9 + (W < 520 ? -14 : 12), H * 0.28, state?.moon === "deimos" ? "dread" : null, show, W < 520);
    if (b.aurora > 0.01) for (let i = 0; i < 3; i++) {
      g.beginPath(); const y0 = H * (0.2 + i * 0.07);
      for (let x = 0; x <= W; x += 12) { const y = y0 + Math.sin(x / 180 + (move * now) / (2600 + i * 700) + i) * 26 + Math.sin(x / 61 + (move * now) / 1700) * 8; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
      const a = b.aurora * (0.35 + 0.65 * night);
      g.strokeStyle = i === 1 ? `rgb(180 140 255 / ${0.24 * a})` : `rgb(110 240 190 / ${0.3 * a})`; g.lineWidth = 34 - i * 8; g.filter = "blur(14px)"; g.stroke(); g.filter = "none";
    }
    if (b.clouds > 0.01) for (const c of clouds) {
      if (move) { c.x += c.v * dt * 0.01; if (c.x - c.r * 2 > W) c.x = -c.r * 2; }
      g.save(); g.translate(c.x, c.y); g.scale(2.4, 1);
      const cg = g.createRadialGradient(0, 0, 0, 0, 0, c.r);
      cg.addColorStop(0, `rgb(150 155 170 / ${0.8 * b.clouds * c.o})`); cg.addColorStop(1, "rgb(150 155 170 / 0)");
      g.fillStyle = cg; g.beginPath(); g.arc(0, 0, c.r, 0, 7); g.fill(); g.restore();
    }
    if (b.tint[1] > 0.005) { g.fillStyle = rgb(b.tint[0], b.tint[1]); g.fillRect(0, 0, W, H); }
    if (b.veil[1] > 0.005) { g.fillStyle = rgb(b.veil[0], b.veil[1]); g.fillRect(0, 0, W, H); }
    if (b.haze[1] > 0.005) { const hg = g.createLinearGradient(0, 0, 0, H); hg.addColorStop(0, rgb(b.haze[0], b.haze[1] * 0.35)); hg.addColorStop(1, rgb(b.haze[0], b.haze[1])); g.fillStyle = hg; g.fillRect(0, 0, W, H); }
    if (b.vignette > 0.01) { const vg = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.25, W / 2, H * 0.45, Math.max(W, H) * 0.8); vg.addColorStop(0, "rgb(0 0 0 / 0)"); vg.addColorStop(1, `rgb(2 3 10 / ${b.vignette})`); g.fillStyle = vg; g.fillRect(0, 0, W, H); }
    g.fillStyle = rgb(b.haze[1] > 0.01 ? mix(b.haze[0], [255, 240, 220], 0.45) : [255, 236, 214]);
    for (let i = 0; i < Math.round(b.dust) && i < dust.length; i++) {
      const d = dust[i];
      if (move) { d.x += d.v * (b.wind + 0.08) * dt * 0.06; d.y += Math.sin(now / 1200 + d.o * 9) * 0.15 * (1 + b.wind); if (d.x > W + 4) { d.x = -4; d.y = Math.random() * H; } }
      g.globalAlpha = (0.2 + d.o * 0.45) * Math.min(1, 0.3 + b.wind); g.beginPath(); g.arc(d.x, d.y, d.s * (1 + b.wind * 0.3), 0, 7); g.fill();
    }
    g.fillStyle = "#ffd27a";
    for (let i = 0; i < Math.round(b.rise) && i < motes.length; i++) {
      const m = motes[i];
      if (move) { m.y -= m.v * dt * 0.03; m.x += Math.sin(now / 900 + m.o * 7) * 0.2; if (m.y < -4) { m.y = H + 4; m.x = Math.random() * W; } }
      g.globalAlpha = (0.3 + 0.5 * Math.sin((move * now) / 500 + m.o * 9) ** 2) * Math.min(1, b.rise / 20); g.beginPath(); g.arc(m.x, m.y, m.s, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
  }

  // Animated like the sky: frames while visible, a 250 ms repaint under reduced motion, nothing while hidden.
  const loop = (t: number) => { draw(t); raf = requestAnimationFrame(loop); };
  let timer = 0;
  const start = () => {
    if (document.hidden) return;
    if (reduce.matches) { if (!timer) timer = window.setInterval(() => draw(performance.now()), 250); }
    else if (!raf) raf = requestAnimationFrame(loop);
  };
  const stop = () => { cancelAnimationFrame(raf); clearInterval(timer); raf = timer = 0; };
  const onVisibility = () => (document.hidden ? stop() : (last = performance.now(), start()));
  const onMotion = () => { stop(); start(); };
  addEventListener("resize", resize);
  document.addEventListener("visibilitychange", onVisibility);
  reduce.addEventListener("change", onMotion);
  resize(); start();
  return () => {
    stop();
    removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", onVisibility);
    reduce.removeEventListener("change", onMotion);
  };
}

