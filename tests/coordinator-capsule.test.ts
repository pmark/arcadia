import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPingSendCommand } from "../src/commands/ping.js";
import {
  repositoryRoot,
  runCoordinatorAcceptCommand,
  runCoordinatorCapsuleCommand,
  runCoordinatorNoteCommand,
  runCoordinatorRelaySessionsCommand,
  runCoordinatorSubscribeCommand,
  runCoordinatorVerifyCommand
} from "../src/commands/coordinator.js";
import { CAPSULE_SCHEMA, renderCapsuleMarkdown, type CapsuleSources } from "../src/coordinator/capsule.js";
import {
  COORDINATOR_ENV,
  CLAIM_LAUNCHING_FRESH_MS,
  assertCoordinatorCustody,
  claimNextGeneration,
  failGeneration,
  listGenerations,
  relayCoordinatorSessions,
  seedCustodianGeneration
} from "../src/coordinator/generations.js";
import { ALIVE_START_UNKNOWN, acquireRelayLock, releaseRelayLock } from "../src/coordinator/lock.js";
import { coordinatorPaths } from "../src/coordinator/paths.js";
import { readCoordinatorState, writeCoordinatorState } from "../src/coordinator/state.js";
import { withDatabase } from "../src/db/connection.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-coord-"));
  roots.push(root);
  const workspacePath = path.join(root, "workspace");
  initWorkspace(workspacePath);
  return workspacePath;
}

/** Deterministic relay-owned sources: no git, gh or repository reads. */
function sources(overrides: Partial<{ head: string; prHead: string }> = {}): CapsuleSources {
  return {
    plan: () => ({ activePlan: "docs/plans/p.md", currentAction: "a1", mainSha: overrides.head ?? "aaa111" }),
    production: () => ({ status: "off", revision: 7, epoch: 3, openEscalations: [], redAlerts: [] }),
    prs: (numbers) => numbers.map((number) => ({
      number, headSha: overrides.prHead ?? "bbb222", verdictMarkerHead: null, checks: "pass", mergeState: "CLEAN", gate: null
    })),
    sessions: () => [],
    decisions: () => ({ open: ["0191"], recentlyAnswered: ["0190"], pendingMerge: [] }),
    pings: () => ({ pending: [], recent: [] }),
    budget: () => null
  };
}

