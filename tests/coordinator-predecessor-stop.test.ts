import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapsuleSources } from "../src/coordinator/capsule.js";
import { coordinatorPaths } from "../src/coordinator/paths.js";
import {
  acceptGeneration,
  claimNextGeneration,
  listGenerations,
  newestLaunching,
  recordStandDown,
  seedCustodianGeneration
} from "../src/coordinator/generations.js";
import { stopPredecessorAfterAccept, type PredecessorStopDeps } from "../src/coordinator/predecessorStop.js";
import { withDatabase } from "../src/db/connection.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const PROJECT = "arcadia";
const ROLE = "rowan";
const NOW = new Date("2026-11-12T22:00:00Z");
const SESSION_1 = "11111111-1111-4111-8111-111111111111";
const SESSION_2 = "22222222-2222-4222-8222-222222222222";
const SESSION_3 = "33333333-3333-4333-8333-333333333333";
const REPO = "/Users/example/repo";

const sources: CapsuleSources = {
  plan: () => ({ activePlan: null, currentAction: null, mainSha: "abc" }),
  production: () => ({ status: "inactive", revision: 0, epoch: 0, openEscalations: [], redAlerts: [] }),
  prs: () => [], sessions: () => [], decisions: () => ({ open: [], recentlyAnswered: [], pendingMerge: [] }),
  pings: () => ({ pending: [], recent: [] }), budget: () => null
};

function fresh() {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-predecessor-stop-"));
  roots.push(root);
  const ws = path.join(root, "workspace");
  initWorkspace(ws);
  return { ws };
}

/** A fake tmux server: a set of live session names. kill removes a name; `stuck` names survive kill-session. */
function fakeTmux(live: string[], stuck: string[] = []) {
  const sessions = new Set(live);
  const killed: string[] = [];
  const tmux: PredecessorStopDeps["tmux"] = {
    hasSession: (name) => sessions.has(name),
    killSession: (name) => { killed.push(name); if (!stuck.includes(name)) sessions.delete(name); }
  };
  return { tmux, sessions, killed };
}

function deps(options: { live?: string[]; stuck?: string[]; claudeResult?: { ok: true } | { ok: false; error: string }; press?: { inProgress: boolean; detail: string; unreadable?: boolean } } = {}) {
  const tmuxFake = fakeTmux(options.live ?? [], options.stuck ?? []);
  const claudeStop = vi.fn((_id: string): { ok: true } | { ok: false; error: string } => options.claudeResult ?? { ok: true });
  const ping = vi.fn((_message: string) => undefined);
  const press = vi.fn((_repo: string) => options.press ?? { inProgress: false, detail: "no START press in progress" });
  const stopDeps: PredecessorStopDeps = { tmux: tmuxFake.tmux, claudeStop, startPressInProgress: press, ping, now: () => NOW };
  return { stopDeps, tmuxFake, claudeStop, ping, press };
}

/** Generation 1 is relay-launched (token held), accepted; generation 2 is launched, stands gen 1 down, and is accepted. */
function relayPredecessorThenAccept(ws: string) {
  return withDatabase(ws, (db) => {
    const paths = coordinatorPaths(ws, PROJECT, ROLE);
    const first = claimNextGeneration(db, ws, { project: PROJECT, role: ROLE, provider: "claude", model: "opus", tier: "heavy", identity: "Claudia Atlas", nativeSessionId: SESSION_1, sources, now: NOW });
    expect(first.generation).toBe(1);
    acceptGeneration(db, paths, newestLaunching(db, PROJECT, ROLE)!, NOW);
    claimNextGeneration(db, ws, { project: PROJECT, role: ROLE, provider: "claude", model: "opus", tier: "heavy", identity: "Claudia Gale", nativeSessionId: SESSION_2, sources, now: NOW });
    recordStandDown(db, ws, { project: PROJECT, role: ROLE, successor: 2, now: NOW });
    const handedOff = acceptGeneration(db, paths, newestLaunching(db, PROJECT, ROLE)!, NOW).handedOff;
    return { handedOff };
  });
}

