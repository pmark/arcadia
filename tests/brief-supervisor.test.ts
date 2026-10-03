import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  BRIEF_CHILD_ENV,
  BRIEF_DEADLINE_ENV,
  BRIEF_DEADLINE_MS,
  BRIEF_STAGE_PREFIX,
  briefDeadlineMs,
  superviseBrief
} from "../src/briefSupervisor.js";
import { renderNextSuccess, runNextReadOnlyCommand } from "../src/commands/next.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { processPreservationRequests } from "../src/sessions/preservationTransport.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const root = path.resolve(import.meta.dirname, "..");
const entrypoint = path.join(root, "scripts", "arcadia-go-broker.ts");
const tsxLoader = pathToFileURL(path.join(root, "node_modules", "tsx", "dist", "loader.mjs")).href;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function scratch(): string {
  // realpath: macOS tmpdir is a symlink, and the broker resolves its cwd.
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-brief-supervisor-")));
  temporary.push(directory);
  return directory;
}

/** A process is gone once signalling fails or only its zombie entry remains. */
function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch { return false; }
  // A zombie still answers signal 0. Where `ps` is denied (a coding-agent
  // sandbox) the signal answer stands.
  const ps = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
  if (ps.error || typeof ps.stdout !== "string") return true;
  const stat = ps.stdout.trim();
  return stat !== "" && !stat.startsWith("Z");
}

async function expectDead(pid: number): Promise<void> {
  const until = Date.now() + 3_000;
  while (alive(pid) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 50));
  expect(alive(pid), `pid ${pid} survived`).toBe(false);
}

/** A stand-in brief child: it speaks the stage protocol and then misbehaves on cue. */
function fakeChild(directory: string): string {
  const script = path.join(directory, "fake-brief-child.mjs");
  writeFileSync(script, `
import { spawn } from "node:child_process";
import { writeFileSync, writeSync } from "node:fs";
const [mode, pidFile] = process.argv.slice(2);
const id = process.env.${BRIEF_CHILD_ENV};
const stage = (name) => writeSync(2, ${JSON.stringify(BRIEF_STAGE_PREFIX)} + JSON.stringify({ stage: name, correlationId: id }) + "\\n");
if (mode === "ok") {
  stage("render");
  process.stdout.write(JSON.stringify({ ok: true, command: "brief-broker", data: { dispatchBrief: "  exact\\n\\tbytes  " } }, null, 2) + "\\n");
} else if (mode === "crash") {
  process.stderr.write("native addon exploded\\n");
  process.exit(7);
} else if (mode === "stall") {
  stage("advance");
  const sleeper = spawn("sleep", ["30"], { stdio: "ignore" });
  writeFileSync(pidFile, String(sleeper.pid));
  stage("work-monitor");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
} else if (mode === "linger") {
  const holder = spawn("sleep", ["30"], { stdio: ["ignore", "inherit", "ignore"] });
  writeFileSync(pidFile, String(holder.pid));
  stage("render");
  writeSync(1, JSON.stringify({ ok: true, command: "brief-broker", data: { dispatchBrief: "complete" } }) + "\\n");
  process.exit(0);
} else if (mode === "late") {
  stage("next");
  process.on("SIGTERM", () => {
    process.stdout.write(JSON.stringify({ ok: true, late: true }) + "\\n");
    stage("render");
  });
  setInterval(() => {}, 1000);
}
`);
  return script;
}

// Generous for a loaded runner: every stage-reaching child is plain node.
const DEADLINE_MS = 3_000;
const GRACE_MS = 300;

function supervise(directory: string, mode: string, deadlineMs = DEADLINE_MS) {
  const pidFile = path.join(directory, `${mode}.pid`);
  return {
    pidFile,
    run: superviseBrief({
      command: process.execPath,
      args: [fakeChild(directory), mode, pidFile],
      cwd: directory,
      env: process.env,
      correlationId: crypto.randomUUID(),
      deadlineMs,
      killGraceMs: GRACE_MS
    })
  };
}

