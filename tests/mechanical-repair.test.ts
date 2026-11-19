import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { guidanceFingerprint, guidanceResources, renderGuidanceFingerprints } from "../src/projects/agentGuidance.js";
import {
  claimRepairNotice,
  classifyCheckFailureLog,
  isProductionOwnedRepairHead,
  judgeRepairHeadMove,
  lintFixArgs,
  refreshCandidateGuidanceFingerprints,
  refreshStaleGuidance,
  repairEpisodeKey,
  runMechanicalRepairRound,
  staleGuidancePaths,
  type MechanicalRepairEffects
} from "../src/production/mechanicalRepair.js";

/**
 * The recorded failures are shaped from the fix commits Git records for each
 * pull request (a569da1e5 for #2758, 10a0fc841 and c77fe2619 for #2765,
 * 5cf0cb52c for #2766, c73d0fbcd for #2752): the check log lines are the
 * lines those failures print, the classes follow from what each fix touched.
 */
const LINT_2752 = `lint\tRun lint\ttests/start-run-derive.test.ts
lint\tRun lint\t  412:31  error  This assertion is unnecessary since it does not change the type of the expression  @typescript-eslint/no-unnecessary-type-assertion
lint\tRun lint\t
lint\tRun lint\t✖ 1 problem (1 error, 0 warnings)
lint\tRun lint\t  1 error and 0 warnings potentially fixable with the \`--fix\` option.
`;
const FINGERPRINT_2766 = `check\tRun guidance check
check\tRun guidance check\tError: Canonical guidance fingerprint is stale: docs/agent-guidance/operator-actions.md. Refresh docs/agent-guidance/fingerprints.json with the reviewed procedure bytes.
`;
const MIXED_2758 = `${FINGERPRINT_2766}
test\tRun tests\t FAIL  tests/production-replay.test.ts > replay binds the card
test\tRun tests\t AssertionError: expected 'a' to be 'b'
test\tRun tests\t Test Files  2 failed | 300 passed (302)
`;
const MIXED_2765 = `${FINGERPRINT_2766}
lint\tRun lint\t✖ 3 problems (3 errors, 0 warnings)
lint\tRun lint\t  2 errors and 0 warnings potentially fixable with the \`--fix\` option.
test\tRun tests\t FAIL  tests/production-successor-press.test.ts > pins the fixture
`;