const T0 = new Date("2026-11-07T20:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const base = { project: "arcadia", role: "rowan" };
const launch = {
  provider: "claude", model: "opus", tier: "heavy", identity: "Claudia Atlas", nativeSessionId: "00000000-0000-4000-8000-000000000002",
  transcriptPath: null, tmuxName: "arcadia-coord-rowan-g2", remoteControlName: "Rowan g2", briefPath: "docs/briefs/rowan.md", briefSha: "c0ffee"
};

function seed(ws: string) {
  return withDatabase(ws, (db) => seedCustodianGeneration(db, ws, {
    ...base, provider: "claude", model: "opus", tier: "heavy", identity: "Claudia Atlas",
    nativeSessionId: "00000000-0000-4000-8000-000000000001", now: T0
  }));
}

function envFor(generation: number, token: string): NodeJS.ProcessEnv {
  return {
    [COORDINATOR_ENV.role]: "rowan",
    [COORDINATOR_ENV.generation]: String(generation), [COORDINATOR_ENV.token]: token
  };
}

/** The successor runs each inherited watcher itself, then registers it; this stands in for that step. */
function armInherited(ws: string, env: NodeJS.ProcessEnv, now: Date, commandLine = "scripts/wait-for-event.sh --pr 2236", cursor = "c-10") {
  return runCoordinatorSubscribeCommand({ workspace: ws, ...base, commandLine, cursor, now, env });
}

function claim(ws: string, now = at(1)) {
  return withDatabase(ws, (db) => claimNextGeneration(db, ws, { ...base, ...launch, sources: sources(), now }));
}

describe("coordinator capsule: live view and journal", () => {
  it("writes live.json with schema, canonical fields, and an advisory journal", () => {
    const ws = workspace();
    seed(ws);
    runCoordinatorNoteCommand({ workspace: ws, ...base, text: "Holding #2236 until CI is green", pr: ["2236"], now: at(2), env: {} });
    runCoordinatorNoteCommand({ workspace: ws, ...base, text: "gh pr checks 2236 --watch --required", nextMove: true, now: at(3), env: {} });
    const result = runCoordinatorCapsuleCommand({ workspace: ws, ...base, sources: sources(), now: at(4) });
    const live = JSON.parse(readFileSync(coordinatorPaths(ws, "arcadia", "rowan").live, "utf8"));
    expect(live.schema).toBe(CAPSULE_SCHEMA);
    expect(live.generation).toBe(1);
    expect(live.custodian).toMatchObject({ provider: "claude", model: "opus", tier: "heavy" });
    expect(live.plan).toEqual({ activePlan: "docs/plans/p.md", currentAction: "a1", mainSha: "aaa111" });
    expect(live.prs.map((pr: { number: number }) => pr.number)).toEqual([2236]);
    expect(live.journal).toHaveLength(1);
    expect(live.next_move).toMatchObject({ text: "gh pr checks 2236 --watch --required" });
    expect(result.data.check.passed).toBe(true);
    const markdown = renderCapsuleMarkdown(live, at(4));
    expect(markdown).toContain("advisory: model-written, not authority");
    // Never carries a credential or a custody token.
    expect(JSON.stringify(live)).not.toMatch(/token_hash|claude-code-oauth-token/);
  });

  it("keeps at most 20 journal entries and flags entries older than two hours on --check", () => {
    const ws = workspace();
    seed(ws);
    for (let index = 0; index < 22; index += 1) {
      runCoordinatorNoteCommand({ workspace: ws, ...base, text: `note ${index}`, now: at(index), env: {} });
    }
    const late = runCoordinatorCapsuleCommand({ workspace: ws, ...base, sources: sources(), now: at(200), check: true });
    expect(late.data.capsule.journal).toHaveLength(20);
    expect(late.data.capsule.journal[0].text).toBe("note 2");
    expect(late.data.check.passed).toBe(false);
    expect(late.data.check.problems.join(" ")).toMatch(/stale/);
    expect(late.data.check.problems.join(" ")).toMatch(/next_move/);
  });
});

describe("coordinator generations: claim, claim recovery and launching rules", () => {
  it("writes the immutable snapshot before the launching row and pins its sha", () => {
    const ws = workspace();
    seed(ws);
    const claimed = claim(ws);
    expect(claimed.generation).toBe(2);
    const bytes = readFileSync(claimed.snapshotPath);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(claimed.snapshotSha);
    const rows = withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan"));
    expect(rows.map((row) => [row.generation, row.status])).toEqual([[1, "custodian"], [2, "launching"]]);
    expect(rows[1].snapshotSha).toBe(claimed.snapshotSha);
    const log = readFileSync(coordinatorPaths(ws, "arcadia", "rowan").generationsLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(log.map((entry) => entry.event)).toEqual(["custodian_seeded", "launching"]);
    // The token is returned once to the launcher and stored only as a hash.
    expect(claimed.token).toMatch(/^[0-9a-f]{48}$/);
    expect(JSON.stringify(rows)).not.toContain(claimed.token);
  });

  it("refuses another launch while a complete launching row is younger than 15 minutes", () => {
    const ws = workspace();
    seed(ws);
    claim(ws, at(1));
    expect(() => claim(ws, at(1 + CLAIM_LAUNCHING_FRESH_MS / 60_000 - 1))).toThrow(/launching/);
    // Older than 15 minutes it is still unresolved: only an explicit failure (change 3, step 7) clears it.
    expect(() => claim(ws, at(30))).toThrow(/unresolved/);
    withDatabase(ws, (db) => failGeneration(db, ws, { ...base, generation: 2, reason: "no_acceptance", now: at(31) }));
    expect(claim(ws, at(32)).generation).toBe(3);
  });

  it("marks a launching row whose snapshot is missing or mismatched failed (claim_incomplete), then continues", () => {
    const ws = workspace();
    seed(ws);
    const first = claim(ws, at(1));
    unlinkSync(first.snapshotPath);
    const second = claim(ws, at(2));
    expect(second.generation).toBe(3);
    let rows = withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan"));
    expect(rows.find((row) => row.generation === 2)).toMatchObject({ status: "failed", failureReason: "claim_incomplete" });

    // A tampered snapshot is incomplete too; a matching one is never touched.
    unlinkSync(second.snapshotPath);
    writeFileSync(second.snapshotPath, "{}\n");
    const third = claim(ws, at(3));
    rows = withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan"));
    expect(rows.find((row) => row.generation === 3)).toMatchObject({ status: "failed", failureReason: "claim_incomplete" });
    expect(rows.find((row) => row.generation === 4)).toMatchObject({ status: "launching", snapshotSha: third.snapshotSha });
  });

  it("never overwrites an existing snapshot file", () => {
    const ws = workspace();
    seed(ws);
    const stray = path.join(coordinatorPaths(ws, "arcadia", "rowan").snapshots, "2.json");
    claim(ws, at(1));
    const original = readFileSync(stray, "utf8");
    withDatabase(ws, (db) => failGeneration(db, ws, { ...base, generation: 2, reason: "test", now: at(2) }));
    const next = claim(ws, at(3));
    expect(next.generation).toBe(3);
    expect(readFileSync(stray, "utf8")).toBe(original);
  });
});

describe("crash leftovers", () => {
  it("sets aside an orphan snapshot that no row references instead of blocking every later claim", () => {
    const ws = workspace();
    seed(ws);
    const orphan = path.join(coordinatorPaths(ws, "arcadia", "rowan").snapshots, "2.json");
    claim(ws, at(1));
    // Simulate a crash between the snapshot write and the insert: the file exists, the row does not.
    withDatabase(ws, (db) => db.prepare("DELETE FROM coordinator_generations WHERE generation = 2").run());
    const before = readFileSync(orphan, "utf8");
    const next = claim(ws, at(2));
    expect(next.generation).toBe(2);
    const log = readFileSync(coordinatorPaths(ws, "arcadia", "rowan").generationsLog, "utf8");
    const aside = JSON.parse(log.trim().split("\n").find((line) => line.includes("orphan_snapshot_set_aside"))!).path as string;
    expect(readFileSync(aside, "utf8")).toBe(before);
  });
});

describe("relay lock", () => {
  it("treats a live holder whose start time cannot be read as live, never stale", () => {
    const ws = workspace();
    const dir = coordinatorPaths(ws, "arcadia", "rowan").root;
    const held = acquireRelayLock(dir, { pid: 4242, processStartTime: () => "Sat Nov  7 12:00:00 2026", waitMs: 0 });
    expect(() => acquireRelayLock(dir, { pid: 5151, processStartTime: () => ALIVE_START_UNKNOWN, waitMs: 0 })).toThrow(/relay lock/);
    releaseRelayLock(held);
  });

  it("is exclusive for a live holder and broken only when no live process has that pid and start time", () => {
    const ws = workspace();
    const dir = coordinatorPaths(ws, "arcadia", "rowan").root;
    const live = { pid: 4242, processStartTime: (pid: number) => (pid === 4242 ? "Sat Nov  7 12:00:00 2026" : null), waitMs: 0 };
    const held = acquireRelayLock(dir, live);
    expect(() => acquireRelayLock(dir, { ...live, pid: 5151 })).toThrow(/relay lock/);
    releaseRelayLock(held);
    const again = acquireRelayLock(dir, live);
    // The pid is reused by a different process (different start time): the lock is stale.
    const reused = { pid: 5151, processStartTime: (pid: number) => (pid === 4242 ? "Sun Nov  8 01:00:00 2026" : "x"), waitMs: 0 };
    const taken = acquireRelayLock(dir, reused);
    expect(JSON.parse(readFileSync(taken.file, "utf8")).pid).toBe(5151);
    releaseRelayLock(again); // a stale holder's release never removes the new holder's lock
    expect(existsSync(taken.file)).toBe(true);
    releaseRelayLock(taken);
    expect(existsSync(taken.file)).toBe(false);
  });
});

describe("verify, subscribe --from-snapshot and accept", () => {
  function handoff() {
    const ws = workspace();
    seed(ws);
    runCoordinatorSubscribeCommand({ workspace: ws, ...base, commandLine: "scripts/wait-for-event.sh --pr 2236", cursor: "c-10", now: at(1), env: {} });
    runCoordinatorNoteCommand({ workspace: ws, ...base, text: "arcadia production status", nextMove: true, now: at(1), env: {} });
    const claimed = claim(ws, at(2));
    return { ws, claimed, env: envFor(2, claimed.token) };
  }

  it("verify fails until every watcher is registered by the successor, then passes and reports drift as information", () => {
    const { ws, claimed, env } = handoff();
    const before = runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, sources: sources(), now: at(3) });
    expect(before.data.passed).toBe(false);
    expect(before.data.items.find((item) => item.id === 3)?.passed).toBe(false);

    runCoordinatorSubscribeCommand({ workspace: ws, ...base, fromSnapshot: claimed.snapshotSha, now: at(4), env });
    armInherited(ws, env, at(4));
    const after = runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, sources: sources({ head: "ccc333" }), now: at(5) });
    expect(after.data.passed).toBe(true);
    expect(after.data.drift).toEqual([{ field: "plan.mainSha", snapshot: "aaa111", now: "ccc333" }]);
    expect(after.data.items.find((item) => item.id === 6)?.passed).toBe(true);
  });

  it("verify fails on a sha that does not match the pinned snapshot or a generation that is not the newest launching row", () => {
    const { ws, claimed } = handoff();
    expect(runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 2, snapshotSha: "f".repeat(64), sources: sources(), now: at(3) }).data.passed).toBe(false);
    expect(runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 1, snapshotSha: claimed.snapshotSha, sources: sources(), now: at(3) }).data.passed).toBe(false);
  });

  it("accept needs a passing verify on the same sha within 10 minutes, then fences the predecessor", () => {
    const { ws, claimed, env } = handoff();
    runCoordinatorSubscribeCommand({ workspace: ws, ...base, fromSnapshot: claimed.snapshotSha, now: at(3), env });
    armInherited(ws, env, at(3));
    expect(() => runCoordinatorAcceptCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, now: at(4), env })).toThrow(/verify/);
    runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, sources: sources(), now: at(4) });
    expect(() => runCoordinatorAcceptCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, now: at(15), env })).toThrow(/10 minutes/);
    runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, sources: sources(), now: at(15) });
    // A wrong token cannot accept.
    expect(() => runCoordinatorAcceptCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, now: at(16), env: envFor(2, "0".repeat(48)) })).toThrow(/custody/);
    const accepted = runCoordinatorAcceptCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, now: at(16), env });
    expect(accepted.data.custodian).toBe(2);
    const rows = withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan"));
    expect(rows.map((row) => [row.generation, row.status])).toEqual([[1, "handed_off"], [2, "custodian"]]);

    // The new custodian can note; a relay-launched predecessor (generation 1 with its own token) cannot.
    expect(() => runCoordinatorNoteCommand({ workspace: ws, ...base, text: "ok", now: at(17), env })).not.toThrow();
    const predecessorEnv = envFor(1, "seeded-has-no-token");
    expect(() => runCoordinatorNoteCommand({ workspace: ws, ...base, text: "still here", now: at(17), env: predecessorEnv })).toThrow(/generation 2/);
    expect(() => runPingSendCommand({ workspace: ws, message: "hi", env: predecessorEnv })).toThrow(/custody/);
    // A caller with no coordinator identity is not fenced.
    expect(() => runPingSendCommand({ workspace: ws, message: "hi", env: {} })).not.toThrow();

    // A relay-launched predecessor, with its own valid token, is fenced after the next handoff.
    runCoordinatorNoteCommand({ workspace: ws, ...base, text: "arcadia production status", nextMove: true, now: at(18), env });
    const next = claim(ws, at(19));
    const nextEnv = envFor(3, next.token);
    runCoordinatorSubscribeCommand({ workspace: ws, ...base, fromSnapshot: next.snapshotSha, now: at(20), env: nextEnv });
    armInherited(ws, nextEnv, at(20));
    runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 3, snapshotSha: next.snapshotSha, sources: sources(), now: at(20) });
    runCoordinatorAcceptCommand({ workspace: ws, ...base, generation: 3, snapshotSha: next.snapshotSha, now: at(21), env: nextEnv });
    expect(() => runCoordinatorNoteCommand({ workspace: ws, ...base, text: "late", now: at(22), env })).toThrow(/generation 3/);
    expect(() => runPingSendCommand({ workspace: ws, message: "late", env })).toThrow(/custody/);
  });

  it("admits the incoming generation only for subscribe --from-snapshot, accept, and registering a watcher the state already holds", () => {
    const { ws, claimed, env } = handoff();
    expect(() => runCoordinatorNoteCommand({ workspace: ws, ...base, text: "early", now: at(3), env })).toThrow(/custody/);
    expect(() => runCoordinatorSubscribeCommand({ workspace: ws, ...base, commandLine: "x", cursor: "1", now: at(3), env })).toThrow(/already recorded/);
    expect(() => runPingSendCommand({ workspace: ws, message: "hi", env })).toThrow(/custody/);
    // A sha that is not the launching row's snapshot is refused.
    expect(() => runCoordinatorSubscribeCommand({ workspace: ws, ...base, fromSnapshot: "e".repeat(64), now: at(3), env })).toThrow(/snapshot/);
    expect(() => runCoordinatorSubscribeCommand({ workspace: ws, ...base, fromSnapshot: claimed.snapshotSha, now: at(3), env })).not.toThrow();
  });

  it("subscribe --from-snapshot records inherited watchers and verify does not report them registered", () => {
    const { ws, claimed, env } = handoff();
    const result = runCoordinatorSubscribeCommand({ workspace: ws, ...base, fromSnapshot: claimed.snapshotSha, now: at(3), env });
    expect(result.data.subscriptions).toEqual([{ command: "scripts/wait-for-event.sh --pr 2236", cursor: "c-10", armedByGeneration: null, inherited: true }]);
    const unarmed = runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, sources: sources(), now: at(4) });
    expect(unarmed.data.passed).toBe(false);
    expect(unarmed.data.items.find((item) => item.id === 3)).toMatchObject({ passed: false });
    expect(unarmed.data.items.find((item) => item.id === 3)?.detail).toMatch(/not registered by generation 2/);
    // Only the successor's explicit arm of that exact command clears it.
    armInherited(ws, env, at(5));
    const armed = runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, sources: sources(), now: at(6) });
    expect(armed.data.items.find((item) => item.id === 3)).toMatchObject({ passed: true });
  });

  it("a watcher the predecessor registers after the snapshot fails verify closed, then the successor can register it", () => {
    const { ws, claimed, env } = handoff();
    // The predecessor (no relay token) is still custodian and registers a watcher the snapshot does not list.
    runCoordinatorSubscribeCommand({ workspace: ws, ...base, commandLine: "scripts/late-watch.sh --pr 2300", cursor: "l-1", now: at(3), env: {} });
    runCoordinatorSubscribeCommand({ workspace: ws, ...base, fromSnapshot: claimed.snapshotSha, now: at(4), env });
    armInherited(ws, env, at(4));
    const failed = runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, sources: sources(), now: at(5) });
    expect(failed.data.passed).toBe(false);
    const item = failed.data.items.find((entry) => entry.id === 3);
    expect(item).toMatchObject({ passed: false });
    expect(item?.detail).toMatch(/scripts\/late-watch\.sh --pr 2300 \(registered by the predecessor after the snapshot\)/);
    expect(() => runCoordinatorAcceptCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, now: at(6), env })).toThrow(/verify/);
    // The incoming generation may register a late watcher the state holds (plain subscribe used to refuse it).
    armInherited(ws, env, at(6), "scripts/late-watch.sh --pr 2300", "l-1");
    const passed = runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, sources: sources(), now: at(7) });
    expect(passed.data.passed).toBe(true);
    expect(passed.data.items.find((entry) => entry.id === 3)?.detail).toMatch(/does not prove the process is running/);
  });

  it("accept re-checks the watchers under the lock: a late watcher or a re-flagged one after verify refuses and drops the verify pass", () => {
    const { ws, claimed, env } = handoff();
    runCoordinatorSubscribeCommand({ workspace: ws, ...base, fromSnapshot: claimed.snapshotSha, now: at(3), env });
    armInherited(ws, env, at(3));
    expect(runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, sources: sources(), now: at(4) }).data.passed).toBe(true);
    const statuses = () => withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan")).map((row) => [row.generation, row.status]);
    // Between verify and accept the predecessor registers another watcher.
    runCoordinatorSubscribeCommand({ workspace: ws, ...base, commandLine: "scripts/late-watch.sh --pr 2300", cursor: "l-1", now: at(5), env: {} });
    expect(() => runCoordinatorAcceptCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, now: at(6), env })).toThrow(/not registered by generation 2: scripts\/late-watch\.sh/);
    expect(statuses()).toEqual([[1, "custodian"], [2, "launching"]]);
    // The pass was dropped, so even after the successor registers it, accept needs a fresh verify.
    armInherited(ws, env, at(7), "scripts/late-watch.sh --pr 2300", "l-1");
    expect(() => runCoordinatorAcceptCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, now: at(8), env })).toThrow(/verify/);
    runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, sources: sources(), now: at(8) });
    // A `--from-snapshot` after verify re-flags the watcher inherited; accept refuses that too.
    runCoordinatorSubscribeCommand({ workspace: ws, ...base, fromSnapshot: claimed.snapshotSha, now: at(9), env });
    expect(() => runCoordinatorAcceptCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, now: at(10), env })).toThrow(/verify/);
    expect(statuses()).toEqual([[1, "custodian"], [2, "launching"]]);
    // Re-flag with a valid pass in hand (the pass is dropped by --from-snapshot, so write the state directly to prove the lock-time check itself).
    armInherited(ws, env, at(11));
    armInherited(ws, env, at(11), "scripts/late-watch.sh --pr 2300", "l-1");
    runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, sources: sources(), now: at(12) });
    const paths = coordinatorPaths(ws, "arcadia", "rowan");
    const state = readCoordinatorState(paths);
    writeCoordinatorState(paths, { ...state, subscriptions: state.subscriptions.map((subscription) => ({ ...subscription, inherited: true })) });
    expect(() => runCoordinatorAcceptCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, now: at(13), env })).toThrow(/not registered by generation 2/);
    expect(statuses()).toEqual([[1, "custodian"], [2, "launching"]]);
  });

  it("a different cursor never refuses: it is a warning naming both cursors, so a later legitimate resume is not stuck", () => {
    const { ws, claimed, env } = handoff();
    runCoordinatorSubscribeCommand({ workspace: ws, ...base, fromSnapshot: claimed.snapshotSha, now: at(3), env });
    armInherited(ws, env, at(60), "scripts/wait-for-event.sh --pr 2236", "c-42");
    const result = runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, sources: sources(), now: at(61) });
    expect(result.data.passed).toBe(true);
    expect(result.data.cursorChanges).toEqual([{ command: "scripts/wait-for-event.sh --pr 2236", from: "c-10", to: "c-42" }]);
    expect(result.data.items.find((item) => item.id === 3)?.detail).toMatch(/cursor changed for .*c-10 -> c-42/);
    expect(() => runCoordinatorAcceptCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, now: at(62), env })).not.toThrow();
    // The same cursor reports no change.
    const again = handoff();
    runCoordinatorSubscribeCommand({ workspace: again.ws, ...base, fromSnapshot: again.claimed.snapshotSha, now: at(3), env: again.env });
    armInherited(again.ws, again.env, at(4));
    expect(runCoordinatorVerifyCommand({ workspace: again.ws, ...base, generation: 2, snapshotSha: again.claimed.snapshotSha, sources: sources(), now: at(5) }).data.cursorChanges).toEqual([]);
  });

  it("accept refuses a snapshot file changed after verify, names the reason and leaves custody unchanged", () => {
    const { ws, claimed, env } = handoff();
    runCoordinatorSubscribeCommand({ workspace: ws, ...base, fromSnapshot: claimed.snapshotSha, now: at(3), env });
    armInherited(ws, env, at(3));
    expect(runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, sources: sources(), now: at(4) }).data.passed).toBe(true);
    const file = claimed.snapshotPath;
    chmodSync(file, 0o600); // snapshots are written read-only
    writeFileSync(file, `${readFileSync(file, "utf8")} `);
    const statuses = () => withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan")).map((row) => [row.generation, row.status]);
    expect(() => runCoordinatorAcceptCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, now: at(5), env })).toThrow(/no longer hashes/);
    expect(statuses()).toEqual([[1, "custodian"], [2, "launching"]]);
    unlinkSync(file);
    expect(() => runCoordinatorAcceptCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, now: at(5), env })).toThrow(/missing or unreadable/);
    expect(statuses()).toEqual([[1, "custodian"], [2, "launching"]]);
  });

  it("a failing generations log write after commit leaves the claim's token returned and the accept successful, with warnings", () => {
    const ws = workspace();
    seed(ws);
    const paths = coordinatorPaths(ws, "arcadia", "rowan");
    // A directory where the log file belongs makes every append throw.
    unlinkSync(paths.generationsLog);
    mkdirSync(paths.generationsLog);
    runCoordinatorNoteCommand({ workspace: ws, ...base, text: "arcadia production status", nextMove: true, now: at(1), env: {} });
    const claimed = claim(ws, at(2));
    expect(claimed.token).toMatch(/^[0-9a-f]{48}$/);
    expect(claimed.warnings?.[0]).toMatch(/log write failed/);
    expect(withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan")).map((row) => [row.generation, row.status])).toEqual([[1, "custodian"], [2, "launching"]]);

    const env = envFor(2, claimed.token);
    runCoordinatorSubscribeCommand({ workspace: ws, ...base, fromSnapshot: claimed.snapshotSha, now: at(3), env });
    runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, sources: sources(), now: at(4) });
    const accepted = runCoordinatorAcceptCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, now: at(5), env });
    expect(accepted.data.custodian).toBe(2);
    expect(accepted.data.warnings?.[0]).toMatch(/log write failed/);
    expect(withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan")).map((row) => [row.generation, row.status])).toEqual([[1, "handed_off"], [2, "custodian"]]);
  });

  it("re-running --from-snapshot after a passing verify clears it, so accept needs a fresh verify", () => {
    const { ws, claimed, env } = handoff();
    runCoordinatorSubscribeCommand({ workspace: ws, ...base, fromSnapshot: claimed.snapshotSha, now: at(3), env });
    armInherited(ws, env, at(3));
    expect(runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, sources: sources(), now: at(4) }).data.passed).toBe(true);
    runCoordinatorSubscribeCommand({ workspace: ws, ...base, fromSnapshot: claimed.snapshotSha, now: at(5), env });
    expect(() => runCoordinatorAcceptCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, now: at(6), env })).toThrow(/verify/);
    expect(withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan")).map((row) => row.status)).toEqual(["custodian", "launching"]);
  });

  it("a failing log write does not stop failGeneration from marking the row failed", () => {
    const { ws } = handoff();
    const paths = coordinatorPaths(ws, "arcadia", "rowan");
    unlinkSync(paths.generationsLog);
    mkdirSync(paths.generationsLog);
    expect(withDatabase(ws, (db) => failGeneration(db, ws, { ...base, generation: 2, reason: "launch_failed", now: at(3) }))).toBe(true);
    expect(withDatabase(ws, (db) => listGenerations(db, "arcadia", "rowan")).map((row) => row.status)).toEqual(["custodian", "failed"]);
  });

  it("the guard refuses an unknown generation or token and names the custodian", () => {
    const { ws } = handoff();
    expect(() => withDatabase(ws, (db) => assertCoordinatorCustody(db, { command: "note", env: envFor(9, "x"), now: at(3) }))).toThrow(/generation 1/);
    expect(withDatabase(ws, (db) => assertCoordinatorCustody(db, { command: "note", env: {}, now: at(3) }))).toEqual({ kind: "unfenced" });
  });
});