describe("brief supervisor", () => {
  it("caps the deadline override below the agent attempt and ignores junk", () => {
    expect(briefDeadlineMs({})).toBe(BRIEF_DEADLINE_MS);
    expect(briefDeadlineMs({ [BRIEF_DEADLINE_ENV]: "500" })).toBe(500);
    expect(briefDeadlineMs({ [BRIEF_DEADLINE_ENV]: "600000" })).toBe(BRIEF_DEADLINE_MS);
    expect(briefDeadlineMs({ [BRIEF_DEADLINE_ENV]: "-1" })).toBe(BRIEF_DEADLINE_MS);
    expect(BRIEF_DEADLINE_MS).toBeLessThan(30_000);
  });

  it("passes a healthy child's receipt through byte-for-byte", async () => {
    const directory = scratch();
    const outcome = await supervise(directory, "ok").run;
    const expected = `${JSON.stringify({ ok: true, command: "brief-broker", data: { dispatchBrief: "  exact\n\tbytes  " } }, null, 2)}\n`;
    expect(outcome).toMatchObject({ exitCode: 0, timedOut: false, stage: "render" });
    expect(outcome.receipt).toBe(expected);
  });

  it("kills a stalled child and its descendants within the bound and names the last stage", async () => {
    const directory = scratch();
    const { pidFile, run } = supervise(directory, "stall");
    const started = Date.now();
    const outcome = await run;
    expect(Date.now() - started).toBeLessThan(DEADLINE_MS + 2 * GRACE_MS + 2_000);
    expect(outcome).toMatchObject({ exitCode: 1, timedOut: true, stage: "work-monitor" });
    const receipt = JSON.parse(outcome.receipt);
    expect(receipt).toMatchObject({
      ok: false,
      command: "brief-broker",
      error: {
        code: "BRIEF_DEADLINE_EXCEEDED",
        details: { stage: "work-monitor", deadlineMs: DEADLINE_MS, readOnly: true }
      }
    });
    expect(receipt.error.details.correlationId).toMatch(UUID);
    expect(receipt.error.details.recovery).toContain("rerunning the same fixed brief launcher is safe");
    expect(receipt.error.details.elapsedMs).toBeGreaterThanOrEqual(DEADLINE_MS);
    // The grandchild shared the child's group and did not survive it.
    await expectDead(Number(readFileSync(pidFile, "utf8")));
  });

  it("keeps a complete answer whose descendant still holds stdout, then stops that descendant", async () => {
    const directory = scratch();
    const { pidFile, run } = supervise(directory, "linger");
    const started = Date.now();
    const outcome = await run;
    expect(Date.now() - started).toBeLessThan(DEADLINE_MS);
    expect(outcome).toMatchObject({ exitCode: 0, timedOut: false, stage: "render" });
    expect(outcome.receipt).toBe(`${JSON.stringify({ ok: true, command: "brief-broker", data: { dispatchBrief: "complete" } })}\n`);
    await expectDead(Number(readFileSync(pidFile, "utf8")));
  });

  it("discards a late child answer so only one receipt ever exists", async () => {
    const directory = scratch();
    const outcome = await supervise(directory, "late").run;
    expect(outcome).toMatchObject({ exitCode: 1, timedOut: true, stage: "next" });
    // JSON.parse refuses two concatenated documents: this is exactly one.
    const receipt = JSON.parse(outcome.receipt);
    expect(receipt.error).toMatchObject({ code: "BRIEF_DEADLINE_EXCEEDED", details: { stage: "next" } });
    expect(outcome.receipt).not.toContain("late");
  });

  it("turns a child that dies without a receipt into one structured failure", async () => {
    const directory = scratch();
    const outcome = await supervise(directory, "crash").run;
    expect(outcome).toMatchObject({ exitCode: 1, timedOut: false });
    expect(JSON.parse(outcome.receipt).error).toMatchObject({
      code: "UNEXPECTED_ERROR",
      details: { stage: "spawn", childExitCode: 7, childStderrTail: "native addon exploded", readOnly: true }
    });
  });
});

/** The installed launcher's exact shape, through the real entrypoint. */
function runBriefLauncher(cwd: string, env: NodeJS.ProcessEnv) {
  const started = Date.now();
  const result = spawnSync(process.execPath, ["--import", tsxLoader, entrypoint, "codex", "brief"], {
    cwd,
    env: { ...process.env, CODEX_SANDBOX: "", ...env },
    encoding: "utf8",
    timeout: 60_000
  });
  return { ...result, elapsedMs: Date.now() - started };
}

