import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isCodingAgentAvailable, observeCodingAgentAvailability } from "../../src/codingAgents/availability.js";
import { selectAgentProfile } from "../../src/codex/packets.js";
import type { CodingAgentProfile } from "../../src/intent/registries.js";

const codex: CodingAgentProfile = {
  name: "codex-build",
  provider: "codex-cli",
  package: "codex",
  command: "codex",
  purpose: "build",
  sandbox: "workspace-write",
  args: [],
};

const claude: CodingAgentProfile = {
  ...codex,
  name: "claude-build",
  provider: "claude-code-cli",
  package: "claude-code",
  command: "claude",
};

const tempDirs: string[] = [];

beforeEach(() => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "arcadia-agent-cache-"));
  tempDirs.push(directory);
  process.env.ARCADIA_CODING_AGENT_USAGE_CACHE_PATH = path.join(directory, "usage.json");
});

afterEach(() => {
  delete process.env.ARCADIA_CLAUDE_USAGE_PATH;
  delete process.env.ARCADIA_CODEX_RATE_LIMIT_FIXTURE;
  delete process.env.ARCADIA_CODING_AGENT_USAGE_CACHE_PATH;
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("coding agent availability", () => {
  it("allows an agent when quota telemetry is unknown", () => {
    expect(isCodingAgentAvailable(codex, {
      generatedAt: "2026-07-18T00:00:00.000Z",
      agents: [{
        provider: "Codex",
        profiles: [codex.name],
        availability: "unknown",
        observedTasks: 0,
        usageLimitedTasks: 0,
        budgetLimitedTasks: 0,
        remainingTokens: null,
        resetAt: null,
        context: null,
        rateLimits: [],
        capturedAt: null,
        telemetry: "unknown",
      }],
    })).toBe(true);
  });

  it("blocks an agent when the provider reports a hard usage limit", () => {
    expect(isCodingAgentAvailable(codex, {
      generatedAt: "2026-07-18T00:00:00.000Z",
      agents: [{
        provider: "Codex",
        profiles: [codex.name],
        availability: "budget_limited",
        observedTasks: 1,
        usageLimitedTasks: 0,
        budgetLimitedTasks: 1,
        remainingTokens: null,
        resetAt: null,
        context: null,
        rateLimits: [],
        capturedAt: null,
        telemetry: "local status",
      }],
    })).toBe(false);
  });

  it("reads Claude context and account limits captured by the status line", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "arcadia-claude-usage-"));
    tempDirs.push(directory);
    const snapshotPath = path.join(directory, "claude-code.json");
    process.env.ARCADIA_CLAUDE_USAGE_PATH = snapshotPath;
    writeFileSync(snapshotPath, JSON.stringify({
      arcadia_captured_at: "2026-07-18T19:00:00.000Z",
      context_window: {
        total_input_tokens: 15_500,
        total_output_tokens: 1_200,
        context_window_size: 200_000,
        used_percentage: 8,
        remaining_percentage: 92,
      },
      rate_limits: {
        five_hour: { used_percentage: 23.5, resets_at: 1_784_999_999 },
        seven_day: { used_percentage: 41.2, resets_at: 1_785_999_999 },
      },
    }));

    const snapshot = observeCodingAgentAvailability([claude], new Date("2026-07-18T19:01:00.000Z"));

    expect(snapshot.agents[0]).toMatchObject({
      provider: "Claude Code",
      availability: "available",
      context: { inputTokens: 15_500, outputTokens: 1_200, usedPercentage: 8 },
      rateLimits: [
        { label: "5h", usedPercentage: 23.5 },
        { label: "7d", usedPercentage: 41.2 },
      ],
    });
  });

  it("reads Codex account limits from the app-server response", () => {
    process.env.ARCADIA_CODEX_RATE_LIMIT_FIXTURE = JSON.stringify({
      id: 2,
      result: {
        rateLimits: {
          primary: { usedPercent: 36, windowDurationMins: 10_080, resetsAt: 1_784_992_155 },
          secondary: null,
          rateLimitReachedType: null,
        },
      },
    });

    const snapshot = observeCodingAgentAvailability([codex], new Date("2026-07-18T19:01:00.000Z"));

    expect(snapshot.agents[0]).toMatchObject({
      provider: "Codex",
      availability: "available",
      rateLimits: [{ label: "7d", usedPercentage: 36 }],
      telemetry: "Codex account rate limits reported by the local app server.",
    });
  });

  it("falls back to another eligible provider when the default is exhausted", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "arcadia-claude-usage-"));
    tempDirs.push(directory);
    const snapshotPath = path.join(directory, "claude-code.json");
    process.env.ARCADIA_CLAUDE_USAGE_PATH = snapshotPath;
    writeFileSync(snapshotPath, JSON.stringify({
      context_window: { used_percentage: 10, remaining_percentage: 90 },
      rate_limits: { five_hour: { used_percentage: 20, resets_at: 1_784_999_999 } },
    }));
    process.env.ARCADIA_CODEX_RATE_LIMIT_FIXTURE = JSON.stringify({
      id: 2,
      result: {
        rateLimits: {
          primary: { usedPercent: 100, windowDurationMins: 10_080, resetsAt: 1_784_992_155 },
          rateLimitReachedType: "rate_limit_reached",
        },
      },
    });

    expect(selectAgentProfile(
      [codex, claude],
      "build",
      undefined,
      { build: codex.name },
    ).name).toBe(claude.name);
  });

  it("keeps the last provider snapshot when a live read is unavailable", () => {
    process.env.ARCADIA_CODEX_RATE_LIMIT_FIXTURE = JSON.stringify({
      id: 2,
      result: { rateLimits: { primary: { usedPercent: 36, windowDurationMins: 10_080, resetsAt: 1_784_992_155 } } },
    });
    observeCodingAgentAvailability([codex], new Date("2026-07-18T19:01:00.000Z"));
    delete process.env.ARCADIA_CODEX_RATE_LIMIT_FIXTURE;

    const snapshot = observeCodingAgentAvailability([codex], new Date("2026-07-18T19:02:00.000Z"));

    expect(snapshot.agents[0]).toMatchObject({
      availability: "available",
      rateLimits: [{ label: "7d", usedPercentage: 36 }],
      telemetry: expect.stringContaining("Last reported snapshot"),
    });
  });
});
