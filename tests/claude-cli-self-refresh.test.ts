import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lastClaudeCliSelfRefreshAt, readClaudeUsageRefreshState, type ClaudeUsageRefreshDependencies } from "../src/codingAgents/availability.js";
import { openDatabase, withDatabase } from "../src/db/connection.js";
import type { CodingAgentProfile } from "../src/intent/registries.js";
import { listPendingOperatorPings, OPERATOR_PING_MESSAGE_MAX } from "../src/ping/operatorPing.js";
import {
  CLAUDE_CLI_SELF_REFRESH_ARGS,
  CLAUDE_CLI_SELF_REFRESH_ENV_ALLOWLIST,
  CLAUDE_CLI_SELF_REFRESH_INTERVAL_MS,
  refreshClaudeCapacityBeforeAdmission,
  runClaudeCliHeadless,
  type ClaudeCliRunner
} from "../src/production/capacityPreAdmission.js";
import { activateProduction, fingerprintProductionScope, normalizeProductionScope } from "../src/production/policy.js";
import { boundedPingMessage } from "../src/production/tick.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

// Issue #1616: on a recorded 401 the worker lets the Claude CLI refresh its
// own sign-in, at most once per interval, and re-reads usage once.
const profiles: CodingAgentProfile[] = [
  { name: "claude_build", provider: "claude-code-cli", package: "test", command: "claude", purpose: "build", sandbox: "workspace-write", args: [] }
];

