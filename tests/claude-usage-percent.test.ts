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
  async function refresh(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-usage-weekly-"));
    roots.push(root);
    const snapshotPath = path.join(root, "claude-code.json");
    writeFileSync(snapshotPath, JSON.stringify({ rate_limits: { five_hour: { used_percentage: 100, resets_at: 1_784_999_999 }, seven_day: { used_percentage: 10 } } }));
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("live network call attempted"); }));
    await refreshClaudeCodeUsageTelemetry(new Date(), {
      force: true,
      deps: { snapshotPath, loadCredentials: async () => ({ accessToken: "token" }), requestUsage: async () => ({ status: 200, body }) }
    });
    return (JSON.parse(readFileSync(snapshotPath, "utf8")) as { rate_limits: Record<string, unknown> }).rate_limits;
  }
  const week = { utilization: 40, resets_at: new Date(Date.now() + 2 * 86_400_000).toISOString() };

  it.each<[string, Record<string, unknown>]>([
    ["absent", { seven_day: week }],
    ["null", { five_hour: null, seven_day: week }],
    ["reported with neither utilization nor reset", { five_hour: { utilization: null, resets_at: null }, seven_day: week }]
  ])("drops the cached 5-hour window when five_hour is %s", async (_label, body) => {
    const limits = await refresh(body);
    expect(limits).not.toHaveProperty("five_hour");
    expect(limits.seven_day).toMatchObject({ used_percentage: 40 });
  });

  it("keeps a reported idle 5-hour window at 0%", async () => {
    const limits = await refresh({ five_hour: { utilization: 0, resets_at: null }, seven_day: week });
    expect(limits.five_hour).toMatchObject({ used_percentage: 0 });
  });
});
