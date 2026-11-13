import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  KEEPER_LOCK_FILE,
  KEEPER_RECORD_FILE,
  acquireLock,
  readKeeperRecord,
  renderKeeperStartSuccess,
  runKeeperStartCommand,
  runKeeperStatusCommand,
  runKeeperStopCommand,
  type KeeperDependencies
} from "../src/commands/keeper.js";
import { runKeeperHeartbeatCommand } from "../src/commands/productionMomentum.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const SUPERVISOR = "local_supervisor-1";
const BRIEF = path.resolve(import.meta.dirname, "..", "docs", "agent-guidance", "momentum-keeper-brief.md");

function scratch(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-keeper-"));
  roots.push(root);
  return root;
}

function workspace(): string {
  const root = scratch();
  initWorkspace(root);
  mkdirSync(path.join(root, ".arcadia"), { recursive: true });
  return root;
}

interface Fake { deps: KeeperDependencies; dir: string; calls: () => string[][]; cwds: () => string[]; setAgents: (json: string) => void; queueAgents: (...json: string[]) => void; setLaunchRow: (row: Record<string, unknown>) => void }

/**
 * A fake `claude` on PATH: logs each argv as JSON, prints a short id for --bg, and models `claude agents --json`
 * honestly: the listing starts as whatever the test sets (sessions that ALREADY exist, the pre-launch snapshot), and
 * `--bg` then adds one NEW row (the launched keeper; override with setLaunchRow) that appears from the
 * `agentsAfter`-th listing after the launch (default: the first).
 */
