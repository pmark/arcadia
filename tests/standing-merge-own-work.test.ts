import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import { ensureProductionPolicyTables } from "../src/production/policy.js";
import { loadGateSet } from "../src/production/gateSet.js";
import { evaluateStandingMerge, settlementReceiptIsReal, type CandidateHistory, type StandingMergeDeps } from "../src/production/standingMerge.js";
import { standingCandidateHistory } from "../src/production/workerMerge.js";

/**
 * Issue #2943: C4 judges only the agent's own work. Governed records that only
 * a real settlement commit touches are skipped; everything else is judged as
 * before. Hermetic: a real throwaway Git repository replays the shapes of
 * #2938 (candidate commit, settlement commit, later test-only commit) and
 * #2907 (settlement, test commit, a merge of main), the real shared gate set
 * (loadGateSet), an in-memory workspace database.
 */

const CARD = "start-run-fixture-20261122";
const REVIEWED = "b".repeat(40);
const MARKER_URL = "https://github.com/pmark/arcadia/pull/7#issuecomment-99";
const PLAN = "fixture-plan";
const PLAN_PATH = `docs/plans/${PLAN}.md`;
const OTHER_PLAN_PATH = "docs/plans/some-other-plan.md";
const ACTION = { id: "verify-overnight-merges-at-8am", title: "T", next_action: "Do the thing.", acceptance_criteria: ["A."], references: ["src/a.ts"] };
const NEXT = { id: "park-and-continue", title: "N", next_action: "Next.", acceptance_criteria: ["B."], references: [] };
/** An Action of the Plan that the card does not pin. */
const UNPINNED = { id: "x-unpinned", title: "U", next_action: "U.", acceptance_criteria: ["C."], references: [], status: "open" };
const DONE = "Completed via Agent Ask x; no further action.";
/** The pinned Action as a settlement leaves it. */
const SETTLED = { ...ACTION, status: "done", next_action: DONE };
/** A Plan as a settlement leaves it: `done` also rewrites the pinned Action's next_action and moves `updated` and the pointer, nothing else. */
const planText = (status: string, over: { actions?: Array<Record<string, unknown>>; extra?: Record<string, unknown>; body?: string } = {}) => {
  const done = status === "done";
  const actions = over.actions ?? [{ ...ACTION, status, ...(done ? { next_action: DONE } : {}) }, NEXT, UNPINNED];
  return `---\n${stringifyYaml({ slug: PLAN, status: "active", updated: done ? "2026-11-22" : "2026-11-21", actions, current_action: done ? NEXT.id : ACTION.id, ...over.extra })}---\n\n${over.body ?? "# Plan\n"}`;
};
const projectText = (pointer: string | null, updated: string, over: { activePlan?: string; status?: string; body?: string } = {}) =>
  `---\nname: Arcadia\nstatus: ${over.status ?? "active"}\nactive_plan: ${over.activePlan ?? PLAN}\nupdated: ${updated}\ncurrent_action: ${pointer ?? "null"}\n---\n\n${over.body ?? "# Arcadia\n"}`;
const RECEIPT_ID = "asksettle_a48046dd677645e1a7";
const receiptLine = (id: string) => `Written by \`arcadia agent-ask settle --apply\` (${id}).`;

const repoRoot = path.resolve(import.meta.dirname, "..");
const GATES = loadGateSet(repoRoot);