function git(cwd: string, args: string[]): string {
  return spawnSync("git", args, { cwd, encoding: "utf8" }).stdout;
}

function write(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function candidateFixture(): { repo: string; workspace: string } {
  const base = scratch();
  const repo = path.join(base, "repo");
  write(path.join(repo, "PROJECT.md"), [
    "---", "arcadia: v1", "type: project", "slug: demo", "name: Demo", "status: active",
    "goal: Exercise the supervised brief.", "milestone: First milestone", "active_plan: sample-plan",
    "updated: 2026-10-02", "---", ""
  ].join("\n"));
  write(path.join(repo, "CONSTITUTION.md"), "# Constitution\n\n- Capability never grants authority.\n");
  write(path.join(repo, "docs/plans/sample-plan.md"), [
    "---", "arcadia: v1", "type: plan", "slug: sample-plan", "project: demo", "status: active",
    "milestone: First milestone", "token_impact: medium",
    "token_budget: One bounded implementation pass; tests are deterministic.",
    "recommended_model: gpt-5.6-terra", "current_action: ship-it", "updated: 2026-10-02",
    "actions:", "  - id: ship-it", "    title: Ship the thing", "    status: open", "    responsibility: codex",
    "    next_action: Wire the command.", "    expected_artifact: A wired command with a test",
    "    clarification: clarified", "    acceptance_criteria:", "      - The command is covered by a test.",
    "    depends_on: []", "---", "", "# Sample plan", ""
  ].join("\n"));
  for (const args of [["init", "-q", "-b", "main"], ["add", "-A"]]) git(repo, args);
  spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-q", "-m", "fixture"], { cwd: repo });
  const workspace = path.join(base, "ws");
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo", mission: "Exercise the supervised brief.", status: "active",
      currentMilestone: "First milestone", nextAction: "Start", workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo, validationCommands: ["pnpm test"] });
  });
  return { repo, workspace };
}

