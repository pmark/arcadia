import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgentAskPendingCommand, runAgentAskSettleCommand } from "../../src/commands/agentAsk.js";
import { runSessionReconcileCommand } from "../../src/commands/advance.js";
import { git } from "../helpers/rehearsalHarness.js";
import { expectAdvancedExactlyOnce } from "./helpers/assertions.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import type { ExecutorResult } from "./helpers/executor.js";
import { ACTION_1, ACTION_2, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * Failure injection at the completion boundary: interruptions and step errors
 * (Git command failures are in git-faults.test.ts; split so the files run in
 * parallel). Each scenario breaks Action 1's finish at one point and then
 * lets the real lifecycle recover on its own. Faults are in-process (a thrown
 * error, a failing Git shim), not process kills: cleanup a killed process
 * would skip still runs. "Advances exactly once" means: Action 1 is
 * integrated once, with the agent's work commit on the base (no lost
 * commit), and Action 2 is admitted exactly once (no double admission).
 */
let isolation: IsolatedProcess;
const worlds: FastRehearsal[] = [];
beforeAll(() => { isolation = isolateProcess(); });
afterAll(() => {
  for (const world of worlds.splice(0)) world.dispose();
  isolation?.restore();
});

function world(name: string): FastRehearsal {
  const created = new FastRehearsal(name, isolation, import.meta.filename);
  worlds.push(created);
  created.start();
  return created;
}


