import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  runCoordinatorAcceptCommand,
  runCoordinatorRegisterCommand,
  runCoordinatorStandDownCommand,
  runCoordinatorVerifyCommand,
  type CoordinatorSessionBindData
} from "../src/commands/coordinator.js";
import type { CapsuleSources } from "../src/coordinator/capsule.js";
import { COORDINATOR_ENV, claimNextGeneration, ensureCoordinatorGenerationsTable, listGenerations, seedCustodianGeneration } from "../src/coordinator/generations.js";
import { coordinatorPaths } from "../src/coordinator/paths.js";
import { withDatabase } from "../src/db/connection.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const SESSION = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const base = { project: "arcadia", role: "rowan" } as const;

const sources: CapsuleSources = {
  plan: () => ({ activePlan: null, currentAction: null, mainSha: "abc" }),
  production: () => ({ status: "inactive", revision: 0, epoch: 0, openEscalations: [], redAlerts: [] }),
  prs: () => [], sessions: () => [], decisions: () => ({ open: [], recentlyAnswered: [], pendingMerge: [] }),
  pings: () => ({ pending: [], recent: [] }), budget: () => null
};

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-session-identity-"));
  roots.push(root);
  const ws = path.join(root, "workspace");
  initWorkspace(ws);
  const projects = path.join(root, "claude-projects");
  mkdirSync(path.join(projects, "-some-worktree"), { recursive: true });
  return { ws, projects };
}

/** A Claude Code transcript: the nonce arrives as a tool result (a `user` entry), then the model answers. */
function transcript(projects: string, sessionId: string, options: { nonce?: string; model?: string | null; ageMs?: number; sessionIdInEntries?: string } = {}): string {
  const file = path.join(projects, "-some-worktree", `${sessionId}.jsonl`);
  const entryId = options.sessionIdInEntries ?? sessionId;
  const lines: unknown[] = [{ type: "user", sessionId: entryId, message: { content: "hello" } }];
  if (options.nonce) lines.push({ type: "user", sessionId: entryId, message: { content: [{ type: "tool_result", content: `Session challenge: ${options.nonce}` }] } });
  if (options.model !== null) lines.push({ type: "assistant", sessionId: entryId, message: { model: options.model ?? "claude-opus-4-7", content: [] } });
  writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  if (options.ageMs) { const t = new Date(Date.now() - options.ageMs); utimesSync(file, t, t); }
  return file;
}

function challenge(ws: string, projects: string, extra: { correct?: boolean } = {}): string {
  const result = runCoordinatorRegisterCommand({ workspace: ws, ...base, challenge: true, claudeProjectsDirectory: projects, ...extra });
  expect(result.data.step).toBe("challenge");
  return (result.data as Extract<CoordinatorSessionBindData, { step: "challenge" }>).nonce;
}

function register(ws: string, projects: string, sessionId: string, nonce: string, extra: { correct?: boolean; tier?: string; identity?: string; role?: string } = {}) {
  return runCoordinatorRegisterCommand({
    workspace: ws, ...base, ...(extra.role ? { role: extra.role } : {}), confirm: nonce, sessionId, tier: extra.tier ?? "heavy", identity: extra.identity ?? "Rowan 10",
    claudeProjectsDirectory: projects, correct: extra.correct
  });
}

function registered(ws: string, projects: string, sessionId = SESSION) {
  const nonce = challenge(ws, projects);
  transcript(projects, sessionId, { nonce });
  return register(ws, projects, sessionId, nonce);
}

