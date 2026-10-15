/*
  The simulated Martian day behind the site (docs/design/mars-mission-control-theme.md).

  One sol lasts ten minutes. Every visit opens at midnight, so the first
  impression is the star field, lingers there, and eases to sunrise at about
  forty seconds (roughly when a reader is halfway down the landing page) and
  to morning by a minute; from there the sol runs at its normal pace. The
  opening runs on time alone, never on scroll position. The clock counts from the
  start of the browsing session, so the sky carries on across navigations
  instead of restarting. Phase 0 is midnight, 0.25 sunrise, 0.5 noon, 0.75
  sunset.

  The sky is ambient, not a clock: nothing here is ever shown as text.
*/

export const SOL_MS = 600_000;

/** Midnight: where every visit opens. */
export const OPENING_PHASE = 0;
/** Morning, reached by the end of the opening. */
export const MORNING_PHASE = 0.34;
export const OPENING_MS = 60_000;

/**
 * The phase `ms` after the session started. The opening eases from late night
 * to morning, lingering on the stars first; then the sol runs at its normal
 * pace. Under reduced motion there is no fast opening, only the normal pace.
 */
export function phaseSince(ms: number, reduced = false): number {
	if (reduced) return (OPENING_PHASE + ms / SOL_MS) % 1;
	if (ms < OPENING_MS) return OPENING_PHASE + (MORNING_PHASE - OPENING_PHASE) * smooth(0, OPENING_MS, ms);
	return (MORNING_PHASE + (ms - OPENING_MS) / SOL_MS) % 1;
}

/** `#dawn`, `#day`, `#dusk` or `#night` freezes the sky for verification. */
export const FROZEN_PHASES: Record<string, number> = {
	dawn: 0.26,
	day: 0.5,
	dusk: 0.755,
	night: 0,
};

export type RGB = [number, number, number];
type Row = [number, string, string, string];

/* Each row: phase, zenith, mid-sky, horizon. The light scheme never reaches
   night-black; the dark scheme never reaches full daylight. Neither day ever
   gets bright enough to wash out the stars: the light scheme's day is a deep
   dusty amber: a mid-depth white star at typical daytime strength keeps at
   least 1.5:1 against open sky. Twinkle troughs and the sun's own glow and
   disc can dip below that for a moment; that is the twinkle, not a floor. */
const SKY: Record<'light' | 'dark', Row[]> = {
	light: [
		[0.0, '#27304f', '#3d4a72', '#6c7496'],
		[0.2, '#2c3a62', '#4a5f8e', '#8e8fa8'],
		[0.25, '#2b5aa8', '#5d9ae0', '#c98a64'],
		[0.32, '#9c5634', '#b26c44', '#c4875c'],
		[0.5, '#a45c36', '#ba7448', '#cc9064'],
		[0.68, '#9c5634', '#b26c44', '#c4875c'],
		[0.74, '#8a4c34', '#a8684a', '#bf8660'],
		[0.775, '#1f3f80', '#3f7fd0', '#6fa6d8'],
		[0.83, '#26305a', '#3a4a78', '#6c7496'],
		[1.0, '#27304f', '#3d4a72', '#6c7496'],
	],
	dark: [
		[0.0, '#07080f', '#0c0f1d', '#171a2b'],
		[0.2, '#080b18', '#101732', '#22223a'],
		[0.25, '#0c1a3c', '#1b3a78', '#7a4a38'],
		[0.32, '#1c1210', '#3a1e14', '#7a3a1c'],
		[0.5, '#24140f', '#4a2412', '#8e4518'],
		[0.68, '#20120e', '#432010', '#843f18'],
		[0.74, '#150f14', '#2e1a1c', '#6e3a24'],
		[0.775, '#081230', '#123a80', '#2f7fd0'],
		[0.83, '#07080f', '#0d1022', '#1a1b30'],
		[1.0, '#07080f', '#0c0f1d', '#171a2b'],
	],
};

const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;

export const mix = (a: RGB, b: RGB, t: number): RGB =>
	a.map((v, i) => Math.round(v + (b[i] - v) * t)) as RGB;

export const rgb = (c: RGB, a = 1): string => `rgb(${c[0]} ${c[1]} ${c[2]} / ${a})`;

export const smooth = (e0: number, e1: number, x: number): number => {
	const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
	return t * t * (3 - 2 * t);
};

/** Zenith, mid-sky and horizon colors for a phase. */
export function skyAt(p: number, dark: boolean): [RGB, RGB, RGB] {
	const table = SKY[dark ? 'dark' : 'light'];
	for (let i = 0; i < table.length - 1; i++) {
		const [p0, ...a] = table[i];
		const [p1, ...b] = table[i + 1];
		if (p >= p0 && p <= p1) {
			const t = smooth(0, 1, (p - p0) / (p1 - p0));
			return a.map((c, j) => mix(hex(c), hex(b[j]), t)) as [RGB, RGB, RGB];
		}
	}
	return table[0].slice(1).map((c) => hex(c as string)) as [RGB, RGB, RGB];
}

/** The sun's altitude: 1 at noon, -1 at midnight, 0 at sunrise and sunset. */
export const altitude = (p: number): number => Math.cos(2 * Math.PI * (p - 0.5));

/** How far into night the ground and stars are: 0 in daylight, 1 after dusk. */
export const nightAt = (p: number): number => smooth(0.1, -0.12, altitude(p));
