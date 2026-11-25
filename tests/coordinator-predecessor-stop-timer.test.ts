import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapsuleSources } from "../src/coordinator/capsule.js";
import { coordinatorPaths } from "../src/coordinator/paths.js";
import {
  acceptGeneration,
  claimNextGeneration,
  newestLaunching,
  recordStandDown,
  seedCustodianGeneration
} from "../src/coordinator/generations.js";
import { stopPredecessorAfterAccept, systemPaneIdentity, type PaneIdentity, type PredecessorStopDeps } from "../src/coordinator/predecessorStop.js";
import { findPredecessorStopCandidates, renderPredecessorStopTimerLines, runPredecessorStopTimer } from "../src/coordinator/predecessorStopTimer.js";
import { runCoordinatorRelaySessionsCommand } from "../src/commands/coordinator.js";
import { runProductionLivenessTimerCommand } from "../src/commands/productionMomentum.js";
import { withDatabase } from "../src/db/connection.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

/**
 * #3029 fix A, part 1: the host liveness timer (outside any agent sandbox) stops a handed-off predecessor coordinator's tmux
 * after its successor accepted, by the exact recorded identity, through predecessorStop.ts's own checks and receipt.
 * Every tmux call here is a fake: no test touches a real tmux server.
 */

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const PROJECT = "arcadia";
const ROLE = "rowan";
const NOW = new Date("2026-11-24T22:00:00Z");
const SESSION_1 = "11111111-1111-4111-8111-111111111111";
const SESSION_2 = "22222222-2222-4222-8222-222222222222";
const SESSION_3 = "33333333-3333-4333-8333-333333333333";
const REPO = "/Users/example/repo";
const G1 = "arcadia-coord-rowan-g1";
const G2 = "arcadia-coord-rowan-g2";

const sources: CapsuleSources = {
  plan: () => ({ activePlan: null, currentAction: null, mainSha: "abc" }),
  production: () => ({ status: "inactive", revision: 0, epoch: 0, openEscalations: [], redAlerts: [] }),
  prs: () => [], sessions: () => [], decisions: () => ({ open: [], recentlyAnswered: [], pendingMerge: [] }),
  pings: () => ({ pending: [], recent: [] }), budget: () => null
};

function fresh(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-predecessor-timer-"));
  roots.push(root);
  const ws = path.join(root, "workspace");
  initWorkspace(ws);
  return ws;
}

type Fake = ReturnType<typeof fakeDeps>;

/** A fake tmux server (a set of live names) plus spies for every other host effect. */
function fakeDeps(options: { live?: string[]; unknown?: string[]; identity?: PaneIdentity; press?: { inProgress: boolean; detail: string } } = {}) {
  const sessions = new Set(options.live ?? []);
  const killed: string[] = [];
  const probed: string[] = [];
  const identityChecks: Array<[string, string]> = [];
  const tmux: PredecessorStopDeps["tmux"] = {
    state: (name) => { probed.push(name); return (options.unknown ?? []).includes(name) ? "unknown" : sessions.has(name) ? "present" : "absent"; },
    killSession: (name) => { killed.push(name); sessions.delete(name); },
    paneIdentity: (name, sessionId) => { identityChecks.push([name, sessionId]); return options.identity ?? "match"; }
  };
  const claudeStop = vi.fn((_id: string) => ({ ok: true as const }));
  const ping = vi.fn((_message: string) => undefined);
  const press = vi.fn((_repo: string) => options.press ?? { inProgress: false, detail: "no START press in progress" });
  const stopDeps: PredecessorStopDeps = { tmux, claudeStop, startPressInProgress: press, ping, now: () => NOW };
  return { stopDeps, sessions, killed, probed, identityChecks, claudeStop, ping, press };
}

function timer(ws: string, fake: Fake, repoRoot: string | null = REPO) {
  return runPredecessorStopTimer(ws, { stopDeps: () => fake.stopDeps, repoRoot: () => repoRoot });
}