const repoRoots: string[] = [];
afterEach(() => { for (const root of repoRoots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("classifyCheckFailureLog (recorded failures)", () => {
  it("classifies #2752 as lint-autofixable", () => {
    expect(classifyCheckFailureLog(LINT_2752)).toMatchObject({ class: "lint-autofixable", classes: ["lint-autofixable"], residue: false });
  });
  it("classifies #2766 as guidance-fingerprint and names the document", () => {
    expect(classifyCheckFailureLog(FINGERPRINT_2766)).toMatchObject({ class: "guidance-fingerprint", guidancePaths: ["docs/agent-guidance/operator-actions.md"] });
  });
  it("classifies #2758 and #2765 as unknown: a failing test or unfixable lint rides with the mechanical failure", () => {
    expect(classifyCheckFailureLog(MIXED_2758).class).toBe("unknown");
    expect(classifyCheckFailureLog(MIXED_2765).class).toBe("unknown");
    expect(classifyCheckFailureLog(MIXED_2765).residue).toBe(true);
  });
  it("classifies a stale current_action and an empty log", () => {
    expect(classifyCheckFailureLog('Error: current_action "derive-start-card" is already done; the pointer is stale').class).toBe("stale-current-action");
    expect(classifyCheckFailureLog("").class).toBe("unknown");
  });
});

function effects(overrides: Partial<MechanicalRepairEffects> = {}): MechanicalRepairEffects & { ran: string[]; commits: string[] } {
  const ran: string[] = [];
  const commits: string[] = [];
  return {
    ran, commits,
    run: (command, args) => { ran.push([command, ...args].join(" ")); return { status: 0 }; },
    dirty: () => true,
    commit: (message) => { commits.push(message); return "b".repeat(40); },
    advancePointer: () => true,
    refreshFingerprints: () => ({ refreshed: ["docs/agent-guidance/operator-actions.md"], refused: [], written: true }),
    ...overrides
  };
}

const HEAD = "a".repeat(40);
const KEY = "arcadia/repair-mechanical-check-failures-deterministically";
const NOW = new Date("2026-11-18T00:00:00Z");

describe("runMechanicalRepairRound", () => {
  it("runs eslint --fix limited to the candidate's changed lintable files", () => {
    const db = new Database(":memory:");
    const fx = effects();
    const out = runMechanicalRepairRound({ db, actionKey: KEY, head: HEAD, logs: [LINT_2752], changedPaths: ["tests/start-run-derive.test.ts", "docs/x.md"], effects: fx, now: NOW });
    expect(out).toMatchObject({ kind: "repaired", newHead: "b".repeat(40), classes: ["lint-autofixable"] });
    expect(fx.ran).toEqual(["pnpm exec eslint --fix -- tests/start-run-derive.test.ts"]);
    expect(lintFixArgs(["docs/x.md"])).toBeNull();
  });

  it("is one round per head: a second call never runs a generator again", () => {
    const db = new Database(":memory:");
    const fx = effects();
    const input = { db, actionKey: KEY, head: HEAD, logs: [LINT_2752], changedPaths: ["a.ts"], effects: fx, now: NOW };
    runMechanicalRepairRound(input);
    const again = runMechanicalRepairRound(input);
    expect(again).toEqual({ kind: "already_attempted", outcome: "repaired" });
    expect(fx.ran).toHaveLength(1);
  });

  it("hands an unknown class to the bounded repair Session without running any generator", () => {
    const db = new Database(":memory:");
    const fx = effects();
    const out = runMechanicalRepairRound({ db, actionKey: KEY, head: HEAD, logs: [MIXED_2765], changedPaths: ["a.ts"], effects: fx, now: NOW });
    expect(out.kind).toBe("handoff");
    expect(fx.ran).toEqual([]);
    expect(fx.commits).toEqual([]);
    expect(runMechanicalRepairRound({ db, actionKey: KEY, head: HEAD, logs: [MIXED_2765], changedPaths: ["a.ts"], effects: fx, now: NOW }).kind).toBe("already_attempted");
  });

  it("hands off a still-red repaired head instead of looping", () => {
    const db = new Database(":memory:");
    const first = runMechanicalRepairRound({ db, actionKey: KEY, head: HEAD, logs: [LINT_2752], changedPaths: ["a.ts"], effects: effects(), now: NOW });
    if (first.kind !== "repaired") throw new Error("expected a repair");
    const fx = effects();
    const second = runMechanicalRepairRound({ db, actionKey: KEY, head: first.newHead, logs: [LINT_2752], changedPaths: ["a.ts"], effects: fx, now: NOW });
    expect(second.kind).toBe("handoff");
    expect(fx.ran).toEqual([]);
  });

  it("hands off when the generators change nothing", () => {
    const db = new Database(":memory:");
    const out = runMechanicalRepairRound({ db, actionKey: KEY, head: HEAD, logs: [LINT_2752], changedPaths: ["a.ts"], effects: effects({ dirty: () => false }), now: NOW });
    expect(out).toMatchObject({ kind: "handoff" });
  });

  it("applies the governed pointer advance for a stale current_action", () => {
    const db = new Database(":memory:");
    let advanced = 0;
    const out = runMechanicalRepairRound({ db, actionKey: KEY, head: HEAD, logs: ['current_action "x" is already done; stale pointer'], changedPaths: [], effects: effects({ advancePointer: () => { advanced += 1; return true; } }), now: NOW });
    expect(out.kind).toBe("repaired");
    expect(advanced).toBe(1);
  });
});

describe("a repair push is production-owned", () => {
  it("is not a moved head after a recorded verdict; any other head is", () => {
    const db = new Database(":memory:");
    // The reviewed (verdict-bearing) head is HEAD; production repairs it to a new head.
    const out = runMechanicalRepairRound({ db, actionKey: KEY, head: HEAD, logs: [FINGERPRINT_2766], changedPaths: ["docs/agent-guidance/operator-actions.md"], effects: effects(), now: NOW });
    if (out.kind !== "repaired") throw new Error("expected a repair");
    expect(isProductionOwnedRepairHead(db, KEY, out.newHead)).toBe(true);
    expect(judgeRepairHeadMove(db, KEY, out.newHead)).toBe("production_owned");
    expect(judgeRepairHeadMove(db, KEY, "c".repeat(40))).toBe("head_moved");
    expect(judgeRepairHeadMove(db, "arcadia/other", out.newHead)).toBe("head_moved");
  });
});

describe("refreshCandidateGuidanceFingerprints", () => {
  function fixture(): { root: string; fingerprints: () => Record<string, string> } {
    const root = mkdtempSync(path.join(tmpdir(), "mech-repair-"));
    repoRoots.push(root);
    mkdirSync(path.join(root, "docs/agent-guidance"), { recursive: true });
    // The real loader (guidanceEntries) demands every mandatory trigger, so the fixture indexes them all.
    const mandatory = ["continuation", "agent-asks", "operator-actions", "proposals", "principles", "pull-requests", "learning", "git-identity", "managed-documents", "planning", "working-copy"];
    const ids = ["mine", "theirs", ...mandatory];
    const index = { schema: "arcadia-agent-guidance-v1", entries: ids.map((id) => ({ id, trigger: "t", path: `docs/agent-guidance/${id}.md`, read_before: "r" })) };
    writeFileSync(path.join(root, "docs/agent-guidance/index.json"), JSON.stringify(index));
    const prints: Record<string, string> = {};
    for (const id of ids) {
      const text = id === "mine" ? "mine, edited\n" : id === "theirs" ? "theirs, drifted on the base\n" : `${id}\n`;
      writeFileSync(path.join(root, `docs/agent-guidance/${id}.md`), text);
      prints[id] = id === "mine" ? "0".repeat(64) : id === "theirs" ? "1".repeat(64) : guidanceFingerprint(text);
    }
    writeFileSync(path.join(root, "docs/agent-guidance/fingerprints.json"), renderGuidanceFingerprints(prints));
    return { root, fingerprints: () => (JSON.parse(readFileSync(path.join(root, "docs/agent-guidance/fingerprints.json"), "utf8")) as { fingerprints: Record<string, string> }).fingerprints };
  }

  it("refreshes a document the candidate changed", () => {
    const { root, fingerprints } = fixture();
    const result = refreshCandidateGuidanceFingerprints(root, ["docs/agent-guidance/mine.md"], ["docs/agent-guidance/mine.md"]);
    expect(result).toMatchObject({ refreshed: ["docs/agent-guidance/mine.md"], refused: [], written: true });
    expect(fingerprints().mine).toBe(guidanceFingerprint("mine, edited\n"));
  });

  it("never refreshes a fingerprint for a document outside the candidate's diff", () => {
    const { root, fingerprints } = fixture();
    const result = refreshCandidateGuidanceFingerprints(root, ["docs/agent-guidance/theirs.md"], ["docs/agent-guidance/mine.md"]);
    expect(result).toMatchObject({ refreshed: [], refused: ["docs/agent-guidance/theirs.md"], written: false });
    expect(fingerprints().theirs).toBe("1".repeat(64));
  });

  it("hands the round off when a stale document is outside the diff", () => {
    const db = new Database(":memory:");
    const { root } = fixture();
    const fx = effects({ refreshFingerprints: (stale, changed) => refreshCandidateGuidanceFingerprints(root, stale, changed) });
    const log = "Error: Canonical guidance fingerprint is stale: docs/agent-guidance/theirs.md. Refresh x.";
    const out = runMechanicalRepairRound({ db, actionKey: KEY, head: HEAD, logs: [log], changedPaths: ["docs/agent-guidance/mine.md"], effects: fx, now: NOW });
    expect(out.kind).toBe("handoff");
    expect(fx.commits).toEqual([]);
  });
});

describe("guidance:refresh (refreshStaleGuidance)", () => {
  function setup(): { root: string; fingerprints: () => string } {
    const root = mkdtempSync(path.join(tmpdir(), "guidance-refresh-"));
    repoRoots.push(root);
    mkdirSync(path.join(root, "docs/agent-guidance"), { recursive: true });
    const mandatory = ["continuation", "agent-asks", "operator-actions", "proposals", "principles", "pull-requests", "learning", "git-identity", "managed-documents", "planning", "working-copy"];
    const ids = ["a", "b", ...mandatory];
    writeFileSync(path.join(root, "docs/agent-guidance/index.json"), JSON.stringify({ schema: "arcadia-agent-guidance-v1", entries: ids.map((id) => ({ id, trigger: "t", path: `docs/agent-guidance/${id}.md`, read_before: "r" })) }));
    const prints: Record<string, string> = {};
    for (const id of ids) {
      writeFileSync(path.join(root, `docs/agent-guidance/${id}.md`), `${id}\n`);
      prints[id] = guidanceFingerprint(`${id}\n`);
    }
    writeFileSync(path.join(root, "docs/agent-guidance/fingerprints.json"), renderGuidanceFingerprints(prints));
    return { root, fingerprints: () => readFileSync(path.join(root, "docs/agent-guidance/fingerprints.json"), "utf8") };
  }

  it("refreshes only the named stale document, and the result then passes the guidance check", () => {
    const { root, fingerprints } = setup();
    writeFileSync(path.join(root, "docs/agent-guidance/a.md"), "a edited\n");
    writeFileSync(path.join(root, "docs/agent-guidance/b.md"), "b edited\n");
    const result = refreshStaleGuidance(root, ["docs/agent-guidance/a.md"]);
    expect(result).toMatchObject({ refreshed: ["docs/agent-guidance/a.md"], refused: [], written: true });
    expect(staleGuidancePaths(root)).toEqual(["docs/agent-guidance/b.md"]);
    expect(JSON.parse(fingerprints()).fingerprints.a).toBe(guidanceFingerprint("a edited\n"));
    refreshStaleGuidance(root);
    expect(staleGuidancePaths(root)).toEqual([]);
    const read = (file: string): string | null => { try { return readFileSync(path.join(root, file), "utf8"); } catch { return null; } };
    expect(() => guidanceResources(read)).not.toThrow();
  });

  it("changes nothing when no fingerprint is stale", () => {
    const { root, fingerprints } = setup();
    const before = fingerprints();
    expect(refreshStaleGuidance(root)).toEqual({ refreshed: [], refused: [], written: false });
    expect(fingerprints()).toBe(before);
  });
});

describe("one notice per repair episode", () => {
  it("fires once for the recorded 139,735-repeat case, not on every tick", () => {
    const db = new Database(":memory:");
    const episode = repairEpisodeKey(KEY, HEAD);
    let fired = 0;
    for (const trigger of ["repair_gated", "repair_budget_repeat"]) {
      for (let tick = 0; tick < 139_735; tick += 1) if (claimRepairNotice(db, episode, trigger, NOW)) fired += 1;
    }
    expect(fired).toBe(2);
    // A new head is a new episode.
    expect(claimRepairNotice(db, repairEpisodeKey(KEY, "c".repeat(40)), "repair_gated", NOW)).toBe(true);
  });
});
