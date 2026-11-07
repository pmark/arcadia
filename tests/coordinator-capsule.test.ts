import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPingSendCommand } from "../src/commands/ping.js";
import {
  runCoordinatorAcceptCommand,
  runCoordinatorCapsuleCommand,
  runCoordinatorNoteCommand,
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
  seedCustodianGeneration
} from "../src/coordinator/generations.js";
import { acquireRelayLock, releaseRelayLock } from "../src/coordinator/lock.js";
import { coordinatorPaths } from "../src/coordinator/paths.js";
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

describe("relay lock", () => {
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

  it("verify fails until every subscription is re-armed, then passes and reports drift as information", () => {
    const { ws, claimed, env } = handoff();
    const before = runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 2, snapshotSha: claimed.snapshotSha, sources: sources(), now: at(3) });
    expect(before.data.passed).toBe(false);
    expect(before.data.items.find((item) => item.id === 3)?.passed).toBe(false);

    runCoordinatorSubscribeCommand({ workspace: ws, ...base, fromSnapshot: claimed.snapshotSha, now: at(4), env });
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
    runCoordinatorVerifyCommand({ workspace: ws, ...base, generation: 3, snapshotSha: next.snapshotSha, sources: sources(), now: at(20) });
    runCoordinatorAcceptCommand({ workspace: ws, ...base, generation: 3, snapshotSha: next.snapshotSha, now: at(21), env: nextEnv });
    expect(() => runCoordinatorNoteCommand({ workspace: ws, ...base, text: "late", now: at(22), env })).toThrow(/generation 3/);
    expect(() => runPingSendCommand({ workspace: ws, message: "late", env })).toThrow(/custody/);
  });

  it("admits the incoming generation only for subscribe --from-snapshot and accept", () => {
    const { ws, claimed, env } = handoff();
    expect(() => runCoordinatorNoteCommand({ workspace: ws, ...base, text: "early", now: at(3), env })).toThrow(/custody/);
    expect(() => runCoordinatorSubscribeCommand({ workspace: ws, ...base, commandLine: "x", cursor: "1", now: at(3), env })).toThrow(/custody/);
    expect(() => runPingSendCommand({ workspace: ws, message: "hi", env })).toThrow(/custody/);
    // A sha that is not the launching row's snapshot is refused.
    expect(() => runCoordinatorSubscribeCommand({ workspace: ws, ...base, fromSnapshot: "e".repeat(64), now: at(3), env })).toThrow(/snapshot/);
    expect(() => runCoordinatorSubscribeCommand({ workspace: ws, ...base, fromSnapshot: claimed.snapshotSha, now: at(3), env })).not.toThrow();
  });

  it("the guard refuses an unknown generation or token and names the custodian", () => {
    const { ws } = handoff();
    expect(() => withDatabase(ws, (db) => assertCoordinatorCustody(db, { command: "note", env: envFor(9, "x"), now: at(3) }))).toThrow(/generation 1/);
    expect(withDatabase(ws, (db) => assertCoordinatorCustody(db, { command: "note", env: {}, now: at(3) }))).toEqual({ kind: "unfenced" });
  });
});