/** Generation 1 is relay-launched and accepted; generation 2 is launched, gen 1 stands down for it, and gen 2 accepts. */
function handedOffRelayPredecessor(ws: string): void {
  withDatabase(ws, (db) => {
    const paths = coordinatorPaths(ws, PROJECT, ROLE);
    claimNextGeneration(db, ws, { project: PROJECT, role: ROLE, provider: "claude", model: "opus", tier: "heavy", identity: "Claudia Mason", nativeSessionId: SESSION_1, sources, now: NOW });
    acceptGeneration(db, paths, newestLaunching(db, PROJECT, ROLE)!, NOW);
    claimNextGeneration(db, ws, { project: PROJECT, role: ROLE, provider: "claude", model: "opus", tier: "heavy", identity: "Claudia Atlas", nativeSessionId: SESSION_2, sources, now: NOW });
    recordStandDown(db, ws, { project: PROJECT, role: ROLE, successor: 2, now: NOW });
    expect(acceptGeneration(db, paths, newestLaunching(db, PROJECT, ROLE)!, NOW).handedOff).toBe(1);
  });
}

function receiptFile(ws: string, generation: number): string {
  return path.join(coordinatorPaths(ws, PROJECT, ROLE).root, `predecessor-stop-g${generation}.json`);
}

function receiptOf(ws: string, generation: number) {
  return JSON.parse(readFileSync(receiptFile(ws, generation), "utf8")) as Record<string, any>;
}

/** The live defect: accept ran the stop inside the agent's sandbox, where the tmux probe answered unknown (receipt failed). */
function acceptInsideSandbox(ws: string): void {
  const sandboxed = fakeDeps({ live: [G1, G2], unknown: [G1] });
  const result = withDatabase(ws, (db) => stopPredecessorAfterAccept(db, { workspace: ws, project: PROJECT, role: ROLE, successor: 2, predecessor: 1, repoRoot: REPO }, sandboxed.stopDeps));
  expect(result.outcome).toBe("failed");
  expect(receiptOf(ws, 1).outcome).toBe("failed");
}