/** Every row of every table: claims, reservations, admissions and telemetry alike. */
function databaseSnapshot(workspace: string): Array<[string, unknown[]]> {
  return withReadOnlyDatabase(workspace, (db) =>
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>)
      .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}"`).all()] as [string, unknown[]]));
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("fixed brief entrypoint under supervision", () => {
  it("returns a structured failure within the deadline when git hangs, and kills the hung git", () => {
    const { repo, workspace } = candidateFixture();
    const shims = path.join(path.dirname(repo), "shims");
    const pids = path.join(path.dirname(repo), "git.pids");
    write(path.join(shims, "git"), `#!/bin/sh\necho $$ >> '${pids}'\nexec sleep 30\n`);
    chmodSync(path.join(shims, "git"), 0o755);
    const deadlineMs = 7_000;

    const result = runBriefLauncher(repo, {
      ARCADIA_WORKSPACE: workspace,
      PATH: `${shims}${path.delimiter}${process.env.PATH ?? ""}`,
      [BRIEF_DEADLINE_ENV]: String(deadlineMs)
    });

    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain("\"ok\"");
    const receipt = JSON.parse(result.stdout);
    expect(receipt).toMatchObject({
      ok: false,
      command: "brief-broker",
      error: { code: "BRIEF_DEADLINE_EXCEEDED", details: { stage: "advance", deadlineMs, readOnly: true } }
    });
    expect(receipt.error.details.correlationId).toMatch(UUID);
    expect(receipt.error.details.recovery).toContain("SQLite lock or a hung git process");
    // Startup of the supervising process plus the deadline and both kill steps.
    expect(result.elapsedMs).toBeLessThan(deadlineMs + 2_000 + 10_000);
    const hung = readFileSync(pids, "utf8").trim().split("\n").map(Number);
    expect(hung.length).toBeGreaterThan(0);
    for (const pid of hung) {
      const until = Date.now() + 3_000;
      while (alive(pid) && Date.now() < until) spawnSync("sleep", ["0.05"]);
      expect(alive(pid), `git shim ${pid} survived`).toBe(false);
    }
    expect(git(repo, ["status", "--porcelain=v1", "--untracked-files=all"])).toBe("");
  });

  it("returns the literal dispatch brief, writes nothing, and repeats cleanly across a worker restart", () => {
    const { repo, workspace } = candidateFixture();
    const canonical = renderNextSuccess(runNextReadOnlyCommand({ workspace, project: "demo" })).join("\n");
    const statusBefore = git(repo, ["status", "--porcelain=v1", "--untracked-files=all"]);
    const headBefore = git(repo, ["rev-parse", "HEAD"]);
    const before = databaseSnapshot(workspace);

    const first = runBriefLauncher(repo, { ARCADIA_WORKSPACE: workspace });
    expect(first.status, first.stdout + first.stderr).toBe(0);
    const firstReceipt = JSON.parse(first.stdout);
    expect(firstReceipt.command).toBe("brief-broker");
    expect(firstReceipt.data.dispatchBrief).toBe(canonical);
    expect(sha256(firstReceipt.data.dispatchBrief)).toBe(sha256(canonical));
    expect(firstReceipt.data.dispatchBrief).toContain("Capability never grants authority.");
    expect(databaseSnapshot(workspace)).toEqual(before);
    expect(git(repo, ["status", "--porcelain=v1", "--untracked-files=all"])).toBe(statusBefore);

    // A fresh host-worker tick (what a restart performs first) in between.
    withDatabase(workspace, (db) => processPreservationRequests(db, workspace));
    const afterRestart = databaseSnapshot(workspace);

    const second = runBriefLauncher(repo, { ARCADIA_WORKSPACE: workspace });
    expect(second.status, second.stdout + second.stderr).toBe(0);
    const secondReceipt = JSON.parse(second.stdout);
    expect(sha256(secondReceipt.data.dispatchBrief)).toBe(sha256(canonical));
    expect(firstReceipt.data.correlationId).toMatch(UUID);
    expect(secondReceipt.data.correlationId).toMatch(UUID);
    expect(secondReceipt.data.correlationId).not.toBe(firstReceipt.data.correlationId);
    expect(databaseSnapshot(workspace)).toEqual(afterRestart);
    const events = afterRestart.find(([name]) => name === "dispatch_events");
    expect(events?.[1]).toEqual([]);
    expect(git(repo, ["status", "--porcelain=v1", "--untracked-files=all"])).toBe(statusBefore);
    expect(git(repo, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(existsSync(path.join(repo, ".arcadia"))).toBe(false);
  });

  it("leaves no brief child or hung git behind when the caller SIGKILLs the launcher's process group", async () => {
    const { repo, workspace } = candidateFixture();
    const shims = path.join(path.dirname(repo), "shims");
    const pids = path.join(path.dirname(repo), "git.pids");
    // $$ is the hung git (exec keeps the pid); $PPID is the brief child.
    write(path.join(shims, "git"), `#!/bin/sh\necho "$$ $PPID" >> '${pids}'\nexec sleep 30\n`);
    chmodSync(path.join(shims, "git"), 0o755);
    // The launcher leads its own group here, as a harness's tool process would.
    const launcher = spawn(process.execPath, ["--import", tsxLoader, entrypoint, "codex", "brief"], {
      cwd: repo,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, CODEX_SANDBOX: "", ARCADIA_WORKSPACE: workspace, PATH: `${shims}${path.delimiter}${process.env.PATH ?? ""}` }
    });
    try {
      const until = Date.now() + 30_000;
      while (!existsSync(pids) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 100));
      const [gitPid, childPid] = readFileSync(pids, "utf8").trim().split("\n")[0].split(" ").map(Number);
      expect(alive(gitPid) && alive(childPid)).toBe(true);
      process.kill(-launcher.pid!, "SIGKILL");
      await expectDead(childPid);
      await expectDead(gitPid);
    } finally {
      try { process.kill(-launcher.pid!, "SIGKILL"); } catch { /* Already gone. */ }
    }
  });

  it("answers the internal self-test without a workspace", () => {
    const directory = scratch();
    const result = runBriefLauncher(directory, { ARCADIA_GO_BROKER_SELFTEST: "1", ARCADIA_WORKSPACE: "" });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, command: "brief-broker.self-test", data: { readOnly: true } });
    expect(JSON.parse(result.stdout).data.correlationId).toMatch(UUID);
  });
});
