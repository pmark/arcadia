import { describe, expect, it, vi } from "vitest";
import { readProviderUsage, type ProviderUsageDependencies } from "../src/codingAgents/providerUsage.js";
import { requestClaudeUsage, loadClaudeOAuthCredentials } from "../src/codingAgents/availability.js";
import { runProviderUsageCommand } from "../src/commands/providerUsage.js";

const now = new Date("2026-10-22T17:00:00Z");
function deps(): ProviderUsageDependencies {
  return {
    loadClaude: vi.fn(async () => ({ accessToken: "secret-sentinel", source: "keychain" as const, expiresAt: "2026-10-23T00:00:00Z" })),
    requestClaude: vi.fn(async () => ({ status: 200, body: { five_hour: { utilization: 1, resets_at: "2026-10-22T20:00:00Z" } } })),
    readCodex: vi.fn(() => ({ ok: false as const, failure: { kind: "timeout" as const, exitStatus: null, signal: null, detail: "private failure detail" } })),
    readClaudeCache: vi.fn(() => null),
  };
}

describe("shared provider usage diagnostics", () => {
  it("never reads credentials or providers without explicit refresh; marks cache unverified", async () => {
    const d = deps();
    d.readClaudeCache = vi.fn(() => ({ availability: "available", context: null, rateLimits: [{ label: "5h", usedPercentage: 2, resetsAt: null }], credits: null, bankedResets: [], planScope: null, capturedAt: now.toISOString(), telemetry: "cache" }));
    const result = await readProviderUsage({ now }, d);
    expect(result.providers[1]).toMatchObject({ observation: "cached_unverified", requestAttempted: false });
    expect(d.loadClaude).not.toHaveBeenCalled();
    expect(d.requestClaude).not.toHaveBeenCalled();
    expect(d.readCodex).not.toHaveBeenCalled();
  });

  it("makes exactly one context-selected fresh read, with safe metadata and 1% preserved", async () => {
    const d = deps();
    const result = await readProviderUsage({ now, refresh: true, claudeSource: "keychain" }, d);
    expect(d.loadClaude).toHaveBeenCalledExactlyOnceWith("keychain");
    expect(d.requestClaude).toHaveBeenCalledTimes(1);
    expect(d.readClaudeCache).not.toHaveBeenCalled();
    expect(result.providers[1]).toMatchObject({ observation: "live", credentialSource: "keychain", requestAttempted: true, httpStatus: 200, outcome: "ok", windows: [{ usedPercentage: 1 }] });
    expect(result.providers[0]).toMatchObject({ observation: "unavailable", requestAttempted: true, outcome: "timeout", windows: [] });
    expect(result.providers[2]).toMatchObject({ observation: "unsupported", requestAttempted: false, windows: [] });
    expect(JSON.stringify(result)).not.toContain("secret-sentinel");
    expect(JSON.stringify(result)).not.toContain("private failure detail");
  });

  it.each([401, 403, 429, 500])("preserves HTTP %s without fallback, retry or stale windows", async status => {
    const d = deps();
    d.requestClaude = vi.fn(async () => ({ status, body: null }));
    const result = await readProviderUsage({ now, refresh: true, claudeSource: "environment" }, d);
    expect(result.providers[1]).toMatchObject({ requestAttempted: true, httpStatus: status, outcome: "http_error", windows: [] });
    expect(d.loadClaude).toHaveBeenCalledTimes(1);
    expect(d.requestClaude).toHaveBeenCalledTimes(1);
    expect(d.readClaudeCache).not.toHaveBeenCalled();
  });

  it.each([null, { accessToken: "expired", expiresAt: "2026-10-21T00:00:00Z" }])("refuses absent/expired credentials before a request", async credential => {
    const d = deps();
    d.loadClaude = vi.fn(async () => credential);
    const result = await readProviderUsage({ now, refresh: true }, d);
    expect(result.providers[1].requestAttempted).toBe(false);
    expect(d.requestClaude).not.toHaveBeenCalled();
  });

  it("does not accept HTTP error bodies or malformed numeric windows as fresh usage", async () => {
    const d = deps();
    d.requestClaude = vi.fn(async () => ({ status: 403, body: { five_hour: { utilization: 1 } } }));
    expect((await readProviderUsage({ now, refresh: true }, d)).providers[1].windows).toEqual([]);
    d.requestClaude = vi.fn(async () => ({ status: 200, body: { five_hour: { utilization: NaN }, seven_day: { utilization: 101 } } }));
    expect((await readProviderUsage({ now, refresh: true }, d)).providers[1]).toMatchObject({ outcome: "not_reported", windows: [] });
  });

  it("distinguishes received malformed JSON from transport failure without leaking exceptions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error("private"); } })));
    try {
      expect(await requestClaudeUsage("secret")).toEqual({ status: 200, body: null, failure: "parse" });
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("private"); }));
      expect(await requestClaudeUsage("secret")).toEqual({ status: 0, body: null, failure: "transport" });
    } finally { vi.unstubAllGlobals(); }
  });

  it.each(["AbortError", "TimeoutError"])("classifies a response-body %s as transport while retaining HTTP status", async name => {
    const error = new Error("private body-read failure"); error.name = name;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw error; } })));
    try {
      expect(await requestClaudeUsage("secret")).toEqual({ status: 200, body: null, failure: "transport" });
    } finally { vi.unstubAllGlobals(); }
  });

  it("explicit absent environment source never tries a credential fallback", async () => {
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
    try { expect(await loadClaudeOAuthCredentials("environment")).toBeNull(); }
    finally { vi.unstubAllEnvs(); }
  });

  it("rejects invalid CLI credential source before reading credentials", async () => {
    await expect(runProviderUsageCommand({ claudeSource: "other-account" })).rejects.toThrow("--claude-source");
  });
});