describe("#3029: the host timer stops a handed-off predecessor coordinator's tmux", () => {
  it("stops exactly the predecessor's recorded session after accept, never the successor, and updates the failed receipt to stopped", () => {
    const ws = fresh();
    handedOffRelayPredecessor(ws);
    acceptInsideSandbox(ws);
    const fake = fakeDeps({ live: [G1, G2] });
    const data = timer(ws, fake);
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({ project: PROJECT, role: ROLE, predecessor: 1, successor: 2, outcome: "stopped", command: `tmux kill-session -t =${G1}` });
    expect(fake.killed).toEqual([G1]);
    expect(fake.sessions.has(G2)).toBe(true);
    // Pane identity is checked against the predecessor's own recorded session id before the kill.
    expect(fake.identityChecks).toEqual([[G1, SESSION_1]]);
    expect(fake.claudeStop).not.toHaveBeenCalled();
    expect(fake.ping).not.toHaveBeenCalled();
    const receipt = receiptOf(ws, 1);
    expect(receipt).toMatchObject({ outcome: "stopped", runner: "host-timer", command: `tmux kill-session -t =${G1}`, predecessor: { method: "tmux", tmuxName: G1, nativeSessionId: SESSION_1 } });
    expect(receipt.supersedes).toMatchObject({ outcome: "failed", runner: "accept", detail: expect.stringMatching(/probe unknown/) });
    expect(renderPredecessorStopTimerLines(data, "T").join("\n")).toContain(`predecessor rowan generation 1 (arcadia): stopped`);
  });

  it("is idempotent: once a terminal receipt exists, later runs probe nothing, kill nothing and ping nothing", () => {
    const ws = fresh();
    handedOffRelayPredecessor(ws);
    expect(timer(ws, fakeDeps({ live: [G1] })).results[0]?.outcome).toBe("stopped");
    const again = fakeDeps({ live: [G1] });
    const data = timer(ws, again);
    expect(data.results).toEqual([]);
    expect(again.probed).toEqual([]);
    expect(again.killed).toEqual([]);
    expect(again.ping).not.toHaveBeenCalled();
    expect(renderPredecessorStopTimerLines(data, "T")).toEqual([]);
  });

  it("refuses a live session under the exact name whose pane does not run the recorded session id", () => {
    const ws = fresh();
    handedOffRelayPredecessor(ws);
    const fake = fakeDeps({ live: [G1, G2], identity: "mismatch" });
    expect(timer(ws, fake).results[0]).toMatchObject({ outcome: "identity_mismatch" });
    expect(fake.killed).toEqual([]);
    expect(receiptOf(ws, 1)).toMatchObject({ outcome: "identity_mismatch", runner: "host-timer" });
  });

  it("a terminal receipt also ends START's tolerance: after identity_mismatch, relay-sessions holds the predecessor (N1)", () => {
    const ws = fresh();
    handedOffRelayPredecessor(ws);
    // Before any receipt, and after a non-terminal one, START tolerates the predecessor while the timer retries.
    expect(runCoordinatorRelaySessionsCommand({ workspace: ws, project: PROJECT }).data.allowed).toEqual([G1, G2]);
    expect(timer(ws, fakeDeps({ live: [G1, G2], identity: "unknown" })).results[0]).toMatchObject({ outcome: "failed" });
    expect(runCoordinatorRelaySessionsCommand({ workspace: ws, project: PROJECT }).data.allowed).toEqual([G1, G2]);
    // A terminal identity_mismatch ends the retries, so START must hold it from then on.
    expect(timer(ws, fakeDeps({ live: [G1, G2], identity: "mismatch" })).results[0]).toMatchObject({ outcome: "identity_mismatch" });
    expect(timer(ws, fakeDeps({ live: [G1, G2] })).results).toEqual([]);
    const data = runCoordinatorRelaySessionsCommand({ workspace: ws, project: PROJECT }).data;
    expect(data.allowed).toEqual([G2]);
    expect(data.sessions.find((session) => session.tmuxName === G1)).toMatchObject({ allowed: false, reason: expect.stringMatching(/terminal stop receipt \(identity_mismatch\)/) });
  });

  it("never kills a session with more than one pane or window: failed, nothing killed, and a later single-pane run stops it (N3)", () => {
    const ws = fresh();
    handedOffRelayPredecessor(ws);
    const crowded = fakeDeps({ live: [G1, G2], identity: "multiple_panes" });
    expect(timer(ws, crowded).results[0]).toMatchObject({ outcome: "failed", command: null, detail: expect.stringMatching(/more than one pane/) });
    expect(crowded.killed).toEqual([]);
    expect(receiptOf(ws, 1)).toMatchObject({ outcome: "failed", runner: "host-timer" });
    const single = fakeDeps({ live: [G1, G2] });
    expect(timer(ws, single).results[0]).toMatchObject({ outcome: "stopped" });
    expect(single.killed).toEqual([G1]);
  });

  it("refuses an unreadable pane identity as failed, and a later readable run stops it", () => {
    const ws = fresh();
    handedOffRelayPredecessor(ws);
    const unreadable = fakeDeps({ live: [G1], identity: "unknown" });
    expect(timer(ws, unreadable).results[0]).toMatchObject({ outcome: "failed" });
    expect(unreadable.killed).toEqual([]);
    const readable = fakeDeps({ live: [G1] });
    expect(timer(ws, readable).results[0]).toMatchObject({ outcome: "stopped" });
    expect(readable.killed).toEqual([G1]);
  });

  it.each<[string, string]>([
    ["a name that is not the predecessor's own generation name", G2],
    ["a prefix-shaped name", `${G1}-copy`],
    ["another role's name", "arcadia-coord-signal-g1"]
  ])("never targets %s: the generation is not a timer candidate and nothing is probed or killed", (_label, recorded) => {
    const ws = fresh();
    handedOffRelayPredecessor(ws);
    withDatabase(ws, (db) => db.prepare("UPDATE coordinator_generations SET tmux_name = ? WHERE project = ? AND role = ? AND generation = 1").run(recorded, PROJECT, ROLE));
    const fake = fakeDeps({ live: [G1, G2, recorded] });
    const data = timer(ws, fake);
    expect(data.results).toEqual([]);
    expect(fake.probed).toEqual([]);
    expect(fake.killed).toEqual([]);
    expect(fake.ping).not.toHaveBeenCalled();
    expect(existsSync(receiptFile(ws, 1))).toBe(false);
  });

  it("refuses a generation that is not handed_off: before accept the predecessor is still custodian and nothing is stopped", () => {
    const ws = fresh();
    withDatabase(ws, (db) => {
      claimNextGeneration(db, ws, { project: PROJECT, role: ROLE, provider: "claude", model: "opus", tier: "heavy", identity: "Claudia Mason", nativeSessionId: SESSION_1, sources, now: NOW });
      acceptGeneration(db, coordinatorPaths(ws, PROJECT, ROLE), newestLaunching(db, PROJECT, ROLE)!, NOW);
      claimNextGeneration(db, ws, { project: PROJECT, role: ROLE, provider: "claude", model: "opus", tier: "heavy", identity: "Claudia Atlas", nativeSessionId: SESSION_2, sources, now: NOW });
      // Stand-down recorded, but the successor has not accepted: generation 1 is still the custodian.
      recordStandDown(db, ws, { project: PROJECT, role: ROLE, successor: 2, now: NOW });
    });
    const fake = fakeDeps({ live: [G1, G2] });
    expect(timer(ws, fake).results).toEqual([]);
    expect(fake.probed).toEqual([]);
    expect(fake.killed).toEqual([]);
  });

  it("refuses a handed_off generation whose stand-down is not recorded for the current custodian", () => {
    const ws = fresh();
    handedOffRelayPredecessor(ws);
    withDatabase(ws, (db) => db.prepare("UPDATE coordinator_generations SET stood_down_for = 7 WHERE project = ? AND role = ? AND generation = 1").run(PROJECT, ROLE));
    const unrecorded = fakeDeps({ live: [G1, G2] });
    expect(timer(ws, unrecorded).results).toEqual([]);
    expect(unrecorded.killed).toEqual([]);
    withDatabase(ws, (db) => db.prepare("UPDATE coordinator_generations SET stood_down_for = 2, stood_down_at = NULL WHERE project = ? AND role = ? AND generation = 1").run(PROJECT, ROLE));
    const noStamp = fakeDeps({ live: [G1, G2] });
    expect(timer(ws, noStamp).results).toEqual([]);
    expect(noStamp.killed).toEqual([]);
  });

  it("only the immediate predecessor of the current custodian: an older handed-off generation is never a candidate", () => {
    const ws = fresh();
    handedOffRelayPredecessor(ws);
    withDatabase(ws, (db) => {
      claimNextGeneration(db, ws, { project: PROJECT, role: ROLE, provider: "claude", model: "opus", tier: "heavy", identity: "Claudia Lune", nativeSessionId: SESSION_3, sources, now: NOW });
      recordStandDown(db, ws, { project: PROJECT, role: ROLE, successor: 3, now: NOW });
      acceptGeneration(db, coordinatorPaths(ws, PROJECT, ROLE), newestLaunching(db, PROJECT, ROLE)!, NOW);
    });
    const candidates = withDatabase(ws, (db) => findPredecessorStopCandidates(db, ws));
    expect(candidates.map((candidate) => [candidate.predecessor, candidate.successor])).toEqual([[2, 3]]);
    const fake = fakeDeps({ live: [G1, G2, "arcadia-coord-rowan-g3"] });
    expect(timer(ws, fake).results.map((result) => result.predecessor)).toEqual([2]);
    expect(fake.killed).toEqual([G2]);
  });

  it("never acts on a desktop predecessor: no claude stop, no manual-stop page from the timer", () => {
    const ws = fresh();
    withDatabase(ws, (db) => {
      seedCustodianGeneration(db, ws, { project: PROJECT, role: ROLE, provider: "claude", model: "opus", tier: "heavy", identity: "Claudia Mason", nativeSessionId: SESSION_1, now: NOW });
      claimNextGeneration(db, ws, { project: PROJECT, role: ROLE, provider: "claude", model: "opus", tier: "heavy", identity: "Claudia Atlas", nativeSessionId: SESSION_2, sources, now: NOW });
      recordStandDown(db, ws, { project: PROJECT, role: ROLE, successor: 2, now: NOW });
      acceptGeneration(db, coordinatorPaths(ws, PROJECT, ROLE), newestLaunching(db, PROJECT, ROLE)!, NOW);
    });
    const fake = fakeDeps({ live: [G2] });
    expect(timer(ws, fake).results).toEqual([]);
    expect(fake.claudeStop).not.toHaveBeenCalled();
    expect(fake.ping).not.toHaveBeenCalled();
  });

  it("defers during a START press or a launch in flight, without paging (the next minute retries), then stops", () => {
    const ws = fresh();
    handedOffRelayPredecessor(ws);
    const pressing = fakeDeps({ live: [G1], press: { inProgress: true, detail: "start-run pid 4242 live" } });
    expect(timer(ws, pressing).results[0]).toMatchObject({ outcome: "deferred" });
    expect(pressing.killed).toEqual([]);
    expect(pressing.ping).not.toHaveBeenCalled();
    const unbound = fakeDeps({ live: [G1] });
    expect(timer(ws, unbound, null).results[0]).toMatchObject({ outcome: "deferred", detail: expect.stringMatching(/interlock_repository_unbound/) });
    expect(unbound.killed).toEqual([]);
    const clear = fakeDeps({ live: [G1] });
    expect(timer(ws, clear).results[0]).toMatchObject({ outcome: "stopped" });
    expect(clear.killed).toEqual([G1]);
  });

  it("a page that cannot be queued never loses the receipt", () => {
    const ws = fresh();
    handedOffRelayPredecessor(ws);
    const fake = fakeDeps({ live: [G1], identity: "mismatch" });
    fake.stopDeps.ping = () => { throw new Error("Ping not sent: hourly cap"); };
    expect(timer(ws, fake).results[0]).toMatchObject({ outcome: "identity_mismatch" });
    expect(receiptOf(ws, 1).outcome).toBe("identity_mismatch");
  });

  it("a workspace with no coordinator table, or no handoff, has no candidate", () => {
    const ws = fresh();
    const fake = fakeDeps({ live: [G1] });
    expect(timer(ws, fake).results).toEqual([]);
    expect(fake.probed).toEqual([]);
  });

  it("runs on the liveness timer, after the other checks, and adds its data to --json", async () => {
    const ws = fresh();
    handedOffRelayPredecessor(ws);
    const fake = fakeDeps({ live: [G1, G2] });
    const response = await runProductionLivenessTimerCommand(
      { workspace: ws },
      {
        liveness: { readProductionActive: () => false },
        momentum: { readRow: async () => { throw new Error("not under test"); } },
        budget: { sources: { claudeProjectsDir: null, codexHome: null, claudeStatusLinePath: null } },
        predecessorStop: { stopDeps: () => fake.stopDeps, repoRoot: () => REPO }
      }
    ).catch((error: Error) => error);
    // The momentum failure makes the run exit non-zero, but the stop still ran and its line is in the log.
    expect(response).toBeInstanceOf(Error);
    expect((response as Error).message).toMatch(/predecessor rowan generation 1 \(arcadia\): stopped/);
    expect(fake.killed).toEqual([G1]);
  });
});

