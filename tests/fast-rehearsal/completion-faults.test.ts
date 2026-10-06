import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
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
    // Never held by its pending completion (the gate's skip reason names it).
    expect(rehearsal.recorder.tickLog.some((tick) => tick.summary.includes(`(Record ${ACTION_1} complete.)`))).toBe(false);
    expect(rehearsal.log.some((line) => line.includes("operator_gate_pending"))).toBe(false);
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
 * shows it as exactly one `operator_gate_pending` entry naming the proposal,
 * why it cannot settle again ("Action is already done") and that the
 * candidate already holds its canonical settlement commit, with the operator
 * merge of exactly that commit and the worktree retirement that lets the next
 * Action launch; logged once however many ticks it holds, and gone once the
 * gate is (Issue #997; clearing on rejection is pinned in
 * tests/rehearsal-run-3-amended-action.test.ts).
 */
describe("the agent dies after its settlement commit and an operator reconciles the Session before the worker does", () => {
  it("shows one deduplicated operator_gate_pending entry naming the committed settlement, and its remedy's route admits the next Action once", () => {
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
    // The remedy names the candidate's committed settlement (derived again, as the exit tick would have) and advises against rejecting.
    expect(entry.remedy).toContain(`It cannot settle again (Action is already done.): ${result.brief.worktree} at ${result.settlementCommit} is already its own canonical completion settlement`);
    expect(entry.remedy).toContain("Do not reject it alone");
    expect(entry.remedy).toContain(`git -C ${rehearsal.repo} merge --ff-only ${result.settlementCommit}`);
    expect(entry.remedy).toContain(`git -C ${rehearsal.repo} worktree remove ${result.brief.worktree}`);
    expect(text).toContain(`${rehearsal.actionKey(ACTION_1)} [operator_gate_pending]`);
    expect(rehearsal.log.filter((line) => line.includes("(operator_gate_pending)"))).toHaveLength(1);
    expect(rehearsal.redAlerts()).toEqual([]);
    // Computing that remedy wrote nothing durable: no settlement row, the candidate unchanged and clean.
    expect(runAgentAskPendingCommand({ workspace: rehearsal.workspace }).data.pending.map((item) => item.requestId)).toEqual([result.requestId]);
    expect(git(result.brief.worktree, ["rev-parse", "HEAD"]).trim()).toBe(result.settlementCommit);
    expect(git(result.brief.worktree, ["status", "--porcelain", "--untracked-files=all"])).toBe("");
    expect(git(rehearsal.repo, ["worktree", "list", "--porcelain"])).not.toContain("arcadia-settlement-replay-");

    // The remedy's route, end to end: land exactly the settlement commit, retire the candidate's
    // worktree (its head is now on the base), and the next Action launches once; then reject the moot proposal.
    git(rehearsal.repo, ["merge", "--ff-only", "--quiet", result.settlementCommit!]);
    git(rehearsal.repo, ["worktree", "remove", result.brief.worktree]);
    rehearsal.untilLaunched(ACTION_2, 3);
    expect(rehearsal.escalations()).toEqual([]);
    expect(rehearsal.sessions().filter((s) => s.action_id === ACTION_2)).toHaveLength(1);
    expect(rehearsal.planAction(rehearsal.repo, ACTION_1)).toBe("done");
    git(rehearsal.repo, ["merge-base", "--is-ancestor", result.workCommit, "refs/heads/main"]);
    const preview = runAgentAskSettleCommand({ workspace: rehearsal.workspace, proposal, requestId: `reject-${result.requestId}`, disposition: "rejected", cwd: rehearsal.repo });
    runAgentAskSettleCommand({ workspace: rehearsal.workspace, proposal, requestId: `reject-${result.requestId}`, disposition: "rejected", cwd: rehearsal.repo,
      preview: preview.data.receipt.previewFingerprint, apply: true });
    expect(runAgentAskPendingCommand({ workspace: rehearsal.workspace }).data.pending).toEqual([]);
    expect(isolation.guardCalls()).toEqual([]);
    expect(rehearsal.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);
});

/**
 * The same window, but the commit on top of the Candidate revision is not the
 * settlement Arcadia would write: it also changes a Decision, or the Plan
 * beyond the completion. Nothing about that commit is trusted: the exit tick
 * derives the settlement again at the Candidate revision, finds the files
 * differ, and records nothing, so a hand-made "settlement" never becomes a
 * deterministic-proof receipt. The proposal stays pending and shows as the
 * operator gate, with the plain reason it cannot settle.
 */
describe.each([
  { forgery: "also answers a Decision", edit: (worktree: string) => {
    mkdirSync(path.join(worktree, "docs", "decisions"), { recursive: true });
    writeFileSync(path.join(worktree, "docs", "decisions", "0999-forged.md"), "---\narcadia: v1\ntype: decision\nid: \"0999\"\nstatus: approved\n---\n");
  } },
  { forgery: "also edits the Plan beyond the completion", edit: (worktree: string) => {
    const plan = git(worktree, ["ls-files", "docs/plans"]).trim().split("\n")[0];
    writeFileSync(path.join(worktree, plan), `${readFileSync(path.join(worktree, plan), "utf8")}\nA line no settlement writes.\n`);
  } }
])("a commit on the Candidate revision that $forgery is not recorded as the settlement", ({ forgery, edit }) => {
  it("records nothing on the exit tick and shows the pending proposal as the operator gate", () => {
    const rehearsal = world(`fault-forged-settlement-${forgery.split(" ").slice(-2).join("-").toLowerCase()}`);
    rehearsal.expectError(/reconciliation outcome was incomplete_resumable/);
    const { launch } = rehearsal.untilLaunched(ACTION_1, 3);
    const result = rehearsal.execute(launch, ACTION_1, "interrupted-after-settlement-commit");
    const worktree = result.brief.worktree;
    edit(worktree);
    git(worktree, ["add", "-A"]);
    git(worktree, ["-c", "user.name=Forger", "-c", "user.email=forger@rehearsal.test", "commit", "-q", "--amend", "--no-edit"]);
    const forged = git(worktree, ["rev-parse", "HEAD"]).trim();
    expect(git(worktree, ["rev-parse", "HEAD^"]).trim()).toBe(result.workCommit);

    const exit = rehearsal.tick();
    expect(exit.reconciled.map((entry) => entry.outcome)).toEqual(["incomplete_resumable"]);
    expect(rehearsal.log.filter((line) => line.includes(`Did not record pending completion Agent Ask ${result.requestId}`)
      && line.includes("is not this Ask's own canonical completion settlement"))).toHaveLength(1);
    expect(rehearsal.log.some((line) => line.includes("Recorded the interrupted completion settlement"))).toBe(false);
    expect(runAgentAskPendingCommand({ workspace: rehearsal.workspace }).data.pending.map((item) => item.requestId)).toEqual([result.requestId]);

    rehearsal.ticks(2);
    expect(rehearsal.sessions().map((s) => [s.action_id, s.status])).toEqual([[ACTION_1, "needs_input"]]);
    const [entry, ...others] = rehearsal.escalations();
    expect(others).toEqual([]);
    expect(entry.kind).toBe("operator_gate_pending");
    expect(entry.remedy).toContain("It cannot settle: Action is already done.");
    expect(entry.remedy).toContain("That candidate already records the Action done, but its head is not this Ask's canonical settlement");
    expect(entry.remedy).not.toContain("is already its own canonical completion settlement");
    expect(git(worktree, ["rev-parse", "HEAD"]).trim()).toBe(forged);
    expect(git(rehearsal.repo, ["worktree", "list", "--porcelain"])).not.toContain("arcadia-settlement-replay-");
    expect(rehearsal.planAction(rehearsal.repo, ACTION_1)).toBe("open");
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
