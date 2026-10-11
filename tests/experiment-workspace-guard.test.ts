import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig as loadDiscordBotConfig } from "../apps/discord-bot/src/config.js";
import { activityErrorCode } from "../src/activity/errorCodes.js";
import { recordActivityEvent } from "../src/activity/repository.js";
import { buildProgram } from "../src/cli.js";
import { ArcadiaError, normalizeError, validationError } from "../src/cli/errors.js";
import { runInitCommand } from "../src/commands/init.js";
import { runWorkerInstallCommand } from "../src/commands/worker.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { applyInitialSchema } from "../src/db/schema.js";
import { assertClean } from "../src/git/worktrees.js";
import { readExperimentWorkspace, setDefaultWorkspace } from "../src/workspace/config.js";
import {
  COMMAND_CLASSIFICATION,
  evaluateCommandGuard,
  GUARDED_OPERATIONS,
  listActionCommands
} from "../src/workspace/experimentGuard.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { compareAttributedFields, compareLeakSnapshots, takeLeakSnapshot } from "../src/workspace/leakCheck.js";

const roots: string[] = [];
let root: string;
let live: string;
let experiment: string;
let userConfig: string;
let home: string;

function makeRoot(): string {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-exp-guard-")));
  roots.push(dir);
  return dir;
}

beforeEach(() => {
  root = makeRoot();
  home = path.join(root, "home");
  mkdirSync(home, { recursive: true });
  userConfig = path.join(root, "user-config.json");
  live = path.join(root, "live");
  initWorkspace(live);
  writeFileSync(userConfig, JSON.stringify({ defaultWorkspace: live }));
  // Every resolution in this file stays inside the temp root: never the
  // operator's real user config, workspace or HOME.
  vi.stubEnv("ARCADIA_CONFIG_PATH", userConfig);
  vi.stubEnv("HOME", home);
  vi.stubEnv("ARCADIA_WORKSPACE", "");
  experiment = path.join(root, "workspaces", "exp-claude-20261004");
  runInitCommand(experiment, { profile: "experiment" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function projectCount(workspace: string): number {
  return withDatabase(workspace, (db) => (db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }).count);
}

function registerProject(workspace: string, name: string, repoPath: string): void {
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name, mission: "Fixture", goal: "Fixture", status: "active",
      currentMilestone: "Fixture", nextAction: "Fixture", workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath });
  });
}

type CliOutcome = { thrown: unknown } | { output: { ok: boolean; data?: any; error?: { code: string; message: string; details?: any } } };

async function runCli(args: string[], json = true): Promise<CliOutcome> {
  let stdout = "";
  let stderr = "";
  const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { stdout += String(chunk); return true; });
  const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => { stderr += String(chunk); return true; });
  try {
    await buildProgram().parseAsync(["node", "arcadia", ...args, ...(json ? ["--json"] : [])]);
  } catch (error) {
    return { thrown: error };
  } finally {
    out.mockRestore();
    err.mockRestore();
    process.exitCode = undefined;
  }
  return { output: JSON.parse(stdout.trim() || stderr.trim()) };
}

function expectRefused(outcome: CliOutcome, operation: string): ArcadiaError {
  expect("thrown" in outcome, JSON.stringify(outcome)).toBe(true);
  const error = (outcome as { thrown: unknown }).thrown as ArcadiaError;
  expect(error).toBeInstanceOf(ArcadiaError);
  expect(error.code).toBe("EXPERIMENT_WORKSPACE_REFUSED");
  expect(error.details.operation).toBe(operation);
  expect(String(error.details.reason)).not.toBe("");
  expect(String(error.details.alternative)).not.toBe("");
  return error;
}

function expectNotRefused(outcome: CliOutcome): void {
  if ("thrown" in outcome) {
    expect((outcome.thrown as ArcadiaError).code).not.toBe("EXPERIMENT_WORKSPACE_REFUSED");
    return;
  }
  expect(outcome.output.error?.code).not.toBe("EXPERIMENT_WORKSPACE_REFUSED");
}

