import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { git, HOST_REVIEWER_BINDING, LINE_A, LINE_B, LINE_C, Rehearsal } from "./helpers/rehearsalHarness.js";

/**
 * The opt-in three-Action variant of the hermetic rehearsal: the real worker
 * tick, real Git, real settlement and integration, with only tmux, the agent's
 * edits and provider capacity/sign-in simulated (see the harness). It proves
 * serial dependency selection across three Actions, that Off between two
 * Actions fences the next launch, and that after re-activation the following
 * ticks launch the next Action exactly once. Later ticks open fresh
 * database connections and registries but share this process, so they are
 * not a full worker-process restart.
 *
 * It runs three times: with the harness's simulated reviewers; with the real
 * host review path (`arcadia qa code-review` and `arcadia qa pr`, only GitHub
 * and the reviewer model stubbed) invoked by the harness between ticks; and
 * with no reviewer invoked by the harness at all, where the tick itself
 * readies each host-created draft PR, waits for its checks and runs both host
 * review commands. Every Action integrates through the tick with no operator
 * merge once both exact-head verdicts are recorded. GitHub-side merge and
 * the base-branch push stay out of scope: integration is the local
 * fast-forward, and `origin`'s base branch never moves.
 */
const rehearsals: Rehearsal[] = [];
afterEach(() => {
  for (const rehearsal of rehearsals.splice(0)) rehearsal.dispose();
});

const CRITERIA_A = [`MARKER.md exists and contains exactly the line "${LINE_A}" followed by a trailing newline, with no other content.`];
const CRITERIA_B = [
  "MARKER.md contains both lines, action A's line before action B's line.",
  'tests/marker.test.mjs exists and "node --test" passes, asserting both lines appear in order.'
];
const CRITERIA_C = ["MARKER.md contains the A, B and C lines in that order."];
const MARKER_TEST = `import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
test("marker lines are in order", () => {
  assert.ok(readFileSync("MARKER.md", "utf8").startsWith(${JSON.stringify(`${LINE_A}\n${LINE_B}\n`)}));
});
`;

