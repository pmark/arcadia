import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readClaudeUsageRefreshState,
  refreshClaudeCodeUsageTelemetry,
  type ClaudeUsageRefreshDependencies
} from "../src/codingAgents/availability.js";
import { observeProviderCapacity, refreshProviderCapacity } from "../src/codingAgents/capacity.js";
import { openDatabase, withDatabase } from "../src/db/connection.js";
import type { CodingAgentProfile } from "../src/intent/registries.js";
import { CLAUDE_UNAUTHORIZED_PING, refreshClaudeCapacityBeforeAdmission } from "../src/production/capacityPreAdmission.js";
import { listPendingOperatorPings } from "../src/ping/operatorPing.js";
import {
  activateProduction,
  fingerprintProductionScope,
  normalizeProductionScope
} from "../src/production/policy.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

const profiles: CodingAgentProfile[] = [
  { name: "claude_build", provider: "claude-code-cli", package: "test", command: "claude", purpose: "build", sandbox: "workspace-write", args: [] }
];

const temporary: string[] = [];
let root: string;
let workspace: string;
let snapshotPath: string;
let configHashBefore: string;
let liveFetch: ReturnType<typeof vi.fn>;

const hashFile = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "arcadia-claude-capacity-"));
  temporary.push(root);
  workspace = path.join(root, "workspace");
  initWorkspace(workspace);
  snapshotPath = path.join(root, "claude-code.json");
  vi.stubEnv("ARCADIA_CLAUDE_USAGE_PATH", snapshotPath);
  vi.stubEnv("ARCADIA_CODING_AGENT_USAGE_CACHE_PATH", path.join(root, "cache.json"));
  vi.stubEnv("ARCADIA_CAPACITY_RECEIPTS_PATH", path.join(root, "receipts.json"));
  vi.stubEnv("ARCADIA_CLAUDE_CREDENTIALS_PATH", path.join(root, "no-credentials.json"));
  vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
  // Any live provider call is a test failure: the injected collaborators must carry everything.
  liveFetch = vi.fn(() => { throw new Error("live network call attempted"); });
  vi.stubGlobal("fetch", liveFetch);
  configHashBefore = hashFile(getWorkspacePaths(workspace).configFile);
});