const temporary: string[] = [];
let root: string;
let workspace: string;
let snapshotPath: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "arcadia-claude-self-refresh-"));
  temporary.push(root);
  workspace = path.join(root, "workspace");
  initWorkspace(workspace);
  snapshotPath = path.join(root, "claude-code.json");
  vi.stubEnv("ARCADIA_CLAUDE_USAGE_PATH", snapshotPath);
  vi.stubEnv("ARCADIA_CODING_AGENT_USAGE_CACHE_PATH", path.join(root, "cache.json"));
  vi.stubEnv("ARCADIA_CAPACITY_RECEIPTS_PATH", path.join(root, "receipts.json"));
  vi.stubEnv("ARCADIA_CLAUDE_CREDENTIALS_PATH", path.join(root, "no-credentials.json"));
  vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("live network call attempted"); }));
  const scope = normalizeProductionScope({
    intent: "Prove the Claude CLI self-refresh.", projects: ["demo"], plans: ["demo/queue-plan"], actions: ["demo/migrate"],
    providers: ["claude-code-cli"], maxConcurrentSessions: 1, mechanicalTransitions: []
  });
  withDatabase(workspace, (db) => activateProduction(db, { requestId: "grant-self-refresh", scope, scopeFingerprint: fingerprintProductionScope(scope), grantedBy: "operator" }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const goodUsage = async () => ({
  status: 200,
  body: {
    five_hour: { utilization: 0.1, resets_at: new Date(Date.now() + 3 * 3_600_000).toISOString() },
    seven_day: { utilization: 0.2, resets_at: new Date(Date.now() + 3 * 86_400_000).toISOString() }
  }
});

/** The stored token is rejected until the CLI has refreshed it. */
function usageAfterCliRefresh(): { deps: ClaudeUsageRefreshDependencies; runner: ReturnType<typeof vi.fn> } {
  let refreshed = false;
  const runner = vi.fn<ClaudeCliRunner>(async () => { refreshed = true; return { ok: true, detail: "exit 0" }; });
  return {
    runner,
    deps: {
      snapshotPath,
      loadCredentials: async () => ({ accessToken: refreshed ? "fresh-access-token" : "expired-access-token" }),
      requestUsage: async (token) => (token === "fresh-access-token" ? goodUsage() : { status: 401, body: null })
    }
  };
}

// The worker keeps its connection open across the async refresh (worker.ts).
async function refresh(deps: ClaudeUsageRefreshDependencies, runClaudeCli: ClaudeCliRunner, now?: Date): Promise<void> {
  const db = openDatabase(workspace);
  try {
    await refreshClaudeCapacityBeforeAdmission(
      { db, workspacePath: workspace, profiles, unmeteredProvider: null, deps, runClaudeCli, ...(now ? { now } : {}) }, 5_000);
  } finally {
    db.close();
  }
}

describe("worker Claude CLI self-refresh on a 401 (#1616)", () => {
  it("runs the CLI's minimal call once, re-reads usage, recovers, and pings nobody", async () => {
    const { deps, runner } = usageAfterCliRefresh();
    await refresh(deps, runner);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0]).toEqual(CLAUDE_CLI_SELF_REFRESH_ARGS);
    expect(readClaudeUsageRefreshState(snapshotPath)).toBe("ok");
    expect(withDatabase(workspace, (db) => listPendingOperatorPings(db))).toEqual([]);
  });

  it("on a failed CLI call keeps the refusal, pings once, and does not retry the CLI within the interval", async () => {
    const runner = vi.fn<ClaudeCliRunner>(async () => ({ ok: false, detail: "exit 1" }));
    const deps: ClaudeUsageRefreshDependencies = { snapshotPath, loadCredentials: async () => ({ accessToken: "expired" }), requestUsage: async () => ({ status: 401, body: null }) };
    const start = new Date();
    await refresh(deps, runner, start);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(readClaudeUsageRefreshState(snapshotPath)).toBe("unauthorized");
    expect(lastClaudeCliSelfRefreshAt(snapshotPath)).toBe(start.toISOString());
    expect(withDatabase(workspace, (db) => listPendingOperatorPings(db))).toHaveLength(1);

    // Within the interval (the usage cooldown aside): no second CLI call.
    await refresh(deps, runner, new Date(start.getTime() + CLAUDE_CLI_SELF_REFRESH_INTERVAL_MS - 60_000));
    expect(runner).toHaveBeenCalledTimes(1);
    // Past it: one more attempt.
    await refresh(deps, runner, new Date(start.getTime() + CLAUDE_CLI_SELF_REFRESH_INTERVAL_MS + 60_000));
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("never runs the CLI while the stored token is accepted", async () => {
    const runner = vi.fn<ClaudeCliRunner>(async () => ({ ok: true, detail: "exit 0" }));
    await refresh({ snapshotPath, loadCredentials: async () => ({ accessToken: "good" }), requestUsage: goodUsage }, runner);
    expect(runner).not.toHaveBeenCalled();
    expect(readClaudeUsageRefreshState(snapshotPath)).toBe("ok");
  });

  function fakeClaude(script: string): string {
    const bin = path.join(root, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, "claude"), `#!/bin/sh\n${script}\n`);
    chmodSync(path.join(bin, "claude"), 0o755);
    vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
    return bin;
  }

  it.runIf(process.platform !== "win32")("the worker's runner runs `claude` with stdin on /dev/null, a private empty cwd and only allowlisted environment", async () => {
    const record = path.join(root, "record.json");
    fakeClaude(`if [ -p /dev/stdin ]; then stdin=pipe; elif [ -t 0 ]; then stdin=tty; else stdin=devnull; fi
printf '{"args":"%s","key":"%s","auth":"%s","oauth":"%s","base":"%s","bedrock":"%s","aws":"%s","stdin":"%s","cwd":"%s","files":"%s","home":"%s"}' "$*" "\${ANTHROPIC_API_KEY-unset}" "\${ANTHROPIC_AUTH_TOKEN-unset}" "\${CLAUDE_CODE_OAUTH_TOKEN-unset}" "\${ANTHROPIC_BASE_URL-unset}" "\${CLAUDE_CODE_USE_BEDROCK-unset}" "\${AWS_ACCESS_KEY_ID-unset}" "$stdin" "$PWD" "$(ls -A | wc -l | tr -d ' ')" "\${HOME-unset}" > ${JSON.stringify(record)}`);
    for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "AWS_ACCESS_KEY_ID"]) vi.stubEnv(name, "should-never-reach");

    const result = await runClaudeCliHeadless(CLAUDE_CLI_SELF_REFRESH_ARGS, 10_000);

    expect(result.ok).toBe(true);
    const seen = JSON.parse(readFileSync(record, "utf8")) as Record<string, string>;
    expect(seen.args).toBe(CLAUDE_CLI_SELF_REFRESH_ARGS.join(" "));
    expect([seen.key, seen.auth, seen.oauth, seen.base, seen.bedrock, seen.aws]).toEqual(["unset", "unset", "unset", "unset", "unset", "unset"]);
    expect(seen.home).toBe(process.env.HOME);
    expect(seen.stdin).toBe("devnull");
    expect(realpathSync(path.dirname(seen.cwd))).toBe(realpathSync(tmpdir()));
    expect(path.basename(seen.cwd)).toMatch(/^arcadia-claude-refresh-/);
    expect(seen.files).toBe("0");
    expect(existsSync(seen.cwd)).toBe(false);
    expect(CLAUDE_CLI_SELF_REFRESH_ENV_ALLOWLIST).not.toContain("ANTHROPIC_API_KEY");
  });

  it.runIf(process.platform !== "win32")("kills a CLI call at its bound and reports why", async () => {
    // Keep the sleeping process as the direct child and allow startup under CI load.
    fakeClaude("echo 'stuck waiting' >&2; exec sleep 30");
    const result = await runClaudeCliHeadless(CLAUDE_CLI_SELF_REFRESH_ARGS, 2_000);
    expect(result).toEqual({ ok: false, detail: "signal SIGKILL: stuck waiting" });
  });

  it("records a failed refresh's bounded detail for diagnosis", async () => {
    const runner = vi.fn<ClaudeCliRunner>(async () => ({ ok: false, detail: "exit 1: Not logged in \u001b[31m" }));
    await refresh({ snapshotPath, loadCredentials: async () => ({ accessToken: "expired" }), requestUsage: async () => ({ status: 401, body: null }) }, runner);
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, unknown>;
    expect(snapshot.arcadia_cli_self_refresh_outcome).toBe("failed");
    expect(snapshot.arcadia_cli_self_refresh_detail).toBe("exit 1: Not logged in  [31m");
  });

  it("bounds the tick's sign-in ping to the queue's limit so it is actually queued", () => {
    const long = `Production cannot launch arcadia/x: ${"Claude sign-in on the worker host needs renewing. ".repeat(20)}`;
    const bounded = boundedPingMessage(long);
    expect(bounded.length).toBeLessThanOrEqual(OPERATOR_PING_MESSAGE_MAX);
    expect(bounded.startsWith("Production cannot launch arcadia/x: Claude sign-in")).toBe(true);
    expect(boundedPingMessage("short")).toBe("short");
  });
});
