import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  KEEPER_RECORD_FILE,
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

interface Fake { deps: KeeperDependencies; calls: () => string[][]; setAgents: (json: string) => void }

/** A fake `claude` on PATH: logs each argv as JSON, prints a short id for --bg, lists what the test sets. */
function fakeClaude(behaviour: { failBg?: boolean; failStop?: boolean } = {}): Fake {
  const dir = scratch();
  const log = path.join(dir, "calls.jsonl");
  const agents = path.join(dir, "agents.json");
  writeFileSync(agents, "[]");
  const script = `#!/usr/bin/env node
const fs = require("fs");
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");
const [cmd] = process.argv.slice(2);
if (cmd === "--bg") {
  if (${behaviour.failBg === true}) { console.error("boom: not signed in"); process.exit(3); }
  console.log("started background session abcd1234");
} else if (cmd === "agents") {
  process.stdout.write(fs.readFileSync(${JSON.stringify(agents)}, "utf8"));
} else if (cmd === "stop") {
  if (${behaviour.failStop === true}) { console.error("no such session"); process.exit(4); }
  console.log("stopped");
}
`;
  const bin = path.join(dir, "claude");
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  return {
    deps: { env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}` }, cwd: dir, briefPath: BRIEF, now: () => Date.parse("2026-11-10T20:00:00.000Z"), newSessionId: () => "11111111-2222-3333-4444-555555555555" },
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]) : []),
    setAgents: (json) => writeFileSync(agents, json)
  };
}

describe("arcadia keeper start", () => {
  it("dry run prints the exact argv with the brief and supervisor substituted, and changes nothing", () => {
    const root = workspace();
    const fake = fakeClaude();
    const result = runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR, dryRun: true }, fake.deps).data;
    expect(result.argv.slice(0, 11)).toEqual([
      "claude", "--bg", "--remote-control", "momentum-keeper", "-n", `↳ Momentum Keeper · under ${SUPERVISOR}`,
      "--model", "sonnet", "--permission-mode", "auto", "--session-id"
    ]);
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
      sessionId: "11111111-2222-3333-4444-555555555555", stopId: "abcd1234", stoppedAt: null
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
    fake.setAgents(JSON.stringify([{ id: "abcd1234", name: "x" }]));
    expect(() => runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps)).toThrow(/still listed/);
    expect(fake.calls().filter((call) => call[0] === "--bg")).toHaveLength(1);
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

  it("stop keeps the record running when claude stop fails, and refuses with no record", () => {
    const root = workspace();
    expect(() => runKeeperStopCommand({ workspace: root }, fakeClaude().deps)).toThrow(/nothing to stop/);
    const fake = fakeClaude({ failStop: true });
    runKeeperStartCommand({ workspace: root, supervisor: SUPERVISOR }, fake.deps);
    expect(() => runKeeperStopCommand({ workspace: root }, fake.deps)).toThrow(/record is unchanged.*no such session/);
    expect(readKeeperRecord(root)?.status).toBe("running");
  });
});
