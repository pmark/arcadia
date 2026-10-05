import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig as loadDiscordBotConfig } from "../apps/discord-bot/src/config.js";
import { recordCliActivity } from "../src/activity/recorder.js";
import { ArcadiaError } from "../src/cli/errors.js";
import { withDatabase } from "../src/db/connection.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";
import {
  INLINE_WORKSPACE_REMEDY,
  inlineWorkspaceRequired,
  reportWorkspaceResolution,
  requireResolvedWorkspace,
  resolveWorkspace
} from "../src/workspace/resolve.js";
import { cleanupTrackedPaths, parseJson, runCli } from "./cli-response-fixture.js";

// Every fixture here is a temporary directory and a temporary user config:
// nothing reads the operator's real ~/.config/arcadia/config.json.
let root: string;
let configPath: string;
let defaultWorkspace: string;
let neutral: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-inline-mode-")));
  defaultWorkspace = path.join(root, "default-workspace");
  mkdirSync(path.join(defaultWorkspace, "config"), { recursive: true });
  writeFileSync(path.join(defaultWorkspace, "config", "arcadia.json"), "{}\n");
  configPath = path.join(root, "user-config.json");
  writeFileSync(configPath, JSON.stringify({ defaultWorkspace }));
  neutral = path.join(root, "neutral");
  mkdirSync(neutral);
});

afterEach(() => {
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  rmSync(root, { recursive: true, force: true });
  cleanupTrackedPaths();
});

function env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ARCADIA_CONFIG_PATH: configPath, ...extra };
}

const ON = { ARCADIA_REQUIRE_INLINE_WORKSPACE: "1" };

function refusal(run: () => unknown): ArcadiaError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ArcadiaError);
    return error as ArcadiaError;
  }
  throw new Error("expected INLINE_WORKSPACE_REQUIRED");
}

describe("ARCADIA_REQUIRE_INLINE_WORKSPACE truthiness", () => {
  it.each(["1", "true", "TRUE", "yes", "Yes", "on", " on "])("treats %j as on", (value) => {
    expect(inlineWorkspaceRequired({ ARCADIA_REQUIRE_INLINE_WORKSPACE: value })).toBe(true);
  });

  it.each([undefined, "", "0", "false", "no", "off", "2", "enabled"])("treats %j as off", (value) => {
    expect(inlineWorkspaceRequired(value === undefined ? {} : { ARCADIA_REQUIRE_INLINE_WORKSPACE: value })).toBe(false);
  });
});

