import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentAskPreviewCommand, runAgentAskSettleCommand } from "../src/commands/agentAsk.js";
import { runDocsSyncCommand } from "../src/commands/docs.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { discoverDocs } from "../src/docs/discover.js";
import type { PlanActionDoc } from "../src/docs/types.js";
import { developmentLineageRemedy } from "../src/production/tick.js";
import { latestRoleAttempt, recordSessionRoleAttemptTerminal } from "../src/sessions/enrollment.js";
import { resolveProjectTransition, type AgentSession } from "../src/sessions/index.js";
import { beginDevelopmentAttempt, planDevelopmentAttempt, requirementIdentity } from "../src/sessions/roleLineage.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { git, LINE_A, Rehearsal } from "./helpers/rehearsalHarness.js";

/**
 * Rehearsal run 4 reuses the fixture a fourth time. Runs 1, 2 and 3 each left
 * a passed development attempt for write-start-marker (for three different
 * input revisions) and an unmerged, preserved candidate. The run-4 reset
 * (reset-three-action-rehearsal-fixture-run4-2026-10-05) gives the Action a
 * fourth next_action and, as run 3's reset did for run 2's, rejects run 3's
 * complete proposal before its commit if it is still pending (Issue #968: a
 * pending proposal naming the Action makes the dispatch gate answer
 * "decision"). These cases prove, with Arcadia's real discovery, lineage, the
 * real transition resolver (resolveProjectTransition) and the real worker
 * tick, that the amendment gets a fresh lineage the launch gate admits with
 * all three earlier lineages present, that a pending proposal naming the
 * Action blocks dispatch, and that once it is rejected the tick dispatches the
 * run-4 input.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
const library = path.join(repoRoot, "artifacts", "generated", "operator-scripts");
const RESET = "reset-three-action-rehearsal-fixture-run4-2026-10-05";
const RUN3_RESET = "reset-three-action-rehearsal-fixture-run3-2026-10-05";
const RUN2_RESET = "reset-three-action-rehearsal-fixture-2026-10-05";
const G1 = "prepare-three-action-rehearsal-fixture-2026-10-04";
const source = (id: string) => readFileSync(path.join(library, `${id}.sh`), "utf8");
const shellConstant = (script: string, name: string) => {
  const match = script.match(new RegExp(`^${name}=(?:'([^']*)'|"([^"$]*)")$`, "m"));
  expect(match, `${name} is a literal constant`).not.toBeNull();
  return match![1] ?? match![2];
};
const ORIGINAL_LINE = shellConstant(source(RUN2_RESET), "OLD_NEXT_ACTION");
const RUN2_LINE = shellConstant(source(RUN2_RESET), "NEW_NEXT_ACTION");
const RUN3_LINE = shellConstant(source(RUN3_RESET), "NEW_NEXT_ACTION");
const RUN4_LINE = shellConstant(source(RESET), "NEW_NEXT_ACTION");
/** Each reset's amendment: the original sentence, its final period replaced by that run's note. */
const RUN2_NOTE = RUN2_LINE.slice(ORIGINAL_LINE.length - 1);
const RUN3_NOTE = RUN3_LINE.slice(ORIGINAL_LINE.length - 1);
const RUN4_NOTE = RUN4_LINE.slice(ORIGINAL_LINE.length - 1);

const directories: string[] = [];
const rehearsals: Rehearsal[] = [];
afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
  rehearsals.splice(0).forEach((rehearsal) => rehearsal.dispose());
});
const temp = (prefix: string) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  directories.push(directory);
  return directory;
};