function fakeClaude(behaviour: { failBg?: boolean; failStop?: string; silentBg?: boolean; bgOutput?: string; agentsAfter?: number; noLaunchRow?: boolean } = {}): Fake {
  const dir = realpathSync(scratch());
  execFileSync("git", ["init", "-q", dir]);
  const log = path.join(dir, "calls.jsonl");
  const agents = path.join(dir, "agents.json");
  const cwdLog = path.join(dir, "cwds.txt");
  writeFileSync(agents, "[]");
  const launchedFile = path.join(dir, "agents.launched.json");
  const launchRowFile = path.join(dir, "agents.launchrow.json");
  const queue = path.join(dir, "agents.queue.json");
  const statePath = path.join(dir, "claude-state.json");
  writeFileSync(statePath, JSON.stringify({ projects: { [dir]: { hasTrustDialogAccepted: true } } }));
  const script = `#!/usr/bin/env node
import fs from "node:fs";
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");
fs.appendFileSync(${JSON.stringify(cwdLog)}, fs.realpathSync(process.cwd()) + "\\n");
const [cmd] = process.argv.slice(2);
if (cmd === "--bg") {
  if (${behaviour.failBg === true}) { console.error("boom: not signed in"); process.exit(3); }
  if (${behaviour.noLaunchRow !== true}) {
    const row = fs.existsSync(${JSON.stringify(launchRowFile)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(launchRowFile)}, "utf8")) : { id: "abcd1234", name: "♾️ Flynn · keeper starting", cwd: fs.realpathSync(process.cwd()) };
    const launched = fs.existsSync(${JSON.stringify(launchedFile)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(launchedFile)}, "utf8")) : [];
    fs.writeFileSync(${JSON.stringify(launchedFile)}, JSON.stringify([...launched, row]));
    fs.writeFileSync(${JSON.stringify(agents + ".post")}, "0");
  }
  if (${behaviour.silentBg === true}) console.log("started"); else console.log(${JSON.stringify(behaviour.bgOutput ?? "started background session abcd1234")});
} else if (cmd === "agents") {
  const queueFile = ${JSON.stringify(queue)};
  const queued = fs.existsSync(queueFile) ? JSON.parse(fs.readFileSync(queueFile, "utf8")) : [];
  if (queued.length > 0) { const next = queued.shift(); fs.writeFileSync(queueFile, JSON.stringify(queued)); process.stdout.write(next); process.exit(0); }
  const base = JSON.parse(fs.readFileSync(${JSON.stringify(agents)}, "utf8"));
  const launched = fs.existsSync(${JSON.stringify(launchedFile)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(launchedFile)}, "utf8")) : [];
  let rows = base;
  if (launched.length > 0) {
    const post = Number(fs.readFileSync(${JSON.stringify(agents + ".post")}, "utf8")) + 1;
    fs.writeFileSync(${JSON.stringify(agents + ".post")}, String(post));
    if (post >= ${behaviour.agentsAfter ?? 1}) rows = [...base, ...launched];
  }
  process.stdout.write(JSON.stringify(rows));
} else if (cmd === "stop") {
  if (${behaviour.failStop !== undefined}) { console.error(${JSON.stringify(behaviour.failStop ?? "")}); process.exit(4); }
  console.log("stopped");
}
`;
  const bin = path.join(dir, "claude");
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  return {
    deps: { env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}` }, cwd: dir, briefPath: BRIEF, now: () => Date.parse("2026-11-10T20:00:00.000Z"), claudeStatePath: statePath, claudeProjectsDirectory: path.join(dir, "projects"), sleep: () => undefined },
    dir,
    cwds: () => (existsSync(cwdLog) ? readFileSync(cwdLog, "utf8").trim().split("\n").filter(Boolean) : []),
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]) : []),
    // Replaces the whole listing from now on (sessions that exist; the keeper launched earlier is gone unless it is in `json`).
    setAgents: (json) => { writeFileSync(agents, json); rmSync(launchedFile, { force: true }); },
    setLaunchRow: (row) => writeFileSync(launchRowFile, JSON.stringify(row)),
    queueAgents: (...json) => writeFileSync(queue, JSON.stringify(json))
  };
}

describe("arcadia keeper start", () => {
  it("dry run prints the exact argv with the brief and supervisor substituted, and changes nothing", () => {
    const root = workspace();
    const fake = fakeClaude();
    const result = runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR, dryRun: true }, fake.deps).data;
    expect(result.argv.slice(0, 10)).toEqual([
      "claude", "--bg", "--remote-control", "momentum-keeper", "-n", "♾️ Flynn · keeper starting",
      "--model", "sonnet", "--permission-mode", "auto"
    ]);
    // `--bg` ignores --session-id (probe P2), so none is passed.
    expect(result.argv).not.toContain("--session-id");
    const prompt = result.argv.at(-1) as string;
    expect(prompt).toContain(`coordinator session \`${SUPERVISOR}\``);
    expect(prompt).not.toContain("{{SUPERVISOR}}");
    expect(prompt.startsWith("You are")).toBe(true);
    expect(fake.calls()).toEqual([]);
    expect(existsSync(path.join(root, ".arcadia", KEEPER_RECORD_FILE))).toBe(false);
    expect(renderKeeperStartSuccess({ command: "keeper.start", data: result } as never)[0]).toMatch(/Dry run/);
  });

  it("requires a well-formed supervisor", () => {
    const root = workspace();
    expect(() => runKeeperStartCommand({ workspace: root }, fakeClaude().deps)).toThrow(/--supervisor/);
    expect(() => runKeeperStartCommand({ workspace: root, supervisor: "a b; rm -rf" }, fakeClaude().deps)).toThrow(/--supervisor/);
  });

  it("launches once and records the launch", () => {
    const root = workspace();
    const fake = fakeClaude();
    const data = runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps).data;
    const launches = fake.calls().filter((call) => call[0] === "--bg");
    expect(launches).toHaveLength(1);
    expect(launches[0]).toContain("--remote-control");
    const record = readKeeperRecord(root);
    expect(record).toMatchObject({
      status: "running", supervisor: SUPERVISOR, remoteControlName: "momentum-keeper", model: "sonnet",
      sessionId: "abcd1234", stopId: "abcd1234", stoppedAt: null
    });
    expect(record?.argv).toEqual(data.argv);
  });

  it("refuses while a keeper heartbeat is live, launching nothing", () => {
    const root = workspace();
    runKeeperHeartbeatCommand({ workspace: root, minutes: 30 }, { now: () => Date.parse("2026-11-10T19:55:00.000Z") });
    const fake = fakeClaude();
    expect(() => runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps)).toThrow(/already live.*heartbeat/);
    expect(fake.calls().filter((call) => call[0] === "--bg")).toHaveLength(0);
    expect(readKeeperRecord(root)).toBeNull();
  });

  it("refuses while the recorded keeper is still listed by claude agents, and proceeds once it is not", () => {
    const root = workspace();
    const fake = fakeClaude();
    runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps);
    expect(() => runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps)).toThrow(/still listed/);
    expect(fake.calls().filter((call) => call[0] === "--bg")).toHaveLength(1);
    // The first keeper is gone from the listing: the next start proceeds and finds its own new row.
    fake.setAgents("[]");
    runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps);
    expect(fake.calls().filter((call) => call[0] === "--bg")).toHaveLength(2);
  });

  it("reports a launch failure and writes no record", () => {
    const root = workspace();
    const fake = fakeClaude({ failBg: true });
    expect(() => runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps)).toThrow(/did not start and no record was written.*not signed in/);
    expect(existsSync(path.join(root, ".arcadia", KEEPER_RECORD_FILE))).toBe(false);
  });
});

