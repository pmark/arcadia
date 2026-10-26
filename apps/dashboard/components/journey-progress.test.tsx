import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JourneyProgressPanel } from "./journey-progress";
import type { JourneyProgress, ProgressWindow } from "../lib/journey-types";

const window: ProgressWindow = { start: "2026-10-18T12:00:00Z", end: "2026-10-25T12:00:00Z", elapsedDays: 7, delivered: 2, cleared: 3, failed: 1, deliveredPerDay: 2/7, clearedPerDay: 3/7, sessionHours: null, occupiedHours: null, sessionsWithoutBounds: 1,
  services: [{service: "claude-code-cli", configuredModel: "configured", configuredEffort: "high", runtimeModel: null, runtimeEffort: null, workType: "managed development Session", sessions: 1, closedSpans: 0, sessionHours: null, delivered: 2, cleared: 3, failed: 1, sessionIds: ["s1"], source: "agent_sessions"}],
  evidence: [{ at: "2026-10-20T12:00:00Z", action: "a", source: "production_worker_merges", id: "head", sessionId: "s1", kind: "delivered", url: "https://github.com/example/repo/pull/1" }] };
const progress: JourneyProgress = { generatedAt: window.end, timezone: "UTC", periods: [1,7,30].map(days => ({ days, current: window, previous: window })), limitations: ["Coverage unknown"] };
describe("Journey progress panel", () => {
  it("offers labelled windows, real denominators, unknown effort and inspectable model/outcome evidence", () => {
    const html = renderToStaticMarkup(<JourneyProgressPanel progress={progress} project="p" />);
    expect(html).toContain('Window <select');
    expect(html).toContain('Last 30 elapsed days');
    expect(html).toContain('denominator 7 × 24 hours');
    expect(html).toContain('Active effort unknown');
    expect(html).toContain('configured model');
    expect(html).toContain('Runtime model/effort');
    expect(html).toContain('Source agent_sessions: s1');
    expect(html).toContain('3 dated alert clears');
    expect(html).toContain('unattributed coverage is unknown');
    expect(html).toContain('href="/journey/p/a"');
    expect(html).toContain('scope="col"');
    expect(html).toContain('Coverage unknown');
  });
});
