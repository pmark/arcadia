import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../src/cli.js";
import { withDatabase } from "../src/db/connection.js";
import { COMMAND_CLASSIFICATION, listActionCommands, recordsActivity } from "../src/workspace/experimentGuard.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

// Every SQLite open in this process, before the constructor runs, so a failed
// open is counted too. The CLI, the recorder and the leak check all open
// databases through better-sqlite3.
const tracking = vi.hoisted(() => ({
  opened: [] as Array<{ file: string; readonly: boolean }>,
  recorded: [] as string[]
}));

vi.mock("better-sqlite3", async (importOriginal) => {
  const actual = (await importOriginal<{ default: new (file: string, options?: { readonly?: boolean }) => object }>()).default;
  class TrackedDatabase extends actual {
    constructor(file: string, options?: { readonly?: boolean }) {
      tracking.opened.push({ file: String(file), readonly: Boolean(options?.readonly) });
      super(file, options);
    }
  }
  return { default: TrackedDatabase };
});

vi.mock("../src/activity/recorder.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/activity/recorder.js")>();
  return {
    ...actual,
    recordCliActivity: (input: Parameters<typeof actual.recordCliActivity>[0]) => {
      tracking.recorded.push(input.command);
      actual.recordCliActivity(input);
    }
  };
});

const roots: string[] = [];
let root: string;
let live: string;
let liveDatabase: string;
let repo: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-no-record-")));
  roots.push(root);
  const home = path.join(root, "home");
  mkdirSync(home, { recursive: true });
  // A live-like workspace that the user config names as the default, and an
  // uninlined environment: no ARCADIA_WORKSPACE, no --workspace. This is
  // exactly how the Decision 0082 near-miss reached `martianrover`.
  live = path.join(root, "live");
  initWorkspace(live);
  liveDatabase = getWorkspacePaths(live).databaseFile;
  const userConfig = path.join(root, "user-config.json");
  writeFileSync(userConfig, JSON.stringify({ defaultWorkspace: live }));
  vi.stubEnv("ARCADIA_CONFIG_PATH", userConfig);
  vi.stubEnv("HOME", home);
  vi.stubEnv("ARCADIA_WORKSPACE", "");
  vi.stubEnv("CODEX_SANDBOX", "");
  repo = path.join(root, "repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-q", "--allow-empty", "-m", "fixture"], { cwd: repo });
});