describe("arcadia keeper status and stop", () => {
  it("status is read-only and reports the record, the agents listing and the heartbeat", () => {
    const root = workspace();
    const fake = fakeClaude();
    expect(runKeeperStatusCommand({ workspace: root }, fake.deps).data).toMatchObject({ record: null, listed: null, heartbeat: null });
    runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps);
    fake.setAgents(JSON.stringify([{ id: "abcd1234" }]));
    runKeeperHeartbeatCommand({ workspace: root, minutes: 30 }, { now: () => Date.parse("2026-11-10T20:00:00.000Z") });
    const status = runKeeperStatusCommand({ workspace: root }, fake.deps).data;
    expect(status.listed).toBe(true);
    expect(status.heartbeat).toMatchObject({ live: true, armedUntil: "2026-11-10T20:30:00.000Z" });
    expect(fake.calls().filter((call) => call[0] === "--bg" || call[0] === "stop")).toHaveLength(1);
  });

  it("stop calls claude stop with the recorded id and marks the record stopped", () => {
    const root = workspace();
    const fake = fakeClaude();
    runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps);
    const stopped = runKeeperStopCommand({ workspace: root }, fake.deps).data.record;
    expect(fake.calls().filter((call) => call[0] === "stop")).toEqual([["stop", "abcd1234"]]);
    expect(stopped.status).toBe("stopped");
    expect(readKeeperRecord(root)?.stoppedAt).toBe("2026-11-10T20:00:00.000Z");
    expect(() => runKeeperStopCommand({ workspace: root }, fake.deps)).toThrow(/already stopped/);
  });

  it("stop keeps the record running when claude stop fails for another reason, and refuses with no record", () => {
    const root = workspace();
    expect(() => runKeeperStopCommand({ workspace: root }, fakeClaude().deps)).toThrow(/nothing to stop/);
    const fake = fakeClaude({ failStop: "permission denied" });
    runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps);
    expect(() => runKeeperStopCommand({ workspace: root }, fake.deps)).toThrow(/record is unchanged.*permission denied.*--forget/);
    expect(readKeeperRecord(root)?.status).toBe("running");
  });

  it("stop closes the record when claude no longer knows the session", () => {
    const root = workspace();
    const fake = fakeClaude({ failStop: "no such session" });
    runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps);
    const result = runKeeperStopCommand({ workspace: root }, fake.deps).data;
    expect(result.note).toMatch(/no longer knows/);
    expect(readKeeperRecord(root)?.status).toBe("stopped");
  });

  it("stop --forget closes the record without calling claude stop", () => {
    const root = workspace();
    const fake = fakeClaude({ failStop: "permission denied" });
    runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps);
    runKeeperStopCommand({ workspace: root, forget: true }, fake.deps);
    expect(fake.calls().filter((call) => call[0] === "stop")).toHaveLength(0);
    expect(readKeeperRecord(root)?.status).toBe("stopped");
  });
});

