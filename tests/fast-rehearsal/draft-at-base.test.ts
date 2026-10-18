import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { git } from "../helpers/rehearsalHarness.js";
import { installGitFaults, isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import { ACTION_1, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * Issue #1518 (first supervised Claude run, 2026-10-17, draft PR #1517): a
 * sandboxed Session cannot commit, so it drafts its `complete` Ask with
 * `candidate_revision` = its HEAD, the Session's base. Host preservation
 * commits the tree; the worker then settles the draft on the candidate.
 */
let isolation: IsolatedProcess;
const worlds: FastRehearsal[] = [];
beforeAll(() => { isolation = isolateProcess(); });
afterAll(() => {
  for (const world of worlds.splice(0)) world.dispose();
  isolation?.restore();
});

describe("Issue #1518: a completion Ask drafted at the base revision by a Session that cannot commit", () => {
  it("settles inside the candidate before its PR is published, so the PR carries the Plan status change", () => {
    const world = new FastRehearsal("draft-at-base-uncommitted", isolation, import.meta.filename);
    worlds.push(world);
    world.start();
    world.expectError(/Did not record pending completion Agent Ask/);
    const base = git(world.repo, ["rev-parse", "refs/heads/main"]).trim();
    const { session, launch } = world.untilLaunched(ACTION_1, 3);
    const result = world.execute(launch, ACTION_1, "draft-at-base-uncommitted");
    expect(result.workCommit).toBe(base);
    expect(result.statusAtExit).toContain("MARKER.md");

    const [exit] = world.ticks(1);
    expect(exit.reconciled.map((entry) => entry.outcome)).toEqual(["accepted_completion"]);
    const head = git(session.worktree_path, ["rev-parse", "HEAD"]).trim();
    // The settlement is committed on the candidate branch ...
    const settled = git(session.worktree_path, ["show", "--name-only", "--format=", head]);
    expect(settled).toMatch(/docs\/plans\//);
    expect(settled).toContain("PROJECT.md");
    const planFile = settled.split("\n").find((file) => file.startsWith("docs/plans/"))!;
    expect(git(session.worktree_path, ["show", `${head}:${planFile}`])).toMatch(new RegExp(`id: ${ACTION_1}[\\s\\S]*?status: done`));
    // ... and the candidate branch on the remote, which the PR shows, carries it.
    const pr = world.pullRequestFor(ACTION_1);
    expect(pr).not.toBeNull();
    const view = world.gh.view(pr!);
    expect(view.headRefOid).toBe(head);
    expect(view.files.map((file) => file.path)).toEqual(expect.arrayContaining(["PROJECT.md", planFile, "MARKER.md"]));

    world.untilIntegrated(ACTION_1);
    expect(git(world.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(head);
    expect(isolation.guardCalls()).toEqual([]);
    expect(world.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);

  it("is merged by the worker through its PR under the merge opt-in, not refused as authority-adjacent for its archived draft", () => {
    // The live headless Claude shape (PR #1545): host preservation commits the work
    // and the agent's draft together; the settlement archives that draft.
    const world = new FastRehearsal("draft-at-base-worker-merge", isolation, import.meta.filename, { workerMerge: true });
    worlds.push(world);
    world.start();
    world.expectError(/Did not record pending completion Agent Ask/);
    const { launch } = world.untilLaunched(ACTION_1, 3);
    world.execute(launch, ACTION_1, "draft-at-base-uncommitted");
    world.untilIntegrated(ACTION_1, 10);
    const pr = world.pullRequestFor(ACTION_1)!;
    expect(world.github.mergeCalls).toEqual([{ url: pr.url, matchHead: world.github.headOf(pr.branch), merged: true }]);
    expect(world.escalations()).toEqual([]);
    expect(isolation.guardCalls()).toEqual([]);
    expect(world.finish().errors.filter((error) => !error.expected)).toEqual([]);
  }, SCENARIO_TIMEOUT_MS);

  it("never reports accepted_completion when the settlement cannot be committed in the candidate, and escalates it by name", () => {
    const world = new FastRehearsal("draft-at-base-settlement-uncommitted", isolation, import.meta.filename);
    worlds.push(world);
    world.start();
    world.expectError(/Did not record pending completion Agent Ask/);
    world.expectError(/completion_settlement_not_in_candidate|Completion settlement not in candidate/);
    world.expectError(/injected fault/);
    const base = git(world.repo, ["rev-parse", "refs/heads/main"]).trim();
    const { session, launch } = world.untilLaunched(ACTION_1, 3);
    world.execute(launch, ACTION_1, "draft-at-base-uncommitted");
    // Only the settlement's own commit hashes blobs with --no-filters (src/git/askIsolation.ts).
    const faults = installGitFaults(world.root);
    faults.arm("hash-object", 1, "--no-filters");
    try {
      const [exit] = world.ticks(1);
      expect(faults.injected().map((entry) => entry.subcommand)).toEqual(["hash-object"]);
      expect(exit.reconciled.map((entry) => entry.outcome)).not.toContain("accepted_completion");
      expect(world.log.some((line) => line.includes("accepted_completion"))).toBe(false);
      const escalation = world.escalations().find((entry) => entry.actionKey === world.actionKey(ACTION_1));
      expect(escalation).toMatchObject({ kind: "completion_settlement_not_in_candidate" });
      expect(escalation!.message).toContain("Completion settlement not in candidate");
      expect(escalation!.remedy).toContain(session.worktree_path);

      const later = world.ticks(4);
      expect(later.every((tick) => tick.handoff?.integration.kind !== "integrated")).toBe(true);
      expect(later.every((tick) => tick.launch?.outcome !== "launched")).toBe(true);
      expect(git(world.repo, ["rev-parse", "refs/heads/main"]).trim()).toBe(base);
      const { data } = world.productionStatus();
      expect(data.operatorEscalations).toEqual([expect.objectContaining({ actionKey: world.actionKey(ACTION_1), kind: "completion_settlement_not_in_candidate" })]);
    } finally {
      faults.remove();
    }
    expect(isolation.guardCalls()).toEqual([]);
    world.finish();
  }, SCENARIO_TIMEOUT_MS);
});