/** Generation 1 is a desktop custodian (seeded, no token); generation 2 is launched and accepted after its stand-down. */
function desktopPredecessorThenAccept(ws: string) {
  return withDatabase(ws, (db) => {
    seedCustodianGeneration(db, ws, { project: PROJECT, role: ROLE, provider: "claude", model: "opus", tier: "heavy", identity: "Claudia Atlas", nativeSessionId: SESSION_1, now: NOW });
    claimNextGeneration(db, ws, { project: PROJECT, role: ROLE, provider: "claude", model: "opus", tier: "heavy", identity: "Claudia Gale", nativeSessionId: SESSION_2, sources, now: NOW });
    recordStandDown(db, ws, { project: PROJECT, role: ROLE, successor: 2, now: NOW });
    return acceptGeneration(db, coordinatorPaths(ws, PROJECT, ROLE), newestLaunching(db, PROJECT, ROLE)!, NOW).handedOff;
  });
}

function stop(ws: string, predecessor: number, stopDeps: PredecessorStopDeps, repoRoot: string | null = REPO) {
  return withDatabase(ws, (db) => stopPredecessorAfterAccept(db, { workspace: ws, project: PROJECT, role: ROLE, successor: 2, predecessor, repoRoot }, stopDeps));
}

function receiptOf(ws: string, generation: number) {
  return JSON.parse(readFileSync(path.join(coordinatorPaths(ws, PROJECT, ROLE).root, `predecessor-stop-g${generation}.json`), "utf8")) as { outcome: string; command: string | null; predecessor: { method: string } };
}