describe("arcadia keeper start safety", () => {
  it("spawns in the primary checkout even when started from a linked worktree, and refuses a non-git cwd", () => {
    const root = workspace();
    const fake = fakeClaude();
    execFileSync("git", ["-C", fake.dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"]);
    const linked = path.join(scratch(), "linked");
    execFileSync("git", ["-C", fake.dir, "worktree", "add", "-q", "-b", "task", linked]);
    runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, { ...fake.deps, cwd: linked });
    // The launch and the follow-up `claude agents --json` both run in the primary checkout.
    expect(new Set(fake.cwds())).toEqual(new Set([fake.dir]));
    expect(readKeeperRecord(root)?.status).toBe("running");
    const plain = realpathSync(scratch());
    const other = fakeClaude();
    expect(() => runKeeperStartCommand({ workspace: workspace(), supervisor: SUPERVISOR }, { ...other.deps, cwd: plain })).toThrow(/primary checkout/);
    expect(other.calls()).toEqual([]);
  });

  it("refuses while another start holds the lock, launches nothing, and releases the lock on success and failure", () => {
    const root = workspace();
    const fake = fakeClaude();
    const lock = path.join(root, ".arcadia", KEEPER_LOCK_FILE);
    writeFileSync(lock, "{}\n");
    expect(() => runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps)).toThrow(/in progress/);
    expect(fake.calls()).toEqual([]);
    rmSync(lock);
    runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps);
    expect(existsSync(lock)).toBe(false);
    const failing = fakeClaude({ failBg: true });
    const second = workspace();
    expect(() => runKeeperStartCommand({ workspace: second, supervisor: SUPERVISOR }, failing.deps)).toThrow(/did not start/);
    expect(existsSync(path.join(second, ".arcadia", KEEPER_LOCK_FILE))).toBe(false);
  });

  it("matches the listing by exact field, not substring", () => {
    const root = workspace();
    const fake = fakeClaude();
    runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps);
    fake.setAgents(JSON.stringify([{ id: "abcd12345", sessionId: "xx-abcd1234-yy", name: "copy of ♾️ Flynn · keeper starting" }]));
    expect(runKeeperStatusCommand({ workspace: root }, fake.deps).data.listed).toBe(false);
    fake.setAgents(JSON.stringify([{ id: "abcd1234" }]));
    expect(runKeeperStatusCommand({ workspace: root }, fake.deps).data.listed).toBe(true);
  });
});

