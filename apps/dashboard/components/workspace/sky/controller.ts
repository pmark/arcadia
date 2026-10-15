// Adapted from Mission Control Backdrop.astro at c0347d93c964e50779ebb44b16e690642d857ebd.
// Source footer identifies MPL-2.0. See docs/design/conversational-ui-shell.md.

	import { FROZEN_PHASES, altitude, mix, nightAt, phaseSince, rgb, skyAt, smooth, type RGB } from './sol-phase';
	import { skyScroll } from './sky-scroll';

/** Drawing logic is preserved; refs, scoped CSS ownership and disposal replace Astro's document lifetime. */
export function mountSky(surface: HTMLElement, sky: HTMLCanvasElement, starField: HTMLCanvasElement) {
	const root = surface;
	const canvas = sky;
	const ctx = canvas?.getContext('2d');
	const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
	const darkQuery = matchMedia('(prefers-color-scheme: dark)');
	const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : darkQuery.matches);

	// The sol counts from the session's first page, so later pages continue it.
	// Without storage each page simply opens at night again.
	let started = Date.now();
	try {
		// A start in the future (the clock moved back) is discarded.
		const saved = Number(sessionStorage.getItem('sol-start'));
		if (saved > 0 && saved <= started) started = saved;
		sessionStorage.setItem('sol-start', String(started));
	} catch {}
	const frozen = () => FROZEN_PHASES[location.hash.slice(1)];
	const phase = () => frozen() ?? phaseSince(Date.now() - started, reduceMotion.matches);

	let W = 0;
	let H = 0;

	// The page's sky colors: the no-canvas fallback, the ground's light, and the
	// colors the next page paints first. They change slowly, so a few times a
	// second is enough, and each update restyles the whole document.
	function publish() {
		const p = phase();
		const [zenith, midSky, horizon] = skyAt(p, isDark());
		const vars = {
			'--night': nightAt(p).toFixed(3),
			'--haze': rgb(horizon),
			'--sky-zenith': rgb(zenith),
			'--sky-mid': rgb(midSky),
			'--sky-horizon': rgb(horizon),
		};
		for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
		try {
			sessionStorage.setItem('sky', JSON.stringify(vars));
		} catch {}
	}

	// The sky and the sun, painted every animation frame so the sun glides
	// rather than stepping.
	function draw() {
		if (!canvas || !ctx) return;
		const p = phase();
		const dark = isDark();
		const [zenith, midSky, horizon] = skyAt(p, dark);

		const g = ctx.createLinearGradient(0, 0, 0, H);
		g.addColorStop(0, rgb(zenith));
		g.addColorStop(0.55, rgb(midSky));
		g.addColorStop(1, rgb(horizon));
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, W, H);

		// The sun: small and pale, rising on the left (east) and setting on the
		// right (west) along one arc, ringed in blue near the horizon.
		const alt = altitude(p);
		if (alt <= -0.18) return;
		const theta = 2 * Math.PI * (p - 0.5);
		const sx = W / 2 + W * 0.46 * Math.sin(theta);
		const sy = H * 0.97 - H * 0.81 * Math.max(alt, -0.1);
		const breath = reduceMotion.matches ? 1 : 1 + 0.06 * Math.sin((Date.now() / 1000) * ((2 * Math.PI) / 90));
		const R = Math.max(W, H) * (0.24 + 0.12 * (1 - Math.max(0, alt))) * breath;
		const glow = mix([70, 150, 255], [255, 226, 190], smooth(0.08, 0.38, alt));
		// Full at sunrise and sunset, halved at midday so the stars stay visible.
		const strength = (dark ? 0.55 : 0.6) * smooth(-0.18, 0.02, alt) * (1 - 0.5 * smooth(0.05, 0.4, alt));
		const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, R);
		rg.addColorStop(0, rgb(glow, strength));
		rg.addColorStop(0.3, rgb(glow, strength * 0.4));
		rg.addColorStop(1, rgb(glow, 0));
		ctx.fillStyle = rg;
		ctx.fillRect(0, 0, W, H);
		if (alt > -0.02) {
			ctx.globalAlpha = 0.92 * smooth(-0.02, 0.04, alt);
			ctx.fillStyle = '#fffaf0';
			ctx.beginPath();
			ctx.arc(sx, sy, Math.max(4, Math.min(W, H) * 0.009), 0, 7);
			ctx.fill();
			ctx.globalAlpha = 1;
		}
	}

	// --- stars ---------------------------------------------------------------
	// The field turns about a pole far below the screen, so every star drifts
	// the same way, east to west, on gentle parallel arcs. Nearer layers turn a
	// little faster and shift farther on scroll: that is the parallax. The
	// canvas sits behind the page, so the translucent panels let the stars
	// show through faintly and the ground covers them.
	const starCanvas = starField;
	const sctx = starCanvas?.getContext('2d');

	// [depth, min size, max size, alpha, cumulative share]
	const LAYERS = [
		[0.12, 0.5, 0.85, 0.6, 0.55],
		[0.3, 0.75, 1.15, 0.75, 0.85],
		[0.6, 1.05, 1.55, 0.9, 1],
	];
	const WARM: RGB = [255, 246, 236];
	const TINTS: RGB[] = [WARM, WARM, WARM, WARM, [200, 220, 255], [255, 222, 184]];

	type Star = { z: number; px: number; alpha: number; u: number; v: number; period: number; tw: number; tint: RGB };
	let stars: Star[] = [];
	function seedStars() {
		let seed = 11;
		const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
		const count = Math.round(Math.min(240, Math.max(80, (W * H) / 6000)));
		stars = Array.from({ length: count }, () => {
			const roll = rand();
			const [z, lo, hi, alpha] = LAYERS.find((l) => roll < l[4])!;
			return {
				z,
				alpha,
				px: lo + rand() * (hi - lo),
				u: rand(),
				v: rand(),
				period: 3 + rand() * 6,
				tw: rand() * Math.PI * 2,
				tint: TINTS[Math.floor(rand() * TINTS.length)],
			};
		});
	}

	const scrolled = () => scrollY + skyScroll.y;
	let lastY = scrolled();
	let lastT = performance.now();
	let vel = 0;
	function drawStars() {
		if (!starCanvas || !sctx) return;
		const still = reduceMotion.matches;
		const y0 = scrolled();
		const dy = y0 - lastY;
		const ms = performance.now();
		// Scroll speed and streak decay run on elapsed time, in 60 fps frames,
		// so every refresh rate and extra redraw fades the same.
		const k = Math.max(1, ms - lastT) / (1000 / 60);
		lastY = y0;
		lastT = ms;
		// Streaks fade over about a second and a half once scrolling stops.
		vel = dy ? vel + (dy / k - vel) * 0.5 : vel * 0.955 ** k;
		if (Math.abs(vel) < 0.02) vel = 0;

		const pad = 40;
		const P = H * 1.2;
		const cx = W / 2;
		const cy = H + P;
		const band = H + 2 * pad;
		const now = Date.now() / 1000;
		const p = phase();
		// Sky time, so the stars keep pace with the sun. Held under reduced
		// motion and when the sky is frozen for verification.
		const f = frozen();
		const skyT = still ? 0 : f === undefined ? now : f * 600;
		// A star at mid-height crosses the screen in about 100 seconds.
		const omega = W / 100 / (P + H / 2);
		const scroll = still ? 0 : y0;
		const night = nightAt(p);
		// Always clearly there, day included; the dark night sky is what makes
		// them most prominent after sunset.
		const seen = 0.92 + 0.08 * night;

		sctx.clearRect(0, 0, W, H);
		for (const s of stars) {
			const radius = P - pad + s.v * band;
			const half = Math.asin(Math.min(1, (W / 2 + pad) / radius));
			const span = 2 * half;
			const a = -half + ((((s.u * span + omega * (1 + 0.3 * s.z) * skyT) % span) + span) % span);
			const x = cx + radius * Math.sin(a);
			let y = cy - radius * Math.cos(a) - scroll * s.z * 0.35;
			y = ((((y + pad) % band) + band) % band) - pad;
			const twinkle = still ? 0.8 : 0.6 + 0.4 * Math.sin(now * ((2 * Math.PI) / s.period) + s.tw);
			const { tint } = s;
			const alpha = s.alpha * seen * twinkle;

			// A faint trace against the scroll, brightest at the star.
			const len = Math.min(90, Math.abs(vel) * s.z * 5);
			if (!still && len > 1.5) {
				const tail = y + Math.sign(vel) * len;
				const streak = sctx.createLinearGradient(x, y, x, tail);
				streak.addColorStop(0, rgb(tint, alpha * 0.6));
				streak.addColorStop(1, rgb(tint, 0));
				sctx.strokeStyle = streak;
				sctx.lineWidth = s.px;
				sctx.beginPath();
				sctx.moveTo(x, y);
				sctx.lineTo(x, tail);
				sctx.stroke();
			}
			sctx.fillStyle = rgb(tint, alpha);
			sctx.beginPath();
			sctx.arc(x, y, s.px, 0, 7);
			sctx.fill();
		}

		// Earth, an unlabelled evening star on the same arcs.
		const earth = night * smooth(0.77, 0.81, p) * smooth(0.97, 0.9, p);
		if (earth > 0.01) {
			const radius = P + H * 0.35;
			const half = Math.asin(Math.min(1, (W / 2 + pad) / radius));
			const a = -half + 2 * half * (0.45 + (p - 0.77) * 2);
			const ex = cx + radius * Math.sin(a);
			const ey = cy - radius * Math.cos(a) - scroll * 0.042;
			sctx.fillStyle = rgb([184, 214, 255], earth);
			sctx.beginPath();
			sctx.arc(ex, ey, 2, 0, 7);
			sctx.fill();
		}
	}

	function resize() {
		W = innerWidth;
		H = innerHeight;
		if (canvas) {
			canvas.width = W;
			canvas.height = H;
		}
		if (starCanvas && sctx) {
			const dpr = Math.min(2, devicePixelRatio || 1);
			starCanvas.width = Math.round(W * dpr);
			starCanvas.height = Math.round(H * dpr);
			sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			sctx.lineCap = 'round';
			seedStars();
		}
		// Drawn directly, not on a frame callback, so the first frame appears
		// even when the page loads in a background tab.
		redraw();
	}

	// Every moving thing (the sun, its glow, the stars) is drawn on animation
	// frames, so motion is as smooth as the display. Under reduced motion there
	// are no animation frames: the timer repaints the sky, the sun steps along
	// its slow arc, and the stars hold still. Everything pauses while the tab
	// is hidden.
	let timer = 0;
	let raf = 0;
	const loop = () => {
		draw();
		drawStars();
		raf = requestAnimationFrame(loop);
	};
	const tick = () => {
		publish();
		if (reduceMotion.matches) {
			draw();
			drawStars();
		}
	};
	const start = () => {
		if (document.hidden) return;
		if (!timer) timer = window.setInterval(tick, 250);
		if (!raf && !reduceMotion.matches) raf = requestAnimationFrame(loop);
	};
	const stop = () => {
		clearInterval(timer);
		cancelAnimationFrame(raf);
		timer = raf = 0;
	};

	let resizeTimer = 0;
	const onResize = () => {
		clearTimeout(resizeTimer);
		resizeTimer = window.setTimeout(resize, 150);
	};
	addEventListener('resize', onResize);
	function redraw() {
		publish();
		draw();
		drawStars();
	}
	addEventListener('hashchange', redraw);
	const onVisibility = () => (document.hidden ? stop() : (redraw(), start()));
	document.addEventListener('visibilitychange', onVisibility);
	darkQuery.addEventListener('change', redraw);
	const onMotion = () => {
		stop();
		redraw();
		start();
	};
	reduceMotion.addEventListener('change', onMotion);
	const observer = new MutationObserver(redraw);
	observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

	resize();
	start();

 return () => {
  stop();
  clearTimeout(resizeTimer);
  removeEventListener('resize', onResize);
  removeEventListener('hashchange', redraw);
  document.removeEventListener('visibilitychange', onVisibility);
  darkQuery.removeEventListener('change', redraw);
  reduceMotion.removeEventListener('change', onMotion);
  observer.disconnect();
 };
}