describe("init --profile experiment", () => {
  it("writes the experiment flag with an allowed repository root inside the workspace and seeds nothing", () => {
    const config = JSON.parse(readFileSync(path.join(experiment, "config", "arcadia.json"), "utf8"));
    expect(config.experiment).toEqual({ enabled: true, allowedRepoRoot: "projects", decision: "0082" });
    expect(readExperimentWorkspace(experiment)).toEqual({
      workspacePath: experiment,
      allowedRepoRoot: path.join(experiment, "projects")
    });
    expect(existsSync(path.join(experiment, "projects"))).toBe(true);
    expect(projectCount(experiment)).toBe(0);
    expect(readExperimentWorkspace(live)).toBeNull();
  });

  it("refuses the live workspace's name in any case, before creating anything", () => {
    for (const name of ["martianrover", "MartianRover"]) {
      const target = path.join(root, "elsewhere", name);
      expect(() => runInitCommand(target, { profile: "experiment" })).toThrow(/never be named martianrover/);
      expect(existsSync(target)).toBe(false);
    }
  });

  it("refuses any existing workspace or database", () => {
    expect(() => runInitCommand(live, { profile: "experiment" })).toThrow(/must be created fresh/);
    const databaseOnly = path.join(root, "database-only");
    mkdirSync(path.join(databaseOnly, "database"), { recursive: true });
    writeFileSync(path.join(databaseOnly, "database", "arcadia.sqlite3"), "");
    expect(() => runInitCommand(databaseOnly, { profile: "experiment" })).toThrow(/must be created fresh/);
    expect(readExperimentWorkspace(live)).toBeNull();
  });

  it("refuses a target nested inside any existing workspace", () => {
    const nested = path.join(live, "nested", "exp-x");
    expect(() => runInitCommand(nested, { profile: "experiment" })).toThrow(/inside another workspace/);
    expect(existsSync(nested)).toBe(false);
  });

  it("never seeds the real Arcadia Project, even when asked later", () => {
    expect(() => runInitCommand(experiment, { profile: "arcadia" })).toThrow(/arcadia-project.seed/);
    expect(projectCount(experiment)).toBe(0);
  });

  it("refuses to disable the flag by hand", () => {
    const configFile = path.join(experiment, "config", "arcadia.json");
    const config = JSON.parse(readFileSync(configFile, "utf8"));
    writeFileSync(configFile, JSON.stringify({ ...config, experiment: { enabled: false, allowedRepoRoot: "projects" } }));
    expect(() => readExperimentWorkspace(experiment)).toThrow(/experiment.enabled must be true/);
    writeFileSync(configFile, JSON.stringify({ ...config, experiment: { enabled: true, allowedRepoRoot: "../outside" } }));
    expect(() => readExperimentWorkspace(experiment)).toThrow(/allowedRepoRoot/);
  });
});

describe("config set defaultWorkspace", () => {
  it("refuses an experiment workspace and leaves the user config unchanged", async () => {
    const before = readFileSync(userConfig, "utf8");
    expect(() => setDefaultWorkspace(experiment)).toThrow(/can never be the default workspace/);
    const outcome = await runCli(["config", "set", "defaultWorkspace", experiment]);
    expect("output" in outcome && outcome.output.error?.code).toBe("VALIDATION_ERROR");
    expect(readFileSync(userConfig, "utf8")).toBe(before);
  });

  it("is itself guarded while an experiment workspace is resolved", async () => {
    vi.stubEnv("ARCADIA_WORKSPACE", experiment);
    const before = readFileSync(userConfig, "utf8");
    expectRefused(await runCli(["config", "set", "defaultWorkspace", live]), "config set defaultWorkspace");
    expect(readFileSync(userConfig, "utf8")).toBe(before);
  });

  it("can still repair a default that a hand edit pointed at an experiment", async () => {
    writeFileSync(userConfig, JSON.stringify({ defaultWorkspace: experiment }));
    expectNotRefused(await runCli(["config", "set", "defaultWorkspace", live]));
    expect(JSON.parse(readFileSync(userConfig, "utf8")).defaultWorkspace).toBe(live);
  });

  it("still sets an ordinary workspace", () => {
    const other = path.join(root, "other");
    initWorkspace(other);
    expect(setDefaultWorkspace(other).defaultWorkspace).toBe(other);
  });
});

