import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
