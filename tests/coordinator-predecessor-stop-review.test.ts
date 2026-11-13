import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapsuleSources } from "../src/coordinator/capsule.js";
import { coordinatorPaths } from "../src/coordinator/paths.js";
import {
  acceptGeneration,
  claimNextGeneration,
  ensureCoordinatorGenerationsTable,
  listGenerations,
  newestLaunching,
  recordStandDown
} from "../src/coordinator/generations.js";
import {
  interlockRepository,
  stopPredecessorAfterAccept,
  stopPressInterlock,
  verifiedPrimaryCheckout,
  type ClaudeStopResult,
  type PredecessorStopDeps,
  type TmuxState
} from "../src/coordinator/predecessorStop.js";
import { withDatabase } from "../src/db/connection.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const PROJECT = "arcadia";
const ROLE = "rowan";
const NOW = new Date("2026-11-12T22:00:00Z");
const SESSION_1 = "11111111-1111-4111-8111-111111111111";
const SESSION_2 = "22222222-2222-4222-8222-222222222222";
const REPO = "/Users/example/repo";
const NAME1 = "arcadia-coord-rowan-g1";

const sources: CapsuleSources = {
  plan: () => ({ activePlan: null, currentAction: null, mainSha: "abc" }),
  production: () => ({ status: "inactive", revision: 0, epoch: 0, openEscalations: [], redAlerts: [] }),
  prs: () => [], sessions: () => [], decisions: () => ({ open: [], recentlyAnswered: [], pendingMerge: [] }),
  pings: () => ({ pending: [], recent: [] }), budget: () => null
};

function fresh(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-predecessor-review-"));
  roots.push(root);
  const ws = path.join(root, "workspace");
  initWorkspace(ws);
  return ws;
}

/** Generation 1 relay-launched and accepted; generation 2 stands 1 down and is accepted. */
function relayPredecessorThenAccept(ws: string): void {
  withDatabase(ws, (db) => {
    const paths = coordinatorPaths(ws, PROJECT, ROLE);
    claimNextGeneration(db, ws, { project: PROJECT, role: ROLE, provider: "claude", model: "opus", tier: "heavy", identity: "Claudia Atlas", nativeSessionId: SESSION_1, sources, now: NOW });
    acceptGeneration(db, paths, newestLaunching(db, PROJECT, ROLE)!, NOW);
    claimNextGeneration(db, ws, { project: PROJECT, role: ROLE, provider: "claude", model: "opus", tier: "heavy", identity: "Claudia Gale", nativeSessionId: SESSION_2, sources, now: NOW });
    recordStandDown(db, ws, { project: PROJECT, role: ROLE, successor: 2, now: NOW });
    acceptGeneration(db, paths, newestLaunching(db, PROJECT, ROLE)!, NOW);
  });
}

function sqlOn(ws: string, sql: string, ...values: unknown[]): void {
  withDatabase(ws, (db) => { db.prepare(sql).run(...values); });
}

/** A tmux probe that answers from a queue (the last answer repeats), with kills recorded. */
function tmuxSeq(states: TmuxState[], identity: "match" | "mismatch" | "unknown" = "match") {
  const queue = [...states];
  const killed: string[] = [];
  const tmux: PredecessorStopDeps["tmux"] = {
    state: () => (queue.length > 1 ? queue.shift()! : queue[0]),
    killSession: (name) => { killed.push(name); },
    paneIdentity: () => identity
  };
  return { tmux, killed };
}

function depsWith(tmux: PredecessorStopDeps["tmux"]) {
  const claudeStop = vi.fn((_id: string): ClaudeStopResult => ({ ok: true }));
  const ping = vi.fn((_message: string) => undefined);
  const stopDeps: PredecessorStopDeps = { tmux, claudeStop, startPressInProgress: () => ({ inProgress: false, detail: "none" }), ping, now: () => NOW };
  return { stopDeps, claudeStop, ping };
}

function stop(ws: string, stopDeps: PredecessorStopDeps, repoRoot: string | null = REPO) {
  return withDatabase(ws, (db) => stopPredecessorAfterAccept(db, { workspace: ws, project: PROJECT, role: ROLE, successor: 2, predecessor: 1, repoRoot }, stopDeps));
}