describe("repositoryRoot", () => {
  it("capsule and verify keep the invocation root even inside a linked worktree", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-coord-linked-"));
    roots.push(root);
    const main = path.join(root, "main");
    mkdirSync(main);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: main });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "--allow-empty", "-m", "i"], { cwd: main });
    const linked = path.join(root, "linked");
    execFileSync("git", ["worktree", "add", "-q", linked], { cwd: main });
    const before = process.env.ARCADIA_INVOKED_FROM;
    process.env.ARCADIA_INVOKED_FROM = linked;
    try {
      expect(repositoryRoot()).toBe(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: linked, encoding: "utf8" }).trim());
    } finally {
      if (before === undefined) delete process.env.ARCADIA_INVOKED_FROM; else process.env.ARCADIA_INVOKED_FROM = before;
    }
  });

  it("resolves from the invocation directory, not the process directory", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-coord-repo-"));
    roots.push(root);
    const repo = path.join(root, "operator-repo");
    mkdirSync(repo);
    execFileSync("git", ["init", "-q", repo]);
    const before = process.env.ARCADIA_INVOKED_FROM;
    process.env.ARCADIA_INVOKED_FROM = repo;
    try {
      expect(repositoryRoot()).toBe(execFileSync("git", ["-C", repo, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
      expect(repositoryRoot()).not.toBe(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
      expect(repositoryRoot("/explicit")).toBe("/explicit");
    } finally {
      if (before === undefined) delete process.env.ARCADIA_INVOKED_FROM; else process.env.ARCADIA_INVOKED_FROM = before;
    }
  });
});

describe("coordinator relay-sessions: which tmux sessions START tolerates (#2286 item 7)", () => {
  const verdicts = (ws: string) => withDatabase(ws, (db) => relayCoordinatorSessions(db, "arcadia")).map((entry) => [entry.tmuxName, entry.allowed]);
  const NEXT = "arcadia production status";

  it("allows nothing for a desktop-seeded custodian, which has no tmux session", () => {
    const ws = workspace();
    seed(ws);
    expect(verdicts(ws)).toEqual([]);
    expect(runCoordinatorRelaySessionsCommand({ workspace: ws, project: "arcadia" }).data.allowed).toEqual([]);
  });

  it("holds the name while a successor is launching, allows only the accepted relay custodian, and holds it again during the next handoff", () => {
    const ws = workspace();
    seed(ws);
    runCoordinatorNoteCommand({ workspace: ws, ...base, text: NEXT, nextMove: true, now: at(1), env: {} });
    const claimed = claim(ws, at(2));
    const env = envFor(2, claimed.token);
    // A handoff in flight: the launching successor is held (and the seeded predecessor has no tmux name).
    expect(verdicts(ws)).toEqual([["arcadia-coord-rowan-g2", false]]);
    runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, sources: sources(), now: at(4) });
    runCoordinatorAcceptCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, now: at(5), env });
    // Accepted: the relay-launched custodian is the one name allowed; the handed-off generation never is.
    expect(verdicts(ws)).toEqual([["arcadia-coord-rowan-g2", true]]);
    expect(runCoordinatorRelaySessionsCommand({ workspace: ws, project: "arcadia" }).data.allowed).toEqual(["arcadia-coord-rowan-g2"]);
    // Another handoff in flight holds the current custodian's name as well: START cannot overlap a transfer.
    runCoordinatorNoteCommand({ workspace: ws, ...base, text: NEXT, nextMove: true, now: at(6), env });
    withDatabase(ws, (db) => claimNextGeneration(db, ws, { ...base, ...launch, tmuxName: "arcadia-coord-rowan-g3", nativeSessionId: "00000000-0000-4000-8000-000000000003", sources: sources(), now: at(7) }));
    expect(verdicts(ws)).toEqual([["arcadia-coord-rowan-g2", false], ["arcadia-coord-rowan-g3", false]]);
    // Another Project's sessions are not this Project's.
    expect(runCoordinatorRelaySessionsCommand({ workspace: ws, project: "other" }).data.sessions).toEqual([]);
  });
});