describe("gate 10: stopping the predecessor after accept", () => {
  it("stops a tmux predecessor by its exact generation name and never touches the successor", () => {
    const { ws } = fresh();
    const { handedOff } = relayPredecessorThenAccept(ws);
    expect(handedOff).toBe(1);
    const fake = deps({ live: ["arcadia-coord-rowan-g1", "arcadia-coord-rowan-g2"] });
    const result = stop(ws, 1, fake.stopDeps);
    expect(result.outcome).toBe("stopped");
    expect(result.method).toBe("tmux");
    expect(result.command).toBe("tmux kill-session -t =arcadia-coord-rowan-g1");
    expect(fake.tmuxFake.killed).toEqual(["arcadia-coord-rowan-g1"]);
    expect(fake.tmuxFake.sessions.has("arcadia-coord-rowan-g2")).toBe(true);
    expect(fake.claudeStop).not.toHaveBeenCalled();
    expect(fake.ping).not.toHaveBeenCalled();
    expect(receiptOf(ws, 1)).toMatchObject({ outcome: "stopped", command: "tmux kill-session -t =arcadia-coord-rowan-g1", predecessor: { method: "tmux" } });
  });

  it("stops a --bg predecessor by claude stop with its recorded id, never by tmux", () => {
    const { ws } = fresh();
    relayPredecessorThenAccept(ws);
    // A background launch records its id and has no tmux pane. Nothing in the relay writes it today; the fixture sets it directly.
    withDatabase(ws, (db) => db.prepare("UPDATE coordinator_generations SET tmux_name = NULL, bg_stop_id = ? WHERE project = ? AND role = ? AND generation = 1").run("bg-id-7f3a", PROJECT, ROLE));
    const fake = deps({ live: ["arcadia-coord-rowan-g2"] });
    const result = stop(ws, 1, fake.stopDeps);
    expect(result.outcome).toBe("stopped");
    expect(result.method).toBe("bg");
    expect(result.command).toBe("claude stop bg-id-7f3a");
    expect(fake.claudeStop).toHaveBeenCalledTimes(1);
    expect(fake.claudeStop).toHaveBeenCalledWith("bg-id-7f3a");
    expect(fake.tmuxFake.killed).toEqual([]);
  });

  it("refuses a --bg id that names the successor and stops nothing", () => {
    const { ws } = fresh();
    relayPredecessorThenAccept(ws);
    withDatabase(ws, (db) => db.prepare("UPDATE coordinator_generations SET tmux_name = NULL, bg_stop_id = ? WHERE project = ? AND role = ? AND generation = 1").run(SESSION_2, PROJECT, ROLE));
    const fake = deps();
    const result = stop(ws, 1, fake.stopDeps);
    expect(result.outcome).toBe("manual_stop_required");
    expect(fake.claudeStop).not.toHaveBeenCalled();
    expect(fake.tmuxFake.killed).toEqual([]);
  });

  it("never stops a desktop predecessor: manual_stop_required with the exact title and session, pinged once", () => {
    const { ws } = fresh();
    const handedOff = desktopPredecessorThenAccept(ws);
    expect(handedOff).toBe(1);
    const fake = deps({ live: ["arcadia-coord-rowan-g2"] });
    const result = stop(ws, 1, fake.stopDeps);
    expect(result.outcome).toBe("manual_stop_required");
    expect(result.method).toBe("desktop");
    expect(result.command).toBeNull();
    expect(result.detail).toContain(`session ${SESSION_1}`);
    expect(result.detail).toContain('title "Claudia Atlas"');
    expect(fake.tmuxFake.killed).toEqual([]);
    expect(fake.claudeStop).not.toHaveBeenCalled();
    expect(fake.ping).toHaveBeenCalledTimes(1);
    expect(fake.ping.mock.calls[0][0]).toContain(SESSION_1);
    expect(receiptOf(ws, 1)).toMatchObject({ outcome: "manual_stop_required", predecessor: { method: "desktop" } });
  });

  it("is idempotent: a second run reports the first receipt and runs nothing or pings nothing again", () => {
    const { ws } = fresh();
    relayPredecessorThenAccept(ws);
    const first = deps({ live: ["arcadia-coord-rowan-g1"] });
    expect(stop(ws, 1, first.stopDeps).outcome).toBe("stopped");
    const second = deps({ live: ["arcadia-coord-rowan-g1"] });
    const again = stop(ws, 1, second.stopDeps);
    expect(again.reused).toBe(true);
    expect(again.outcome).toBe("stopped");
    expect(second.tmuxFake.killed).toEqual([]);
    expect(second.ping).not.toHaveBeenCalled();
  });

  it("records already_stopped when the predecessor pane is already gone, and does not repeat it", () => {
    const { ws } = fresh();
    relayPredecessorThenAccept(ws);
    const fake = deps({ live: [] });
    const result = stop(ws, 1, fake.stopDeps);
    expect(result.outcome).toBe("already_stopped");
    expect(fake.tmuxFake.killed).toEqual([]);
    expect(stop(ws, 1, deps().stopDeps)).toMatchObject({ outcome: "already_stopped", reused: true });
  });

  it("refuses during a START press: nothing is stopped, the deferral is not terminal, and a later run stops it", () => {
    const { ws } = fresh();
    relayPredecessorThenAccept(ws);
    const blocked = deps({ live: ["arcadia-coord-rowan-g1"], press: { inProgress: true, detail: "start-run pid 4242 live" } });
    const deferred = stop(ws, 1, blocked.stopDeps);
    expect(deferred.outcome).toBe("deferred");
    expect(deferred.detail).toContain("START press");
    expect(blocked.tmuxFake.killed).toEqual([]);
    expect(blocked.ping).toHaveBeenCalledTimes(1);
    expect(receiptOf(ws, 1).outcome).toBe("deferred");
    const clear = deps({ live: ["arcadia-coord-rowan-g1"] });
    expect(stop(ws, 1, clear.stopDeps).outcome).toBe("stopped");
    expect(clear.tmuxFake.killed).toEqual(["arcadia-coord-rowan-g1"]);
  });

  it("refuses during a launch in flight and when the repository cannot be resolved", () => {
    const { ws } = fresh();
    relayPredecessorThenAccept(ws);
    withDatabase(ws, (db) => claimNextGeneration(db, ws, { project: PROJECT, role: ROLE, provider: "claude", model: "opus", tier: "heavy", identity: "Claudia Lune", nativeSessionId: SESSION_3, sources, now: NOW }));
    const launching = deps({ live: ["arcadia-coord-rowan-g1"] });
    expect(stop(ws, 1, launching.stopDeps).outcome).toBe("deferred");
    expect(launching.tmuxFake.killed).toEqual([]);
    expect(launching.press).not.toHaveBeenCalled();
    const unresolved = deps({ live: ["arcadia-coord-rowan-g1"] });
    expect(stop(ws, 1, unresolved.stopDeps, null).outcome).toBe("deferred");
    expect(unresolved.tmuxFake.killed).toEqual([]);
  });

  it("reports a stop that did not take as failed, loudly, and leaves custody as accept set it", () => {
    const { ws } = fresh();
    relayPredecessorThenAccept(ws);
    const fake = deps({ live: ["arcadia-coord-rowan-g1"], stuck: ["arcadia-coord-rowan-g1"] });
    const result = stop(ws, 1, fake.stopDeps);
    expect(result.outcome).toBe("failed");
    expect(result.detail).toContain("still live");
    expect(fake.ping).toHaveBeenCalledTimes(1);
    expect(fake.ping.mock.calls[0][0]).toContain("FAILED");
    expect(receiptOf(ws, 1).outcome).toBe("failed");
    withDatabase(ws, (db) => {
      const rows = listGenerations(db, PROJECT, ROLE);
      expect(rows.find((row) => row.generation === 2)?.status).toBe("custodian");
      expect(rows.find((row) => row.generation === 1)?.status).toBe("handed_off");
    });
  });

  it("reports a failed --bg stop as failed, not success, and keeps the id for a retry", () => {
    const { ws } = fresh();
    relayPredecessorThenAccept(ws);
    withDatabase(ws, (db) => db.prepare("UPDATE coordinator_generations SET tmux_name = NULL, bg_stop_id = ? WHERE project = ? AND role = ? AND generation = 1").run("bg-id-9c1d", PROJECT, ROLE));
    const fake = deps({ claudeResult: { ok: false, error: "claude stop exited 1: permission denied" } });
    const result = stop(ws, 1, fake.stopDeps);
    expect(result.outcome).toBe("failed");
    expect(result.command).toBe("claude stop bg-id-9c1d");
    expect(fake.ping).toHaveBeenCalledTimes(1);
    // A failed receipt is not terminal, so a retry runs the stop again.
    const retry = deps();
    expect(stop(ws, 1, retry.stopDeps).outcome).toBe("stopped");
    expect(retry.claudeStop).toHaveBeenCalledWith("bg-id-9c1d");
  });

  it("never targets a tmux name other than the predecessor's own generation", () => {
    const { ws } = fresh();
    relayPredecessorThenAccept(ws);
    // A recorded name that is not the predecessor's own generation name is never killed: it is reported for a manual stop.
    withDatabase(ws, (db) => db.prepare("UPDATE coordinator_generations SET tmux_name = ? WHERE project = ? AND role = ? AND generation = 1").run("arcadia-coord-rowan-g2", PROJECT, ROLE));
    const fake = deps({ live: ["arcadia-coord-rowan-g2"] });
    const result = stop(ws, 1, fake.stopDeps);
    expect(result.outcome).toBe("manual_stop_required");
    expect(fake.tmuxFake.killed).toEqual([]);
    expect(fake.tmuxFake.sessions.has("arcadia-coord-rowan-g2")).toBe(true);
  });

  it("does nothing before accept: no successor custodian, no handed-off predecessor", () => {
    const { ws } = fresh();
    withDatabase(ws, (db) => {
      seedCustodianGeneration(db, ws, { project: PROJECT, role: ROLE, provider: "claude", model: "opus", tier: "heavy", identity: "Claudia Atlas", nativeSessionId: SESSION_1, now: NOW });
      claimNextGeneration(db, ws, { project: PROJECT, role: ROLE, provider: "claude", model: "opus", tier: "heavy", identity: "Claudia Gale", nativeSessionId: SESSION_2, sources, now: NOW });
    });
    const fake = deps({ live: ["arcadia-coord-rowan-g2"] });
    const result = stop(ws, 1, fake.stopDeps);
    expect(result.outcome).toBe("deferred");
    expect(fake.tmuxFake.killed).toEqual([]);
    expect(fake.claudeStop).not.toHaveBeenCalled();
    expect(existsSync(path.join(coordinatorPaths(ws, PROJECT, ROLE).root, "predecessor-stop-g1.json"))).toBe(false);
  });

  it("writes its receipt beside the generation record with the predecessor identity and timestamps", () => {
    const { ws } = fresh();
    relayPredecessorThenAccept(ws);
    stop(ws, 1, deps({ live: ["arcadia-coord-rowan-g1"] }).stopDeps);
    const receipt = JSON.parse(readFileSync(path.join(coordinatorPaths(ws, PROJECT, ROLE).root, "predecessor-stop-g1.json"), "utf8")) as Record<string, unknown>;
    expect(receipt).toMatchObject({
      schema: "arcadia-coordinator-predecessor-stop-v1",
      predecessor: { generation: 1, method: "tmux", tmuxName: "arcadia-coord-rowan-g1", nativeSessionId: SESSION_1 },
      successor: { generation: 2, tmuxName: "arcadia-coord-rowan-g2", nativeSessionId: SESSION_2 },
      outcome: "stopped"
    });
    expect(typeof receipt.startedAt).toBe("string");
    expect(typeof receipt.finishedAt).toBe("string");
  });
});