function git(args: string[]): void {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { stdio: "ignore" });
}

describe("PR 2543 review: the repository must be the primary checkout", () => {
  it("a bogus path resolves to no checkout, and the stop defers without a kill", () => {
    const ws = fresh();
    relayPredecessorThenAccept(ws);
    const root = verifiedPrimaryCheckout(path.join(ws, "no-such-repo"));
    expect(root).toBeNull();
    const fake = tmuxSeq(["present"]);
    const { stopDeps } = depsWith(fake.tmux);
    expect(stop(ws, stopDeps, root).outcome).toBe("deferred");
    expect(fake.killed).toEqual([]);
  });

  it("a linked worktree resolves to no checkout, and the stop defers without a kill", () => {
    const base = mkdtempSync(path.join(tmpdir(), "arcadia-primary-"));
    roots.push(base);
    const primary = path.join(base, "primary");
    const linked = path.join(base, "linked");
    mkdirSync(primary);
    execFileSync("git", ["init", "-q", primary], { stdio: "ignore" });
    git(["-C", primary, "commit", "-q", "--allow-empty", "-m", "init"]);
    git(["-C", primary, "worktree", "add", "-q", "-b", "linked-branch", linked]);
    const ws = fresh();
    relayPredecessorThenAccept(ws);
    expect(verifiedPrimaryCheckout(linked)).toBeNull();
    const fake = tmuxSeq(["present"]);
    const { stopDeps } = depsWith(fake.tmux);
    expect(stop(ws, stopDeps, verifiedPrimaryCheckout(linked)).outcome).toBe("deferred");
    expect(fake.killed).toEqual([]);
  });

  it("the primary checkout itself is accepted, by realpath", () => {
    const base = mkdtempSync(path.join(tmpdir(), "arcadia-primary-ok-"));
    roots.push(base);
    const primary = path.join(base, "primary");
    mkdirSync(primary);
    execFileSync("git", ["init", "-q", primary], { stdio: "ignore" });
    git(["-C", primary, "commit", "-q", "--allow-empty", "-m", "init"]);
    expect(verifiedPrimaryCheckout(primary)).toBe(realpathSync(primary));
  });
});

describe("PR 2543 review: guards that must fail if loosened", () => {
  it("the stand-down check refuses a handed-off predecessor with no stand-down for this successor", () => {
    const ws = fresh();
    relayPredecessorThenAccept(ws);
    sqlOn(ws, "UPDATE coordinator_generations SET stood_down_for = NULL WHERE project = ? AND role = ? AND generation = 1", PROJECT, ROLE);
    const fake = tmuxSeq(["present"]);
    const { stopDeps, claudeStop } = depsWith(fake.tmux);
    const result = stop(ws, stopDeps);
    expect(result.outcome).toBe("deferred");
    expect(fake.killed).toEqual([]);
    expect(claudeStop).not.toHaveBeenCalled();
  });

  it("the tmux name must be exactly arcadia-coord-<role>-g<N> on its own, with the successor guard also present", () => {
    const lookalikes = ["arcadia-coord-rowan-g1-extra", "arcadia-coord-signal-g1", "arcadia-coord-rowan-g01", "arcadia-coord-rowan-g10", "arcadia-coord-rowan-g1.", "ARCADIA-coord-rowan-g1"];
    for (const name of lookalikes) {
      const ws = fresh();
      relayPredecessorThenAccept(ws);
      sqlOn(ws, "UPDATE coordinator_generations SET tmux_name = ? WHERE project = ? AND role = ? AND generation = 1", name, PROJECT, ROLE);
      const fake = tmuxSeq(["present"]);
      const { stopDeps } = depsWith(fake.tmux);
      expect({ name, outcome: stop(ws, stopDeps).outcome }).toEqual({ name, outcome: "manual_stop_required" });
      expect(fake.killed).toEqual([]);
    }
    // Positive control: the exact name is stopped, so the lookalike result is not vacuous.
    const ws = fresh();
    relayPredecessorThenAccept(ws);
    const fake = tmuxSeq(["present", "absent", "absent"]);
    const { stopDeps } = depsWith(fake.tmux);
    expect(stop(ws, stopDeps).outcome).toBe("stopped");
    expect(fake.killed).toEqual([NAME1]);
  });

  it("refuses when the predecessor and the successor record the same session id", () => {
    const ws = fresh();
    relayPredecessorThenAccept(ws);
    sqlOn(ws, "UPDATE coordinator_generations SET native_session_id = ? WHERE project = ? AND role = ? AND generation = 1", SESSION_2, PROJECT, ROLE);
    const fake = tmuxSeq(["present"]);
    const { stopDeps, claudeStop } = depsWith(fake.tmux);
    const result = stop(ws, stopDeps);
    expect(result.outcome).toBe("identity_mismatch");
    expect(result.detail).toContain("never targeted");
    expect(fake.killed).toEqual([]);
    expect(claudeStop).not.toHaveBeenCalled();
  });
});