describe("three-Action rehearsal: serial selection, between-Action Off, later ticks", () => {
  it.each([
    { reviewers: true as const, label: "simulated reviewers" },
    { reviewers: "host-commands" as const, label: "the real host review commands" },
    { reviewers: "tick" as const, label: "the tick readying each PR and running both host review commands" }
  ])("launches only the next dependency-ready Action, fences Off between B and C, and launches C exactly once after On across later ticks ($label)", ({ reviewers }) => {
    const rehearsal = new Rehearsal({ thirdAction: true, independentReviewers: reviewers });
    rehearsals.push(rehearsal);
    rehearsal.createFixtureRepository();
    rehearsal.approve(rehearsal.registerProject());
    rehearsal.activate();

    // A is the only dependency-ready Action; B and C wait on it.
    rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionA, 3);
    const a = rehearsal.lease()!;
    expect(a.action_id).toBe("write-marker-a");
    // The launch runs under exactly one mutation-owning development attempt; nothing else is live for A yet.
    expect(rehearsal.attempts("write-marker-a").map((x) => [x.role, x.ordinal, x.status, x.mutation_owner])).toEqual([["development", 1, "running", 1]]);
    expect(rehearsal.attempts("write-marker-b")).toEqual([]);
    rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
    rehearsal.agentFinish(a, CRITERIA_A);
    rehearsal.tmux.exit(a.tmux_session_name);

    // After A integrates, B -- never C -- is selected next.
    const reviewTicks = reviewers === "tick" ? 4 : 0;
    rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionB, 4 + reviewTicks);
    const b = rehearsal.lease()!;
    expect(b.action_id).toBe("write-marker-b");
    expect(rehearsal.sessions().map((s) => s.action_id)).toEqual(["write-marker-a", "write-marker-b"]);

    rehearsal.agentEdit(b, "MARKER.md", `${LINE_A}\n${LINE_B}\n`);
    rehearsal.agentEdit(b, "tests/marker.test.mjs", MARKER_TEST);
    rehearsal.agentFinish(b, CRITERIA_B);
    rehearsal.tmux.exit(b.tmux_session_name);
    // A thrown exception right after `gh pr ready` took effect on B's PR aborts
    // the tick before it records the step (simulated in-process; not a real
    // process death). The next tick, on fresh connections, resumes from the
    // persisted state and GitHub and must not ready it again.
    if (reviewers === "tick") rehearsal.github.afterReady = () => { throw new Error("simulated abort after gh pr ready"); };
    const { integrated } = rehearsal.tickThroughReview();
    expect(integrated.handoff?.integration.kind).toBe("integrated");
    expect(rehearsal.planAction(rehearsal.repo, "write-marker-b")).toBe("done");
    expect(rehearsal.pointer()).toBe("write-marker-c");
    // C needs its own packet; it has not launched in the integrating tick.
    expect(integrated.launch?.outcome).not.toBe("launched");
    const launchesBetween = rehearsal.tmux.launches.length;
    const attemptsBeforeOff = rehearsal.attempts("write-marker-c").length;

    // Off between B and C: nothing launches, however many ticks pass.
    rehearsal.deactivate("turn-off-between-b-and-c");
    const fenced = [rehearsal.tick(), rehearsal.tick(), rehearsal.tick()];
    expect(fenced.every((r) => r.launch === null || r.launch.outcome !== "launched")).toBe(true);
    expect(rehearsal.tmux.launches).toHaveLength(launchesBetween);
    expect(rehearsal.lease()).toBeNull();
    expect(rehearsal.status().liveAdmissions).toBe(0);
    // Off fences the between-Action launch at the attempt level too: no development attempt for C exists.
    expect(rehearsal.attempts("write-marker-c")).toHaveLength(attemptsBeforeOff);
    expect(rehearsal.attempts("write-marker-c").some((x) => x.role === "development")).toBe(false);

    // A fresh On grant: C (the only dependency-ready Action) launches once.
    rehearsal.activate("reactivate-for-c-20260926T233000Z");
    rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionC, 4);
    const c = rehearsal.lease()!;
    expect(c.action_id).toBe("write-marker-c");
    expect(readFileSync(path.join(c.worktree_path, "MARKER.md"), "utf8")).toBe(`${LINE_A}\n${LINE_B}\n`);

    // Later ticks (fresh connections and registries, same process) never duplicate C.
    const later = [rehearsal.tick(), rehearsal.tick()];
    expect(later.every((r) => r.launch?.outcome !== "launched")).toBe(true);
    expect(rehearsal.lease()?.id).toBe(c.id);
    expect(rehearsal.sessions().filter((s) => s.action_id === "write-marker-c")).toHaveLength(1);
    expect(rehearsal.attempts("write-marker-c").filter((x) => x.role === "development")).toHaveLength(1);

    rehearsal.agentEdit(c, "MARKER.md", `${LINE_A}\n${LINE_B}\n${LINE_C}\n`);
    rehearsal.agentFinish(c, CRITERIA_C);
    rehearsal.tmux.exit(c.tmux_session_name);
    // A thrown exception inside C's code-review model call leaves its lineage
    // attempt running (simulated in-process, like the one above); the next
    // tick resumes that same attempt instead of allocating a second one.
    if (reviewers === "tick") rehearsal.github.duringReview = () => { throw new Error("simulated abort mid-review"); };
    const { integrated: finished } = rehearsal.tickThroughReview();
    expect(finished.handoff?.integration.kind).toBe("integrated");
    expect(rehearsal.planAction(rehearsal.repo, "write-marker-c")).toBe("done");
    expect(readFileSync(path.join(rehearsal.repo, "MARKER.md"), "utf8")).toBe(`${LINE_A}\n${LINE_B}\n${LINE_C}\n`);
    const after = [rehearsal.tick(), rehearsal.tick()];
    expect(after.every((r) => r.launch?.outcome !== "launched")).toBe(true);
    expect(rehearsal.sessions().map((s) => s.action_id)).toEqual(["write-marker-a", "write-marker-b", "write-marker-c"]);
    expect(rehearsal.status().liveAdmissions).toBe(0);

    // Every Action carries its requirement lineage: one passed development
    // attempt (the only mutation owner), and independent exact-head code
    // review and QA verdicts bound to the head that was integrated. B and C's
    // packets were prepared by the tick, so their planner and critique are
    // recorded as read-only helper attempts. Every transport id is distinct.
    const requestIds = new Set<string>();
    let total = 0;
    for (const actionId of ["write-marker-a", "write-marker-b", "write-marker-c"]) {
      const lineage = rehearsal.attempts(actionId);
      total += lineage.length;
      for (const attempt of lineage) requestIds.add(attempt.request_id);
      const development = lineage.filter((x) => x.role === "development");
      expect(development.map((x) => [x.ordinal, x.status, x.mutation_owner])).toEqual([[1, "passed", 1]]);
      for (const role of ["code-review", "qa"]) {
        const verdicts = lineage.filter((x) => x.role === role);
        expect(verdicts.map((x) => [x.status, x.mutation_owner, x.target_head])).toEqual([["passed", 0, development[0].target_head]]);
        expect(verdicts[0].actor_id).not.toBe(development[0].actor_id);
      }
      expect(new Set(lineage.map((x) => x.input_revision)).size).toBe(1);
      expect(lineage.every((x) => x.requirement_id === `${rehearsal.projectSlug}/${rehearsal.planSlug}/${actionId}`)).toBe(true);
      if (actionId !== "write-marker-a") {
        expect(lineage.filter((x) => x.role === "planner" || x.role === "critique").map((x) => [x.role, x.mutation_owner]))
          .toEqual(expect.arrayContaining([["planner", 0], ["critique", 0]]));
      }
    }
    expect(requestIds.size).toBe(total);

    // Each candidate waited visibly on its verdicts, then the tick itself
    // fast-forwarded the base (no operator merge) and cleared the escalation.
    for (const actionKey of [rehearsal.actionA, rehearsal.actionB, rehearsal.actionC]) {
      expect(rehearsal.log.some((line) => line.includes(`Escalated ${actionKey} to the operator (awaiting_independent_verdicts)`))).toBe(true);
    }
    expect(rehearsal.status().operatorEscalations).toEqual([]);
    const developmentHeads = ["write-marker-a", "write-marker-b", "write-marker-c"]
      .map((actionId) => rehearsal.attempts(actionId).find((x) => x.role === "development")!.target_head!);
    for (const head of developmentHeads) git(rehearsal.repo, ["merge-base", "--is-ancestor", head, "refs/heads/main"]);
    expect(git(rehearsal.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(developmentHeads[2]);
    if (reviewers === "tick") {
      // Each Action's draft PR was readied exactly once, by the tick, at the
      // exact head both verdicts bind; each reviewer ran once per Action, and
      // only against that head. Nothing was merged or pushed to origin's base.
      const { github } = rehearsal;
      expect(github.prs.map((pr) => pr.isDraft)).toEqual([false, false, false]);
      expect(github.readyCalls).toEqual(github.prs.map((pr) => pr.url));
      // C's code-review model ran twice (the abort lost its judgment) but
      // recorded one verdict attempt; every other reviewer ran exactly once.
      const [prA, prB, prC] = github.prs;
      expect(github.reviewerCalls.map((call) => [call.role, call.url])).toEqual([
        ["code-review", prA.url], ["qa", prA.url], ["code-review", prB.url], ["qa", prB.url],
        ["code-review", prC.url], ["code-review", prC.url], ["qa", prC.url]
      ]);
      expect(github.reviewerCalls.map((call) => call.head)).toEqual([developmentHeads[0], developmentHeads[0], developmentHeads[1],
        developmentHeads[1], developmentHeads[2], developmentHeads[2], developmentHeads[2]]);
      expect(rehearsal.log.some((line) => line.includes("simulated abort after gh pr ready"))).toBe(true);
      expect(rehearsal.log.some((line) => line.includes("simulated abort mid-review"))).toBe(true);
      expect(github.ghCalls.some((call) => / merge\b/.test(call))).toBe(false);
      expect(github.headOf("main")).toBe(git(rehearsal.repo, ["rev-list", "--max-parents=0", "refs/heads/main"]).trim());
    }
    if (reviewers === "host-commands" || reviewers === "tick") {
      for (const actionId of ["write-marker-a", "write-marker-b", "write-marker-c"]) {
        expect(rehearsal.attempts(actionId).filter((x) => x.role === "code-review" || x.role === "qa").map((x) => [x.role, x.actor_id]))
          .toEqual([["code-review", `code-review-reviewer:${HOST_REVIEWER_BINDING}`], ["qa", `qa-reviewer:${HOST_REVIEWER_BINDING}`]]);
      }
    }
  });
});