describe("the agent is interrupted after its work commit, before recording completion", () => {
  it("is reconciled incomplete, resumed in the same worktree by one continuation Session that settles, and advances exactly once", () => {
    const rehearsal = world("fault-interrupted-after-work-commit");
    rehearsal.expectError(/reconciliation outcome was incomplete_resumable/);
    const first = rehearsal.untilLaunched(ACTION_1, 3);
    const interrupted = rehearsal.execute(first.launch, ACTION_1, "interrupted-after-work-commit");
    expect(interrupted.interrupted).toContain("died after its work commit");
    expect(interrupted.settlementCommit).toBeNull();

    const again = rehearsal.untilLaunched(ACTION_1, 3);
    expect(again.session.worktree_path).toBe(first.session.worktree_path);
    expect(again.session.branch).toBe(first.session.branch);
    const resumed = rehearsal.execute(again.launch, ACTION_1);
    expect(resumed.brief.continuation).toBe(true);
    // The continuation found the interrupted work commit already on its branch.
    expect(resumed.workCommit).toBe(interrupted.workCommit);
    rehearsal.untilIntegrated(ACTION_1);
    expect(rehearsal.sessions().filter((s) => s.action_id === ACTION_1)).toHaveLength(2);
    expectAdvancedExactlyOnce(rehearsal, interrupted, isolation);
    expect(rehearsal.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);
});

/**
 * The narrowest completion window: `agent-ask settle --apply` has committed
 * the settlement in the candidate (Plan done, pointer moved, Ask archived),
 * and the process dies before the settlement is recorded in the workspace
 * (src/ask/settlement.ts's `beforeOperationalProjection` window), so the
 * previewed `complete` proposal stays PENDING. Before the fix that pending
 * proposal was an operator gate (resolveProjectTransition answers
 * `decision`): every later tick skipped the launch and production status
 * showed nothing (Issues #995 and #997; the mechanism of run 2's stall,
 * #968). Now the exit tick recognises the candidate's own canonical
 * settlement commit and records that settlement
 * (`recordCommittedCompletionSettlement`: no coding agent, no model call),
 * so reconciliation accepts the completion and the ordinary review and
 * integration path follows.
 */
describe("the agent dies after its settlement commit, before the settlement is recorded", () => {
  let rehearsal: FastRehearsal;
  let result: ExecutorResult;
  let exit: ReturnType<FastRehearsal["tick"]>;
  let atExit: { pending: string[]; sessions: string[][]; head: string; recorded: string[]; launches: number };
  beforeAll(() => {
    rehearsal = world("fault-interrupted-after-settlement-commit");
    const { launch } = rehearsal.untilLaunched(ACTION_1, 3);
    result = rehearsal.execute(launch, ACTION_1, "interrupted-after-settlement-commit");
    exit = rehearsal.tick();
    atExit = {
      pending: runAgentAskPendingCommand({ workspace: rehearsal.workspace }).data.pending.map((item) => item.requestId),
      sessions: rehearsal.sessions().map((s) => [s.action_id, s.status]),
      head: git(result.brief.worktree, ["rev-parse", "HEAD"]).trim(),
      recorded: rehearsal.log.filter((line) => line.includes("Recorded the interrupted completion settlement")),
      launches: rehearsal.tmux.launches.length
    };
    rehearsal.untilIntegrated(ACTION_1);
  }, SCENARIO_TIMEOUT_MS);

  it("records the candidate's committed settlement on the exit tick: accepted completion, no continuation, no pending proposal", () => {
    expect(result.interrupted).toContain("died after the settlement commit");
    expect(result.statusAtExit).toBe("");
    expect(git(result.brief.worktree, ["show", "--name-only", "--format=", result.settlementCommit!])).toContain(`.arcadia/asks/archive/agent-ask-${result.requestId}.yaml`);
    expect(exit.handoff?.preservation.kind).toBe("preserved");
    expect(exit.reconciled.map((entry) => entry.outcome)).toEqual(["accepted_completion"]);
    // Recorded against the agent's own settlement commit; nothing was rewritten or committed on top.
    expect(atExit.head).toBe(result.settlementCommit);
    expect(atExit.recorded).toHaveLength(1);
    expect(atExit.recorded[0]).toContain(`Agent Ask ${result.requestId}`);
    expect(atExit.recorded[0]).toContain(result.settlementCommit!);
    expect(atExit.pending).toEqual([]);
    expect(atExit.sessions).toEqual([[ACTION_1, "completed"]]);
    expect(atExit.launches).toBe(1);
    expect(rehearsal.log.some((line) => line.includes("launch skipped") || line.includes("operator_gate_pending"))).toBe(false);
  });

  // Was an EXPECTED FAILURE (Issues #995, #997) until the exit tick recorded
  // the interrupted settlement.
  it("recovers and advances exactly once", () => {
    expectAdvancedExactlyOnce(rehearsal, result, isolation);
    expect(rehearsal.planAction(rehearsal.repo, ACTION_1)).toBe("done");
    expect(rehearsal.recorder.tickLog.filter((tick) => tick.summary.includes("integration integrated"))).toHaveLength(1);
    expect(rehearsal.sessions().filter((s) => s.action_id === ACTION_2)).toHaveLength(1);
    expect(rehearsal.finish().errors.filter((error) => !error.expected)).toEqual([]);
  });
});

/**
 * The same window, but an operator reconciles the dead Session by hand
 * (`arcadia session reconcile`, as `arcadia advance`'s `reconcile`
 * transition tells them to) before the worker's next tick. The worker then
 * never sees the exit, so it neither preserves the candidate nor records the
 * settlement, and the agent's `complete` proposal stays pending: an operator
 * gate (resolveProjectTransition answers `decision`). Production status
 * shows it as exactly one `operator_gate_pending` entry naming the proposal
 * and why it cannot settle ("Action is already done": the candidate's Plan
 * already says done), logged once however many ticks it holds, and cleared
 * by the first tick after the proposal is rejected (Issue #997).
 */
describe("the agent dies after its settlement commit and an operator reconciles the Session before the worker does", () => {
  it("shows one deduplicated operator_gate_pending entry with the reason it cannot settle, cleared once the proposal is rejected", () => {
    const rehearsal = world("fault-interrupted-after-settlement-commit-operator-reconciled");
    const first = rehearsal.untilLaunched(ACTION_1, 3);
    const result = rehearsal.execute(first.launch, ACTION_1, "interrupted-after-settlement-commit");
    expect(runSessionReconcileCommand({ workspace: rehearsal.workspace, repo: rehearsal.repo, session: first.session.id, requestId: `operator-reconcile-${first.session.id}` })
      .data.receipt.outcome).toBe("incomplete_resumable");
    const gated = rehearsal.ticks(3);
    rehearsal.advanceClock(4 * 3_600_000);
    gated.push(...rehearsal.ticks(2));
    for (const tick of gated) expect(tick.launch).toMatchObject({ outcome: "skipped", reason: expect.stringContaining(`Record ${ACTION_1} complete.`) });
    const pending = runAgentAskPendingCommand({ workspace: rehearsal.workspace }).data.pending;
    expect(pending.map((item) => item.requestId)).toEqual([result.requestId]);
    const proposal = pending[0].proposalId;
    const { data, text } = rehearsal.productionStatus();
    expect(data.operatorEscalations.map((entry) => [entry.actionKey, entry.kind])).toEqual([[rehearsal.actionKey(ACTION_1), "operator_gate_pending"]]);
    const [entry] = data.operatorEscalations;
    expect(entry.message).toBe(`Launch of ${rehearsal.actionKey(ACTION_1)} is held by pending Agent Ask proposal ${proposal}: Record ${ACTION_1} complete.`);
    expect(entry.remedy).toContain(`It cannot settle: Action is already done. (previewed in ${result.brief.worktree})`);
    const reject = `arcadia agent-ask settle --proposal ${proposal} --request-id reject-${result.requestId} --disposition rejected`;
    expect(entry.remedy).toContain(reject);
    expect(text).toContain(`${rehearsal.actionKey(ACTION_1)} [operator_gate_pending]`);
    expect(rehearsal.log.filter((line) => line.includes("(operator_gate_pending)"))).toHaveLength(1);
    expect(rehearsal.redAlerts()).toEqual([]);

    // The remedy's own command, preview then apply, from the Project's checkout.
    const preview = runAgentAskSettleCommand({ workspace: rehearsal.workspace, proposal, requestId: `reject-${result.requestId}`, disposition: "rejected", cwd: rehearsal.repo });
    runAgentAskSettleCommand({ workspace: rehearsal.workspace, proposal, requestId: `reject-${result.requestId}`, disposition: "rejected", cwd: rehearsal.repo,
      preview: preview.data.receipt.previewFingerprint, apply: true });
    const after = rehearsal.tick();
    expect(after.launch).toMatchObject({ outcome: "launched", actionKey: rehearsal.actionKey(ACTION_1) });
    expect(rehearsal.escalations()).toEqual([]);
    expect(isolation.guardCalls()).toEqual([]);
    expect(rehearsal.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);
});

/**
 * Not a process kill: the step error thrown inside readiness is caught by the
 * tick's own reconcile catch (src/production/tick.ts), which logs
 * "Reconciliation failed". That catch raises a `reconcile_failed` red alert
 * only for a live lease (observeReconcileFailure in
 * src/production/redAlerts.ts returns early without one), and a terminal
 * Session's handoff runs with no lease, so here no red alert is raised: the
 * failure shows only in the worker log. The fresh module graph then shows
 * that no in-process state carries the handoff: the next tick resumes from
 * the database and GitHub alone (it would with or without the restart).
 */
describe("a step error between preservation and readiness, then a fresh module graph", () => {
  it("logs the step error (no red alert for a terminal Session's handoff), readies the PR once and advances exactly once", async () => {
    const rehearsal = world("fault-readiness-step-error-then-fresh-modules");
    rehearsal.expectError(/step error before gh pr ready took effect/);
    const { launch } = rehearsal.untilLaunched(ACTION_1, 3);
    const work = rehearsal.execute(launch, ACTION_1);
    const exit = rehearsal.tick();
    expect(exit.handoff?.preservation.kind).toBe("preserved");
    const pr = rehearsal.pullRequestFor(ACTION_1)!;
    expect(pr.isDraft).toBe(true);

    rehearsal.github.beforeReady = () => { throw new Error("step error before gh pr ready took effect"); };
    rehearsal.tick();
    expect(pr.isDraft).toBe(true);
    expect(rehearsal.github.readyCalls).toEqual([]);
    expect(rehearsal.log.some((line) => line.includes("Reconciliation failed for") && line.includes("step error before gh pr ready took effect"))).toBe(true);
    expect(rehearsal.redAlerts()).toEqual([]);
    await rehearsal.restartWorker();

    rehearsal.untilIntegrated(ACTION_1);
    expect(rehearsal.redAlerts()).toEqual([]);
    expect(pr.isDraft).toBe(false);
    expect(rehearsal.github.readyCalls).toEqual([pr.url]);
    expect(rehearsal.github.reviewerCalls.map((call) => [call.role, call.head])).toEqual([["code-review", work.finalHead], ["qa", work.finalHead]]);
    expectAdvancedExactlyOnce(rehearsal, work, isolation);
    expect(rehearsal.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);
});
