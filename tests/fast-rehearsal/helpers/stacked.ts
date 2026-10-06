import { checkQaPlanConsistency, parseRenderedPlan, type QaPlanConsistencyReport } from "../../../scripts/qa-plan-consistency.js";
import { git } from "../../helpers/rehearsalHarness.js";
import type { ExecutorResult } from "./executor.js";
import { ACTION_1, ACTION_2, type FastRehearsal } from "./world.js";

/** Action 1 run to local integration; returns its executor result and the remote and local base afterwards. */
export function integrateFirstAction(world: FastRehearsal): { one: ExecutorResult; remoteMain: string; localMain: string } {
  const remoteMain = world.github.headOf("main");
  const { launch } = world.untilLaunched(ACTION_1, 3);
  const one = world.execute(launch, ACTION_1);
  world.untilIntegrated(ACTION_1);
  return { one, remoteMain, localMain: git(world.repo, ["rev-parse", "refs/heads/main"]).trim() };
}

/** Action 2 launched, executed and its terminal preservation run; returns its PR as GitHub reports it and the replay check against it. */
export function preserveSecondAction(world: FastRehearsal): {
  two: ExecutorResult;
  launchBase: string;
  view: ReturnType<FastRehearsal["gh"]["view"]>;
  published: ReturnType<typeof parseRenderedPlan>;
  consistency: QaPlanConsistencyReport;
} {
  const { session, launch } = world.untilLaunched(ACTION_2, 4);
  const two = world.execute(launch, ACTION_2);
  world.tickUntil((r) => r.handoff?.preservation.kind === "preserved", 2);
  const pr = world.pullRequestFor(ACTION_2)!;
  const view = world.gh.view(pr);
  const consistency = checkQaPlanConsistency({
    repositoryPath: world.repo, pullRequest: view, base: session.base_revision, baseSource: "Action 2 Session's launch base", branch: pr.branch
  });
  world.recorder.notes.push(`Action 2's PR on ${view.baseRefName} (qa-plan-consistency): ${consistency.consistent ? "consistent" : JSON.stringify(consistency.mismatches)}`);
  return { two, launchBase: session.base_revision, view, published: parseRenderedPlan(view.body), consistency };
}

/** GitHub merging a PR with a merge commit on the remote (a person's action on GitHub, never the worker's). */
export function mergeOnGitHub(world: FastRehearsal, branch: string, base = "main"): string {
  const origin = world.github.origin;
  const head = world.github.headOf(branch);
  const tree = git(origin, ["rev-parse", `${head}^{tree}`]).trim();
  const merge = git(origin, ["-c", "user.name=GitHub", "-c", "user.email=noreply@github.test", "commit-tree", tree, "-p", world.github.headOf(base), "-p", head, "-m", `Merge branch ${branch}`]).trim();
  git(origin, ["update-ref", `refs/heads/${base}`, merge]);
  return merge;
}