describe("#3029 N3: systemPaneIdentity reads every pane of the session, as kill-session ends them all", () => {
  const SESSION = "44444444-4444-4444-8444-444444444444";
  const NAME = "arcadia-coord-rowan-g1";
  let savedPath: string | undefined;
  afterEach(() => { if (savedPath !== undefined) process.env.PATH = savedPath; savedPath = undefined; });

  /**
   * Fake `tmux` and `ps` first on PATH. tmux models windows: without `-s`, list-panes answers only the current (first)
   * window's pane; with `-s`, every pane of every window. `ps` reports pane 5001 running the recorded session and each
   * other pane running a builder.
   */
  function fakeHost(panes: number[]): void {
    const bin = path.join(mkdtempSync(path.join(tmpdir(), "arcadia-pane-identity-")), "bin");
    roots.push(path.dirname(bin));
    mkdirSync(bin);
    const all = panes.map(String).join("\\n");
    writeFileSync(path.join(bin, "tmux"), `#!/bin/sh
[ "$1" = "list-panes" ] || exit 1
if [ "$2" = "-s" ]; then [ "$3 $4" = "-t =${NAME}:" ] || exit 1; printf '${all}${panes.length ? "\\n" : ""}'; exit 0; fi
[ "$2 $3" = "-t =${NAME}:" ] || exit 1
${panes.length ? `echo ${panes[0]}` : ""}
`);
    const rows = panes.map((pid) => `${pid} 1 zsh`).concat(panes.map((pid, index) => `${pid + 100} ${pid} ${pid === 5001 ? `claude --session-id ${SESSION}` : `node builder-${index}`}`));
    writeFileSync(path.join(bin, "ps"), `#!/bin/sh\nprintf '${rows.join("\\n")}\\n'\n`);
    chmodSync(path.join(bin, "tmux"), 0o755);
    chmodSync(path.join(bin, "ps"), 0o755);
    savedPath = process.env.PATH;
    process.env.PATH = `${bin}:${savedPath ?? ""}`;
  }

  it("matches a one-pane session whose pane runs the recorded session id", () => {
    fakeHost([5001]);
    expect(systemPaneIdentity(NAME, SESSION)).toBe("match");
  });

  it("answers multiple_panes, never match, when the first window runs the predecessor and another window runs other work", () => {
    fakeHost([5001, 5002]);
    expect(systemPaneIdentity(NAME, SESSION)).toBe("multiple_panes");
  });

  it("answers mismatch for one pane that runs something else, and unknown for no pane at all", () => {
    fakeHost([5002]);
    expect(systemPaneIdentity(NAME, SESSION)).toBe("mismatch");
    fakeHost([]);
    expect(systemPaneIdentity(NAME, SESSION)).toBe("unknown");
  });
});