describe("C4 judges only the agent's own work (Issue #2943)", () => {
  let dir: string;
  let work: string;
  let library: string;
  let db: Database.Database;
  let baseSha: string;

  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t.test", "-c", "commit.gpgsign=false", ...args], { cwd: work, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const write = (file: string, text: string) => { mkdirSync(path.dirname(path.join(work, file)), { recursive: true }); writeFileSync(path.join(work, file), text); };
  const commit = (message: string): string => { git("add", "-A"); git("commit", "-q", "-m", message); return git("rev-parse", "HEAD").trim(); };
  /** A settlement commit as `agent-ask settle --apply` writes it, plus its workspace receipt row (bound to the commit). */
  const settle = (message: string, record: boolean, over: { disposition?: string; applied?: boolean; id?: string } = {}): string => {
    const sha = commit(message);
    if (record) {
      db.prepare("INSERT INTO agent_ask_settlements (id, proposal_id, request_id, disposition, project_slug, receipt_json) VALUES (?, ?, ?, ?, 'arcadia', ?)")
        .run(over.id ?? RECEIPT_ID, `p-${sha}`, `r-${sha}`, over.disposition ?? "accepted", JSON.stringify({ applied: over.applied ?? true, documentsCommit: sha, intent: "complete" }));
    }
    return sha;
  };
  const settleMessage = `chore(arcadia): settle auto-settle-arcadia-x\n\n- Marked Action done.\n\n${receiptLine(RECEIPT_ID)}\nArcadia writes and lands its own managed documents.\n`;
  /** The governed-record edits a settlement makes. */
  const settleFiles = (pointer: string | null = "park-and-continue") => {
    write(".arcadia/asks/archive/agent-ask-complete-x.yaml", "request_id: x\nintent: complete\n");
    write("MISSION_LOG.md", "# Log\n\n## Completed x\n");
    write("PROJECT.md", projectText(pointer, "2026-11-22"));
    write(PLAN_PATH, planText("done"));
  };

  const changed = () => git("-c", "core.quotepath=false", "diff", "--no-renames", "--name-only", "main...HEAD").split("\n").filter(Boolean);
  const run = (over: { changedPaths?: readonly string[] | null; history?: CandidateHistory | null } = {}, deps: StandingMergeDeps = {}) => {
    const head = git("rev-parse", "HEAD").trim();
    const body = `Independent review, head ${head.slice(0, 12)}\nNo blocking findings.\nLoosens a gate: no\n`;
    const history = "history" in over ? over.history : standingCandidateHistory(work, "main", head);
    return evaluateStandingMerge({
      db, repoRoot: work, baseBranch: "main", head, actionKey: `arcadia/${ACTION.id}`, pullRequestUrl: "https://github.com/pmark/arcadia/pull/7",
      changedPaths: "changedPaths" in over ? over.changedPaths! : changed(), history,
      runCommand: () => ({ status: 0, stdout: JSON.stringify({ comments: [{ body, url: MARKER_URL }] }), stderr: "" })
    }, {
      libraryDir: () => library, gateSet: () => GATES,
      decisions: () => [{ id: "0279", status: "approved", question: `May Rowan merge for ${CARD}?`, answer: "A" }],
      showFile: (revision, file) => { try { return git("show", `${revision === REVIEWED || revision === "main-now" ? baseSha : revision}:${file}`); } catch { return null; } },
      mergeTimeMain: () => "main-now", ...deps
    });
  };
  const parkedAt = (v: ReturnType<typeof run>) => (v.ok ? "ok" : v.condition);
  const reasonOf = (v: ReturnType<typeof run>) => (v.ok ? "" : v.reason);

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "standing-own-work-"));
    work = path.join(dir, "work");
    library = path.join(dir, "operator-scripts");
    mkdirSync(work);
    mkdirSync(library);
    git("init", "-q", "-b", "main");
    write("PROJECT.md", projectText(ACTION.id, "2026-11-21"));
    write("MISSION_LOG.md", "# Log\n");
    write(PLAN_PATH, planText("ready"));
    write(OTHER_PLAN_PATH, planText("ready"));
    write("src/production/overnightVerify.ts", "export const a = 1;\n");
    write("tests/overnight-verify.test.ts", "// test\n");
    baseSha = commit("base");
    git("checkout", "-q", "-b", "candidate");
    db = new Database(":memory:");
    ensureProductionPolicyTables(db);
    db.exec(`CREATE TABLE agent_ask_settlements (id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL UNIQUE,
      disposition TEXT NOT NULL, project_slug TEXT NOT NULL, receipt_json TEXT NOT NULL)`);
    db.prepare("UPDATE production_policy SET desired_state = 'active', authority_json = ? WHERE id = 'workspace'")
      .run(JSON.stringify({ requestId: CARD, grantedBy: "op", grantedAt: "2026-11-22T00:00:00Z", decisionRef: null, scopeFingerprint: "f" }));
    writeFileSync(path.join(library, `${CARD}.json`), JSON.stringify({ startRun: {
      schema: "arcadia-start-run-v1", reviewedRevision: REVIEWED, executorSha256: "b".repeat(64), workspace: "martianrover", project: "arcadia",
      plan: PLAN, actions: [ACTION.id, NEXT.id], provider: "claude-code-cli", transitions: ["validation", "acceptance", "pointer", "packet_approval"],
      concurrency: 1, packetApprovalHours: 24, intent: "A fixture run.", spendDecision: "0130", integrationDecision: "0058",
      requiredDecisions: ["0130", "0058", "0097", "0134", "0156", "0157", "0141", "0143", "0161", "0162"], requiredFiles: ["scripts/start-run.sh"],
      production: { revision: 83, epoch: 46 }, queueRevision: 290, workerLabel: "com.arcadia.local.1.worker", gateCardId: "enable-capacity-gate-20261017",
      offId: "restore-off-production", grantedBy: "the operator", consumedHistory: [{ path: "/abs/one.consumed.json", sha256: "c".repeat(64) }]
    } }));
  });
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

  /** #2938: a Controller candidate commit with a code path, the settlement, then a test-only commit. */
  function replay2938(): void {
    write(".arcadia/asks/agent-ask-complete-x.yaml", "request_id: x\nintent: complete\n");
    write("src/production/overnightVerify.ts", "export const a = 2;\n");
    write("tests/overnight-verify.test.ts", "// test v2\n");
    commit("chore(candidate): preserve candidate for handoff\n\nArcadia-Preservation-Request: worker-tick-preserve-session_x\nArcadia-Candidate-Fingerprint: 1522783610863be2113b5560e24850252a2969cb");
    git("rm", "-q", "--cached", ".arcadia/asks/agent-ask-complete-x.yaml");
    settleFiles();
    settle(settleMessage, true);
    write("tests/overnight-verify.test.ts", "// test v3\n");
    commit("fix(test): drop the unnecessary cast");
  }

  it("proves the failure this fixes: the whole 2938 diff names a gate module and PROJECT.md", () => {
    replay2938();
    expect(changed()).toEqual(expect.arrayContaining(["PROJECT.md", "src/production/overnightVerify.ts", "MISSION_LOG.md", PLAN_PATH]));
  });

  it("still parks #2938 on its code path src/production/overnightVerify.ts, but no longer on the settlement's records", () => {
    replay2938();
    const v = run();
    expect(parkedAt(v)).toBe("C4");
    const reason = reasonOf(v);
    expect(reason).toContain("src/production/overnightVerify.ts");
    expect(reason).not.toContain("PROJECT.md");
    expect(reason).not.toContain("MISSION_LOG.md");
  });

  it("passes #2907's shape: settlement plus tests (and a merge of main), no gate code", () => {
    write("tests/mech.test.ts", "// t\n");
    commit("test(production): finish-wire repair coverage");
    git("checkout", "-q", "main");
    write("docs/notes.txt", "main moved\n");
    commit("main moves");
    git("checkout", "-q", "candidate");
    git("merge", "-q", "--no-edit", "main");
    settleFiles();
    settle(settleMessage, true);
    const v = run();
    expect(v).toMatchObject({ ok: true, cardId: CARD });
  });

  it("a settle-only candidate passes C4: protected PROJECT.md is skipped, and only because of the receipt", () => {
    settleFiles();
    settle(settleMessage, true);
    expect(parkedAt(run())).toBe("ok");
    // The same diff judged exactly as before (no history) parks on PROJECT.md.
    const before = run({ history: null });
    expect(parkedAt(before)).toBe("C4");
    expect(reasonOf(before)).toContain("PROJECT.md");
  });

  it("parks a hand-written receipt line the workspace never recorded", () => {
    settleFiles();
    settle(settleMessage, false);
    const v = run();
    expect(parkedAt(v)).toBe("C4");
    expect(reasonOf(v)).toContain("PROJECT.md");
  });

  it.each([
    ["rejected", { disposition: "rejected" }],
    ["not applied", { applied: false }]
  ])("parks a recorded receipt that is %s", (_name, over) => {
    settleFiles();
    settle(settleMessage, true, over);
    expect(parkedAt(run())).toBe("C4");
  });

  it("parks a real receipt id copied onto a different commit (the receipt binds its documents commit)", () => {
    settleFiles();
    settle(settleMessage, true);
    write("PROJECT.md", projectText("park-and-continue", "2026-11-23"));
    commit(`hand edit\n\n${receiptLine(RECEIPT_ID)}`);
    expect(parkedAt(run())).toBe("C4");
  });

  it("parks a commit that claims two different receipts", () => {
    settleFiles();
    settle(`${settleMessage}\n${receiptLine("asksettle_second00000000001")}\n`, true);
    expect(parkedAt(run())).toBe("C4");
  });

  it("parks a path touched by two commits, even when both are real settlements", () => {
    settleFiles();
    settle(settleMessage, true);
    write("PROJECT.md", projectText("park-and-continue", "2026-11-23"));
    settle(`chore(arcadia): settle again\n\n${receiptLine("asksettle_second00000000001")}\n`, true, { id: "asksettle_second00000000001" });
    expect(parkedAt(run())).toBe("C4");
  });

  it("parks a path an ordinary commit also touches (a hand edit of PROJECT.md after the settlement)", () => {
    settleFiles();
    settle(settleMessage, true);
    write("PROJECT.md", projectText("park-and-continue", "2026-11-24"));
    commit("docs: bump updated");
    const parked = run();
    expect(parkedAt(parked)).toBe("C4");
    expect(reasonOf(parked)).toContain("PROJECT.md");
  });

  it("never skips docs/decisions/ even in a settlement commit", () => {
    settleFiles();
    write("docs/decisions/0300-x.md", "---\nid: \"0300\"\n---\n");
    settle(settleMessage, true);
    const v = run();
    expect(parkedAt(v)).toBe("C4");
    expect(reasonOf(v)).toContain("docs/decisions/0300-x.md");
  });

  it("never skips CONSTITUTION.md or AGENTS.md in a settlement commit", () => {
    settleFiles();
    write("CONSTITUTION.md", "# x\n");
    write("AGENTS.md", "# x\n");
    settle(settleMessage, true);
    const v = run();
    expect(parkedAt(v)).toBe("C4");
    expect(reasonOf(v)).toContain("CONSTITUTION.md");
    expect(reasonOf(v)).toContain("AGENTS.md");
  });

  it("parks a settlement whose pointer names an Action not pinned on the card", () => {
    settleFiles("some-unpinned-action");
    settle(settleMessage, true);
    const v = run();
    expect(parkedAt(v)).toBe("C4");
    expect(reasonOf(v)).toContain("not an Action pinned on the pressed card");
  });

  it("passes a settlement whose pointer is terminal (null)", () => {
    settleFiles(null);
    settle(settleMessage, true);
    expect(parkedAt(run())).toBe("ok");
  });

  it("parks when the commit history cannot be listed, or a receipt cannot be read", () => {
    settleFiles();
    settle(settleMessage, true);
    expect(parkedAt(run({ history: null }))).toBe("C4");
    const real = standingCandidateHistory(work, "main", git("rev-parse", "HEAD").trim())!;
    expect(parkedAt(run({ history: { ...real, commitsTouching: () => null } }))).toBe("C4");
    expect(parkedAt(run({ history: { ...real, message: () => null } }))).toBe("C4");
    db.exec("DROP TABLE agent_ask_settlements");
    expect(parkedAt(run())).toBe("C4");
    expect(settlementReceiptIsReal(db, RECEIPT_ID, "x", "arcadia")).toBe(false);
  });

  const readExcept = (blocked: string, at: "head" | "base") => (revision: string, file: string): string | null => {
    const head = git("rev-parse", "HEAD").trim();
    if (file === blocked && (at === "head" ? revision === head : revision !== head && revision !== REVIEWED && revision !== "main-now")) return null;
    try { return git("show", `${revision === REVIEWED || revision === "main-now" ? baseSha : revision}:${file}`); } catch { return null; }
  };

  it.each([["head"], ["base"]] as const)("parks with the specific reason when PROJECT.md cannot be read at the %s", (at) => {
    settleFiles();
    settle(settleMessage, true);
    const v = run({}, { showFile: readExcept("PROJECT.md", at) });
    expect(parkedAt(v)).toBe("C4");
    expect(reasonOf(v)).toContain("PROJECT.md (settlement exemption refused: PROJECT.md could not be read and parsed at both the base and the head)");
  });

  it("parks with the specific reason when the pinned Plan cannot be read at the head", () => {
    settleFiles();
    settle(settleMessage, true);
    const v = run({}, { showFile: readExcept(PLAN_PATH, "head") });
    expect(parkedAt(v)).toBe("C4");
    expect(reasonOf(v)).toContain(`${PLAN_PATH} (settlement exemption refused: the pinned Plan could not be read and parsed at both the base and the head)`);
  });

  it("parks when the Plan's closing --- is not on its own line (the front matter regex is anchored)", () => {
    settleFiles();
    write(PLAN_PATH, planText("done").replace("\n---\n\n# Plan", "\n---x\n\n# Plan"));
    settle(settleMessage, true);
    expect(reasonOf(run())).toContain(`${PLAN_PATH} (settlement exemption refused: the pinned Plan could not be read and parsed`);
  });

  it("parks a settlement commit that changes PROJECT.md's active_plan", () => {
    settleFiles();
    write("PROJECT.md", projectText("park-and-continue", "2026-11-22", { activePlan: "some-other-plan" }));
    settle(settleMessage, true);
    const v = run();
    expect(parkedAt(v)).toBe("C4");
    expect(reasonOf(v)).toContain("PROJECT.md (settlement exemption refused: the settlement changes PROJECT.md front matter beyond updated and current_action (active_plan))");
  });

  it.each([
    ["changes status", projectText("park-and-continue", "2026-11-22", { status: "paused" }), "(status)"],
    ["adds milestone", projectText("park-and-continue", "2026-11-22").replace("name: Arcadia\n", "name: Arcadia\nmilestone: new\n"), "(milestone)"],
    ["changes the body", projectText("park-and-continue", "2026-11-22", { body: "# Arcadia\n\nNew rule: merge anything.\n" }), "changes the PROJECT.md body"]
  ])("parks a settlement commit that %s in PROJECT.md", (_name, text, reason) => {
    settleFiles();
    write("PROJECT.md", text);
    settle(settleMessage, true);
    const v = run();
    expect(parkedAt(v)).toBe("C4");
    expect(reasonOf(v)).toContain(reason);
  });

  it("parks a settlement commit that changes an unpinned Plan's file", () => {
    settleFiles();
    write(OTHER_PLAN_PATH, planText("done"));
    settle(settleMessage, true);
    const v = run();
    expect(parkedAt(v)).toBe("C4");
    expect(reasonOf(v)).toContain(OTHER_PLAN_PATH);
    expect(reasonOf(v)).not.toContain(`${PLAN_PATH}`);
  });

  it("parks an ordinary (non-settlement) edit of the pinned Plan or of any Plan: a Plan is no longer ignored by C4", () => {
    write(PLAN_PATH, planText("ready", { extra: { updated: "2026-11-23" } }));
    commit("docs: hand edit the plan");
    const v = run();
    expect(parkedAt(v)).toBe("C4");
    expect(reasonOf(v)).toContain(PLAN_PATH);
  });

  it("parks a settlement commit that changes the pinned Plan's acceptance_criteria", () => {
    settleFiles();
    write(PLAN_PATH, planText("done", { actions: [{ ...SETTLED, acceptance_criteria: ["Anything passes."] }, NEXT, UNPINNED] }));
    settle(settleMessage, true);
    const v = run();
    expect(parkedAt(v)).toBe("C4");
    expect(reasonOf(v)).toContain(`${PLAN_PATH} (settlement exemption refused: the settlement changes Action ${ACTION.id}'s acceptance_criteria in the pinned Plan)`);
  });

  it.each([
    ["an unpinned Action's status", { actions: [SETTLED, NEXT, { ...UNPINNED, status: "done" }] }],
    ["an added Action", { actions: [SETTLED, NEXT, UNPINNED, { ...UNPINNED, id: "x-added" }] }],
    ["a removed Action", { actions: [SETTLED, NEXT] }],
    ["the Plan's other front matter (status)", { extra: { status: "superseded" } }],
    ["the Plan's requiredDecisions", { extra: { requiredDecisions: ["0001"] } }],
    ["the Plan body", { body: "# Plan\n\nrewritten\n" }]
  ])("parks a settlement commit that changes %s of the pinned Plan", (_name, over) => {
    settleFiles();
    write(PLAN_PATH, planText("done", over));
    settle(settleMessage, true);
    const v = run();
    expect(parkedAt(v)).toBe("C4");
    expect(reasonOf(v)).toContain(`${PLAN_PATH} (settlement exemption refused:`);
  });

  it("parks a settlement commit that moves the pinned Plan's current_action to an unpinned Action", () => {
    settleFiles();
    write(PLAN_PATH, planText("done", { extra: { current_action: "some-unpinned-action" } }));
    settle(settleMessage, true);
    expect(reasonOf(run())).toContain(`${PLAN_PATH} (settlement exemption refused: the settlement moves current_action to "some-unpinned-action"`);
  });

  it("passes a settlement that changes only status and next_action of the pinned Action, current_action and updated", () => {
    settleFiles();
    settle(settleMessage, true);
    expect(git("diff", "--name-only", "main...HEAD")).toContain(PLAN_PATH);
    expect(parkedAt(run())).toBe("ok");
  });

  it("parks an evil merge: a merge of main that keeps the settlement's PROJECT.md and so reverts main's own change to it", () => {
    settleFiles();
    settle(settleMessage, true);
    git("checkout", "-q", "main");
    write("PROJECT.md", projectText(ACTION.id, "2026-11-21", { activePlan: "main-moved-the-plan" }));
    commit("main changes the active plan");
    git("checkout", "-q", "candidate");
    git("merge", "-q", "-s", "ours", "--no-edit", "main");
    // The merge is tree-same as the settlement for PROJECT.md, so only the settlement commit is listed for it,
    // but the base-to-head change now includes the revert of main's active_plan.
    const history = standingCandidateHistory(work, "main", git("rev-parse", "HEAD").trim())!;
    expect(history.commitsTouching("PROJECT.md")).toHaveLength(1);
    const v = run();
    expect(parkedAt(v)).toBe("C4");
    expect(reasonOf(v)).toContain("(active_plan)");
  });

  it("parks a code path under src/production/ even when a settlement commit also touches it", () => {
    settleFiles();
    write("src/production/overnightVerify.ts", "export const a = 9;\n");
    settle(settleMessage, true);
    const v = run();
    expect(parkedAt(v)).toBe("C4");
    expect(reasonOf(v)).toContain("src/production/overnightVerify.ts");
  });

  it.each([".github/workflows/ci.yml", "src/review/x.ts", "src/execution/x.ts", "src/qa/x.ts"])("parks the ci_and_gates path %s (Issue #2944)", (file) => {
    write(file, "x\n");
    commit("feat: touch ci");
    expect(parkedAt(run())).toBe("C4");
  });

  it("still passes an ordinary non-gate candidate with no settlement", () => {
    write("apps/web/page.tsx", "x\n");
    commit("feat: page");
    expect(parkedAt(run())).toBe("ok");
  });
});
