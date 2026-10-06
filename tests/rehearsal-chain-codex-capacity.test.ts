import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCodexRateLimitsLive, type CodexRateLimitRead } from "../src/codingAgents/availability.js";
import type { CodingAgentProfile } from "../src/intent/registries.js";
import { CODEX_CAPACITY_LIVE_READ, observeCodexCapacityLive } from "../src/operatorActions/rehearsalChainProbe.js";

/**
 * G6's Codex capacity read (Issue #1016): one live account/rateLimits/read with
 * a named failure, and the bounded retry that either judges a fresh reading or
 * returns every failure and judges nothing (never a stale cache).
 */
const NOW = new Date("2026-10-07T00:00:00.000Z");
const ANSWER = [
  JSON.stringify({ id: 1, result: { userAgent: "codex" } }),
  JSON.stringify({ id: 2, result: { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1791000000 }, secondary: { usedPercent: 30, windowDurationMins: 10080, resetsAt: 1791500000 }, planType: "plus" } } })
].join("\n");
const profiles: CodingAgentProfile[] = [
  { name: "codex_review", provider: "codex-cli", package: "codex", command: "/opt/bin/codex", purpose: "planning", sandbox: "read-only", args: [] },
  { name: "codex_build", provider: "codex-cli", package: "codex", command: "/opt/bin/codex", purpose: "build", sandbox: "workspace-write", args: [] }
];

const directories: string[] = [];
const saved = { cache: process.env.ARCADIA_CODING_AGENT_USAGE_CACHE_PATH, receipts: process.env.ARCADIA_CAPACITY_RECEIPTS_PATH };
let cachePath = "";
beforeEach(() => {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-codex-capacity-"));
  directories.push(directory);
  cachePath = path.join(directory, "usage.json");
  process.env.ARCADIA_CODING_AGENT_USAGE_CACHE_PATH = cachePath;
  process.env.ARCADIA_CAPACITY_RECEIPTS_PATH = path.join(directory, "receipts.json");
});
afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
  for (const [name, value] of [["ARCADIA_CODING_AGENT_USAGE_CACHE_PATH", saved.cache], ["ARCADIA_CAPACITY_RECEIPTS_PATH", saved.receipts]] as const) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

const failing = (error: Record<string, unknown>) => () => { throw Object.assign(new Error("Command failed"), error); };

describe("readCodexRateLimitsLive names why a live read produced nothing", () => {
  it("returns the telemetry of an answered account/rateLimits/read", () => {
    const read = readCodexRateLimitsLive(NOW, { run: () => ANSWER });
    expect(read).toMatchObject({ ok: true, telemetry: { availability: "available", planScope: "plus", capturedAt: NOW.toISOString() } });
    if (read.ok) expect(read.telemetry.rateLimits.map((limit) => [limit.label, limit.usedPercentage])).toEqual([["5h", 12], ["7d", 30]]);
  });

  it("names a timeout, with the deadline it was held to", () => {
    const read = readCodexRateLimitsLive(NOW, { deadlineMs: 20_000, run: failing({ code: "ETIMEDOUT", signal: "SIGTERM", status: null }) });
    expect(read).toEqual({ ok: false, failure: { kind: "timeout", exitStatus: null, signal: "SIGTERM", detail: expect.stringContaining("did not answer within 20000 ms") } });
  });

  it("names a non-zero exit status", () => {
    const read = readCodexRateLimitsLive(NOW, { run: failing({ status: 127 }) });
    expect(read).toEqual({ ok: false, failure: { kind: "exit", exitStatus: 127, signal: null, detail: expect.stringContaining("exit status 127") } });
  });

  it.each([
    ["output with no id 2 response (the app server exited before answering)", "{\"id\":1,\"result\":{}}\n", "no_response"],
    ["output that is not JSON lines", "not json\n", "unparseable"],
    ["an answer without a rateLimits snapshot", "{\"id\":2,\"result\":{}}\n", "no_rate_limits"]
  ])("names %s", (_label, output, kind) => {
    expect(readCodexRateLimitsLive(NOW, { run: () => output })).toMatchObject({ ok: false, failure: { kind, exitStatus: 0 } });
  });
});