afterEach(() => {
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * One or more invocations of every command the CLI records no activity for.
 * A command that becomes exempt fails "covers every no-record command" until
 * it is listed here, and then has to prove it opens nothing.
 */
function invocations(): Record<string, string[][]> {
  return {
    "audit host-preview": [["audit", "host-preview", "--root", path.join(root, "missing-site"), "--seconds", "1"]],
    init: [
      ["init", path.join(root, "fresh")],
      ["init", path.join(root, "workspaces", "exp-test-20261005"), "--profile", "experiment"],
      ["init", path.join(root, "bad-profile"), "--profile", "no-such-profile"]
    ],
    "config get defaultWorkspace": [["config", "get", "defaultWorkspace"]],
    "workspace resolve": [["workspace", "resolve"]],
    "workspace leak-check": [["workspace", "leak-check", "--live-repo", repo]],
    "workspace guard": [["workspace", "guard", "services.restart"], ["workspace", "guard", "no.such-operation"]],
    "identity resolve": [["identity", "resolve", "--agent", "claude", "--tier", "heavy"], ["identity", "resolve", "--agent", "nobody"]],
    "identity roster": [["identity", "roster"]],
    "agent-ask contract": [["agent-ask", "contract"]],
    "pr code-review": [["pr", "code-review", "0", "--repo", repo]],
    "tidy list": [["tidy", "--repo", repo, "list"]],
    "tidy undo": [["tidy", "--repo", repo, "undo", "no-such-run"]],
    triggers: [["triggers", "--repo", repo]],
    docket: [["docket", "--repo", repo]],
    plans: [["plans", "--repo", repo]],
    "operator-task list": [["operator-task", "list", "--repo", repo]],
    "operator-task show": [["operator-task", "show", "no-such-task", "--repo", repo]],
    "operator-task raise": [["operator-task", "raise", "Approve the fixture", "--because", "Only the operator can", "--repo", repo]],
    "operator-task evidence": [["operator-task", "evidence", "no-such-task", "--note", "looks done", "--repo", repo]],
    "operator-task close": [["operator-task", "close", "no-such-task", "--operator", "--repo", repo]],
    "operator-task decline": [["operator-task", "decline", "no-such-task", "--because", "not needed", "--operator", "--repo", repo]],
    "ask report": [["ask", "report"], ["ask", "report", "--since", "1h"], ["ask", "report", "--since", "not-a-time"]],
    todo: [["todo"], ["todo", "--stale"], ["todo", "--all", "--project", "no-such-project"]],
    timeline: [["timeline"], ["timeline", "--since", "1h", "--ndjson"], ["timeline", "--as-of", "1h"], ["timeline", "--tool", "nobody"]]
  };
}

async function runCli(args: string[]): Promise<void> {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    await buildProgram().parseAsync(["node", "arcadia", ...args, "--json"]);
  } catch {
    // Refusals and usage errors are part of the coverage: a failed command
    // used to record its error into the default workspace.
  } finally {
    out.mockRestore();
    err.mockRestore();
    process.exitCode = undefined;
  }
}

function liveActivityRows(): number {
  return withDatabase(live, (db) => (db.prepare("SELECT COUNT(*) AS count FROM activity_events").get() as { count: number }).count);
}

/** Runs one invocation and returns what it opened of the live database and what it recorded. */
async function observe(args: string[]): Promise<{ liveOpens: Array<{ readonly: boolean }>; recorded: string[] }> {
  tracking.opened.length = 0;
  tracking.recorded.length = 0;
  await runCli(args);
  const liveOpens = tracking.opened.filter((open) => path.resolve(open.file) === liveDatabase);
  return { liveOpens, recorded: [...tracking.recorded] };
}

describe("commands that read no workspace state record no activity", () => {
  it("draws the no-record set from the classification table the CLI uses, and covers every no-record command", () => {
    const commands = listActionCommands(buildProgram());
    const noRecord = commands.filter((key) => !recordsActivity(key)).sort();
    expect(noRecord).toEqual(commands.filter((key) => COMMAND_CLASSIFICATION[key]?.kind === "exempt").sort());
    expect(noRecord).toEqual(expect.arrayContaining([
      "init", "config get defaultWorkspace", "identity resolve", "identity roster",
      "workspace resolve", "workspace guard", "workspace leak-check", "audit host-preview", "timeline"
    ]));
    expect(Object.keys(invocations()).sort(), "Add an invocation to this test for each newly exempt command").toEqual(noRecord);
    for (const key of commands.filter((command) => COMMAND_CLASSIFICATION[command]?.kind !== "exempt")) {
      expect(recordsActivity(key), key).toBe(true);
    }
  });

  it("records an ordinary command into the default workspace, so the harness can see a leak", async () => {
    const { recorded } = await observe(["status"]);
    expect(recorded).toEqual(["status"]);
    expect(liveActivityRows()).toBe(1);
  });

  it("runs each no-record command uninlined without recording, or opening the default workspace's database", async () => {
    for (const [key, runs] of Object.entries(invocations())) {
      for (const args of runs) {
        const { liveOpens, recorded } = await observe(args);
        expect(recorded, args.join(" ")).toEqual([]);
        if (key === "workspace leak-check" || (key === "timeline" && !args.includes("nobody")) || key === "todo" || (key === "ask report" && !args.includes("not-a-time"))) {
          // The leak check's, the timeline's, the Ask report's and the to-do view's purpose is to
          // observe the live database, which they do only read-only; none opens
          // it to record itself.
          expect(liveOpens.length, args.join(" ")).toBeGreaterThan(0);
          expect(liveOpens.every((open) => open.readonly), args.join(" ")).toBe(true);
        } else {
          expect(liveOpens, args.join(" ")).toEqual([]);
        }
      }
    }
    expect(liveActivityRows()).toBe(0);
  });
});
