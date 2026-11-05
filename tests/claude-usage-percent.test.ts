import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshClaudeCodeUsageTelemetry } from "../src/codingAgents/availability.js";

// Issue #1620: live readings are percentages. A fresh window at 1.0 is 1%
// used, never 100%; 59 is 59%.
const roots: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function read(fiveHour: number, sevenDay: number): Promise<{ five: unknown; seven: unknown }> {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-usage-percent-"));
  roots.push(root);
  const snapshotPath = path.join(root, "claude-code.json");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("live network call attempted"); }));
  await refreshClaudeCodeUsageTelemetry(new Date(), {
    force: true,
    deps: {
      snapshotPath,
      loadCredentials: async () => ({ accessToken: "token" }),
      requestUsage: async () => ({
        status: 200,
        body: {
          five_hour: { utilization: fiveHour, resets_at: new Date(Date.now() + 5 * 3_600_000).toISOString() },
          seven_day: { utilization: sevenDay, resets_at: new Date(Date.now() + 2 * 86_400_000).toISOString() }
        }
      })
    }
  });
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as { rate_limits: { five_hour: { used_percentage: unknown }; seven_day: { used_percentage: unknown } } };
  return { five: snapshot.rate_limits.five_hour.used_percentage, seven: snapshot.rate_limits.seven_day.used_percentage };
}

describe("Claude usage readings are percentages (#1620)", () => {
  it("reads 1.0 as 1% used, the live shape right after a window reset", async () => {
    expect(await read(1, 59)).toEqual({ five: 1, seven: 59 });
  });

  it("reads fractional percentages as themselves, never multiplied", async () => {
    expect(await read(0.5, 8)).toEqual({ five: 0.5, seven: 8 });
    expect(await read(0, 100)).toEqual({ five: 0, seven: 100 });
  });
});

// Operator ruling A (2026-11-05): a fresh reading with no 5-hour window means the plan has none, so admission must not
// keep reading a stale cached 5-hour figure (a cached 100% would otherwise refuse every Claude launch).
describe("Claude usage refresh with no 5-hour window (ruling A)", () => {
  const cachedAt = "2026-11-01T00:00:00.000Z";
  const cachedLimits = { five_hour: { used_percentage: 100, resets_at: 1_784_999_999 }, seven_day: { used_percentage: 10 } };
  async function refresh(body: Record<string, unknown>): Promise<Record<string, unknown> & { rate_limits: Record<string, unknown> }> {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-usage-weekly-"));
    roots.push(root);
    const snapshotPath = path.join(root, "claude-code.json");
    writeFileSync(snapshotPath, JSON.stringify({ arcadia_captured_at: cachedAt, arcadia_usage_refresh_state: "ok", rate_limits: cachedLimits }));
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("live network call attempted"); }));
    await refreshClaudeCodeUsageTelemetry(new Date(), {
      force: true,
      deps: { snapshotPath, loadCredentials: async () => ({ accessToken: "token" }), requestUsage: async () => ({ status: 200, body }) }
    });
    return JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, unknown> & { rate_limits: Record<string, unknown> };
  }
  const week = { utilization: 40, resets_at: new Date(Date.now() + 2 * 86_400_000).toISOString() };

  it.each<[string, Record<string, unknown>]>([
    ["absent", { seven_day: week }],
    ["null", { five_hour: null, seven_day: week }],
    ["reported with neither utilization nor reset", { five_hour: { utilization: null, resets_at: null }, seven_day: week }]
  ])("drops the cached 5-hour window when five_hour is %s", async (_label, body) => {
    const snapshot = await refresh(body);
    expect(snapshot).toMatchObject({ arcadia_usage_refresh_state: "ok" });
    expect(snapshot.arcadia_captured_at).not.toBe(cachedAt);
    expect(snapshot.rate_limits).not.toHaveProperty("five_hour");
    expect(snapshot.rate_limits.seven_day).toMatchObject({ used_percentage: 40 });
  });

  it("keeps a reported idle 5-hour window at 0%", async () => {
    const snapshot = await refresh({ five_hour: { utilization: 0, resets_at: null }, seven_day: week });
    expect(snapshot).toMatchObject({ arcadia_usage_refresh_state: "ok" });
    expect(snapshot.rate_limits.five_hour).toMatchObject({ used_percentage: 0 });
  });

  // An unreadable reported window, or no weekly window, is a failed refresh: the cached figures and capture time stay,
  // and the state is not ok, so a stale figure never reads as current.
  it.each<[string, Record<string, unknown>]>([
    ["seven_day has a reset but no utilization", { five_hour: { utilization: 5, resets_at: week.resets_at }, seven_day: { utilization: null, resets_at: week.resets_at } }],
    ["seven_day is above 100%", { seven_day: { utilization: 150, resets_at: week.resets_at } }],
    ["seven_day is missing", { five_hour: { utilization: 5, resets_at: week.resets_at } }],
    ["a reported five_hour has a reset but no utilization", { five_hour: { utilization: null, resets_at: week.resets_at }, seven_day: week }],
    ["a reported five_hour is not an object", { five_hour: "full", seven_day: week }]
  ])("records a non-ok refresh and keeps the cached figures when %s", async (_label, body) => {
    const snapshot = await refresh(body);
    expect(snapshot).toMatchObject({ arcadia_usage_refresh_state: "not_reported", arcadia_captured_at: cachedAt, rate_limits: cachedLimits });
  });
});