afterEach(() => {
  // The workspace config is the operator's gate: nothing here may rewrite it,
  // and the suite made no live provider call.
  expect(hashFile(getWorkspacePaths(workspace).configFile)).toBe(configHashBefore);
  expect(liveFetch).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function activate(): void {
  const scope = normalizeProductionScope({
    intent: "Prove the pre-admission refresh.",
    projects: ["demo"],
    plans: ["demo/queue-plan"],
    actions: ["demo/migrate"],
    providers: ["claude-code-cli"],
    maxConcurrentSessions: 1,
    mechanicalTransitions: []
  });
  withDatabase(workspace, (db) =>
    activateProduction(db, {
      requestId: "grant-preadmission",
      scope,
      scopeFingerprint: fingerprintProductionScope(scope),
      grantedBy: "operator"
    })
  );
}

function writeStaleSnapshot(): void {
  const old = new Date(Date.now() - 60 * 60_000).toISOString();
  writeFileSync(snapshotPath, JSON.stringify({
    arcadia_captured_at: old,
    arcadia_usage_checked_at: old,
    rate_limits: {
      five_hour: { used_percentage: 5, resets_at: Math.floor(Date.now() / 1000) + 3 * 3600 },
      seven_day: { used_percentage: 5, resets_at: Math.floor(Date.now() / 1000) + 3 * 86_400 }
    }
  }));
}

function claudeDecision() {
  const observed = observeProviderCapacity(profiles, { unmeteredProvider: null });
  return observed.providers.find((entry) => entry.providerId === "claude-code-cli")!;
}

function deps(overrides: Partial<ClaudeUsageRefreshDependencies> = {}): ClaudeUsageRefreshDependencies {
  return {
    snapshotPath,
    loadCredentials: async () => ({ accessToken: "access-token", refreshToken: "refresh-token" }),
    requestUsage: async () => ({
      status: 200,
      body: {
        five_hour: { utilization: 0.1, resets_at: new Date(Date.now() + 3 * 3_600_000).toISOString() },
        seven_day: { utilization: 0.2, resets_at: new Date(Date.now() + 3 * 86_400_000).toISOString() }
      }
    }),
    ...overrides
  };
}

describe("worker pre-admission Claude usage refresh (Decision 0130)", () => {
  it("refreshes a stale snapshot instead of refusing it", async () => {
    activate();
    writeStaleSnapshot();
    const before = claudeDecision();
    expect(before.admitted).toBe(false);
    expect(before.code).toBe("capacity_stale");

    const requestUsage = vi.fn(deps().requestUsage);
    const attempted = await withDatabase(workspace, (db) =>
      refreshClaudeCapacityBeforeAdmission(
        { db, workspacePath: workspace, profiles, unmeteredProvider: null, deps: deps({ requestUsage }) },
        5_000
      )
    );

    expect(attempted).toBe(true);
    expect(requestUsage).toHaveBeenCalledTimes(1);
    const after = claudeDecision();
    expect(after.code).not.toBe("capacity_stale");
    expect(after.receipt.freshness).toBe("fresh");
    expect(after.receipt.windows.map((window) => window.label)).toEqual(expect.arrayContaining(["5h", "7d"]));
    expect(readClaudeUsageRefreshState(snapshotPath)).toBe("ok");
  });

  it("never exchanges the refresh token: a 401 is recorded unauthorized and the stale reading is refused", async () => {
    activate();
    writeStaleSnapshot();
    const requestUsage = vi.fn(async () => ({ status: 401, body: null }));

    await withDatabase(workspace, (db) =>
      refreshClaudeCapacityBeforeAdmission(
        { db, workspacePath: workspace, profiles, unmeteredProvider: null, deps: deps({ requestUsage }) },
        5_000
      )
    );

    expect(liveFetch).not.toHaveBeenCalled();
    expect(requestUsage).toHaveBeenCalledTimes(1);
    expect(readClaudeUsageRefreshState(snapshotPath)).toBe("unauthorized");
    const decision = claudeDecision();
    expect(decision.admitted).toBe(false);
    expect(decision.code).toBe("capacity_stale");
  });

  it("the manual refresh is read-only too: a 401 is recorded unauthorized with no token exchange", async () => {
    writeStaleSnapshot();
    const requestUsage = vi.fn(async () => ({ status: 401, body: null }));

    await refreshClaudeCodeUsageTelemetry(new Date(), { force: true, deps: deps({ requestUsage }) });

    expect(requestUsage).toHaveBeenCalledTimes(1);
    expect(readClaudeUsageRefreshState(snapshotPath)).toBe("unauthorized");
  });

  it("raises one attention ping on the first turn to unauthorized, none on later ticks, and a new one after a good reading", async () => {
    activate();
    writeStaleSnapshot();
    let status = 200;
    const requestUsage = vi.fn(async (token: string) =>
      status === 401 ? { status: 401, body: null } : deps().requestUsage!(token));
    // The worker keeps its connection open across the async refresh (worker.ts).
    const tick = async (now?: Date) => {
      const db = openDatabase(workspace);
      try {
        await refreshClaudeCapacityBeforeAdmission(
          { db, workspacePath: workspace, profiles, unmeteredProvider: null, deps: deps({ requestUsage }), ...(now ? { now } : {}) },
          5_000
        );
      } finally {
        db.close();
      }
    };
    const pings = () => withDatabase(workspace, (db) =>
      listPendingOperatorPings(db).filter((ping) => ping.message === CLAUDE_UNAUTHORIZED_PING));
    const expireCooldown = () => {
      const record = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, unknown>;
      record.arcadia_usage_checked_at = new Date(Date.now() - 60 * 60_000).toISOString();
      writeFileSync(snapshotPath, JSON.stringify(record));
    };

    await tick();
    expect(readClaudeUsageRefreshState(snapshotPath)).toBe("ok");
    expect(pings()).toHaveLength(0);

    status = 401;
    expireCooldown();
    await tick();
    expect(readClaudeUsageRefreshState(snapshotPath)).toBe("unauthorized");
    expect(pings()).toHaveLength(1);
    expect(pings()[0]?.kind).toBe("attention");

    // Later ticks in the same episode stay quiet, even past the ping queue's own dedupe window.
    for (let index = 0; index < 3; index += 1) {
      expireCooldown();
      await tick();
    }
    expect(requestUsage).toHaveBeenCalledTimes(5);
    expect(pings()).toHaveLength(1);

    // A good reading closes the episode; the next 401 is a new transition and signals again.
    status = 200;
    expireCooldown();
    await tick();
    expect(readClaudeUsageRefreshState(snapshotPath)).toBe("ok");
    status = 401;
    expireCooldown();
    // Past the ping queue's 10-minute identical-message window, so only our episode dedupe is under test.
    await tick(new Date(Date.now() + 20 * 60_000));
    expect(pings()).toHaveLength(2);
  });

  it("issue #1559: a 401 through the capacity-observer refresh never contacts the OAuth token endpoint", async () => {
    // The live shape: `arcadia capacity --refresh` reaches refreshProviderCapacity,
    // which used the refresher's default and exchanged the single-use refresh
    // token on a 401 without persisting the rotation. No exchange collaborator is
    // injected here, so any exchange would reach the (stubbed) live fetch.
    writeStaleSnapshot();
    const requestUsage = vi.fn(async () => ({ status: 401, body: null }));
    await refreshProviderCapacity(profiles, {
      unmeteredProvider: null,
      claudeUsageRefreshDeps: {
        snapshotPath,
        loadCredentials: async () => ({ accessToken: "access-token", refreshToken: "refresh-token" }),
        requestUsage
      }
    });

    const tokenEndpointCalls = liveFetch.mock.calls.filter((call) => String(call[0]).includes("/oauth/token"));
    expect(tokenEndpointCalls).toHaveLength(0);
    expect(requestUsage).toHaveBeenCalledTimes(1);
    expect(readClaudeUsageRefreshState(snapshotPath)).toBe("unauthorized");
    expect(claudeDecision().admitted).toBe(false);
  });

  it("records an unreadable credential as no_credentials and refuses", async () => {
    activate();
    writeStaleSnapshot();
    const requestUsage = vi.fn(async () => ({ status: 200, body: {} }));

    await withDatabase(workspace, (db) =>
      refreshClaudeCapacityBeforeAdmission(
        { db, workspacePath: workspace, profiles, unmeteredProvider: null, deps: deps({ loadCredentials: async () => null, requestUsage }) },
        5_000
      )
    );

    expect(requestUsage).not.toHaveBeenCalled();
    expect(readClaudeUsageRefreshState(snapshotPath)).toBe("no_credentials");
    expect(claudeDecision().admitted).toBe(false);
  });

  it("respects the cooldown: a recent check is not repeated", async () => {
    activate();
    writeFileSync(snapshotPath, JSON.stringify({ arcadia_usage_checked_at: new Date().toISOString() }));
    const requestUsage = vi.fn(deps().requestUsage);

    await withDatabase(workspace, (db) =>
      refreshClaudeCapacityBeforeAdmission(
        { db, workspacePath: workspace, profiles, unmeteredProvider: null, deps: deps({ requestUsage }) },
        5_000
      )
    );

    expect(requestUsage).not.toHaveBeenCalled();
  });

  it("does nothing while production is Inactive, for a non-Claude fleet, or when the gate is exempt", async () => {
    writeStaleSnapshot();
    const requestUsage = vi.fn(deps().requestUsage);
    const run = (input: { profiles?: CodingAgentProfile[]; unmeteredProvider?: "all" | null }) =>
      withDatabase(workspace, (db) =>
        refreshClaudeCapacityBeforeAdmission(
          { db, workspacePath: workspace, profiles: input.profiles ?? profiles, unmeteredProvider: input.unmeteredProvider ?? null, deps: deps({ requestUsage }) },
          5_000
        )
      );

    expect(await run({})).toBe(false);
    activate();
    expect(await run({ profiles: [{ ...profiles[0], provider: "codex-cli" }] })).toBe(false);
    expect(await run({ unmeteredProvider: "all" })).toBe(false);
    expect(requestUsage).not.toHaveBeenCalled();
  });

  it("makes no live call when nothing is injected under the test runner", async () => {
    writeStaleSnapshot();
    await refreshClaudeCodeUsageTelemetry(new Date(), { force: true });
    expect(liveFetch).not.toHaveBeenCalled();
  });
});