describe("arcadia keeper start: probe P1/P2 adaptations (trusted folder, real --bg session id, exact brief, observed model)", () => {
  const FULL = "686736ac-1111-4222-8333-444455556666";
  const NAME = "♾️ Flynn · keeper starting";
  const row = (dir: string, extra: Record<string, unknown> = {}) => ({ id: "abcd1234", sessionId: FULL, name: NAME, cwd: dir, ...extra });

  it("refuses an untrusted launch folder before launching, and says why; the dry run reports it", () => {
    const root = workspace();
    const fake = fakeClaude();
    const untrusted = { ...fake.deps, claudeStatePath: path.join(fake.dir, "absent-state.json") };
    expect(() => runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, untrusted)).toThrow(/not started.*cannot be shown to be trusted/);
    expect(fake.calls()).toEqual([]);
    expect(readKeeperRecord(root)).toBeNull();
    const dry = runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR, dryRun: true }, untrusted);
    expect(dry.data.trust.trusted).toBe(false);
    expect(renderKeeperStartSuccess(dry).join("\n")).toMatch(/A real start would refuse: .*trust/);
  });

  it("records the REAL session id from the new agents row, not one asked for, and never passes --session-id", () => {
    const root = workspace();
    const fake = fakeClaude();
    fake.setLaunchRow(row(fake.dir));
    runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps);
    expect(fake.calls().find((call) => call[0] === "--bg")).not.toContain("--session-id");
    expect(readKeeperRecord(root)).toMatchObject({ sessionId: FULL, stopId: "abcd1234", trustedFolder: fake.dir });
  });

  it("snapshots the agents listing BEFORE launching (and refuses to launch when it cannot be read)", () => {
    const root = workspace();
    const fake = fakeClaude();
    runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps);
    const order = fake.calls().map((call) => call[0]);
    expect(order.indexOf("agents")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("agents")).toBeLessThan(order.indexOf("--bg"));
    const broken = fakeClaude();
    broken.queueAgents("not json", "not json");
    expect(() => runKeeperStartCommand({ workspace: workspace(), supervisor: SUPERVISOR }, broken.deps)).toThrow(/could not be read before launching.*Nothing was launched/s);
    expect(broken.calls().filter((call) => call[0] === "--bg")).toHaveLength(0);
  });

  it("never takes a STALE row as the new keeper: an old unstopped keeper with the same name and cwd is not the stop target", () => {
    const root = workspace();
    const fake = fakeClaude({ noLaunchRow: true });
    fake.setAgents(JSON.stringify([{ id: "oldoldol", sessionId: "11111111-1111-4111-8111-111111111111", name: NAME, cwd: fake.dir }]));
    expect(() => runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps)).toThrow(/could not be verified.*no record was written/);
    expect(readKeeperRecord(root)).toBeNull();
  });

  it("never takes a printed token that matches an OLD row in the same cwd; the genuinely new row is used", () => {
    const stale = { id: "deadbeef", name: "other keeper", cwd: "" };
    const root = workspace();
    const fake = fakeClaude({ bgOutput: "started deadbeef" });
    stale.cwd = fake.dir;
    fake.setAgents(JSON.stringify([stale]));
    fake.setLaunchRow(row(fake.dir, { id: "feedc0de" }));
    runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps);
    expect(readKeeperRecord(root)).toMatchObject({ stopId: "feedc0de" });
    const noNew = fakeClaude({ bgOutput: "started deadbeef", noLaunchRow: true });
    noNew.setAgents(JSON.stringify([{ ...stale, cwd: noNew.dir }]));
    expect(() => runKeeperStartCommand({ workspace: workspace(), supervisor: SUPERVISOR }, noNew.deps)).toThrow(/deadbeef.*no new .*row.*not used as a stop target/s);
  });

  it("finds the new row when it is listed late, ignoring the stale same-name row on the earlier attempts", () => {
    const root = workspace();
    const fake = fakeClaude({ agentsAfter: 3 });
    fake.setAgents(JSON.stringify([{ id: "oldoldol", name: NAME, cwd: fake.dir }]));
    fake.setLaunchRow(row(fake.dir));
    runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps);
    expect(fake.calls().filter((call) => call[0] === "agents").length).toBeGreaterThanOrEqual(4);
    expect(readKeeperRecord(root)?.stopId).toBe("abcd1234");
  });

  it("leaves several new rows unverified and writes no record", () => {
    const root = workspace();
    const fake = fakeClaude();
    fake.setLaunchRow(row(fake.dir));
    // A second, unrelated session appears in the same cwd during the launch: ambiguous, so nothing is recorded.
    fake.queueAgents("[]", JSON.stringify([row(fake.dir), { id: "cafebabe", name: "someone else", cwd: fake.dir }]), JSON.stringify([row(fake.dir), { id: "cafebabe", name: "someone else", cwd: fake.dir }]), JSON.stringify([row(fake.dir), { id: "cafebabe", name: "someone else", cwd: fake.dir }]), JSON.stringify([row(fake.dir), { id: "cafebabe", name: "someone else", cwd: fake.dir }]));
    expect(() => runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps)).toThrow(/could not be verified.*no record was written/);
    expect(readKeeperRecord(root)).toBeNull();
  });

  it("records the exact brief hash, verifies delivery against the transcript, and records the observed model (not the requested one)", () => {
    const root = workspace();
    const fake = fakeClaude();
    fake.setLaunchRow(row(fake.dir, { name: "x" }));
    const brief = runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR, dryRun: true }, fake.deps).data.argv.at(-1) as string;
    const projects = path.join(fake.dir, "projects", "slug");
    mkdirSync(projects, { recursive: true });
    writeFileSync(path.join(projects, `${FULL}.jsonl`), [
      { type: "user", message: { content: brief } },
      { type: "assistant", message: { model: "claude-haiku-5-5" } }
    ].map((line) => JSON.stringify(line)).join("\n"));
    const response = runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps);
    const proof = readKeeperRecord(root)?.proof;
    expect(proof).toMatchObject({ transport: "bg", sessionId: FULL, delivered: true, observed: { provider: "claude", model: "claude-haiku-5-5", effort: null }, requested: { model: "sonnet" }, modelMatchesRequest: false });
    expect(proof?.briefSha).toBe(createHash("sha256").update(brief.trim()).digest("hex"));
    expect(renderKeeperStartSuccess(response).join("\n")).toMatch(/delivered exactly.*observed model claude-haiku-5-5, effort unobserved/s);
    expect(proof?.warnings.join(" ")).toMatch(/does not correspond to the requested sonnet/);
  });

  it("flags a brief that was not delivered as sent, and an absent transcript as unverified, without failing the launch", () => {
    const root = workspace();
    const fake = fakeClaude();
    fake.setLaunchRow(row(fake.dir));
    const projects = path.join(fake.dir, "projects", "slug");
    mkdirSync(projects, { recursive: true });
    writeFileSync(path.join(projects, `${FULL}.jsonl`), `${JSON.stringify({ type: "user", message: { content: "something else" } })}\n`);
    runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps);
    expect(readKeeperRecord(root)?.proof).toMatchObject({ delivered: false, observed: { model: null } });
    const bare = workspace();
    const printedOnly = fakeClaude();
    printedOnly.setLaunchRow({ id: "abcd1234", name: "x", cwd: printedOnly.dir });
    runKeeperStartCommand({ workspace: bare, supervisor: SUPERVISOR }, printedOnly.deps);
    const proof = readKeeperRecord(bare)?.proof;
    expect(proof).toMatchObject({ delivered: false, deliveredSha: null, sessionId: null });
    expect(proof?.warnings.join(" ")).toMatch(/no full session UUID/);
  });

  it("writes no record and says so when no new row is ever listed", () => {
    const root = workspace();
    const fake = fakeClaude({ silentBg: true, noLaunchRow: true });
    expect(() => runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps)).toThrow(/could not be verified.*no record was written/);
    expect(readKeeperRecord(root)).toBeNull();
  });

  it("does not take decoy digits in the launch output as the session id: the new row wins", () => {
    const root = workspace();
    const fake = fakeClaude({ bgOutput: "keeper started 20261112 at 2026-11-12 (build deadbeef)" });
    fake.setLaunchRow(row(fake.dir));
    runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps);
    expect(readKeeperRecord(root)).toMatchObject({ sessionId: FULL, stopId: "abcd1234" });
  });

  it("records nothing when the printed id has no matching new row, and names it as unverified, never a stop target", () => {
    const root = workspace();
    const fake = fakeClaude({ bgOutput: "started background session 20261112" });
    fake.setLaunchRow({ id: "ffffffff", name: "someone else", cwd: "/elsewhere" });
    expect(() => runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps)).toThrow(/20261112.*no new .*row.*confirms.*not used as a stop target/s);
    expect(readKeeperRecord(root)).toBeNull();
  });

  it("reads trust from CLAUDE_CONFIG_DIR in the launch environment when it is set", () => {
    const fake = fakeClaude();
    const configDir = path.join(fake.dir, "cfg");
    mkdirSync(configDir, { recursive: true });
    const { claudeStatePath: _override, ...rest } = fake.deps;
    void _override;
    const env = { ...fake.deps.env, CLAUDE_CONFIG_DIR: configDir };
    // Not trusted there: the state file under CLAUDE_CONFIG_DIR does not exist, whatever ~/.claude.json says.
    expect(() => runKeeperStartCommand({ workspace: workspace(), supervisor: SUPERVISOR }, { ...rest, env })).toThrow(new RegExp(`${configDir}/\\.claude\\.json`));
    writeFileSync(path.join(configDir, ".claude.json"), JSON.stringify({ projects: { [fake.dir]: { hasTrustDialogAccepted: true } } }));
    const root = workspace();
    runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, { ...rest, env });
    expect(readKeeperRecord(root)?.status).toBe("running");
  });

  it("does not wait for a transcript when the host listed no full session UUID, and never records an empty id", () => {
    const root = workspace();
    const fake = fakeClaude();
    fake.setLaunchRow({ id: "abcd1234", name: "x", cwd: fake.dir });
    const sleeps: number[] = [];
    runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, { ...fake.deps, sleep: (ms) => { sleeps.push(ms); } });
    expect(sleeps).toEqual([]);
    expect(readKeeperRecord(root)?.stopId).toBe("abcd1234");
    const interactive = fakeClaude();
    interactive.setLaunchRow({ name: "♾️ Flynn · keeper starting", cwd: interactive.dir });
    expect(() => runKeeperStartCommand({ workspace: workspace(), supervisor: SUPERVISOR }, interactive.deps)).toThrow(/could not be verified/);
  });
});

