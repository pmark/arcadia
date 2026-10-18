import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";

/**
 * Decision 0128's bounded Scout authority really expires (2026-10-18T00:00Z) and production
 * correctly refuses afterwards. Tests that need an unexpired authority run on this pinned
 * pre-expiry clock instead of the wall clock, so they stay green after the expiry passes.
 */
export const PINNED_SCOUT_NOW = Date.parse("2026-10-16T12:00:00Z");

/** Offset-pinned Date.now for the current process (time still advances). Call the result to restore. */
// One offset per test process, shared with every spawned CLI, so wall time stays consistent across processes.
const OFFSET_MS = PINNED_SCOUT_NOW - Date.now();
export function pinScoutClock(): () => void {
  const real = Date.now.bind(Date);
  const offset = OFFSET_MS;
  const spy = vi.spyOn(Date, "now").mockImplementation(() => real() + offset);
  return () => spy.mockRestore();
}

const preload = path.join(path.dirname(fileURLToPath(import.meta.url)), "pinned-clock-preload.mjs");
/** Environment that pins the clock of a spawned Node CLI to the same pre-expiry instant. */
export function pinnedScoutClockEnv(): Record<string, string> {
  const existing = process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : "";
  return { ARCADIA_TEST_CLOCK_OFFSET_MS: String(OFFSET_MS), NODE_OPTIONS: `${existing}--import=${preload}` };
}
