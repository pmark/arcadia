import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { discoverDocs } from "../src/docs/discover.js";
import { runQaPrReviewCommand } from "../src/qa/prReview.js";
import { independentVerdictGate } from "../src/sessions/roleLineage.js";
import { listPendingTerminalCandidates } from "../src/production/terminalCandidates.js";
import { git, hostReviewHost, HOST_REVIEW_PR_URL, hostReviewer, LINE_A, Rehearsal } from "./helpers/rehearsalHarness.js";

const worlds: Rehearsal[] = [];
afterEach(() => { for (const world of worlds.splice(0)) world.dispose(); });
const criteriaA = [`MARKER.md exists and contains exactly the line "${LINE_A}" followed by a trailing newline, with no other content.`];
const criteriaB = ["OTHER.md exists and contains exactly the line independent B followed by a trailing newline."];

function heldCandidate(kind = "review_repair_rounds_exhausted", remoteMerge = false) {
  const actionsYaml = [
    { id: "write-marker-a", file: "MARKER.md", criterion: criteriaA[0] },
    { id: "write-marker-b", file: "OTHER.md", criterion: criteriaB[0] }
  ].map(action => `  - id: ${action.id}
    title: Implement ${action.file}.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement ${action.file}.
    expected_artifact: ${action.file}
    clarification: clarified
    confidence: high
    acceptance_criteria:
      - ${JSON.stringify(action.criterion)}
    depends_on: []
    decisions: []
`).join("");
  const world = new Rehearsal({ independentReviewers: remoteMerge ? "tick" : false, workerMerge: remoteMerge, withOrigin: true,
    fixturePlan: { firstAction: "write-marker-a", actionsYaml, genesisFiles: {} } });
  worlds.push(world);
  world.createFixtureRepository();
  world.approve(world.registerProject()); world.activate();
  world.tickUntil(result => result.launch?.outcome === "launched", 3);
  const session = world.lease()!;
  world.agentEdit(session, "MARKER.md", `${LINE_A}\n`);
  world.agentFinish(session, criteriaA); world.tmux.exit(session.tmux_session_name);
  expect(world.tick().reconciled[0]?.outcome).toBe("accepted_completion");
  world.review("passed", ["code-review"]); world.review("failed", ["qa"]);
  // Fixture fault injection: preserve the real failed attempt; only its hold kind changes.
  withDatabase(world.workspace, db => db.prepare("UPDATE production_operator_escalations SET kind = ? WHERE action_key = ?")
    .run(kind, world.actionA));
  world.tick(); // The real scheduler skips held A and prepares independent B's packet.
  const project = discoverDocs(world.repo).docs.find(doc => doc.type === "project");
  expect(project?.type === "project" && project.currentAction).toBe("write-marker-b");
  expect(world.lease()).toBeNull();
  return { world, session, remoteMerge };
}

function recoverQa(fixture: ReturnType<typeof heldCandidate>) {
  const { world, session } = fixture;
  const head = git(world.repo, ["rev-parse", session.branch]).trim();
  const { dependencies, calls } = hostReviewHost(session, head);
  const qa = runQaPrReviewCommand({ workspace: world.workspace,
    pullRequest: fixture.remoteMerge ? world.github.prs[0].url : HOST_REVIEW_PR_URL, rerun: true },
    { ...(fixture.remoteMerge ? { runCommand: world.github.runCommand, selectReviewer: () => hostReviewer(), remote: world.github.remote } : dependencies), now: () => world.now });
  expect(qa.data.verdict).toBe("pass");
  if (!fixture.remoteMerge) expect(calls.reviewer).toBe(1);
  expect(withDatabase(world.workspace, db => independentVerdictGate(db, { session, repoRoot: world.repo })).satisfied).toBe(true);
  expect(world.attempts("write-marker-a").filter(attempt => attempt.role === "qa").map(attempt => attempt.status)).toEqual(["failed", "passed"]);
}

const pending = (world: Rehearsal) => withDatabase(world.workspace, db =>
  listPendingTerminalCandidates(db, world.repo, world.projectSlug)?.pending.map(session => session.action_id));