describe("Project repository containment", () => {
  it("accepts a repository inside the allowed root", () => {
    registerProject(experiment, "Fixture", path.join(experiment, "projects", "fixture"));
    expect(projectCount(experiment)).toBe(1);
  });

  it("refuses a repository outside the allowed root, including the root itself", () => {
    for (const repo of [path.join(root, "outside"), path.join(experiment, "projects"), path.join(experiment, "notes", "repo")]) {
      expect(() => registerProject(experiment, `Outside ${repo}`, repo)).toThrow(/only repositories inside/);
    }
  });

  it("follows a dangling symlink instead of reading it as a new path inside the root", () => {
    const link = path.join(experiment, "projects", "escape");
    symlinkSync(path.join(root, "outside-not-yet-created"), link);
    expect(() => registerProject(experiment, "Escape", link)).toThrow(/only repositories inside/);
    expect(() => registerProject(experiment, "Escape child", path.join(link, "repo"))).toThrow(/only repositories inside/);
  });

  it("applies the same containment to capability repository paths", () => {
    for (const [key, option] of [["rebuster configure", "repoPath"], ["blog configure-site", "contentRepoPath"]] as const) {
      expect(evaluateCommandGuard(key, { workspace: experiment, [option]: path.join(root, "outside") }), key).not.toBeNull();
      expect(evaluateCommandGuard(key, { workspace: experiment, [option]: path.join(experiment, "projects", "fixture") }), key).toBeNull();
      expect(evaluateCommandGuard(key, { workspace: experiment }), key).toBeNull();
    }
  });

  it("refuses a repository the live workspace already registered", () => {
    const shared = path.join(experiment, "projects", "shared");
    mkdirSync(shared, { recursive: true });
    registerProject(live, "Live", shared);
    expect(() => registerProject(experiment, "Shared", shared)).toThrow(/already registered in the live workspace/);
  });

  it("leaves an ordinary workspace free to register any path", () => {
    registerProject(live, "Anywhere", path.join(root, "anywhere"));
    expect(projectCount(live)).toBe(1);
  });
});

describe("command classification", () => {
  it("classifies every command in the registry, and nothing that no longer exists", () => {
    const commands = listActionCommands(buildProgram());
    expect(commands.length).toBeGreaterThan(200);
    const unclassified = commands.filter((key) => !(key in COMMAND_CLASSIFICATION));
    expect(unclassified, "Classify each new command as allowed, guarded or exempt in src/workspace/experimentGuard.ts").toEqual([]);
    expect(Object.keys(COMMAND_CLASSIFICATION).filter((key) => !commands.includes(key))).toEqual([]);
  });

  it("would fail for a newly added, unclassified command", () => {
    const program = buildProgram();
    program.command("brand-new").action(() => undefined);
    expect(listActionCommands(program).filter((key) => !(key in COMMAND_CLASSIFICATION))).toEqual(["brand-new"]);
  });

  it("refuses every guarded command in an experiment workspace with a named reason and alternative, and none in an ordinary one", () => {
    const guarded = Object.entries(COMMAND_CLASSIFICATION).filter(([, rule]) => rule.kind === "guarded").map(([key]) => key);
    expect(guarded).toEqual(expect.arrayContaining([
      "production activate", "production reactivate", "production capacity attest",
      "go-broker install", "go-broker ensure",
      "worker start", "worker stop", "worker install", "worker uninstall",
      "ingress service install", "ingress service uninstall", "ingress service run",
      "qa restart", "qa refresh", "schedule github link", "pr decline-finding", "way propagate", "push-unpushed",
      "agent-ask notification-sent", "digest mark-posted", "orientation packet mark-sent",
      "config set defaultWorkspace"
    ]));
    for (const key of guarded) {
      const outside = path.join(root, "outside");
      const refused = evaluateCommandGuard(key, { workspace: experiment, apply: true, repoPath: outside, contentRepoPath: outside });
      expect(refused, key).not.toBeNull();
      expect(refused!.refused.code).toBe("EXPERIMENT_WORKSPACE_REFUSED");
      expect(refused!.refused.message).toContain(key);
      expect(evaluateCommandGuard(key, { workspace: live, apply: true, repoPath: outside, contentRepoPath: outside }), key).toBeNull();
    }
    for (const operation of Object.keys(GUARDED_OPERATIONS)) {
      expect(GUARDED_OPERATIONS[operation].reason).not.toBe("");
      expect(GUARDED_OPERATIONS[operation].alternative).not.toBe("");
    }
  });

  it("allows the invocations of a guarded command that stay inside the experiment", () => {
    expect(evaluateCommandGuard("push-unpushed", { workspace: experiment })).toBeNull();
    expect(evaluateCommandGuard("way propagate", { workspace: experiment, dryRun: true })).toBeNull();
    expect(evaluateCommandGuard("qa refresh", { workspace: experiment, skipRestart: true })).toBeNull();
    expect(evaluateCommandGuard("ingress recover", { workspace: experiment })).toBeNull();
    expect(evaluateCommandGuard("ingress process", { workspace: experiment, ingressRoot: path.join(experiment, "ingress") })).toBeNull();
    expect(evaluateCommandGuard("ingress process", { workspace: experiment, ingressRoot: path.join(root, "shared-ingress") })).not.toBeNull();
    expect(evaluateCommandGuard("ingress process", { workspace: experiment })).not.toBeNull();
  });

  it("never evaluates allowed or exempt commands", () => {
    for (const [key, rule] of Object.entries(COMMAND_CLASSIFICATION)) {
      if (rule.kind !== "guarded") expect(evaluateCommandGuard(key, { workspace: experiment }), key).toBeNull();
    }
  });
});