describe("observeCodexCapacityLive: a fresh live read with a bounded retry", () => {
  const answered = (): CodexRateLimitRead => readCodexRateLimitsLive(NOW, { run: () => ANSWER });
  const timedOut = (): CodexRateLimitRead => readCodexRateLimitsLive(NOW, { run: failing({ code: "ETIMEDOUT", signal: "SIGTERM" }) });
  const exited = (): CodexRateLimitRead => readCodexRateLimitsLive(NOW, { run: failing({ status: 2 }) });
  const run = (results: Array<() => CodexRateLimitRead>, sleeps: number[]) => {
    const calls: number[] = [];
    const observation = observeCodexCapacityLive(profiles, {
      now: () => NOW, sleep: (ms) => sleeps.push(ms),
      read: (_now, deadlineMs) => { calls.push(deadlineMs); return results[Math.min(calls.length - 1, results.length - 1)](); }
    });
    return { observation, calls };
  };

  it("success: judges the reading it just made, and lists the read-only reviewer profile", () => {
    const sleeps: number[] = [];
    const { observation, calls } = run([answered], sleeps);
    expect(calls).toEqual([CODEX_CAPACITY_LIVE_READ.deadlineMs]);
    expect(sleeps).toEqual([]);
    expect(observation.readOnlyReviewers).toEqual(["codex_review"]);
    expect(observation.liveRead).toEqual({ ok: true, maxAttempts: 3, deadlineMs: 20_000, attempts: [{ attempt: 1, ok: true }] });
    expect(observation.codex).toMatchObject({ confidence: "observed", freshness: "fresh", availability: "available", observedAt: NOW.toISOString() });
    expect(observation.codex?.windows).toHaveLength(2);
  });

  it("retries a failed read, pausing between attempts only, and judges the first reading that answers", () => {
    const sleeps: number[] = [];
    const { observation, calls } = run([timedOut, exited, answered], sleeps);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([2_000, 2_000]);
    expect(observation.liveRead.ok).toBe(true);
    expect(observation.liveRead.attempts.map((a) => [a.attempt, a.ok, a.failure?.kind ?? null])).toEqual([[1, false, "timeout"], [2, false, "exit"], [3, true, null]]);
    expect(observation.codex?.confidence).toBe("observed");
  });

  it("named failure: when every attempt fails it returns each failure (timeout, exit status) and judges nothing, even with a fresh-looking cache present", () => {
    // The stale cache the old probe fell back to: a perfectly healthy Codex observation from just before.
    writeFileSync(cachePath, JSON.stringify({ version: 1, providers: { "codex-cli": {
      availability: "available", context: null, credits: null, bankedResets: [], planScope: "plus", capturedAt: NOW.toISOString(), telemetry: "cached",
      rateLimits: [{ label: "5h", usedPercentage: 1, resetsAt: null }]
    } } }));
    const sleeps: number[] = [];
    const { observation, calls } = run([timedOut, exited, timedOut], sleeps);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([2_000, 2_000]);
    expect(observation.liveRead.ok).toBe(false);
    expect(observation.liveRead.attempts).toEqual([
      { attempt: 1, ok: false, failure: expect.objectContaining({ kind: "timeout", exitStatus: null }) },
      { attempt: 2, ok: false, failure: expect.objectContaining({ kind: "exit", exitStatus: 2 }) },
      { attempt: 3, ok: false, failure: expect.objectContaining({ kind: "timeout", exitStatus: null }) }
    ]);
    expect(observation.codex).toBeNull();
    expect(observation.readOnlyReviewers).toEqual(["codex_review"]);
  });

  it("is bounded: three attempts of at most 20 seconds, two seconds apart, inside G6's 120-second probe bound", () => {
    expect(CODEX_CAPACITY_LIVE_READ).toEqual({ attempts: 3, deadlineMs: 20_000, pauseMs: 2_000 });
    expect(CODEX_CAPACITY_LIVE_READ.attempts * CODEX_CAPACITY_LIVE_READ.deadlineMs + (CODEX_CAPACITY_LIVE_READ.attempts - 1) * CODEX_CAPACITY_LIVE_READ.pauseMs).toBeLessThan(120_000);
  });
});
