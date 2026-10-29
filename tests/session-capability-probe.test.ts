import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { observeSessionCapability, parseSessionProbe, sessionProbeWalls, SESSION_PROBE_TOKEN_BUDGET } from "../src/production/sessionCapability.js";
import { completionCapabilityForReconciliation } from "../src/production/tick.js";
import { exactBashRule, headlessClaudeAllowList } from "../src/sessions/headlessPermissions.js";
import { issueSessionProbe, readSessionCompletionContract, readSessionProbeNonce, SESSION_PROBE_SCRIPT_PATH } from "../src/sessions/sessionProbeCommand.js";
import { sessionLogPath } from "../src/sessions/sessionRecording.js";

function runProbe(workspace: string, worktree: string, workspaceWrite = "required") {
  const started = Date.now();
  const result = spawnSync(process.execPath, [SESSION_PROBE_SCRIPT_PATH, "--workspace", workspace, "--worktree", worktree, "--nonce", "n1", "--contract", "a".repeat(64), "--workspace-write", workspaceWrite], { encoding: "utf8", timeout: 10_000 });
  return { status: result.status, stdout: result.stdout, ms: Date.now() - started };
}

describe("the in-Session capability probe script", () => {
  it.skipIf(process.getuid?.() === 0).each(["database", "journal", "WAL database"] as const)("refuses a genuine SQLite write denial on the %s even when its directory is writable", (denied, context) => {
    const root = mkdtempSync(path.join(tmpdir(), "probe-sqlite-denied-"));
    const workspace = path.join(root, "ws");
    const directory = path.join(workspace, "database");
    mkdirSync(directory, { recursive: true });
    const database = path.join(directory, "arcadia.sqlite3");
    const setup = new Database(database);
    setup.pragma(`journal_mode = ${denied === "WAL database" ? "WAL" : "DELETE"}`);
    setup.exec("CREATE TABLE retained (value TEXT); INSERT INTO retained VALUES ('unchanged')");
    setup.close();
    const journal = `${database}-journal`;
    const protectedFile = denied === "journal" ? journal : database;
    if (denied === "journal") writeFileSync(journal, "");
    chmodSync(protectedFile, 0o444);
    try {
      // Establish the real failure independently of the capability producer:
      // a nearby marker succeeds while SQLite cannot update the real DB.
      const marker = path.join(directory, "directory-is-writable");
      writeFileSync(marker, "yes");
      rmSync(marker);
      const before = readFileSync(database);
      const attempted = new Database(database, { fileMustExist: true });
      let writeFailure: unknown;
      try {
        attempted.exec("BEGIN IMMEDIATE; UPDATE retained SET value = 'rolled-back'");
      } catch (error) {
        writeFailure = error;
      } finally {
        if (attempted.inTransaction) attempted.exec("ROLLBACK");
        attempted.close();
      }
      if (!writeFailure) context.skip("This host did not enforce the fixture's SQLite write denial.");
      expect(writeFailure).toMatchObject({ code: expect.stringMatching(/^SQLITE_(?:READONLY|CANTOPEN|IOERR)/) });
      // SQLite can remove an empty journal while closing the failed attempt.
      if (denied === "journal") {
        if (!existsSync(journal)) writeFileSync(journal, "");
        chmodSync(journal, 0o444);
      }
      const run = runProbe(workspace, root);
      expect(run.status).toBe(1);
      const probe = JSON.parse(run.stdout.trim());
      expect(probe).toMatchObject({ ok: false, checks: expect.arrayContaining([{ name: "workspace_write", ok: false, error: expect.stringMatching(/^SQLITE_(?:READONLY|CANTOPEN|IOERR)/) }]) });
      expect(readFileSync(database)).toEqual(before);
      const command = "node /host/session-capability-probe.mjs --workspace-write required";
      const log = JSON.stringify({ type: "item.completed", item: { type: "command_execution", command, exit_code: run.status, aggregated_output: run.stdout } });
      expect(observeSessionCapability(log, { command, contract: "a".repeat(64), directWorkspaceWrite: "required" }))
        .toMatchObject({ status: "wall", walls: [{ wallClass: "workspace_write" }] });
      for (const file of [database, journal, `${database}-wal`, `${database}-shm`]) {
        if (existsSync(file)) chmodSync(file, 0o644);
      }
      const control = runProbe(workspace, root);
      expect(control.status).toBe(0);
      expect(JSON.parse(control.stdout)).toMatchObject({ ok: true });
      expect(readFileSync(database)).toEqual(before);
    } finally {
      for (const file of [database, journal, `${database}-wal`, `${database}-shm`]) {
        if (existsSync(file)) chmodSync(file, 0o644);
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes on a writable workspace and worktree, prints one JSON line and leaves nothing behind", () => {
    const root = mkdtempSync(path.join(tmpdir(), "probe-ok-"));
    try {
      const workspace = path.join(root, "ws");
      mkdirSync(path.join(workspace, "database"), { recursive: true });
      const database = path.join(workspace, "database", "arcadia.sqlite3");
      const db = new Database(database);
      db.exec("CREATE TABLE retained (value TEXT); INSERT INTO retained VALUES ('unchanged'); PRAGMA user_version = 7");
      db.close();
      const before = readFileSync(database);
      const run = runProbe(workspace, root);
      expect(run.status).toBe(0);
      const lines = run.stdout.trim().split("\n");
      expect(lines).toHaveLength(1);
      const probe = JSON.parse(lines[0]);
      expect(probe).toMatchObject({ probe: "session-capability/v2", contract: "a".repeat(64), ok: true });
      expect(probe.checks.map((c: { name: string }) => c.name)).toEqual(["workspace_write", "host_validation", "preservation"]);
      expect(readdirSync(path.join(workspace, "database"))).toEqual(["arcadia.sqlite3"]);
      expect(readFileSync(database)).toEqual(before);
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
      expect(parseSessionProbe(run.stdout, "a".repeat(64))).toBeNull();
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

  it("records unavailable direct workspace writes without passing them or stopping source-only completion", () => {
    const root = mkdtempSync(path.join(tmpdir(), "probe-source-only-"));
    try {
      const run = runProbe(path.join(root, "missing-workspace"), root, "unavailable");
      expect(run.status).toBe(0);
      const probe = JSON.parse(run.stdout.trim());
      expect(probe).toMatchObject({ ok: true, checks: expect.arrayContaining([{ name: "workspace_write", ok: false, required: false, unavailable: true }]) });
      expect(sessionProbeWalls(probe, "unavailable")).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("does not load SQLite for source-only completion and fails closed when a required probe cannot load it", () => {
    const root = mkdtempSync(path.join(tmpdir(), "probe-no-sqlite-dependency-"));
    try {
      const script = path.join(root, "probe.mjs");
      writeFileSync(script, readFileSync(SESSION_PROBE_SCRIPT_PATH));
      const args = [script, "--workspace", path.join(root, "ws"), "--worktree", root, "--contract", "a".repeat(64), "--workspace-write"];
      const sourceOnly = spawnSync(process.execPath, [...args, "unavailable"], { encoding: "utf8", timeout: 10_000 });
      expect(sourceOnly.status).toBe(0);
      expect(JSON.parse(sourceOnly.stdout)).toMatchObject({ ok: true, checks: expect.arrayContaining([
        { name: "workspace_write", ok: false, required: false, unavailable: true }
      ]) });
      const required = spawnSync(process.execPath, [...args, "required"], { encoding: "utf8", timeout: 10_000 });
      expect(required.status).toBe(1);
      expect(JSON.parse(required.stdout)).toMatchObject({ ok: false, checks: expect.arrayContaining([
        { name: "workspace_write", ok: false, error: expect.stringContaining("Cannot find module 'better-sqlite3'") }
      ]) });
      expect(existsSync(path.join(root, "ws"))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe("parsing the probe from a Session log", () => {
  const contract = "a".repeat(64);
  const command = "node /host/session-capability-probe.mjs --workspace-write unavailable";
  const result = JSON.stringify({ probe: "session-capability/v2", contract, ok: true, checks: [
    { name: "workspace_write", ok: false, required: false, unavailable: true },
    { name: "host_validation", ok: true }, { name: "preservation", ok: true }
  ] });
  it.each(["required", "unavailable"] as const)("rejects explicitly present undefined %s while accepting its absence in direct check objects", field => {
    const malformed = { probe: "session-capability/v2" as const, ok: false, checks: [{ name: "host_validation", ok: false, [field]: undefined }] };
    expect(sessionProbeWalls(malformed)).toEqual([]);
    expect(sessionProbeWalls({ ...malformed, checks: [{ name: "host_validation", ok: false }] }))
      .toMatchObject([{ wallClass: "host_validation" }]);
  });
  it.each(["required", "unavailable"] as const)("refuses present non-Boolean %s on every check through observation and reconciliation transport", field => {
    const root = mkdtempSync(path.join(tmpdir(), "probe-malformed-flags-"));
    try {
      const workspace = path.join(root, "ws");
      const worktree = path.join(root, "worktree");
      mkdirSync(path.join(worktree, ".arcadia", "asks"), { recursive: true });
      const session = { id: "s-flags", packet_id: "packet", packet_sha256: "b".repeat(64), worktree_path: worktree, completion_capability_mode: "source_only" as const };
      const issued = issueSessionProbe({ workspace, sessionId: session.id, packetId: session.packet_id, packetSha256: session.packet_sha256, worktreePath: worktree, directWorkspaceWrite: "unavailable" });
      for (const name of ["workspace_write", "host_validation", "preservation"]) {
        for (const invalid of ["false", 0, null, [], {}]) {
          const output = JSON.parse(result) as { contract: string; checks: Array<Record<string, unknown>> };
          output.contract = issued.contractDigest;
          output.checks.find(check => check.name === name)![field] = invalid;
          const codex = JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: issued.command, exit_code: 0, aggregated_output: JSON.stringify(output) } });
          const claude = [
            JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "probe", name: "Bash", input: { command: issued.command } }] } }),
            JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "probe", content: JSON.stringify(output) }] } })
          ].join("\n");
          const legacyDenial = JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "arcadia agent-ask preview", exit_code: 1,
            aggregated_output: "Error [SQLITE_WORKSPACE_WRITE_DENIED]: attempt to write a readonly database" } });
          for (const providerLog of [codex, claude]) {
            const log = `${providerLog}\n${legacyDenial}`;
            writeFileSync(sessionLogPath(workspace, session.id), log + "\n");
            expect(observeSessionCapability(log, { command: issued.command, contract: issued.contractDigest })).toMatchObject({ status: "unknown" });
            expect(completionCapabilityForReconciliation(workspace, session)).toMatchObject({ sourceCompletionRequired: true, completionCapability: { localAskTransport: "unavailable" } });
          }
        }
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("accepts only a result paired to the exact host-issued invocation", () => {
    const log = JSON.stringify({ type: "item.completed", item: { type: "command_execution", command, exit_code: 0, aggregated_output: result } });
    expect(parseSessionProbe(log, { command, contract })).toMatchObject({ ok: true });
    expect(parseSessionProbe(JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: `${command} --extra`, exit_code: 0, aggregated_output: result } }), { command, contract })).toBeNull();
    expect(parseSessionProbe(JSON.stringify({ type: "item.completed", item: { type: "command_execution", command, exit_code: 0, aggregated_output: result.replace(contract, "b".repeat(64)) } }), { command, contract })).toBeNull();
    expect(parseSessionProbe(result, { command, contract })).toBeNull();
    expect(parseSessionProbe(`${log}\n${log}`, { command, contract })).toBeNull();
    expect(sessionProbeWalls(null)).toEqual([]);
  });

  it("accepts Codex's exact zsh wrapper but no changed wrapped command", () => {
    const wrapped = `/bin/zsh -lc ${JSON.stringify(command)}`;
    const log = JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: wrapped, exit_code: 0, aggregated_output: result } });
    expect(parseSessionProbe(log, { command, contract })).toMatchObject({ ok: true });
    const changed = `/bin/zsh -lc ${JSON.stringify(`${command} --extra`)}`;
    expect(parseSessionProbe(JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: changed, exit_code: 0, aggregated_output: result } }), { command, contract })).toBeNull();
  });

  it("keeps an optional unavailable DB write clear through observation and managed-tick transport", () => {
    const root = mkdtempSync(path.join(tmpdir(), "probe-managed-source-"));
    try {
      const workspace = path.join(root, "ws");
      const worktree = path.join(root, "worktree");
      mkdirSync(path.join(worktree, ".arcadia", "asks"), { recursive: true });
      const session = { id: "s1", packet_id: "packet", packet_sha256: "b".repeat(64), worktree_path: worktree, completion_capability_mode: "source_only" as const };
      const issued = issueSessionProbe({ workspace, sessionId: session.id, packetId: session.packet_id, packetSha256: session.packet_sha256, worktreePath: worktree, directWorkspaceWrite: "unavailable" });
      const output = JSON.stringify({ probe: "session-capability/v2", contract: issued.contractDigest, ok: true, checks: [
        { name: "workspace_write", ok: false, required: false, unavailable: true },
        { name: "host_validation", ok: true }, { name: "preservation", ok: true }
      ] });
      writeFileSync(sessionLogPath(workspace, session.id), JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: issued.command, exit_code: 0, aggregated_output: output } }) + "\n");
      expect(observeSessionCapability(readFileSync(sessionLogPath(workspace, session.id), "utf8"), { command: issued.command, contract: issued.contractDigest, directWorkspaceWrite: "unavailable" }))
        .toMatchObject({ provenance: "session_probe", status: "clear", walls: [] });
      // Tick callers retain only the exact host-issued command and digest;
      // the command itself binds its unavailable requirement.
      expect(observeSessionCapability(readFileSync(sessionLogPath(workspace, session.id), "utf8"), { command: issued.command, contract: issued.contractDigest }))
        .toMatchObject({ provenance: "session_probe", status: "clear", walls: [] });
      expect(completionCapabilityForReconciliation(workspace, session)).toMatchObject({ sourceCompletionRequired: true, completionCapability: { directWorkspaceWrite: "unavailable", localAskTransport: "ready" } });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("does not let probe output mark host validation or preservation optional", () => {
    const root = mkdtempSync(path.join(tmpdir(), "probe-required-host-checks-"));
    try {
      const workspace = path.join(root, "ws");
      const worktree = path.join(root, "worktree");
      mkdirSync(path.join(worktree, ".arcadia", "asks"), { recursive: true });
      const issued = issueSessionProbe({ workspace, sessionId: "s-host", packetId: "packet", packetSha256: "b".repeat(64), worktreePath: worktree, directWorkspaceWrite: "unavailable" });
      for (const name of ["host_validation", "preservation"] as const) {
        const output = JSON.stringify({ probe: "session-capability/v2", contract: issued.contractDigest, ok: true, checks: [
          { name: "workspace_write", ok: false, required: false, unavailable: true },
          { name, ok: false, required: false, unavailable: true },
          { name: name === "host_validation" ? "preservation" : "host_validation", ok: true }
        ] });
        const log = JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: issued.command, exit_code: 0, aggregated_output: output } });
        expect(observeSessionCapability(log, { command: issued.command, contract: issued.contractDigest, directWorkspaceWrite: "unavailable" }))
          .toMatchObject({ status: "wall", walls: [{ wallClass: name }] });
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("fails closed for a persisted source-only Session when its log or contract is absent", () => {
    const root = mkdtempSync(path.join(tmpdir(), "probe-managed-missing-"));
    try {
      const workspace = path.join(root, "ws");
      const worktree = path.join(root, "worktree");
      mkdirSync(path.join(worktree, ".arcadia", "asks"), { recursive: true });
      const session = { id: "s2", packet_id: "packet", packet_sha256: "b".repeat(64), worktree_path: worktree, completion_capability_mode: "source_only" as const };
      const withoutContract = completionCapabilityForReconciliation(workspace, session);
      expect(withoutContract).toEqual({ sourceCompletionRequired: true, completionCapability: undefined });
      issueSessionProbe({ workspace, sessionId: session.id, packetId: session.packet_id, packetSha256: session.packet_sha256, worktreePath: worktree, directWorkspaceWrite: "unavailable" });
      const withoutLog = completionCapabilityForReconciliation(workspace, session);
      expect(withoutLog).toMatchObject({ sourceCompletionRequired: true, completionCapability: { localAskTransport: "unavailable" } });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("keeps legacy Sessions compatible while direct-required Sessions still fail closed", () => {
    const root = mkdtempSync(path.join(tmpdir(), "probe-managed-modes-"));
    try {
      const workspace = path.join(root, "ws");
      const worktree = path.join(root, "worktree");
      mkdirSync(path.join(worktree, ".arcadia", "asks"), { recursive: true });
      const base = { id: "s3", packet_id: "packet", packet_sha256: "b".repeat(64), worktree_path: worktree };
      issueSessionProbe({ workspace, sessionId: base.id, packetId: base.packet_id, packetSha256: base.packet_sha256,
        worktreePath: worktree, directWorkspaceWrite: "required" });
      expect(completionCapabilityForReconciliation(workspace, { ...base, completion_capability_mode: "legacy" })).toEqual({
        sourceCompletionRequired: false, completionCapability: undefined
      });
      expect(completionCapabilityForReconciliation(workspace, { ...base, completion_capability_mode: "direct_required" })).toMatchObject({
        sourceCompletionRequired: true, completionCapability: { directWorkspaceWrite: "required", localAskTransport: "unavailable" }
      });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("refuses a genuine unavailable-write probe when durable direct-required mode disagrees", () => {
    const root = mkdtempSync(path.join(tmpdir(), "probe-direct-mode-mismatch-"));
    try {
      const workspace = path.join(root, "ws");
      const worktree = path.join(root, "worktree");
      mkdirSync(path.join(worktree, ".arcadia", "asks"), { recursive: true });
      const session = { id: "s-mismatch", packet_id: "packet", packet_sha256: "b".repeat(64), worktree_path: worktree, completion_capability_mode: "direct_required" as const };
      const issued = issueSessionProbe({ workspace, sessionId: session.id, packetId: session.packet_id, packetSha256: session.packet_sha256, worktreePath: worktree, directWorkspaceWrite: "unavailable" });
      const output = JSON.stringify({ probe: "session-capability/v2", contract: issued.contractDigest, ok: true, checks: [
        { name: "workspace_write", ok: false, required: false, unavailable: true },
        { name: "host_validation", ok: true }, { name: "preservation", ok: true }
      ] });
      writeFileSync(sessionLogPath(workspace, session.id), JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: issued.command, exit_code: 0, aggregated_output: output } }) + "\n");
      expect(completionCapabilityForReconciliation(workspace, session)).toMatchObject({ sourceCompletionRequired: true,
        completionCapability: { directWorkspaceWrite: "unavailable", localAskTransport: "unavailable" } });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("refuses a genuine required-write probe when durable source-only mode disagrees", () => {
    const root = mkdtempSync(path.join(tmpdir(), "probe-source-mode-mismatch-"));
    try {
      const workspace = path.join(root, "ws");
      const worktree = path.join(root, "worktree");
      mkdirSync(path.join(worktree, ".arcadia", "asks"), { recursive: true });
      const session = { id: "s-source-mismatch", packet_id: "packet", packet_sha256: "b".repeat(64), worktree_path: worktree, completion_capability_mode: "source_only" as const };
      const issued = issueSessionProbe({ workspace, sessionId: session.id, packetId: session.packet_id, packetSha256: session.packet_sha256, worktreePath: worktree, directWorkspaceWrite: "required" });
      const output = JSON.stringify({ probe: "session-capability/v2", contract: issued.contractDigest, ok: true, checks: [
        { name: "workspace_write", ok: true }, { name: "host_validation", ok: true }, { name: "preservation", ok: true }
      ] });
      writeFileSync(sessionLogPath(workspace, session.id), JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: issued.command, exit_code: 0, aggregated_output: output } }) + "\n");
      expect(completionCapabilityForReconciliation(workspace, session)).toMatchObject({ sourceCompletionRequired: true,
        completionCapability: { directWorkspaceWrite: "required", localAskTransport: "unavailable" } });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe("issuing the probe and pinning its allowance", () => {
  it("pins exactly one command string per Session, nonce included, and no other arguments match", () => {
    const root = mkdtempSync(path.join(tmpdir(), "probe-issue-"));
    try {
      const ws = path.join(root, "ws");
      const issued = issueSessionProbe({ workspace: ws, sessionId: "s1", packetId: "packet", packetSha256: "b".repeat(64), worktreePath: "/wt", directWorkspaceWrite: "unavailable" });
      expect(issued.nonce).toMatch(/^[0-9a-f]{32}$/);
      expect(issued.command).toContain(` --nonce ${issued.nonce}`);
      expect(readSessionProbeNonce(ws, "s1")).toBe(issued.nonce);
      expect(readSessionCompletionContract(ws, "s1")).toMatchObject({ sessionId: "s1", packetId: "packet", packetSha256: "b".repeat(64), requirements: { directWorkspaceWrite: "unavailable", localAskTransport: "required" } });
      // Rotated per launch: a resume gets a fresh nonce, and the recorded one follows it.
      const resumed = issueSessionProbe({ workspace: ws, sessionId: "s1", packetId: "packet", packetSha256: "b".repeat(64), worktreePath: "/wt", directWorkspaceWrite: "unavailable" });
      expect(resumed.nonce).not.toBe(issued.nonce);
      expect(readSessionProbeNonce(ws, "s1")).toBe(resumed.nonce);
      expect(resumed.contractDigest).not.toBe(issued.contractDigest);
      expect(issued.command).not.toContain("--result");
      expect(issued.command).toContain("--workspace-write unavailable");
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
      expect(() => issueSessionProbe({ workspace: root, sessionId: "s", packetId: "packet", packetSha256: "b".repeat(64), directWorkspaceWrite: "unavailable", worktreePath: "/wt", scriptPath: path.join(root, "absent.mjs") }))
        .toThrow(/probe script is missing/);
      expect(existsSync(SESSION_PROBE_SCRIPT_PATH)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ships the probe in the packaged build", () => {
    const scripts = JSON.parse(readFileSync(path.resolve(path.dirname(SESSION_PROBE_SCRIPT_PATH), "../package.json"), "utf8")).scripts as Record<string, string>;
    // `build` is lint plus `build:artifacts`; CI runs the latter so lint runs once (in its own job).
    expect(scripts.build).toContain("pnpm build:artifacts");
    const build = scripts["build:artifacts"];
    expect(build).toContain("scripts/session-capability-probe.mjs");
    expect(build).toMatch(/cp [^&]*scripts\/session-capability-probe\.mjs[^&]* dist\/scripts\//);
  });
});