describe("the CLI choke point", () => {
  it("refuses guarded commands before their action runs and records the refusal in the experiment", async () => {
    vi.stubEnv("ARCADIA_WORKSPACE", experiment);
    expectRefused(await runCli(["go-broker", "install"]), "go-broker install");
    expectRefused(await runCli(["go-broker", "ensure"]), "go-broker ensure");
    expectRefused(await runCli(["production", "activate", "--request-id", "r1", "--granted-by", "agent"]), "production activate");
    expectRefused(await runCli(["pr", "decline-finding", "thread-1", "not applicable"]), "pr decline-finding");
    expectRefused(await runCli(["worker", "install"], false), "worker install");
    expect(existsSync(path.join(home, "Library", "LaunchAgents"))).toBe(false);
    const rows = withDatabase(experiment, (db) => db.prepare(
      "SELECT command, outcome, error_code FROM activity_events ORDER BY occurred_at"
    ).all() as Array<{ command: string; outcome: string; error_code: string }>);
    expect(rows.filter((row) => row.error_code === "EXPERIMENT_WORKSPACE_REFUSED").map((row) => row.command)).toEqual(
      expect.arrayContaining(["go-broker.install", "production.activate", "pr.decline-finding", "worker.install"])
    );
  });

  it("addresses an experiment by --workspace as well as by ARCADIA_WORKSPACE", async () => {
    expectRefused(await runCli(["production", "activate", "--workspace", experiment, "--request-id", "r1", "--granted-by", "agent"]), "production activate");
  });

  it("runs the same guarded command unchanged in an ordinary workspace", async () => {
    expectNotRefused(await runCli(["production", "activate", "--workspace", live, "--request-id", "r1", "--granted-by", "agent"]));
  });

  it("leaves allowed and read-only commands alone in an experiment workspace", async () => {
    vi.stubEnv("ARCADIA_WORKSPACE", experiment);
    for (const args of [["project", "list"], ["production", "status"], ["production", "preview"], ["agent-ask", "pending"], ["go-broker", "status"]]) {
      expectNotRefused(await runCli(args));
    }
    const resolved = await runCli(["workspace", "resolve"]);
    expect("output" in resolved && resolved.output.data.experiment).toBe(true);
  });

  it("keeps recurring proposal intake inside the explicitly named experiment", async () => {
    registerProject(experiment, "Fixture", path.join(experiment, "projects", "fixture"));
    const liveDatabaseBefore = readFileSync(getWorkspacePaths(live).databaseFile);
    const userConfigBefore = readFileSync(userConfig);
    const file = path.join(root, "schedule.json");
    writeFileSync(file, JSON.stringify({ schema: "arcadia-recurring-schedule-v1", id: "fixture-note", project: "fixture", cadence: "daily", timezone: "UTC", time: "00:00", starts_at: "2020-01-01T00:00:00.000Z", desired_result: "Prepare a fixture draft for {{due_at}}.", acceptance: ["Fixture evidence exists."] }));
    for (const args of [["register", "--file", file], ["enable", "fixture-note"], ["tick"], ["recurring"], ["pause", "fixture-note"]]) {
      const outcome = await runCli(["schedule", ...args, "--workspace", experiment]);
      expect("output" in outcome && outcome.output.ok, JSON.stringify(outcome)).toBe(true);
    }
    const proposals = withDatabase(experiment, (db) => (db.prepare("SELECT COUNT(*) AS n FROM agent_ask_proposals").get() as { n: number }).n);
    expect(proposals).toBe(1);
    expect(readFileSync(getWorkspacePaths(live).databaseFile)).toEqual(liveDatabaseBefore);
    expect(readFileSync(userConfig)).toEqual(userConfigBefore);
    expect(existsSync(path.join(home, "Library", "LaunchAgents"))).toBe(false);
  });

  it("refuses the worker plist write even when called directly", () => {
    expect(() => runWorkerInstallCommand({ workspace: experiment }, { listTmuxPanes: () => [] })).toThrow(/launchd.plist-write/);
    expect(existsSync(path.join(home, "Library", "LaunchAgents"))).toBe(false);
  });

  it("exposes the guard to shell callers", async () => {
    const refused = await runCli(["workspace", "guard", "services.restart", "--workspace", experiment]);
    expect("output" in refused && refused.output.error?.code).toBe("EXPERIMENT_WORKSPACE_REFUSED");
    const allowed = await runCli(["workspace", "guard", "services.restart", "--workspace", live]);
    expect("output" in allowed && allowed.output.ok).toBe(true);
    const unknown = await runCli(["workspace", "guard", "no.such-operation", "--workspace", live]);
    expect("output" in unknown && unknown.output.error?.code).toBe("USAGE_ERROR");
  });
});