describe("resolveWorkspace with the mode on and off", () => {
  it("resolves --workspace the same either way", () => {
    const named = path.join(root, "named");
    for (const extra of [{}, ON]) {
      expect(resolveWorkspace({ workspace: named, cwd: neutral, env: env(extra) })).toEqual({ source: "flag", workspacePath: named });
    }
  });

  it("resolves an ARCADIA_WORKSPACE value the same either way", () => {
    const named = path.join(root, "named");
    for (const extra of [{}, ON]) {
      expect(resolveWorkspace({ cwd: neutral, env: env({ ...extra, ARCADIA_WORKSPACE: named }) })).toEqual({
        source: "environment variable",
        workspacePath: named,
        detail: "ARCADIA_WORKSPACE"
      });
    }
  });

  it("resolves the cwd config/arcadia.json walk-up the same either way", () => {
    const inside = path.join(defaultWorkspace, "projects", "deep");
    mkdirSync(inside, { recursive: true });
    for (const extra of [{}, ON]) {
      const resolution = resolveWorkspace({ cwd: inside, env: env(extra) });
      expect(resolution.source).toBe("local marker");
      expect(resolution.workspacePath).toBe(defaultWorkspace);
    }
  });

  it("uses the user config default with the mode off, and refuses it by name with the mode on", () => {
    expect(resolveWorkspace({ cwd: neutral, env: env() })).toEqual({
      source: "user config",
      workspacePath: defaultWorkspace,
      detail: "defaultWorkspace"
    });

    const error = refusal(() => resolveWorkspace({ cwd: neutral, env: env(ON) }));
    expect(error.code).toBe("INLINE_WORKSPACE_REQUIRED");
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain("ARCADIA_REQUIRE_INLINE_WORKSPACE is on");
    expect(error.message).toContain(`the user config defaultWorkspace (${defaultWorkspace})`);
    expect(error.message).toContain("Pass --workspace <path> or set ARCADIA_WORKSPACE=<path> inline on this command.");
    expect(error.details).toEqual({
      code: "INLINE_WORKSPACE_REQUIRED",
      variable: "ARCADIA_REQUIRE_INLINE_WORKSPACE",
      refusedSource: "user config",
      refusedWorkspace: defaultWorkspace,
      refusedDetail: "defaultWorkspace",
      remedy: INLINE_WORKSPACE_REMEDY
    });
    expect(INLINE_WORKSPACE_REMEDY).toContain("pass --workspace <path>");
    expect(INLINE_WORKSPACE_REMEDY).toContain("ARCADIA_WORKSPACE=<path> arcadia <command>");
  });

  it("uses the .arcadia-workspace marker with the mode off, and refuses it by name with the mode on", () => {
    const repo = path.join(root, "repo");
    const dogfood = path.join(repo, ".arcadia-workspace");
    mkdirSync(path.join(dogfood, "config"), { recursive: true });
    writeFileSync(path.join(dogfood, "config", "arcadia.json"), "{}\n");
    const noDefault = { ARCADIA_CONFIG_PATH: path.join(root, "absent-config.json") };

    const off = resolveWorkspace({ cwd: repo, env: noDefault });
    expect(off.source).toBe("local marker");
    expect(off.workspacePath).toBe(dogfood);
    expect(off.warning).toMatch(/dogfood workspace/);

    const error = refusal(() => resolveWorkspace({ cwd: repo, env: { ...noDefault, ...ON } }));
    expect(error.code).toBe("INLINE_WORKSPACE_REQUIRED");
    expect(error.message).toContain(`the repo-local .arcadia-workspace marker (${dogfood})`);
    expect(error.details).toMatchObject({ refusedSource: "local marker", refusedWorkspace: dogfood, remedy: INLINE_WORKSPACE_REMEDY });
  });

  it("still reports a missing workspace as missing, with the mode on or off", () => {
    const noDefault = { ARCADIA_CONFIG_PATH: path.join(root, "absent-config.json") };
    for (const extra of [{}, ON]) {
      expect(resolveWorkspace({ cwd: neutral, env: { ...noDefault, ...extra } }).source).toBe("missing");
    }
  });

  it("makes requireResolvedWorkspace throw the same refusal", () => {
    vi.stubEnv("ARCADIA_CONFIG_PATH", configPath);
    vi.stubEnv("ARCADIA_WORKSPACE", "");
    vi.stubEnv("ARCADIA_INVOKED_FROM", neutral);
    expect(requireResolvedWorkspace({})).toBe(defaultWorkspace);
    vi.stubEnv("ARCADIA_REQUIRE_INLINE_WORKSPACE", "true");
    expect(refusal(() => requireResolvedWorkspace({})).code).toBe("INLINE_WORKSPACE_REQUIRED");
  });

  it("reports the mode and the refused fallback without throwing", () => {
    expect(reportWorkspaceResolution({ cwd: neutral, env: env() })).toMatchObject({
      source: "user config",
      workspacePath: defaultWorkspace,
      inlineWorkspaceRequired: false
    });
    expect(reportWorkspaceResolution({ cwd: neutral, env: env() }).refused).toBeUndefined();
    expect(reportWorkspaceResolution({ workspace: defaultWorkspace, cwd: neutral, env: env(ON) })).toMatchObject({
      source: "flag",
      workspacePath: defaultWorkspace,
      inlineWorkspaceRequired: true
    });
    expect(reportWorkspaceResolution({ cwd: neutral, env: env(ON) })).toMatchObject({
      source: "missing",
      workspacePath: null,
      inlineWorkspaceRequired: true,
      refused: { code: "INLINE_WORKSPACE_REQUIRED", source: "user config", workspacePath: defaultWorkspace, remedy: INLINE_WORKSPACE_REMEDY }
    });
  });
});

describe("the activity recorder in the mode", () => {
  function rows(workspace: string): number {
    return withDatabase(workspace, (db) => (db.prepare("SELECT COUNT(*) AS count FROM activity_events").get() as { count: number }).count);
  }

  it("skips a row it could only have written to the user config default, and still records an inline target", () => {
    const live = path.join(root, "live");
    initWorkspace(live);
    const inline = path.join(root, "inline");
    initWorkspace(inline);
    writeFileSync(configPath, JSON.stringify({ defaultWorkspace: live }));
    vi.stubEnv("ARCADIA_CONFIG_PATH", configPath);
    vi.stubEnv("ARCADIA_WORKSPACE", "");
    vi.stubEnv("ARCADIA_INVOKED_FROM", neutral);

    // Control: with the mode off the recorder does fall back to the default.
    recordCliActivity({ command: "status", outcome: "ok", durationMs: 1 });
    expect(rows(live)).toBe(1);

    vi.stubEnv("ARCADIA_REQUIRE_INLINE_WORKSPACE", "1");
    recordCliActivity({ command: "status", outcome: "ok", durationMs: 1 });
    recordCliActivity({ command: "status", outcome: "error", durationMs: 1, errorCode: "INLINE_WORKSPACE_REQUIRED" });
    expect(rows(live)).toBe(1);

    recordCliActivity({ command: "status", workspace: inline, outcome: "ok", durationMs: 1 });
    vi.stubEnv("ARCADIA_WORKSPACE", inline);
    recordCliActivity({ command: "status", outcome: "ok", durationMs: 1 });
    expect(rows(inline)).toBe(2);
    expect(rows(live)).toBe(1);
  });
});

