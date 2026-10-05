import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArcadiaError } from "../src/cli/errors.js";
import type { CommandSuccess } from "../src/cli/response.js";
import { runInitCommand } from "../src/commands/init.js";
import { runProductionFreezeCheckCommand } from "../src/commands/production.js";
import {
  runGoBrokerEnsureCommand,
  runGoBrokerInstallCommand,
  type GoBrokerInstallData,
  type GoBrokerStatusData
} from "../src/commands/goBrokerInstall.js";
import { withDatabase } from "../src/db/connection.js";
import {
  FREEZE_OPERATIONS,
  FREEZE_OVERRIDE_ENV,
  assertRehearsalFreezeAllows
} from "../src/production/freezeWindow.js";
import {
  activateProduction,
  deactivateProduction,
  fingerprintProductionScope,
  normalizeProductionScope
} from "../src/production/policy.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const roots: string[] = [];
let root: string;
let workspace: string;
let home: string;

function temp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}

beforeEach(() => {
  root = temp("arcadia-freeze-");
  home = path.join(root, "home");
  mkdirSync(home);
  workspace = path.join(root, "workspace");
  initWorkspace(workspace);
  // Every resolution stays inside the temp root: never the operator's real
  // user config, workspace or HOME.
  vi.stubEnv("ARCADIA_CONFIG_PATH", path.join(root, "no-user-config.json"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("ARCADIA_WORKSPACE", workspace);
  vi.stubEnv(FREEZE_OVERRIDE_ENV, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const scope = normalizeProductionScope({
  intent: "Freeze-window fixture rehearsal.",
  projects: ["fixture"],
  plans: ["fixture/rehearsal"],
  actions: ["fixture/one"],
  providers: ["claude-code-cli"],
  maxConcurrentSessions: 1,
  mechanicalTransitions: []
});

function activate(target = workspace): void {
  withDatabase(target, (db) => activateProduction(db, {
    requestId: "freeze-activate", scope, scopeFingerprint: fingerprintProductionScope(scope), grantedBy: "operator"
  }));
}

/** The G8 shape: a successful activation, then the terminal production Off receipt. */
function activateThenOff(target = workspace): void {
  activate(target);
  withDatabase(target, (db) => deactivateProduction(db, { requestId: "freeze-terminal-off", reason: "rehearsal finished" }));
}

function corruptDatabase(target = workspace): void {
  writeFileSync(getWorkspacePaths(target).databaseFile, "this is not a sqlite database");
}

function refusal(run: () => unknown): ArcadiaError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ArcadiaError);
    return error as ArcadiaError;
  }
  throw new Error("expected a refusal");
}

describe("the freeze-window decision (read-only production status)", () => {
  it.each(FREEZE_OPERATIONS)("refuses %s while Active with the named reason and the exact supported alternative", (operation) => {
    activate();
    const error = refusal(() => assertRehearsalFreezeAllows(operation));
    expect(error.code).toBe("PRODUCTION_ACTIVE_FREEZE");
    expect(error.details).toMatchObject({ operation, reason: "production_active_freeze", workspace, override: `${FREEZE_OVERRIDE_ENV}=<reason>` });
    expect(String(error.details.alternative)).toMatch(operation.startsWith("go-broker") ? /arcadia go-broker status/ : /scripts\/services\.sh status/);
    expect(String(error.details.alternative)).toMatch(operation.startsWith("go-broker") ? /reinstall-go-broker\.sh/ : /recover-arcadia-host-services\.sh/);
  });

  it.each(FREEZE_OPERATIONS)("allows %s when Inactive and after the terminal Off receipt", (operation) => {
    expect(assertRehearsalFreezeAllows(operation)).toMatchObject({ operation, state: "inactive", decision: "allowed", policyRevision: 0 });
    activateThenOff();
    const off = assertRehearsalFreezeAllows(operation);
    expect(off).toMatchObject({ state: "inactive", decision: "allowed", policyRevision: 2 });
    expect(off.override).toBeUndefined();
  });

  it.each(FREEZE_OPERATIONS)("lets the inline override bypass an Active refusal for %s and records its reason", (operation) => {
    activate();
    const decision = assertRehearsalFreezeAllows(operation, { env: { ...process.env, [FREEZE_OVERRIDE_ENV]: "operator hotfix #940" } });
    expect(decision).toMatchObject({ state: "active", decision: "overridden", override: { env: FREEZE_OVERRIDE_ENV, reason: "operator hotfix #940" } });
    expect(decision.warning).toContain("operator hotfix #940");
  });

  it.each(FREEZE_OPERATIONS)("fails closed for %s when status cannot be read, unless overridden", (operation) => {
    corruptDatabase();
    const error = refusal(() => assertRehearsalFreezeAllows(operation));
    expect(error.code).toBe("PRODUCTION_FREEZE_UNVERIFIED");
    expect(error.details.reason).toBe("production_status_unreadable");
    const overridden = assertRehearsalFreezeAllows(operation, { env: { ...process.env, [FREEZE_OVERRIDE_ENV]: "db rebuild" } });
    expect(overridden).toMatchObject({ state: "unreadable", decision: "overridden", override: { reason: "db rebuild" } });
    expect(overridden.unreadableReason).toBeTruthy();
  });

  it("treats no configured or resolvable workspace as not Active, with a one-line receipt note (first-time setup)", () => {
    vi.stubEnv("ARCADIA_WORKSPACE", "");
    const isolated = temp("arcadia-freeze-cwd-");
    for (const operation of FREEZE_OPERATIONS) {
      const decision = assertRehearsalFreezeAllows(operation, { cwd: isolated });
      expect(decision).toMatchObject({ operation, workspace: null, state: "no_workspace", decision: "allowed" });
      expect(decision.note).toMatch(/no Arcadia workspace is configured or resolvable/);
      expect(decision.warning).toBeUndefined();
    }
    // First-time `go-broker ensure` proceeds and carries the note in its receipt.
    const { repository, revision } = tinyGitRepo(false);
    const ensured = runGoBrokerEnsureCommand(
      { repository },
      vi.fn().mockReturnValue({ ok: true, command: "go-broker.status", artifacts: [], warnings: [], data: { ready: true, revision } }),
      vi.fn()
    );
    expect(ensured.data.freeze).toMatchObject({ state: "no_workspace", decision: "allowed" });
    expect(ensured.warnings).toEqual([expect.stringContaining("no Arcadia workspace is configured or resolvable")]);
    // First-time `go-broker install` passes the freeze check and reaches its next step.
    expect(refusal(() => runGoBrokerInstallCommand({ repository: tinyGitRepo(true).repository, home })).message).toContain("clean, committed snapshot");
  });

  it("keeps failing closed when a workspace resolves but its database or policy cannot be read", () => {
    rmSync(getWorkspacePaths(workspace).databaseFile);
    for (const operation of FREEZE_OPERATIONS) {
      const error = refusal(() => assertRehearsalFreezeAllows(operation));
      expect(error.code).toBe("PRODUCTION_FREEZE_UNVERIFIED");
      expect(error.details.workspace).toBe(workspace);
    }
    initWorkspace(workspace);
    withDatabase(workspace, (db) => db.exec("DROP TABLE production_policy"));
    expect(refusal(() => assertRehearsalFreezeAllows("go-broker.ensure")).code).toBe("PRODUCTION_FREEZE_UNVERIFIED");
  });

  it("leaves an experiment workspace on its existing guard path", () => {
    const experiment = path.join(root, "workspaces", "exp-freeze");
    runInitCommand(experiment, { profile: "experiment" });
    vi.stubEnv("ARCADIA_WORKSPACE", experiment);
    expect(refusal(() => runGoBrokerInstallCommand({ repository: tinyGitRepo(false).repository, home })).code).toBe("EXPERIMENT_WORKSPACE_REFUSED");
    expect(assertRehearsalFreezeAllows("services.restart")).toMatchObject({ workspace: experiment, state: "inactive", decision: "allowed" });
  });

  it("`production freeze-check` reports the same decision and rejects an unknown operation", () => {
    expect(runProductionFreezeCheckCommand({ operation: "services.restart" }).data).toMatchObject({ decision: "allowed", state: "inactive" });
    activate();
    expect(refusal(() => runProductionFreezeCheckCommand({ operation: "services.stop" })).code).toBe("PRODUCTION_ACTIVE_FREEZE");
    vi.stubEnv(FREEZE_OVERRIDE_ENV, "recorded reason");
    const overridden = runProductionFreezeCheckCommand({ operation: "services.stop" });
    expect(overridden.warnings.join("\n")).toContain("recorded reason");
    expect(refusal(() => runProductionFreezeCheckCommand({ operation: "worker.start" })).code).toBe("VALIDATION_ERROR");
  });
});

function tinyGitRepo(dirty: boolean): { repository: string; revision: string } {
  const repository = temp("arcadia-freeze-repo-");
  const run = (...args: string[]) => execFileSync("git", args, { cwd: repository });
  run("init", "--quiet");
  run("-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "--quiet", "--allow-empty", "-m", "initial");
  if (dirty) writeFileSync(path.join(repository, "untracked.txt"), "dirty\n");
  return { repository, revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository }).toString().trim() };
}

describe("`go-broker install` refuses inside the window before it installs anything", () => {
  // A dirty fixture repository makes the step after the freeze check refuse
  // deterministically, so "proceeds" is observable without a real install.
  function install(): unknown {
    return runGoBrokerInstallCommand({ repository: tinyGitRepo(true).repository, home });
  }

  it("refuses while Active and writes nothing under HOME", () => {
    activate();
    expect(refusal(install).code).toBe("PRODUCTION_ACTIVE_FREEZE");
    expect(existsSync(path.join(home, ".local"))).toBe(false);
  });

  it("proceeds past the freeze check when Inactive or Off", () => {
    expect(refusal(install).message).toContain("clean, committed snapshot");
    activateThenOff();
    expect(refusal(install).message).toContain("clean, committed snapshot");
  });

  it("proceeds under the override and records its reason on stderr", () => {
    activate();
    vi.stubEnv(FREEZE_OVERRIDE_ENV, "install the Off-path fix");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(refusal(install).message).toContain("clean, committed snapshot");
    expect(stderr.mock.calls.map((call) => String(call[0])).join("")).toContain(`${FREEZE_OVERRIDE_ENV}=install the Off-path fix`);
  });

  it("fails closed when status cannot be read", () => {
    corruptDatabase();
    expect(refusal(install).code).toBe("PRODUCTION_FREEZE_UNVERIFIED");
  });
});

describe("`go-broker ensure` refuses inside the window before status or install", () => {
  const readyStatus = (revision: string): CommandSuccess<GoBrokerStatusData> => ({
    ok: true, command: "go-broker.status", artifacts: [], warnings: [],
    data: { ready: true, revision } as GoBrokerStatusData
  });
  const installed: CommandSuccess<GoBrokerInstallData> = {
    ok: true, command: "go-broker.install", artifacts: [], warnings: [], data: { revision: "x" } as GoBrokerInstallData
  };

  it("refuses while Active without calling status or install", () => {
    activate();
    const { repository } = tinyGitRepo(false);
    const statusRunner = vi.fn();
    const installRunner = vi.fn();
    expect(refusal(() => runGoBrokerEnsureCommand({ repository }, statusRunner, installRunner)).code).toBe("PRODUCTION_ACTIVE_FREEZE");
    expect(statusRunner).not.toHaveBeenCalled();
    expect(installRunner).not.toHaveBeenCalled();
  });

  it("proceeds when Inactive and after the terminal Off receipt", () => {
    const { repository, revision } = tinyGitRepo(false);
    const installRunner = vi.fn().mockReturnValue(installed);
    const stale = runGoBrokerEnsureCommand({ repository }, vi.fn().mockReturnValue(readyStatus("old")), installRunner);
    expect(stale.data).toMatchObject({ action: "installed", freeze: { decision: "allowed", state: "inactive" } });
    activateThenOff();
    const current = runGoBrokerEnsureCommand({ repository }, vi.fn().mockReturnValue(readyStatus(revision)), vi.fn());
    expect(current.data).toMatchObject({ action: "skipped", freeze: { decision: "allowed", state: "inactive", policyRevision: 2 } });
  });

  it("proceeds under the override and records the reason in its receipt", () => {
    activate();
    vi.stubEnv(FREEZE_OVERRIDE_ENV, "operator-approved broker hotfix");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { repository, revision } = tinyGitRepo(false);
    const response = runGoBrokerEnsureCommand({ repository }, vi.fn().mockReturnValue(readyStatus(revision)), vi.fn());
    expect(response.data.freeze).toMatchObject({ decision: "overridden", override: { reason: "operator-approved broker hotfix" } });
    expect(response.warnings.join("\n")).toContain("operator-approved broker hotfix");
  });

  it("fails closed when status cannot be read", () => {
    corruptDatabase();
    const { repository } = tinyGitRepo(false);
    const installRunner = vi.fn();
    expect(refusal(() => runGoBrokerEnsureCommand({ repository }, vi.fn(), installRunner)).code).toBe("PRODUCTION_FREEZE_UNVERIFIED");
    expect(installRunner).not.toHaveBeenCalled();
  });
});

/**
 * The real scripts/services.sh against the real CLI freeze check. A `pnpm`
 * shim runs only `arcadia production freeze-check` through this checkout's CLI
 * and records every other call (the post-restart `go-broker ensure`) without
 * running it, and the restart implementation is a stub that records its verb.
 */
describe.skipIf(os.platform() !== "darwin")("scripts/services.sh restart|stop inside the window", () => {
  function services(action: "restart" | "stop", env: Record<string, string> = {}, options: { brokenCli?: boolean } = {}) {
    const bin = path.join(root, "bin");
    mkdirSync(bin, { recursive: true });
    const calls = path.join(root, "impl-calls");
    const pnpmCalls = path.join(root, "pnpm-calls");
    writeFileSync(calls, "");
    writeFileSync(pnpmCalls, "");
    const impl = path.join(bin, "impl.sh");
    writeFileSync(impl, `#!/usr/bin/env bash\necho "$1" >> ${JSON.stringify(calls)}\nexit 0\n`);
    chmodSync(impl, 0o755);
    writeFileSync(path.join(bin, "pnpm"), [
      "#!/usr/bin/env bash",
      'args=("$@"); [[ "${args[0]}" == -s ]] && args=("${args[@]:1}")',
      options.brokenCli ? "exit 127" : "",
      'if [[ "${args[0]}" == arcadia && "${args[1]}" == production && "${args[2]}" == freeze-check ]]; then',
      `  exec ${JSON.stringify(process.execPath)} --import tsx ${JSON.stringify(path.join(repoRoot, "src", "cli.ts"))} "\${args[@]:1}"`,
      "fi",
      `echo "\${args[*]}" >> ${JSON.stringify(pnpmCalls)}`,
      "exit 0",
      ""
    ].join("\n"));
    chmodSync(path.join(bin, "pnpm"), 0o755);
    const result = spawnSync("bash", [path.join(repoRoot, "scripts", "services.sh"), action], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        HOME: home,
        ARCADIA_CONFIG_PATH: path.join(root, "no-user-config.json"),
        ARCADIA_WORKSPACE: workspace,
        ARCADIA_RESTART_SCRIPT: impl,
        ARCADIA_RESTART_RETRY_DELAY: "0",
        ARCADIA_FREEZE_OVERRIDE: "",
        ...env
      }
    });
    return { ...result, implCalls: readFileSync(calls, "utf8").trim(), pnpmCalls: readFileSync(pnpmCalls, "utf8").trim() };
  }

  it.each(["restart", "stop"] as const)("refuses %s while Active before touching any service", (action) => {
    activate();
    const result = services(action);
    expect(result.status, result.stderr).toBe(3);
    expect(result.stderr).toContain("production_active_freeze");
    expect(result.stderr).toContain("PRODUCTION_ACTIVE_FREEZE");
    expect(result.stderr).toContain("scripts/services.sh status");
    expect(result.implCalls).toBe("");
    expect(result.pnpmCalls).toBe("");
  });

  it.each(["restart", "stop"] as const)("runs %s when Inactive", (action) => {
    const result = services(action);
    expect(result.status, result.stderr).toBe(0);
    expect(result.implCalls).toBe(action);
  });

  it("runs G8's Off-first restart: activation, terminal Off receipt, then restart and its go-broker ensure", () => {
    activateThenOff();
    const result = services("restart");
    expect(result.status, result.stderr).toBe(0);
    expect(result.implCalls).toBe("restart");
    expect(result.pnpmCalls).toBe("arcadia go-broker ensure");
  });

  it("proceeds under the override and prints the recorded reason", () => {
    activate();
    const result = services("restart", { ARCADIA_FREEZE_OVERRIDE: "operator-approved restart" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("ARCADIA_FREEZE_OVERRIDE=operator-approved restart");
    expect(result.stderr).toContain('"decision": "overridden"');
    expect(result.implCalls).toBe("restart");
  });

  it("fails open with a warning when production status cannot be read", () => {
    corruptDatabase();
    const unreadable = services("restart");
    expect(unreadable.status, unreadable.stderr).toBe(0);
    expect(unreadable.stderr).toContain("could not read managed production status");
    expect(unreadable.implCalls).toBe("restart");
    const broken = services("stop", {}, { brokenCli: true });
    expect(broken.status, broken.stderr).toBe(0);
    expect(broken.stderr).toContain("fail open");
    expect(broken.implCalls).toBe("stop");
  });
});

describe("G8's pinned restart path stays byte-identical", () => {
  it("leaves recover-arcadia-host-services and its descriptor at the bytes G8 pins", () => {
    const library = path.join(repoRoot, "artifacts", "generated", "operator-scripts");
    const g8 = readFileSync(path.join(library, "restore-terminal-off-three-action-rehearsal-2026-10-04.sh"), "utf8");
    const digest = (file: string) => createHash("sha256").update(readFileSync(path.join(library, file))).digest("hex");
    expect(g8).toContain(`RECOVER_SCRIPT_SHA256="${digest("recover-arcadia-host-services.sh")}"`);
    expect(g8).toContain(`RECOVER_DESCRIPTOR_SHA256="${digest("recover-arcadia-host-services.json")}"`);
  });
});