describe("guarded operations outside the CLI", () => {
  it("scripts/services.sh asks the guard before restarting or stopping, and stops when it refuses", () => {
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    const calls = path.join(root, "pnpm-calls");
    writeFileSync(path.join(bin, "pnpm"), `#!/usr/bin/env bash\necho "$*" >> "${calls}"\nexit 2\n`);
    chmodSync(path.join(bin, "pnpm"), 0o755);
    const impl = path.join(root, "impl.sh");
    const implCalls = path.join(root, "impl-calls");
    writeFileSync(impl, `#!/usr/bin/env bash\necho "$1" >> "${implCalls}"\n`);
    chmodSync(impl, 0o755);
    const script = path.resolve(import.meta.dirname, "..", "scripts", "services.sh");
    const run = (action: string, workspace = experiment, cwd = root) => spawnSync("bash", [script, action], {
      encoding: "utf8",
      cwd,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, ARCADIA_WORKSPACE: workspace, ARCADIA_RESTART_SCRIPT: impl }
    });
    for (const action of ["restart", "stop"]) {
      const result = run(action);
      expect(result.status, result.stderr).toBe(3);
      expect(result.stderr).toContain(`services.${action}`);
    }
    expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual([
      `-s arcadia workspace guard services.restart --workspace ${experiment}`,
      `-s arcadia workspace guard services.stop --workspace ${experiment}`
    ]);
    expect(existsSync(implCalls)).toBe(false);
    // An ordinary workspace never consults the experiment guard; the freeze-window
    // check it does run fails open, so a broken CLI cannot block a recovery restart.
    run("restart", live);
    expect(readFileSync(calls, "utf8").split("\n").filter((line) => line.includes("workspace guard"))).toHaveLength(2);
    // A relative ARCADIA_WORKSPACE is resolved once, from the caller's directory,
    // and that absolute path is what the guard is asked about.
    const relative = run("stop", path.basename(experiment), path.dirname(experiment));
    expect(relative.status, relative.stderr).toBe(3);
    expect(readFileSync(calls, "utf8").trim().split("\n").at(-1)).toBe(`-s arcadia workspace guard services.stop --workspace ${experiment}`);
    // A workspace that does not resolve to a directory is refused rather than guessed.
    const missing = run("restart", "no-such-workspace");
    expect(missing.status).toBe(3);
    expect(missing.stderr).toContain("is not a directory");
    expect(existsSync(implCalls) ? readFileSync(implCalls, "utf8").trim().split("\n") : []).not.toContain("stop");
  });

  it("the Discord bot refuses to start against an experiment workspace", () => {
    const env = { DISCORD_BOT_TOKEN: "t", DISCORD_CLIENT_ID: "c", DISCORD_GUILD_ID: "g", DISCORD_CHANNEL_ID: "ch" };
    expect(() => loadDiscordBotConfig({ ...env, ARCADIA_WORKSPACE: experiment })).toThrow(/discord-bot.start/);
    expect(loadDiscordBotConfig({ ...env, ARCADIA_WORKSPACE: live }).arcadiaWorkspace).toBe(live);
    // A config that no longer parses but still mentions an experiment fails closed.
    const configFile = path.join(experiment, "config", "arcadia.json");
    writeFileSync(configFile, readFileSync(configFile, "utf8").replace(/}\s*$/, ""));
    expect(() => loadDiscordBotConfig({ ...env, ARCADIA_WORKSPACE: experiment })).toThrow(/discord-bot.start/);
  });
});