describe("terminal recovery after an exhaustion hold", () => {
  it("admits and merges ordinary B before exposing A, retaining a governed conflict without rewriting history", () => {
    const fixture = heldCandidate("review_repair_rounds_exhausted", true);
    fixture.world.github.prs[0].isDraft = false;
    expect(pending(fixture.world)).toEqual([]);
    recoverQa(fixture);
    const { world } = fixture;
    expect(pending(world)).toEqual([]);
    const pointerCommit = git(world.repo, ["rev-parse", "main"]).trim();
    world.tickUntil(result => result.launch?.outcome === "launched" && result.launch.actionKey === world.actionB, 4);
    const second = world.lease()!;
    expect(git(second.worktree_path, ["merge-base", "--is-ancestor", pointerCommit, "HEAD"])).toBe("");
    world.agentEdit(second, "OTHER.md", "independent B\n"); world.agentFinish(second, criteriaB);
    world.tmux.exit(second.tmux_session_name);
    expect(world.tick().reconciled[0]?.outcome).toBe("accepted_completion");
    world.tickUntil(result => result.handoff?.integration.kind === "integrated", 8);
    expect(world.github.mergeCalls.filter(call => call.merged)).toHaveLength(1);
    expect(git(world.repo, ["rev-parse", "main"]).trim()).toBe(world.github.headOf("main"));
    expect(pending(world)).toEqual(["write-marker-a"]);
    const beforeRecovery = git(world.repo, ["rev-parse", "main"]).trim();
    const heldHead = git(world.repo, ["rev-parse", fixture.session.branch]).trim();
    const recovery = world.tick();
    // Independent settlements conflict on governed pointer fields. This
    // fixture records that remaining #1702 blocker; it does not resolve it.
    expect(recovery.handoff?.integration.kind).not.toBe("integrated");
    expect(world.log.some(line => line.includes("Reconciliation failed") && line.includes("merge-tree"))).toBe(true);
    expect(world.github.mergeCalls.filter(call => call.merged)).toHaveLength(1);
    expect(world.tmux.launches).toHaveLength(2);
    expect(git(world.repo, ["rev-parse", fixture.session.branch]).trim()).toBe(heldHead);
    expect(git(world.repo, ["rev-parse", "main"]).trim()).toBe(beforeRecovery);
    expect(beforeRecovery).toBe(world.github.headOf("main"));
    expect(world.attempts("write-marker-a").filter(attempt => attempt.role === "qa").map(attempt => attempt.status)).toEqual(["failed", "passed"]);
  });

  it("does not release an authority-gated candidate merely because its verdicts pass", () => {
    const fixture = heldCandidate("review_repair_gated");
    // Fixture setup isolates the authority gate from unpublished-base deferral.
    git(fixture.world.repo, ["push", "origin", "main"]);
    recoverQa(fixture);
    expect(pending(fixture.world)).toEqual([]);
  });

  it("keeps an exhaustion hold when the recovered verdict binding becomes stale", () => {
    const fixture = heldCandidate();
    // Fixture setup isolates stale binding from unpublished-base deferral.
    git(fixture.world.repo, ["push", "origin", "main"]);
    recoverQa(fixture);
    writeFileSync(path.join(fixture.session.worktree_path, "changed-after-review.txt"), "changed\n");
    git(fixture.session.worktree_path, ["add", "changed-after-review.txt"]);
    git(fixture.session.worktree_path, ["commit", "-qm", "Fixture head drift after recovery"]);
    expect(pending(fixture.world)).toEqual([]);
  });

  it("keeps the current independent terminal candidate ahead of a recovered held candidate", () => {
    const fixture = heldCandidate(); const { world } = fixture;
    world.tickUntil(result => result.launch?.outcome === "launched" && result.launch.actionKey === world.actionB, 4);
    const second = world.lease()!;
    // Fixture setup: remove the independent ancestry deferral, then prove A
    // qualifies while B still owns its lease and has no terminal exit.
    git(world.repo, ["push", "origin", "main"]);
    recoverQa(fixture);
    expect(pending(world)).toEqual(["write-marker-a"]);
    world.agentEdit(second, "OTHER.md", "independent B\n"); world.agentFinish(second, criteriaB);
    world.tmux.exit(second.tmux_session_name);
    expect(world.tick().reconciled[0]?.outcome).toBe("accepted_completion");
    expect(pending(world)).toEqual(["write-marker-b"]);
    expect(readFileSync(path.join(second.worktree_path, "OTHER.md"), "utf8")).toBe("independent B\n");
  });
});