describe("PR 2543 review: a single absent probe is not enough", () => {
  it("absent then present is live: the session is killed, not already_stopped", () => {
    const ws = fresh();
    relayPredecessorThenAccept(ws);
    const fake = tmuxSeq(["absent", "present", "absent", "absent"]);
    const { stopDeps } = depsWith(fake.tmux);
    expect(stop(ws, stopDeps).outcome).toBe("stopped");
    expect(fake.killed).toEqual([NAME1]);
  });

  it("absent then unknown is failed, never already_stopped", () => {
    const ws = fresh();
    relayPredecessorThenAccept(ws);
    const fake = tmuxSeq(["absent", "unknown"]);
    const { stopDeps } = depsWith(fake.tmux);
    expect(stop(ws, stopDeps).outcome).toBe("failed");
    expect(fake.killed).toEqual([]);
  });

  it("absent twice is already_stopped", () => {
    const ws = fresh();
    relayPredecessorThenAccept(ws);
    const fake = tmuxSeq(["absent", "absent"]);
    const { stopDeps } = depsWith(fake.tmux);
    expect(stop(ws, stopDeps).outcome).toBe("already_stopped");
    expect(fake.killed).toEqual([]);
  });

  it("a single absent probe after the kill is not confirmed: failed", () => {
    const ws = fresh();
    relayPredecessorThenAccept(ws);
    const fake = tmuxSeq(["present", "absent", "present"]);
    const { stopDeps } = depsWith(fake.tmux);
    const result = stop(ws, stopDeps);
    expect(result.outcome).toBe("failed");
    expect(fake.killed).toEqual([NAME1]);
  });
});