describe("activity error codes", () => {
  it("adds error_code to an existing activity_events table idempotently", () => {
    const file = path.join(root, "legacy.sqlite3");
    const db = new Database(file);
    try {
      db.exec(`CREATE TABLE activity_events (
        id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, local_date TEXT NOT NULL, surface TEXT NOT NULL,
        command TEXT NOT NULL, focus TEXT, entry_id TEXT, project_id TEXT,
        outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'error')), duration_ms INTEGER)`);
      db.prepare("INSERT INTO activity_events VALUES ('old', '2026-10-01T00:00:00Z', '2026-10-01', 'cli', 'status', NULL, NULL, NULL, 'ok', 1)").run();
      applyInitialSchema(db);
      applyInitialSchema(db);
      const columns = (db.prepare("PRAGMA table_info(activity_events)").all() as Array<{ name: string }>).map((column) => column.name);
      expect(columns.filter((name) => name === "error_code")).toHaveLength(1);
      const failed = recordActivityEvent(db, { occurredAt: new Date().toISOString(), surface: "cli", command: "agent-ask.settle", outcome: "error", errorCode: "SQLITE_BUSY" });
      const ok = recordActivityEvent(db, { occurredAt: new Date().toISOString(), surface: "cli", command: "status", outcome: "ok", errorCode: "IGNORED" });
      expect(failed.errorCode).toBe("SQLITE_BUSY");
      expect(ok.errorCode).toBeNull();
      expect((db.prepare("SELECT error_code FROM activity_events WHERE id = 'old'").get() as { error_code: string | null }).error_code).toBeNull();
    } finally {
      db.close();
    }
  });

  it("tells the contention refusals apart", () => {
    const code = (error: unknown) => activityErrorCode(error, normalizeError(error));
    const busy = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY", name: "SqliteError" });
    expect(code(busy)).toBe("SQLITE_BUSY");
    expect(code(Object.assign(new Error("snapshot"), { code: "SQLITE_BUSY_SNAPSHOT", name: "SqliteError" }))).toBe("SQLITE_BUSY_SNAPSHOT");
    expect(code(validationError("Action queue revision changed; refresh the Agent Ask settlement preview."))).toBe("QUEUE_REVISION_CONFLICT");
    expect(code(validationError("Agent Ask settlement apply does not match the current preview."))).toBe("STALE_PREVIEW_FINGERPRINT");
    const repo = path.join(root, "dirty");
    mkdirSync(repo);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    writeFileSync(path.join(repo, "file.txt"), "unsaved");
    let dirty: unknown;
    try { assertClean(repo, "main checkout"); } catch (error) { dirty = error; }
    expect(code(dirty)).toBe("DIRTY_CHECKOUT");
    expect(code(validationError("Unknown Project slug."))).toBe("VALIDATION_ERROR");
  });

  it("records the error code of a failed CLI command", async () => {
    await runCli(["agent-ask", "settle", "--workspace", experiment, "--proposal", "missing", "--request-id", "s1", "--disposition", "accepted"]);
    const row = withDatabase(experiment, (db) => db.prepare(
      "SELECT outcome, error_code FROM activity_events WHERE command = 'agent-ask.settle'"
    ).get() as { outcome: string; error_code: string });
    expect(row).toEqual({ outcome: "error", error_code: "VALIDATION_ERROR" });
  });
});