describe("coordinator register: first registration bound to a verified Session", () => {
  it("registers generation 1 from a transcript that carries the nonce, taking the model from the transcript", () => {
    const { ws, projects } = setup();
    const nonce = challenge(ws, projects);
    const file = transcript(projects, SESSION, { nonce, model: "claude-opus-4-7" });
    const result = register(ws, projects, SESSION, nonce);
    expect(result.data).toMatchObject({ step: "confirmed", generation: 1, tier: "heavy", identity: "Rowan 10", verified: { sessionId: SESSION, provider: "claude", model: "claude-opus-4-7", transcriptPath: file } });
    const [row] = withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan"));
    expect(row).toMatchObject({ generation: 1, status: "custodian", provider: "claude", model: "claude-opus-4-7", nativeSessionId: SESSION, transcriptPath: file, relayLaunched: false });
    const log = readFileSync(coordinatorPaths(ws, "arcadia", "rowan").generationsLog, "utf8");
    expect(log).toContain("transcript_challenge");
    expect(log).toContain(SESSION);
  });

  it("refuses a Session whose transcript lacks the nonce, a wrong or reused nonce, and an unknown Session", () => {
    const { ws, projects } = setup();
    const nonce = challenge(ws, projects);
    transcript(projects, OTHER, { nonce: "something-else" });
    expect(() => register(ws, projects, OTHER, nonce)).toThrow(/nonce is not in session/);
    expect(() => register(ws, projects, SESSION, nonce)).toThrow(/No transcript for session/);
    expect(() => register(ws, projects, OTHER, "arcadia-session-challenge-forged")).toThrow(/does not match/);
    expect(withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan"))).toEqual([]);
    // The nonce is single use: a successful confirmation consumes it.
    transcript(projects, SESSION, { nonce });
    register(ws, projects, SESSION, nonce);
    expect(() => register(ws, projects, SESSION, nonce, { correct: true })).toThrow(/No session challenge is pending/);
  });

  it("refuses an expired challenge, a stale transcript, a transcript with no model, and a session-id mismatch inside the transcript", () => {
    const { ws, projects } = setup();
    const nonce = challenge(ws, projects);
    transcript(projects, SESSION, { nonce });
    const late = new Date(Date.now() + 11 * 60 * 1000);
    expect(() => runCoordinatorRegisterCommand({ workspace: ws, ...base, confirm: nonce, sessionId: SESSION, tier: "heavy", identity: "x", claudeProjectsDirectory: projects, now: late })).toThrow(/expired/);

    const second = challenge(ws, projects);
    transcript(projects, SESSION, { nonce: second, ageMs: 30 * 60 * 1000 });
    expect(() => register(ws, projects, SESSION, second)).toThrow(/only a live Session/);

    transcript(projects, SESSION, { nonce: second, model: null });
    expect(() => register(ws, projects, SESSION, second)).toThrow(/names no model/);

    transcript(projects, SESSION, { nonce: second, sessionIdInEntries: OTHER });
    expect(() => register(ws, projects, SESSION, second)).toThrow(/names session/);
    expect(withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan"))).toEqual([]);
  });

  it("refuses a non-coordinator role, a bad tier or identity, a mixed form, a challenge for another purpose, and a second registration", () => {
    const { ws, projects } = setup();
    expect(() => runCoordinatorRegisterCommand({ workspace: ws, project: "arcadia", role: "builder", challenge: true, claudeProjectsDirectory: projects })).toThrow(/Only the coordinator roles/);
    expect(() => runCoordinatorRegisterCommand({ workspace: ws, ...base, claudeProjectsDirectory: projects })).toThrow(/exactly one of/);
    const nonce = challenge(ws, projects);
    transcript(projects, SESSION, { nonce });
    expect(() => register(ws, projects, SESSION, nonce, { tier: "mega" })).toThrow(/--tier/);
    expect(() => register(ws, projects, SESSION, nonce, { identity: " " })).toThrow(/--identity/);
    expect(() => register(ws, projects, SESSION, nonce, { correct: true })).toThrow(/no custodian to correct/);
    register(ws, projects, SESSION, nonce);
    expect(() => challenge(ws, projects)).toThrow(/already registered/);
  });
});

describe("coordinator register --correct", () => {
  it("lets the recorded Session relabel itself, and logs the previous values", () => {
    const { ws, projects } = setup();
    registered(ws, projects);
    const nonce = challenge(ws, projects, { correct: true });
    transcript(projects, SESSION, { nonce, model: "claude-sonnet-5-5" });
    register(ws, projects, SESSION, nonce, { correct: true, tier: "standard", identity: "Rowan 10b" });
    const [row] = withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan"));
    expect(row).toMatchObject({ generation: 1, status: "custodian", model: "claude-sonnet-5-5", tier: "standard", identity: "Rowan 10b" });
    expect(readFileSync(coordinatorPaths(ws, "arcadia", "rowan").generationsLog, "utf8")).toContain("custodian_corrected");
  });

  it("refuses a different Session while the recorded one is live, and allows it once the recorded Session's transcript is stale", () => {
    const { ws, projects } = setup();
    registered(ws, projects);
    const nonce = challenge(ws, projects, { correct: true });
    transcript(projects, OTHER, { nonce });
    expect(() => register(ws, projects, OTHER, nonce, { correct: true })).toThrow(/still live/);
    expect(withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan"))[0].nativeSessionId).toBe(SESSION);

    transcript(projects, SESSION, { ageMs: 30 * 60 * 1000 });
    register(ws, projects, OTHER, nonce, { correct: true });
    expect(withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan"))[0].nativeSessionId).toBe(OTHER);
  });

  it("refuses to correct a relay-launched custodian or while a successor is launching", () => {
    const { ws, projects } = setup();
    registered(ws, projects);
    withDatabase(ws, (db) => claimNextGeneration(db, ws, { project: "arcadia", role: "rowan", provider: "claude", model: "m", tier: "heavy", identity: "i", nativeSessionId: OTHER, sources, now: new Date() }));
    expect(() => challenge(ws, projects, { correct: true })).toThrow(/launching/);
  });
});

describe("predecessor stand-down before custody is accepted", () => {
  function handoff() {
    const { ws, projects } = setup();
    registered(ws, projects);
    const claimed = withDatabase(ws, (db) => claimNextGeneration(db, ws, { project: "arcadia", role: "rowan", provider: "claude", model: "m", tier: "heavy", identity: "i", nativeSessionId: OTHER, sources, now: new Date() }));
    const env = { [COORDINATOR_ENV.role]: "rowan", [COORDINATOR_ENV.generation]: "2", [COORDINATOR_ENV.token]: claimed.token };
    const verify = () => runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, sources, now: new Date() });
    const accept = () => runCoordinatorAcceptCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, env });
    return { ws, projects, claimed, env, verify, accept };
  }

  it("accept is refused until the registered desktop predecessor proves its own Session and records stand-down", () => {
    const { ws, projects, verify, accept } = handoff();
    verify();
    expect(() => accept()).toThrow(/has not recorded its stand-down for generation 2/);

    const issued = runCoordinatorStandDownCommand({ workspace: ws, ...base, successor: 2, challenge: true, claudeProjectsDirectory: projects, env: {} });
    const nonce = (issued.data as { nonce: string }).nonce;
    // The challenge must be answered from the recorded custodian Session, not another one.
    transcript(projects, OTHER, { nonce });
    expect(() => runCoordinatorStandDownCommand({ workspace: ws, ...base, successor: 2, confirm: nonce, sessionId: OTHER, claudeProjectsDirectory: projects, env: {} })).toThrow(/recorded custodian Session/);
    transcript(projects, SESSION, { nonce });
    const done = runCoordinatorStandDownCommand({ workspace: ws, ...base, successor: 2, confirm: nonce, sessionId: SESSION, claudeProjectsDirectory: projects, env: {} });
    expect(done.data).toMatchObject({ step: "recorded", generation: 1, successor: 2 });
    verify();
    expect(accept().data).toMatchObject({ custodian: 2, handedOff: 1 });
    expect(withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan")).map((row) => [row.generation, row.status])).toEqual([[1, "handed_off"], [2, "custodian"]]);
  });

  it("refuses a stand-down for a generation that is not the launching successor", () => {
    const { ws, projects } = handoff();
    const issued = runCoordinatorStandDownCommand({ workspace: ws, ...base, successor: 3, challenge: true, claudeProjectsDirectory: projects, env: {} });
    const nonce = (issued.data as { nonce: string }).nonce;
    transcript(projects, SESSION, { nonce });
    expect(() => runCoordinatorStandDownCommand({ workspace: ws, ...base, successor: 3, confirm: nonce, sessionId: SESSION, claudeProjectsDirectory: projects, env: {} })).toThrow(/not the launching successor/);
  });

  it("a stand-down recorded for an earlier successor does not satisfy a later one", () => {
    const { ws, projects, claimed, env } = handoff();
    const issued = runCoordinatorStandDownCommand({ workspace: ws, ...base, successor: 2, challenge: true, claudeProjectsDirectory: projects, env: {} });
    const nonce = (issued.data as { nonce: string }).nonce;
    transcript(projects, SESSION, { nonce });
    runCoordinatorStandDownCommand({ workspace: ws, ...base, successor: 2, confirm: nonce, sessionId: SESSION, claudeProjectsDirectory: projects, env: {} });
    // Generation 2 fails (no acceptance); generation 3 is claimed. The old record names generation 2.
    withDatabase(ws, (db) => db.prepare("UPDATE coordinator_generations SET status = 'failed' WHERE generation = 2").run());
    const next = withDatabase(ws, (db) => claimNextGeneration(db, ws, { project: "arcadia", role: "rowan", provider: "claude", model: "m", tier: "heavy", identity: "i", nativeSessionId: OTHER, sources, now: new Date() }));
    const nextEnv = { ...env, [COORDINATOR_ENV.generation]: "3", [COORDINATOR_ENV.token]: next.token };
    expect(claimed.token).not.toBe(next.token);
    withDatabase(ws, (db) => db.prepare("UPDATE coordinator_generations SET verified_sha = ?, verified_at = ? WHERE generation = 3").run(next.snapshotSha, new Date().toISOString()));
    expect(() => runCoordinatorAcceptCommand({ workspace: ws, ...base, generation: 3, snapshotSha: next.snapshotSha, env: nextEnv })).toThrow(/stand-down for generation 3/);
  });

  it("a relay-launched predecessor stands down with its custody token, and no unfenced caller can", () => {
    const { ws } = setup();
    withDatabase(ws, (db) => seedCustodianGeneration(db, ws, { project: "arcadia", role: "rowan", provider: "claude", model: "m", tier: "heavy", identity: "i", nativeSessionId: SESSION }));
    // Generation 2 accepted by the relay's own path gives generation 2 a token; generation 3 then launches.
    const second = withDatabase(ws, (db) => claimNextGeneration(db, ws, { project: "arcadia", role: "rowan", provider: "claude", model: "m", tier: "heavy", identity: "i", nativeSessionId: OTHER, sources, now: new Date() }));
    withDatabase(ws, (db) => db.prepare("UPDATE coordinator_generations SET status = 'handed_off' WHERE generation = 1").run());
    withDatabase(ws, (db) => db.prepare("UPDATE coordinator_generations SET status = 'custodian' WHERE generation = 2").run());
    withDatabase(ws, (db) => claimNextGeneration(db, ws, { project: "arcadia", role: "rowan", provider: "claude", model: "m", tier: "heavy", identity: "i", nativeSessionId: "33333333-3333-4333-8333-333333333333", sources, now: new Date() }));
    const own = { [COORDINATOR_ENV.role]: "rowan", [COORDINATOR_ENV.generation]: "2", [COORDINATOR_ENV.token]: second.token };
    expect(() => runCoordinatorStandDownCommand({ workspace: ws, ...base, successor: 3, env: {} })).toThrow(/run by the current custodian itself/);
    expect(() => runCoordinatorStandDownCommand({ workspace: ws, ...base, successor: 3, env: { ...own, [COORDINATOR_ENV.token]: "0".repeat(48) } })).toThrow(/custody/);
    expect(runCoordinatorStandDownCommand({ workspace: ws, ...base, successor: 3, env: own }).data).toMatchObject({ step: "recorded", generation: 2, successor: 3, method: "custody_token" });
  });
});

describe("generations table migration", () => {
  it("adds the stand-down columns to a table created before they existed", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE coordinator_generations (project TEXT NOT NULL, role TEXT NOT NULL, generation INTEGER NOT NULL, status TEXT NOT NULL,
      provider TEXT NOT NULL, model TEXT NOT NULL, tier TEXT NOT NULL, identity TEXT NOT NULL, native_session_id TEXT, transcript_path TEXT, tmux_name TEXT,
      remote_control_name TEXT, brief_path TEXT, brief_sha TEXT, snapshot_path TEXT, snapshot_sha TEXT, token_hash TEXT, verified_sha TEXT, verified_at TEXT,
      failure_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, accepted_at TEXT, PRIMARY KEY (project, role, generation))`);
    ensureCoordinatorGenerationsTable(db);
    ensureCoordinatorGenerationsTable(db);
    const columns = (db.prepare("PRAGMA table_info(coordinator_generations)").all() as Array<{ name: string }>).map((column) => column.name);
    expect(columns).toEqual(expect.arrayContaining(["stood_down_at", "stood_down_for"]));
    db.close();
  });
});