describe("PR 2543 review: the bg_stop_id migration on an existing workspace", () => {
  it("adds bg_stop_id once to a pre-existing table and is idempotent", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE coordinator_generations (
      project TEXT NOT NULL, role TEXT NOT NULL, generation INTEGER NOT NULL, status TEXT NOT NULL,
      provider TEXT NOT NULL, model TEXT NOT NULL, tier TEXT NOT NULL, identity TEXT NOT NULL,
      native_session_id TEXT, transcript_path TEXT, tmux_name TEXT, remote_control_name TEXT,
      brief_path TEXT, brief_sha TEXT, snapshot_path TEXT, snapshot_sha TEXT, token_hash TEXT,
      verified_sha TEXT, verified_at TEXT, failure_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      accepted_at TEXT, PRIMARY KEY (project, role, generation))`);
    ensureCoordinatorGenerationsTable(db);
    ensureCoordinatorGenerationsTable(db);
    const columns = (db.prepare("PRAGMA table_info(coordinator_generations)").all() as Array<{ name: string }>).map((column) => column.name);
    expect(columns.filter((name) => name === "bg_stop_id")).toHaveLength(1);
    expect(columns).toContain("stood_down_for");
    expect(listGenerations(db, PROJECT, ROLE)).toEqual([]);
    db.close();
  });
});

describe("PR 2543 round 4: the interlock repository is the invocation's own primary checkout", () => {
  function tempBase(): string {
    const base = mkdtempSync(path.join(tmpdir(), "arcadia-round4-"));
    roots.push(base);
    return base;
  }

  function gitClone(base: string, name: string): string {
    const dir = path.join(base, name);
    mkdirSync(dir);
    execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
    git(["-C", dir, "commit", "-q", "--allow-empty", "-m", "init"]);
    return dir;
  }

  it("another clone's primary, passed as --repo, defers the stop (the old rule accepted it)", () => {
    const base = tempBase();
    const mine = gitClone(base, "mine");
    const other = gitClone(base, "other");
    const invocationPrimary = verifiedPrimaryCheckout(mine);
    expect(verifiedPrimaryCheckout(other)).toBe(realpathSync(other));
    expect(interlockRepository(other, invocationPrimary)).toBeNull();
    const ws = fresh();
    relayPredecessorThenAccept(ws);
    const fake = tmuxSeq(["present"]);
    const { stopDeps } = depsWith(fake.tmux);
    expect(stop(ws, stopDeps, interlockRepository(other, invocationPrimary)).outcome).toBe("deferred");
    expect(fake.killed).toEqual([]);
  });

  it("the invocation's own primary resolves, by default and when given explicitly", () => {
    const mine = gitClone(tempBase(), "mine");
    const invocationPrimary = verifiedPrimaryCheckout(mine);
    expect(invocationPrimary).toBe(realpathSync(mine));
    expect(interlockRepository(undefined, invocationPrimary)).toBe(invocationPrimary);
    expect(interlockRepository(mine, invocationPrimary)).toBe(invocationPrimary);
  });

  it("a symlink, a trailing slash, and a relative path to the same primary resolve equal", () => {
    const base = tempBase();
    const mine = gitClone(base, "mine");
    const invocationPrimary = verifiedPrimaryCheckout(mine);
    const link = path.join(base, "link");
    symlinkSync(mine, link);
    expect(interlockRepository(link, invocationPrimary)).toBe(invocationPrimary);
    expect(interlockRepository(`${mine}/`, invocationPrimary)).toBe(invocationPrimary);
    expect(interlockRepository(path.relative(process.cwd(), mine), invocationPrimary)).toBe(invocationPrimary);
  });

  it("a subdirectory of the primary, a linked worktree, and a bogus path all defer", () => {
    const base = tempBase();
    const mine = gitClone(base, "mine");
    const invocationPrimary = verifiedPrimaryCheckout(mine);
    const sub = path.join(mine, "sub");
    mkdirSync(sub);
    expect(interlockRepository(sub, invocationPrimary)).toBeNull();
    const linked = path.join(base, "linked");
    git(["-C", mine, "worktree", "add", "-q", "-b", "linked-branch", linked]);
    expect(interlockRepository(linked, invocationPrimary)).toBeNull();
    expect(interlockRepository(path.join(base, "nope"), invocationPrimary)).toBeNull();
  });

  it("no invocation primary means no interlock repository, even for an explicit path", () => {
    const mine = gitClone(tempBase(), "mine");
    expect(interlockRepository(mine, null)).toBeNull();
    expect(interlockRepository(undefined, null)).toBeNull();
  });

  it("a missing operator-scripts library is unknown and defers the stop; an existing one reads as no press", () => {
    const base = tempBase();
    const noLibrary = gitClone(base, "nolib");
    const withLibrary = gitClone(base, "lib");
    mkdirSync(path.join(withLibrary, "artifacts", "generated", "operator-scripts"), { recursive: true });
    expect(stopPressInterlock(noLibrary)).toMatchObject({ inProgress: true, unreadable: true });
    expect(stopPressInterlock(withLibrary).inProgress).toBe(false);
    const ws = fresh();
    relayPredecessorThenAccept(ws);
    const fake = tmuxSeq(["present"]);
    const { stopDeps } = depsWith(fake.tmux);
    expect(stop(ws, { ...stopDeps, startPressInProgress: stopPressInterlock }, noLibrary).outcome).toBe("deferred");
    expect(fake.killed).toEqual([]);
  });
});