describe("leak check", () => {
  function seedHome(): void {
    mkdirSync(path.join(home, ".codex"), { recursive: true });
    mkdirSync(path.join(home, ".claude"), { recursive: true });
    mkdirSync(path.join(home, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(path.join(home, ".codex", "config.toml"), "approval_policy = \"on-request\"\n");
    writeFileSync(path.join(home, ".claude", "settings.json"), "{}\n");
    writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ numStartups: 1, projects: { "/repo": { hasTrustDialogAccepted: true } } }));
    writeFileSync(path.join(home, "Library", "LaunchAgents", "com.arcadia.local.1.worker.plist"), "<plist/>");
    writeFileSync(path.join(home, "Library", "LaunchAgents", "com.other.plist"), "<plist/>");
  }

  it("reports nothing when shared state is unchanged, even as Claude Code rewrites its state file", () => {
    seedHome();
    const before = takeLeakSnapshot({ home });
    writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ numStartups: 2, projects: { "/repo": { hasTrustDialogAccepted: true, lastCost: 3 } } }));
    expect(compareLeakSnapshots(before, takeLeakSnapshot({ home }))).toEqual([]);
    expect(Object.keys(before.launchAgents)).toEqual(["com.arcadia.local.1.worker.plist"]);
    expect(before.liveWorkspace).toMatchObject({ path: live, projectCount: 0, queueRevision: 0, error: null });
  });

  it("detects a live Project count change, a config hash change, a trust change and a new plist", () => {
    seedHome();
    const before = takeLeakSnapshot({ home });
    registerProject(live, "Leaked", path.join(root, "leaked"));
    writeFileSync(path.join(home, ".codex", "config.toml"), "approval_policy = \"never\"\n");
    writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ projects: { "/repo": { hasTrustDialogAccepted: true }, [experiment]: { hasTrustDialogAccepted: true } } }));
    writeFileSync(userConfig, JSON.stringify({ defaultWorkspace: live, extra: true }));
    writeFileSync(path.join(home, "Library", "LaunchAgents", "com.arcadia.local.1.experiment.plist"), "<plist/>");
    const fields = compareLeakSnapshots(before, takeLeakSnapshot({ home })).map((change) => change.field);
    expect(fields).toEqual([
      "liveWorkspace.projectCount",
      "hashes.userConfig",
      "hashes.codexConfig",
      "hashes.claudeTrust",
      "launchAgents.com.arcadia.local.1.experiment.plist"
    ]);
  });

  it("detects capacity receipts, go-broker artifacts and a live production-policy write", () => {
    seedHome();
    vi.stubEnv("ARCADIA_CAPACITY_RECEIPTS_PATH", "");
    const release = path.join(home, ".local", "share", "arcadia", "go-broker", "releases", "abc123");
    mkdirSync(release, { recursive: true });
    writeFileSync(path.join(release, "broker-manifest.json"), "{\"revision\":\"abc123\"}");
    mkdirSync(path.join(home, ".local", "bin"), { recursive: true });
    symlinkSync(path.join(release, "arcadia-go-broker-claude"), path.join(home, ".local", "bin", "arcadia-go-broker-claude"));
    const before = takeLeakSnapshot({ home });
    expect(before.liveWorkspace.productionPolicy).toMatchObject({ desiredState: "inactive", revision: 0 });
    expect(Object.keys(before.goBroker).sort()).toEqual([
      path.join(".local", "bin", "arcadia-go-broker-claude"),
      path.join(".local", "share", "arcadia", "go-broker", "releases", "abc123", "broker-manifest.json")
    ]);
    mkdirSync(path.join(home, ".arcadia", "telemetry"), { recursive: true });
    writeFileSync(path.join(home, ".arcadia", "telemetry", "capacity-receipts.json"), "{}");
    const other = path.join(home, ".local", "share", "arcadia", "go-broker", "releases", "def456");
    mkdirSync(other, { recursive: true });
    writeFileSync(path.join(other, "broker-manifest.json"), "{}");
    const db = new Database(path.join(live, "database", "arcadia.sqlite3"));
    try { db.prepare("UPDATE production_policy SET revision = revision + 1, epoch = epoch + 1").run(); } finally { db.close(); }
    const fields = compareLeakSnapshots(before, takeLeakSnapshot({ home })).map((change) => change.field);
    expect(fields).toEqual([
      "liveWorkspace.productionPolicy",
      "hashes.capacityReceipts",
      `goBroker.${path.join(".local", "share", "arcadia", "go-broker", "releases", "def456", "broker-manifest.json")}`
    ]);
  });

  it("records live activity rows and live repository refs as attributed fields that never count as a leak", async () => {
    seedHome();
    const liveRepo = path.join(root, "live-repo");
    mkdirSync(liveRepo);
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args], { cwd: liveRepo, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    git("commit", "-q", "--allow-empty", "-m", "base");
    git("tag", "v1");
    git("update-ref", "refs/codex/turn-diffs/one", "HEAD");
    // The registered Arcadia Project's repository is the default live repository.
    registerProject(live, "Arcadia", liveRepo);
    withDatabase(live, (db) => recordActivityEvent(db, { occurredAt: "2026-10-04T00:00:00Z", surface: "cli", command: "status", outcome: "ok" }));

    const before = takeLeakSnapshot({ home });
    expect(before.liveActivity).toMatchObject({ rowCount: 1, newestCommand: "status", error: null });
    expect(before.liveRefs).toMatchObject({ repo: liveRepo, source: "live workspace", counts: { heads: 1, remotes: 0, tags: 1, codex: 1 }, error: null });
    expect(Object.keys(before.liveRefs!.refs!)).toEqual(["refs/codex/turn-diffs/one", "refs/heads/main", "refs/tags/v1"]);
    expect(takeLeakSnapshot({ home, liveRepo: path.join(root, "not-a-repo") }).liveRefs).toMatchObject({ source: "option", hash: null });

    const baseline = path.join(root, "attributed.json");
    writeFileSync(baseline, JSON.stringify(before));
    withDatabase(live, (db) => recordActivityEvent(db, { occurredAt: "2026-10-04T00:01:00Z", surface: "claude", command: "config.get.defaultWorkspace", outcome: "ok" }));
    git("branch", "codex/new-work");
    git("commit", "-q", "--allow-empty", "-m", "moved");

    const after = takeLeakSnapshot({ home });
    expect(compareLeakSnapshots(before, after)).toEqual([]);
    const attributed = compareAttributedFields(before, after);
    expect(attributed.map((change) => change.field)).toEqual([
      "liveActivity.rowCount",
      "liveActivity.newestRowid",
      "liveRefs.hash",
      "liveRefs.refs/heads/codex/new-work",
      "liveRefs.refs/heads/main"
    ]);
    expect(attributed.find((change) => change.field === "liveRefs.refs/heads/codex/new-work")?.before).toBeNull();

    // Attributed changes alone pass the check, and the human output says how to read them.
    const compared = await runCli(["workspace", "leak-check", "--baseline", baseline]);
    expect("output" in compared && compared.output.ok).toBe(true);
    expect("output" in compared && compared.output.data.changes).toEqual([]);
    expect("output" in compared && compared.output.data.attributed.map((change: { field: string }) => change.field)).toContain("liveActivity.rowCount");
    let human = "";
    const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { human += String(chunk); return true; });
    try {
      await buildProgram().parseAsync(["node", "arcadia", "workspace", "leak-check", "--baseline", baseline]);
    } finally {
      out.mockRestore();
    }
    expect(human).toContain("Live activity rows: 2");
    expect(human).toContain(`Live repository refs: ${liveRepo}  heads 2, remotes 0, tags 1, refs/codex 1`);
    expect(human).toContain("attribute each change before calling it a leak");
    expect(human).toContain("liveActivity.rowCount: 1 -> 2");
    // An unreadable live repository is reported, never a reason to fail the check.
    const unreadable = await runCli(["workspace", "leak-check", "--live-repo", path.join(root, "not-a-repo")]);
    expect("output" in unreadable && unreadable.output.ok).toBe(true);
  });

  it("never passes when the live workspace cannot be observed", async () => {
    seedHome();
    const unreadable = path.join(root, "unreadable");
    mkdirSync(path.join(unreadable, "database"), { recursive: true });
    writeFileSync(path.join(unreadable, "database", "arcadia.sqlite3"), "not a database");
    const snapshot = takeLeakSnapshot({ home, liveWorkspace: unreadable });
    expect(snapshot.liveWorkspace.error).not.toBeNull();
    expect(snapshot.liveWorkspace.projectCount).toBeNull();
    const baseline = path.join(root, "leak", "unreadable.json");
    const recorded = await runCli(["workspace", "leak-check", "--live", unreadable, "--record", baseline]);
    expect("output" in recorded && recorded.output.error?.code).toBe("LEAK_CHECK_UNVERIFIABLE");
    expect("output" in recorded && recorded.output.error?.details?.unverifiable).toBe(true);
    expect(existsSync(baseline)).toBe(true);
    // Two identical failures must not compare as "no change".
    const compared = await runCli(["workspace", "leak-check", "--live", unreadable, "--baseline", baseline]);
    expect("output" in compared && compared.output.error?.code).toBe("LEAK_CHECK_UNVERIFIABLE");
  });

  it("runs from the CLI without writing the live workspace, and fails on a change", async () => {
    seedHome();
    vi.stubEnv("ARCADIA_WORKSPACE", experiment);
    const activity = () => withDatabase(live, (db) => (db.prepare("SELECT COUNT(*) AS count FROM activity_events").get() as { count: number }).count);
    const baseline = path.join(root, "leak", "before.json");
    const before = activity();
    const recorded = await runCli(["workspace", "leak-check", "--record", baseline]);
    expect("output" in recorded && recorded.output.data.snapshot.liveWorkspace.path).toBe(live);
    const clean = await runCli(["workspace", "leak-check", "--baseline", baseline]);
    expect("output" in clean && clean.output.data.changes).toEqual([]);
    writeFileSync(path.join(home, "Library", "LaunchAgents", "com.arcadia.local.1.new.plist"), "<plist/>");
    const leaked = await runCli(["workspace", "leak-check", "--baseline", baseline]);
    expect("output" in leaked && leaked.output.error?.code).toBe("WORKSPACE_LEAK_DETECTED");
    expect(activity()).toBe(before);
    expect(JSON.stringify(readFileSync(baseline, "utf8"))).not.toContain("approval_policy");
  });
});
