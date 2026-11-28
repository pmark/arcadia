import { describe, expect, it } from "vitest";

import { actorLabel, renderSources } from "../src/timeline/render.js";

type Actor = Parameters<typeof actorLabel>[0]["actor"];
type Source = Parameters<typeof renderSources>[0][number];

// The tool is widened to a string so the pin covers "claude", which AgentTool does not list.
function event(tool: string, name: string | null, confidence: Actor["confidence"]) {
  return { actor: { tool: tool as Actor["tool"], name, confidence, tier: null, role: null, account: null } };
}

function source(durationMs: number, error: string | null): Source {
  return { source: "git", describe: "git log", events: 0, durationMs, error };
}

describe("actorLabel", () => {
  it.each([
    ["codex", "gamma", "low", "codex·gamma?"],
    ["claude", null, "high", "claude"],
    ["unknown", null, "low", "unknown"],
    ["opencode", "beta", "high", "opencode·beta"]
  ] as const)("labels tool %s, name %s, confidence %s as %j", (tool, name, confidence, expected) => {
    expect(actorLabel(event(tool, name, confidence))).toBe(expected);
  });
});

describe("renderSources", () => {
  it("totals durations and counts unreadable sources", () => {
    expect(renderSources([source(40, null), source(2, "ENOENT")])).toEqual([
      "2 sources read in 42 ms; 1 unreadable (shown as source_error)."
    ]);
  });

  it("reports an empty source list as zero sources in zero ms", () => {
    expect(renderSources([])).toEqual(["0 sources read in 0 ms."]);
  });
});