describe("arcadia keeper start: stale-lock reclaim and checkout workspace (#2464)", () => {
  const TEN_MINUTES = 10 * 60_000;
  // A pid that is not running on this host, so a stale lock's owner counts as dead.
  const DEAD_PID = 999_999;
  type Hooks = Parameters<typeof acquireLock>[2];

  function staleLock(root: string, body: Record<string, unknown> = { pid: DEAD_PID, startedAt: "crashed", token: "crashed" }): string {
    const lock = path.join(root, ".arcadia", KEEPER_LOCK_FILE);
    writeFileSync(lock, `${JSON.stringify(body)}\n`);
    const old = new Date(Date.now() - TEN_MINUTES);
    utimesSync(lock, old, old);
    return lock;
  }

  const gateOf = (root: string): string => path.join(root, ".arcadia", `${KEEPER_LOCK_FILE}.reclaim`);

  function messageOf(run: () => unknown): string {
    try {
      run();
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error("expected the call to throw");
  }

  it("reviewer's three-starter scenario: B sees the stale lock, A reclaims and proceeds, then B and C attempt: exactly one winner, and A's lock is never removed or replaced", () => {
    const root = workspace();
    const lock = staleLock(root);
    const winners: Array<() => void> = [];
    const refusals: string[] = [];
    const attempt = (hooks: Hooks = {}): void => {
      try { winners.push(acquireLock(root, Date.now(), hooks)); } catch (error) { refusals.push((error as Error).message); }
    };
    const seen: { inode?: number } = {};
    // A rival that starts while B holds the reclaim gate, after B has seen that the lock is still A's.
    const rival = (): void => attempt();
    attempt({ beforeReclaim: () => { attempt(); seen.inode = statSync(lock).ino; }, beforeUnlink: rival });
    expect(winners).toHaveLength(1);
    expect(refusals).toHaveLength(2);
    for (const refusal of refusals) expect(refusal).toMatch(/in progress/);
    expect(statSync(lock).ino).toBe(seen.inode);
    expect(existsSync(gateOf(root))).toBe(false);
    winners[0]?.();
    expect(existsSync(lock)).toBe(false);
  });

  it("two starters reclaiming one stale lock: the starter holding the reclaim gate wins, and a rival that tries while the gate is held refuses", () => {
    const root = workspace();
    const lock = staleLock(root);
    const winners: Array<() => void> = [];
    const refusals: string[] = [];
    const attempt = (hooks: Hooks = {}): void => {
      try { winners.push(acquireLock(root, Date.now(), hooks)); } catch (error) { refusals.push((error as Error).message); }
    };
    attempt({ afterGateAcquired: () => attempt() });
    expect(winners).toHaveLength(1);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatch(/in progress/);
    expect(existsSync(lock)).toBe(true);
    expect(existsSync(gateOf(root))).toBe(false);
    winners[0]?.();
    expect(existsSync(lock)).toBe(false);
  });

  it("a fresh lock that appears under the gate makes the reclaim refuse, and the fresh lock is kept", () => {
    const root = workspace();
    const lock = staleLock(root);
    const rival: Array<() => void> = [];
    const message = messageOf(() => acquireLock(root, Date.now(), {
      beforeUnlink: () => {
        // The stale file is replaced by a fresh lock after the stale check and before the unlink.
        rmSync(lock);
        rival.push(acquireLock(root, Date.now()));
      }
    }));
    expect(message).toMatch(/in progress/);
    expect(existsSync(lock)).toBe(true);
    expect(existsSync(gateOf(root))).toBe(false);
    rival[0]?.();
  });

  it("a live reclaim gate refuses the start and leaves the stale lock and the gate alone", () => {
    const root = workspace();
    const lock = staleLock(root);
    const gate = gateOf(root);
    writeFileSync(gate, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`);
    const inode = statSync(lock).ino;
    expect(() => acquireLock(root, Date.now())).toThrow(/in progress/);
    expect(statSync(lock).ino).toBe(inode);
    expect(existsSync(gate)).toBe(true);
  });

  it("a gate left by a crashed reclaimer is never removed automatically, and the refusal names it for removal by hand", () => {
    const root = workspace();
    const lock = staleLock(root);
    const gate = gateOf(root);
    writeFileSync(gate, "{}\n");
    const old = new Date(Date.now() - TEN_MINUTES);
    utimesSync(gate, old, old);
    const message = messageOf(() => acquireLock(root, Date.now()));
    expect(message).toMatch(/in progress/);
    expect(message).toContain(gate);
    expect(message).toContain("remove it by hand");
    expect(existsSync(gate)).toBe(true);
    expect(existsSync(lock)).toBe(true);
  });

  it("a live owner pid always wins, even when the lock is older than the stale window", () => {
    const root = workspace();
    const lock = staleLock(root, { pid: process.pid, startedAt: "old", token: "live" });
    expect(() => acquireLock(root, Date.now())).toThrow(/in progress/);
    expect(existsSync(lock)).toBe(true);
    expect(existsSync(gateOf(root))).toBe(false);
  });

  it("releases only a lock that carries this start's token", () => {
    const root = workspace();
    const release = acquireLock(root, Date.now());
    const lock = path.join(root, ".arcadia", KEEPER_LOCK_FILE);
    writeFileSync(lock, `${JSON.stringify({ pid: process.pid, startedAt: "other", token: "someone-else" })}\n`);
    release();
    expect(existsSync(lock)).toBe(true);
  });

  it("refuses a --workspace inside the primary checkout before any lock or record is written", () => {
    const fake = fakeClaude();
    const inside = path.join(fake.dir, "workspace");
    mkdirSync(inside);
    initWorkspace(inside);
    mkdirSync(path.join(inside, ".arcadia"), { recursive: true });
    expect(() => runKeeperStartCommand({ workspace: inside, supervisor: SUPERVISOR }, fake.deps)).toThrow(/inside the primary checkout/);
    expect(existsSync(path.join(inside, ".arcadia", KEEPER_LOCK_FILE))).toBe(false);
    expect(existsSync(path.join(inside, ".arcadia", KEEPER_RECORD_FILE))).toBe(false);
    expect(fake.calls()).toEqual([]);
  });

  // Case-insensitive volumes (macOS APFS by default) only: on a case-sensitive filesystem the swapped spelling does not exist.
  const caseInsensitive = existsSync(import.meta.dirname.toUpperCase());
  it.skipIf(!caseInsensitive)("refuses a --workspace inside the primary checkout when the checkout is spelled in a different case", () => {
    const fake = fakeClaude();
    const inside = path.join(fake.dir, "workspace");
    mkdirSync(inside);
    initWorkspace(inside);
    mkdirSync(path.join(inside, ".arcadia"), { recursive: true });
    const swapped = path.join(fake.dir.toUpperCase(), "workspace");
    expect(() => runKeeperStartCommand({ workspace: swapped, supervisor: SUPERVISOR }, fake.deps)).toThrow(/inside the primary checkout/);
    expect(existsSync(path.join(inside, ".arcadia", KEEPER_LOCK_FILE))).toBe(false);
    expect(fake.calls()).toEqual([]);
  });
});
