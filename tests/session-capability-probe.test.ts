import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSessionProbe, sessionProbeWalls, SESSION_PROBE_TOKEN_BUDGET } from "../src/production/sessionCapability.js";
import { headlessClaudeAllowList } from "../src/sessions/headlessPermissions.js";
import { SESSION_PROBE_COMMAND_PREFIX, SESSION_PROBE_SCRIPT_PATH, sessionProbeCommand } from "../src/sessions/sessionProbeCommand.js";

function runProbe(workspace: string, worktree: string) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [SESSION_PROBE_SCRIPT_PATH, "--workspace", workspace, "--worktree", worktree], { encoding: "utf8", timeout: 10_000 });
  return { status: result.status, stdout: result.stdout, ms: Date.now() - started };
}

describe("the in-Session capability probe script", () => {
  it("passes on a writable workspace and worktree, prints one JSON line and leaves nothing behind", () => {
    const root = mkdtempSync(path.join(tmpdir(), "probe-ok-"));
    try {
      const workspace = path.join(root, "ws");
      mkdirSync(path.join(workspace, "database"), { recursive: true });
      const run = runProbe(workspace, root);
      expect(run.status).toBe(0);
      const lines = run.stdout.trim().split("\n");
      expect(lines).toHaveLength(1);
      const probe = JSON.parse(lines[0]);
      expect(probe).toMatchObject({ probe: "session-capability/v1", ok: true });
      expect(probe.checks.map((c: { name: string }) => c.name)).toEqual(["workspace_write", "host_validation", "preservation"]);
      expect(readdirSync(path.join(workspace, "database"))).toEqual([]);
      expect(run.ms).toBeLessThan(10_000);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is refused within the probe budget when the workspace database directory is read-only", () => {
    const root = mkdtempSync(path.join(tmpdir(), "probe-ro-"));
    const database = path.join(root, "ws", "database");
    mkdirSync(database, { recursive: true });
    chmodSync(database, 0o555);
    try {
      const run = runProbe(path.join(root, "ws"), root);
      if (process.getuid?.() === 0) return; // root ignores directory modes
      expect(run.status).not.toBe(0);
      const probe = JSON.parse(run.stdout.trim());
      expect(probe.ok).toBe(false);
      expect(probe.checks.find((c: { name: string }) => c.name === "workspace_write")).toMatchObject({ ok: false });
      expect(probe.checks.find((c: { name: string }) => c.name === "host_validation")).toMatchObject({ ok: true });
      expect(run.ms).toBeLessThan(10_000);
      expect(SESSION_PROBE_TOKEN_BUDGET).toBeLessThanOrEqual(5_000);
      // The parsed result becomes exactly one workspace_write wall carrying the probe JSON.
      const walls = sessionProbeWalls(parseSessionProbe(`${run.stdout}`));
      expect(walls).toHaveLength(1);
      expect(walls[0]).toMatchObject({ wallClass: "workspace_write" });
      expect(walls[0]?.evidence).toContain("session-capability/v1");
    } finally {
      chmodSync(database, 0o755);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails the workspace check when the workspace does not exist, without throwing", () => {
    const run = runProbe(path.join(tmpdir(), "no-such-workspace-probe"), tmpdir());
    expect(run.status).toBe(1);
    expect(existsSync(path.join(tmpdir(), "no-such-workspace-probe"))).toBe(false);
  });
});

describe("parsing the probe from a Session log", () => {
  const probe = { probe: "session-capability/v1", ok: false, checks: [{ name: "preservation", ok: false, error: "EACCES" }, { name: "host_validation", ok: true }], ms: 5 };

  it("finds a bare line and one nested in a provider event", () => {
    expect(parseSessionProbe(`noise\n${JSON.stringify(probe)}\n`)).toMatchObject({ ok: false });
    const event = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: `${JSON.stringify(probe)}\n` }] } });
    expect(parseSessionProbe(event)).toMatchObject({ ok: false });
    expect(parseSessionProbe("no probe here")).toBeNull();
    expect(parseSessionProbe(null)).toBeNull();
  });

  it("names one wall per failed check class and none for a passing probe", () => {
    expect(sessionProbeWalls(parseSessionProbe(JSON.stringify(probe))).map((w) => w.wallClass)).toEqual(["preservation"]);
    expect(sessionProbeWalls({ probe: "session-capability/v1", ok: true, checks: [{ name: "workspace_write", ok: true }] })).toEqual([]);
    expect(sessionProbeWalls(null)).toEqual([]);
  });
});

describe("the headless allowance", () => {
  it("allows exactly the probe command prefix and builds an absolute, quoted command", () => {
    expect(headlessClaudeAllowList(["pnpm test"])).toContain(`Bash(${SESSION_PROBE_COMMAND_PREFIX}:*)`);
    expect(sessionProbeCommand("/ws", "/wt")).toBe(`${SESSION_PROBE_COMMAND_PREFIX} --workspace '/ws' --worktree '/wt'`);
  });
});
