import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSessionProbe, sessionProbeWalls, SESSION_PROBE_TOKEN_BUDGET } from "../src/production/sessionCapability.js";
import { exactBashRule, headlessClaudeAllowList } from "../src/sessions/headlessPermissions.js";
import { issueSessionProbe, readSessionProbeNonce, SESSION_PROBE_SCRIPT_PATH } from "../src/sessions/sessionProbeCommand.js";

function runProbe(workspace: string, worktree: string) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [SESSION_PROBE_SCRIPT_PATH, "--workspace", workspace, "--worktree", worktree, "--nonce", "n1"], { encoding: "utf8", timeout: 10_000 });
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
      const walls = sessionProbeWalls(parseSessionProbe(run.stdout, "n1"));
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
  const NONCE = "0123456789abcdef0123456789abcdef";
  const bad = { probe: "session-capability/v1", nonce: NONCE, ok: false, checks: [{ name: "preservation", ok: false, error: "EACCES" }, { name: "host_validation", ok: true }], ms: 5 };
  const good = { ...bad, ok: true, checks: [{ name: "preservation", ok: true }] };

  it("finds a bare line and one nested in a provider event", () => {
    expect(parseSessionProbe(`noise\n${JSON.stringify(bad)}\n`, NONCE)).toMatchObject({ ok: false });
    const event = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: `${JSON.stringify(bad)}\n` }] } });
    expect(parseSessionProbe(event, NONCE)).toMatchObject({ ok: false });
    expect(parseSessionProbe("no probe here", NONCE)).toBeNull();
    expect(parseSessionProbe(null, NONCE)).toBeNull();
  });

  it("ignores a probe line with the wrong nonce, and every line when no nonce was issued", () => {
    const forged = JSON.stringify({ ...bad, nonce: "ffffffffffffffffffffffffffffffff" });
    expect(parseSessionProbe(forged, NONCE)).toBeNull();
    expect(parseSessionProbe(JSON.stringify(bad), null)).toBeNull();
    // A probe-looking line in a cat'd file (the repo's own test file) carries no valid nonce.
    const catted = JSON.stringify({ type: "user", message: { content: `const probe = { probe: "session-capability/v1", ok: false, checks: [] }\n${forged}\n` } });
    expect(sessionProbeWalls(parseSessionProbe(`${catted}\n${NONCE}`, NONCE))).toEqual([]);
  });

  it("lets the first failure win over a later spoofed passing line, and a pass stand when nothing failed", () => {
    expect(parseSessionProbe(`${JSON.stringify(bad)}\n${JSON.stringify(good)}\n`, NONCE)).toMatchObject({ ok: false });
    expect(parseSessionProbe(`${JSON.stringify(good)}\n`, NONCE)).toMatchObject({ ok: true });
  });

  it("names one wall per failed check class and none for a passing probe", () => {
    expect(sessionProbeWalls(parseSessionProbe(JSON.stringify(bad), NONCE)).map((w) => w.wallClass)).toEqual(["preservation"]);
    expect(sessionProbeWalls({ probe: "session-capability/v1", ok: true, checks: [{ name: "workspace_write", ok: true }] })).toEqual([]);
    expect(sessionProbeWalls(null)).toEqual([]);
  });
});

describe("issuing the probe and pinning its allowance", () => {
  it("pins exactly one command string per Session, nonce included, and no other arguments match", () => {
    const root = mkdtempSync(path.join(tmpdir(), "probe-issue-"));
    try {
      const ws = path.join(root, "ws");
      const issued = issueSessionProbe({ workspace: ws, sessionId: "s1", worktreePath: "/wt" });
      expect(issued.nonce).toMatch(/^[0-9a-f]{32}$/);
      expect(issued.command).toContain(` --nonce ${issued.nonce}`);
      expect(readSessionProbeNonce(ws, "s1")).toBe(issued.nonce);
      // Rotated per launch: a resume gets a fresh nonce, and the recorded one follows it.
      const resumed = issueSessionProbe({ workspace: ws, sessionId: "s1", worktreePath: "/wt" });
      expect(resumed.nonce).not.toBe(issued.nonce);
      expect(readSessionProbeNonce(ws, "s1")).toBe(resumed.nonce);
      const stale = JSON.stringify({ probe: "session-capability/v1", nonce: issued.nonce, ok: false, checks: [{ name: "workspace_write", ok: false }] });
      const fresh = JSON.stringify({ probe: "session-capability/v1", nonce: resumed.nonce, ok: true, checks: [{ name: "workspace_write", ok: true }] });
      // Launch 1 failed, the operator fixed the sandbox, launch 2 passed: no wall.
      expect(sessionProbeWalls(parseSessionProbe(`${stale}\n${fresh}\n`, resumed.nonce))).toEqual([]);
      expect(sessionProbeWalls(parseSessionProbe(`${stale}\n`, resumed.nonce))).toEqual([]);
      expect(sessionProbeWalls(parseSessionProbe(`${stale}\n`, issued.nonce))).toHaveLength(1);
      expect(issueSessionProbe({ workspace: ws, sessionId: "s2", worktreePath: "/wt" }).nonce).not.toBe(issued.nonce);
      const allow = headlessClaudeAllowList(["pnpm test"], issued.command);
      expect(allow).toContain(exactBashRule(issued.command));
      expect(allow.filter((rule) => rule.includes("session-capability-probe"))).toEqual([exactBashRule(issued.command)]);
      expect(exactBashRule(issued.command)).not.toContain(":*");
      expect(allow).not.toContain(exactBashRule(`${issued.command} --nonce other`));
      expect(headlessClaudeAllowList(["pnpm test"]).some((rule) => rule.includes("session-capability-probe"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses the launch with a named remedy when the probe script is missing (fail closed)", () => {
    const root = mkdtempSync(path.join(tmpdir(), "probe-missing-"));
    try {
      expect(() => issueSessionProbe({ workspace: root, sessionId: "s", worktreePath: "/wt", scriptPath: path.join(root, "absent.mjs") }))
        .toThrow(/probe script is missing/);
      expect(existsSync(SESSION_PROBE_SCRIPT_PATH)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ships the probe in the packaged build", () => {
    const build = JSON.parse(readFileSync(path.resolve(path.dirname(SESSION_PROBE_SCRIPT_PATH), "../package.json"), "utf8")).scripts.build as string;
    expect(build).toContain("scripts/session-capability-probe.mjs");
    expect(build).toMatch(/cp [^&]*scripts\/session-capability-probe\.mjs[^&]* dist\/scripts\//);
  });
});