describe("the Discord bot's own resolver in the mode", () => {
  const botEnv = {
    DISCORD_BOT_TOKEN: "token",
    DISCORD_CLIENT_ID: "client",
    DISCORD_GUILD_ID: "guild",
    DISCORD_CHANNEL_ID: "channel",
    DISCORD_ALLOWED_USER_IDS: "1"
  };

  it("refuses the user config default with the mode on and keeps ARCADIA_WORKSPACE", () => {
    expect(loadDiscordBotConfig(env(botEnv)).arcadiaWorkspace).toBe(defaultWorkspace);
    expect(() => loadDiscordBotConfig(env({ ...botEnv, ...ON }))).toThrow(/INLINE_WORKSPACE_REQUIRED/);
    expect(loadDiscordBotConfig(env({ ...botEnv, ...ON, ARCADIA_WORKSPACE: defaultWorkspace })).arcadiaWorkspace).toBe(defaultWorkspace);
  });
});

describe("the CLI in the mode (subprocess, temporary user config)", () => {
  let live: string;
  let liveDatabase: string;

  beforeEach(() => {
    live = path.join(root, "live");
    initWorkspace(live);
    liveDatabase = getWorkspacePaths(live).databaseFile;
    writeFileSync(configPath, JSON.stringify({ defaultWorkspace: live }));
  });

  function cli(args: string[], extra: Record<string, string> = {}) {
    return runCli(args, { ARCADIA_REQUIRE_INLINE_WORKSPACE: "1", ...extra }, { configPath, cwd: neutral });
  }

  function liveRows(): number {
    return withDatabase(live, (db) => (db.prepare("SELECT COUNT(*) AS count FROM activity_events").get() as { count: number }).count);
  }

  it("refuses an uninlined command with INLINE_WORKSPACE_REQUIRED and writes nothing into the temp default workspace", () => {
    const before = statSync(liveDatabase).mtimeMs;
    const result = cli(["status", "--json"]);
    // Checked before this test opens the database itself, which can touch it.
    expect(statSync(liveDatabase).mtimeMs).toBe(before);
    expect(result.status).toBe(2);
    // Failures go to stderr as JSON; a sandboxed host may prefix unrelated noise.
    const failure = parseJson(result.stderr.slice(result.stderr.indexOf("{\n")));
    expect(failure.ok).toBe(false);
    expect(failure.error.code).toBe("INLINE_WORKSPACE_REQUIRED");
    expect(failure.error.details).toMatchObject({ code: "INLINE_WORKSPACE_REQUIRED", refusedSource: "user config", refusedWorkspace: live, remedy: INLINE_WORKSPACE_REMEDY });
    expect(liveRows()).toBe(0);

    // The same command named inline runs and records only where it was told.
    const inline = path.join(root, "inline");
    initWorkspace(inline);
    expect(cli(["status", "--json", "--workspace", inline]).status).toBe(0);
    expect(cli(["status", "--json"], { ARCADIA_WORKSPACE: inline }).status).toBe(0);
    expect(withDatabase(inline, (db) => (db.prepare("SELECT COUNT(*) AS count FROM activity_events").get() as { count: number }).count)).toBe(2);
    expect(liveRows()).toBe(0);
  });

  it("keeps help, version and the no-record commands usable", () => {
    const help = cli(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage: arcadia");
    const version = cli(["--version"]);
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe("0.1.0");
    for (const args of [
      ["identity", "resolve", "--agent", "claude", "--tier", "heavy"],
      ["identity", "roster"],
      ["config", "get", "defaultWorkspace"],
      ["agent-ask", "contract"],
      ["init", path.join(root, "fresh")]
    ]) {
      const result = cli([...args, "--json"]);
      expect(result.status, `${args.join(" ")}: ${result.stdout}${result.stderr}`).toBe(0);
    }
    expect(liveRows()).toBe(0);
  });

  it("makes `workspace resolve` report the mode and the refused fallback, and leaves its output unchanged with the mode off", () => {
    const on = parseJson(cli(["workspace", "resolve", "--json"]).stdout);
    expect(on.ok).toBe(true);
    expect(on.data).toMatchObject({
      source: "missing",
      workspacePath: null,
      inlineWorkspaceRequired: true,
      refused: { code: "INLINE_WORKSPACE_REQUIRED", source: "user config", workspacePath: live, remedy: INLINE_WORKSPACE_REMEDY }
    });
    const human = cli(["workspace", "resolve"]).stdout;
    expect(human).toContain("Inline workspace required: on (ARCADIA_REQUIRE_INLINE_WORKSPACE)");
    expect(human).toContain(`Refused fallback: user config ${live}`);
    expect(human).toContain(`Fix: ${INLINE_WORKSPACE_REMEDY}`);

    const off = runCli(["workspace", "resolve", "--json"], {}, { configPath, cwd: neutral });
    expect(parseJson(off.stdout).data).toEqual({
      source: "user config",
      workspacePath: live,
      detail: "defaultWorkspace",
      experiment: false,
      inlineWorkspaceRequired: false
    });
    const offHuman = runCli(["workspace", "resolve"], {}, { configPath, cwd: neutral }).stdout;
    expect(offHuman).not.toContain("Inline workspace required");
    expect(offHuman).not.toContain("Refused fallback");
    expect(liveRows()).toBe(0);
  });
});
