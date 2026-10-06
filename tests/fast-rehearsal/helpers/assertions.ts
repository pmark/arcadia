import { expect } from "vitest";
import { git } from "../../helpers/rehearsalHarness.js";
import type { IsolatedProcess } from "./environment.js";
import type { ExecutorResult } from "./executor.js";
import { ACTION_1, ACTION_2, type FastRehearsal } from "./world.js";

/** Action 1 integrated once with `work` on the base, then Action 2 admitted once and nothing else. */
export function expectAdvancedExactlyOnce(rehearsal: FastRehearsal, work: ExecutorResult, isolation: IsolatedProcess): void {
  rehearsal.untilLaunched(ACTION_2, 4);
  rehearsal.ticks(2);
  git(rehearsal.repo, ["merge-base", "--is-ancestor", work.workCommit, "refs/heads/main"]);
  expect(rehearsal.planAction(rehearsal.repo, ACTION_1)).toBe("done");
  expect(rehearsal.pointer()).toBe(ACTION_2);
  expect(rehearsal.recorder.tickLog.filter((tick) => tick.summary.includes("integration integrated"))).toHaveLength(1);
  expect(rehearsal.sessions().filter((s) => s.action_id === ACTION_2)).toHaveLength(1);
  expect(rehearsal.attempts(ACTION_2).filter((x) => x.role === "development")).toHaveLength(1);
  expect(rehearsal.attempts(ACTION_1).filter((x) => x.role === "development").map((x) => x.status)).toEqual(["passed"]);
  expect(rehearsal.gh.prs.filter((pr) => pr.branch === rehearsal.sessions()[0].branch)).toHaveLength(1);
  expect(rehearsal.escalations()).toEqual([]);
  expect(rehearsal.redAlerts()).toEqual([]);
  expect(isolation.guardCalls()).toEqual([]);
}