/** G1's genesis fixture, rendered from G1's own heredocs. */
function renderG1Fixture(directory: string) {
  const script = source(G1);
  const constants = script.slice(0, script.indexOf('case "${1:-run}" in')).split("\n").filter((line) => /^[A-Z_]+=/.test(line) && !line.includes("$(")).join("\n");
  const end = "} # end render_fixture";
  const start = script.indexOf("render_fixture() {");
  const program = [constants, 'REPO="pmark/arcadia-three-action-rehearsal-t1"', "FIXTURE_DATE=2026-10-04", script.slice(start, script.indexOf(end) + end.length), `render_fixture ${JSON.stringify(directory)}`].join("\n");
  const run = spawnSync("bash", ["-c", program], { encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  return directory;
}
const PLAN_FILE = path.join("docs", "plans", "autonomous-three-action-rehearsal.md");
const planActions = (root: string) => {
  const plan = discoverDocs(root).docs.find((doc) => doc.type === "plan");
  if (plan?.type !== "plan") throw new Error("no Plan discovered");
  return plan.actions;
};
const identity = (action: PlanActionDoc) => requirementIdentity({ projectSlug: "three-action-rehearsal", planSlug: "autonomous-three-action-rehearsal", action });
/** The fixture Plan at genesis and after run 2's, run 3's and run 4's resets. */
function fourPlans() {
  const roots = ["genesis", "run2", "run3", "run4"].map((name) => renderG1Fixture(path.join(temp(`arcadia-run4-${name}-`), "fixture")));
  const plan = readFileSync(path.join(roots[0], PLAN_FILE), "utf8");
  const run2 = plan.replace(ORIGINAL_LINE, RUN2_LINE).replace(/^updated: 2026-10-04$/m, "updated: 2026-10-05");
  const run3 = run2.replace(RUN2_LINE, RUN3_LINE);
  writeFileSync(path.join(roots[1], PLAN_FILE), run2);
  writeFileSync(path.join(roots[2], PLAN_FILE), run3);
  writeFileSync(path.join(roots[3], PLAN_FILE), run3.replace(RUN3_LINE, RUN4_LINE));
  return roots.map(planActions);
}

describe("the run-4 reset's one-line amendment of write-start-marker", () => {
  it("is the original sentence plus a run-4 note, and gives that Action a fourth input revision and nothing else a new one", () => {
    expect(RUN4_LINE.startsWith(ORIGINAL_LINE.slice(0, -1))).toBe(true);
    expect(RUN4_NOTE).toMatch(/^ \(rehearsal run 4, .*\)\.$/);
    expect(new Set([RUN2_NOTE, RUN3_NOTE, RUN4_NOTE]).size).toBe(3);
    const [genesis, run2, run3, run4] = fourPlans();
    expect(run4.map((action) => action.id)).toEqual(genesis.map((action) => action.id));
    expect(run4.slice(1)).toEqual(genesis.slice(1));
    expect({ ...run4[0], nextAction: null }).toEqual({ ...run3[0], nextAction: null });
    expect({ ...run4[0], nextAction: null }).toEqual({ ...run2[0], nextAction: null });
    expect(run4[0].nextAction).toBe(`${String(genesis[0].nextAction).slice(0, -1)}${RUN4_NOTE}`);
    const [i0, i2, i3, i4] = [identity(genesis[0]), identity(run2[0]), identity(run3[0]), identity(run4[0])];
    // The three earlier revisions are exactly the ones the reset pins for the live fixture.
    expect(i0.inputRevision).toBe(shellConstant(source(RESET), "ORIGINAL_REVISION"));
    expect(i2.inputRevision).toBe(shellConstant(source(RESET), "RUN2_REVISION"));
    expect(i3.inputRevision).toBe(shellConstant(source(RESET), "RUN3_REVISION"));
    expect(new Set([i0.inputRevision, i2.inputRevision, i3.inputRevision, i4.inputRevision]).size).toBe(4);
    expect(new Set([i0.requirementId, i2.requirementId, i3.requirementId, i4.requirementId]).size).toBe(1);
    expect(new Set([i0.criteriaFingerprint, i2.criteriaFingerprint, i3.criteriaFingerprint, i4.criteriaFingerprint]).size).toBe(1);
    expect(run4.slice(1).map(identity)).toEqual(genesis.slice(1).map(identity));
  });
});

describe("the launch gate gives the run-4 input a fresh lineage with runs 1, 2 and 3's attempts present", () => {
  it("refuses relaunching any earlier input, and allocates development ordinal 1 for the run-4 input", () => {
    const [genesis, run2, run3, run4] = fourPlans().map((actions) => identity(actions[0]));
    const workspace = path.join(temp("arcadia-run4-gate-ws-"), "workspace");
    initWorkspace(workspace);
    withDatabase(workspace, (db) => {
      const pass = (requirement: typeof genesis, requestId: string, sessionId: string, at: string) => {
        const attempt = beginDevelopmentAttempt(db, { requirement, requestId, retryAuthorized: true, now: new Date(at) }).attempt;
        recordSessionRoleAttemptTerminal(db, { requestId: attempt.request_id, actorId: attempt.actor_id, status: "passed", targetHead: "a".repeat(40), receipt: { sessionId }, now: new Date(at) });
        return attempt;
      };
      const one = pass(genesis, "worker-tick-launch-run-1", "session_run_1", "2026-10-04T17:02:45.000Z");
      const two = pass(run2, "worker-tick-launch-run-2", "session_run_2", "2026-10-05T15:51:47.000Z");
      const three = pass(run3, "worker-tick-launch-run-3", "session_run_3", "2026-10-05T18:47:07.000Z");
      for (const earlier of [genesis, run2, run3]) {
        let refusal: { details?: Record<string, unknown> } | null = null;
        try { planDevelopmentAttempt(db, { requirement: earlier, retryAuthorized: true }); } catch (error) { refusal = error as { details?: Record<string, unknown> }; }
        expect(refusal?.details).toMatchObject({ code: "attempt_retry_not_authorized", status: "passed" });
        expect(developmentLineageRemedy("attempt_retry_not_authorized", refusal?.details)).toMatch(/governed amendment of the Action/);
      }
      expect(planDevelopmentAttempt(db, { requirement: run4, retryAuthorized: true })).toEqual({ kind: "allocate", supersedes: null });
      const fresh = beginDevelopmentAttempt(db, { requirement: run4, requestId: "worker-tick-launch-run-4", retryAuthorized: true, now: new Date("2026-10-05T21:00:00.000Z") });
      expect(fresh).toMatchObject({ resumed: false, attempt: { ordinal: 1, status: "pending", mutation_owner: 1, input_revision: run4.inputRevision } });
      expect(latestRoleAttempt(db, genesis.requirementId, genesis.inputRevision, "development")).toMatchObject({ ordinal: 1, status: "passed", request_id: one.request_id });
      expect(latestRoleAttempt(db, run2.requirementId, run2.inputRevision, "development")).toMatchObject({ ordinal: 1, status: "passed", request_id: two.request_id });
      expect(latestRoleAttempt(db, run3.requirementId, run3.inputRevision, "development")).toMatchObject({ ordinal: 1, status: "passed", request_id: three.request_id });
    });
  });
});

describe("the worker tick dispatches the run-4 input past runs 1, 2 and 3, once no pending proposal gates it", () => {
  const PLAN = path.join("docs", "plans", "two-action-rehearsal-bootstrap.md");
  const CRITERIA_A = [`MARKER.md exists and contains exactly the line "${LINE_A}" followed by a trailing newline, with no other content.`];
  const HARNESS_LINE = `    next_action: Implement MARKER.md containing exactly the line "${LINE_A}" plus a trailing newline.`;
  const lineFor = (note: string) => `${HARNESS_LINE.slice(0, -1)}${note}`;

  /** The reset's amendment on the harness fixture: one next_action line plus today's Plan date, then docs sync. */
  const amend = (rehearsal: Rehearsal, from: string, to: string, run: number) => {
    const file = path.join(rehearsal.repo, PLAN);
    const plan = readFileSync(file, "utf8");
    expect(plan.split("\n").filter((line) => line === from)).toHaveLength(1);
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(file, plan.replace(from, to).replace(/^updated: \d{4}-\d{2}-\d{2}$/m, `updated: ${today}`));
    git(rehearsal.repo, ["-c", "user.name=Arcadia Rehearsal Fixture", "-c", "user.email=rehearsal@localhost", "commit", "-qam", `Reset write-marker-a for rehearsal run ${run}`]);
    const sync = runDocsSyncCommand({ workspace: rehearsal.workspace, project: rehearsal.projectSlug, apply: true });
    const changes = (sync.data as unknown as { projects: Array<{ changes: Array<{ entity: string; ref: string; action: string }> }> }).projects[0].changes;
    expect(changes.find((c) => c.entity === "action" && c.ref.endsWith("#write-marker-a"))?.action).toBe("update");
  };
  /** One run of A: launched by the tick, finished and settled by the agent, reconciled, then terminal Off. */
  const runA = (rehearsal: Rehearsal, grant: string) => {
    rehearsal.activate(grant);
    rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionA, 3);
    const session = rehearsal.lease()!;
    rehearsal.agentEdit(session, "MARKER.md", `${LINE_A}\n`);
    rehearsal.agentFinish(session, CRITERIA_A);
    rehearsal.tmux.exit(session.tmux_session_name);
    expect(rehearsal.tick().reconciled[0]?.outcome).toBe("accepted_completion");
    rehearsal.deactivate(`${grant}-terminal-off`);
    const row = withReadOnlyDatabase(rehearsal.workspace, (db) => db.prepare("SELECT * FROM agent_sessions WHERE id = ?").get(session.id) as AgentSession);
    return { session: row, tip: git(rehearsal.repo, ["rev-parse", `refs/heads/${row.branch}`]).trim() };
  };
  const transition = (rehearsal: Rehearsal) => withDatabase(rehearsal.workspace, (db) => resolveProjectTransition({ repoRoot: rehearsal.repo, projectSlug: rehearsal.projectSlug, db, tmux: rehearsal.tmux }));

  it("answers 'decision' and launches nothing while run 3's pending complete proposal names the Action, then launches a fresh ordinal for the run-4 input once it is rejected", () => {
    const rehearsal = new Rehearsal({ independentReviewers: false });
    rehearsals.push(rehearsal);
    rehearsal.createFixtureRepository();
    rehearsal.approve(rehearsal.registerProject());
    const run1 = runA(rehearsal, "run-1-grant");
    amend(rehearsal, HARNESS_LINE, lineFor(RUN2_NOTE), 2);
    const run2 = runA(rehearsal, "run-2-grant");
    amend(rehearsal, lineFor(RUN2_NOTE), lineFor(RUN3_NOTE), 3);
    const run3 = runA(rehearsal, "run-3-grant");
    expect(new Set([run1.session.id, run2.session.id, run3.session.id]).size).toBe(3);
    const earlier = rehearsal.attempts("write-marker-a");
    expect(earlier.filter((x) => x.role === "development").map((x) => [x.ordinal, x.status])).toEqual([[1, "passed"], [1, "passed"], [1, "passed"]]);
    expect(new Set(earlier.filter((x) => x.role === "development").map((x) => x.input_revision)).size).toBe(3);

    // A complete Ask for run 3 left pending, as run 1's was when it stalled run 2 (Issue #968).
    const pendingRequestId = "complete-write-marker-a-run-3-pending";
    runAgentAskPreviewCommand({ workspace: rehearsal.workspace, request: JSON.stringify({
      agent_ask: "v1", request_id: pendingRequestId, project: rehearsal.projectSlug, intent: "complete", target_ref: "action/write-marker-a",
      candidate_revision: run3.tip, evidence: CRITERIA_A.map((criterion) => ({ criterion, status: "met" })), desired_result: "Mark write-marker-a complete."
    }) });

    // The run-4 amendment alone is not enough: the real transition resolver gates on the pending proposal.
    amend(rehearsal, lineFor(RUN3_NOTE), lineFor(RUN4_NOTE), 4);
    rehearsal.activate("run-4-grant");
    const gated = transition(rehearsal);
    expect(gated.kind).toBe("decision");
    expect(gated.nextAction).toContain("arcadia agent-ask settle --proposal");
    const blocked = [rehearsal.tick(), rehearsal.tick()];
    expect(blocked.some((r) => r.launch?.outcome === "launched")).toBe(false);
    expect(rehearsal.attempts("write-marker-a")).toEqual(earlier);

    // What the run-4 reset does before its commit: reject exactly that proposal, preview then apply.
    const preview = runAgentAskSettleCommand({ workspace: rehearsal.workspace, proposal: pendingRequestId, requestId: "run-4-reset-reject-run-3", disposition: "rejected" });
    expect(preview.data.receipt.review?.documents).toEqual([]);
    runAgentAskSettleCommand({ workspace: rehearsal.workspace, proposal: pendingRequestId, requestId: "run-4-reset-reject-run-3", disposition: "rejected", preview: preview.data.receipt.previewFingerprint, apply: true });
    expect(transition(rehearsal).kind).toBe("launch");

    const launched = rehearsal.tickUntil((r) => r.launch?.outcome === "launched", 3).at(-1)!;
    expect(launched.launch).toMatchObject({ outcome: "launched", actionKey: rehearsal.actionA });
    const lineage = rehearsal.attempts("write-marker-a");
    expect(lineage.slice(0, earlier.length)).toEqual(earlier);
    const fresh = lineage.slice(earlier.length);
    expect(fresh.map((x) => [x.role, x.ordinal, x.status, x.mutation_owner])).toEqual([["development", 1, "running", 1]]);
    expect(earlier.map((x) => x.input_revision)).not.toContain(fresh[0].input_revision);
    const run4 = rehearsal.lease()!;
    expect([run1.session.id, run2.session.id, run3.session.id]).not.toContain(run4.id);

    // Runs 1, 2 and 3's candidates: branch tips and clean worktrees untouched.
    for (const { session, tip } of [run1, run2, run3]) {
      expect(git(rehearsal.repo, ["rev-parse", `refs/heads/${session.branch}`]).trim()).toBe(tip);
      expect(existsSync(session.worktree_path)).toBe(true);
      expect(git(session.worktree_path, ["status", "--porcelain"]).trim()).toBe("");
    }
  });
});
