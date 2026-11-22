import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listLaunchBlockers } from "../../src/production/tick.js";
import { withReadOnlyDatabase } from "../../src/db/connection.js";
import { git } from "../helpers/rehearsalHarness.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";
import { ACTION_1, ACTION_2, FastRehearsal, SCENARIO_TIMEOUT_MS } from "./helpers/world.js";

/**
 * Agent Ask agentask_d6bc1ad4e7cafd0967 (custody-hold replay): another Action's unmerged resumable candidate blocks
 * session preparation for the next eligible Action. The worker must preserve the candidate, report the hold once,
 * spend zero repair attempts for the waiting Action while it waits, and launch exactly once after the hold clears.
 * Real worker tick through normal admission; only the reviewer model, GitHub, tmux and the agent are faked.
 * Live evidence (2026-11-21 verify run): the same refusal was charged as a shared repair failure, exhausting the
 * budget in 76 s with zero Sessions.
 */
let isolation: IsolatedProcess;
let world: FastRehearsal;
const waiting = ACTION_2;
const blocker = ACTION_1;

const attempts = () => withReadOnlyDatabase(world.workspace, (db) =>
  db.prepare("SELECT attempts, local_attempts AS local, last_error AS lastError FROM production_repair_attempts WHERE action_key = ?").get(world.actionKey(waiting)) as
    { attempts: number; local: number; lastError: string | null } | undefined);

/** Settle the blocker out of band: its Plan record says done and the pointer names the waiting Action, as after a governed completion elsewhere. */
function settleBlockerElsewhere(): void {
  const planFile = path.join(world.repo, "docs/plans/two-action-rehearsal-bootstrap.md");
  const plan = readFileSync(planFile, "utf8");
  const block = plan.split("  - id: ");
  const updated = block.map((entry) => entry.startsWith(`${blocker}\n`) ? entry.replace(/\n(\s+)status: \S+/, "\n$1status: done") : entry).join("  - id: ");
  writeFileSync(planFile, updated.replace(/^current_action: \S+$/m, `current_action: ${waiting}`));
  const projectFile = path.join(world.repo, "PROJECT.md");
  writeFileSync(projectFile, readFileSync(projectFile, "utf8").replace(/^current_action: \S+$/m, `current_action: ${waiting}`));
  git(world.repo, ["add", "-A"]);
  git(world.repo, ["-c", "user.name=Rehearsal", "-c", "user.email=r@rehearsal.test", "-c", "commit.gpgsign=false", "commit", "-q", "-m", `settle ${blocker} elsewhere`]);
}

const HOLD_LINE = /Launch refused for \S+\/write-marker-b \[foreign_resumable_candidate\]/;
let holdTicks: number;
let holdLines: number;
let attemptsWhileWaiting: ReturnType<typeof attempts>;
let escalationKinds: string[];
let heldWorktree: string;
let heldBranch: string;
let heldHeadBefore: string;
let heldHeadAfter: string;
let blockerSessionStatus: string;
let launchesForWaiting: number;
let statusBlockers: Array<{ code: string; reason: string; actionKey: string | null }>;
let holdPings: string[];
let attemptsAfterLaunch: ReturnType<typeof attempts>;

beforeAll(() => {
  isolation = isolateProcess();
  world = new FastRehearsal("custody-hold-replay", isolation, import.meta.filename);
  world.start();
  const first = world.untilLaunched(blocker, 3);
  world.execute(first.launch, blocker, "interrupted-after-work-commit");
  world.ticks(1); // reconciles the blocker: incomplete, resumable, preserved
  const row = withReadOnlyDatabase(world.workspace, (db) =>
    db.prepare("SELECT worktree_path AS worktree, branch FROM agent_sessions WHERE action_id = ? ORDER BY rowid DESC LIMIT 1").get(blocker) as { worktree: string; branch: string });
  heldWorktree = row.worktree;
  heldBranch = row.branch;
  heldHeadBefore = git(heldWorktree, ["rev-parse", "HEAD"]).trim();
  settleBlockerElsewhere();
  // Waiting Action: planning packet, packet approval, then the blocked launch, then more ticks while the hold persists.
  world.ticks(20); // one simulated minute per tick: the hold outlasts the 15-minute ping threshold
  holdTicks = 20;
  holdLines = world.log.filter((line: string) => HOLD_LINE.test(line)).length;
  attemptsWhileWaiting = attempts();
  escalationKinds = world.escalations().filter((e: { actionKey: string }) => e.actionKey === world.actionKey(waiting)).map((e: { kind: string }) => e.kind);
  statusBlockers = withReadOnlyDatabase(world.workspace, (db) => listLaunchBlockers(db));
  holdPings = withReadOnlyDatabase(world.workspace, (db) =>
    (db.prepare("SELECT message FROM operator_pings WHERE message LIKE 'Production is WAITING%'").all() as Array<{ message: string }>).map((r) => r.message));
  heldHeadAfter = git(heldWorktree, ["rev-parse", "HEAD"]).trim();
  blockerSessionStatus = withReadOnlyDatabase(world.workspace, (db) =>
    (db.prepare("SELECT status FROM agent_sessions WHERE action_id = ? ORDER BY rowid DESC LIMIT 1").get(blocker) as { status: string }).status);
  // Lift the hold through the existing discard path: remove the candidate's worktree and branch.
  git(world.repo, ["worktree", "remove", "--force", heldWorktree]);
  git(world.repo, ["branch", "-D", heldBranch]);
  const second = world.untilLaunched(waiting, 4);
  launchesForWaiting = world.tmux.launches.filter((entry) => entry.name === second.session.tmux_session_name).length;
  attemptsAfterLaunch = attempts();
  world.finish();
}, SCENARIO_TIMEOUT_MS);

afterAll(() => {
  world?.dispose();
  isolation?.restore();
});

describe("another Action's resumable candidate holds the repository while a different Action waits", () => {
  it("preserves the held candidate untouched while the waiting Action is refused", () => {
    expect(heldHeadAfter).toBe(heldHeadBefore);
    expect(blockerSessionStatus).not.toBe("failed");
    expect(holdTicks).toBeGreaterThan(5);
  });
  it("reports the hold exactly once for the whole episode (the same refusal on later ticks is not re-reported)", () => {
    expect(holdLines).toBe(1);
  });
  it("spends zero repair attempts for the waiting Action and raises no repair_budget_exhausted escalation", () => {
    expect(attemptsWhileWaiting).toBeUndefined();
    expect(escalationKinds).not.toContain("repair_budget_exhausted");
  });
  it("shows the hold durably in production status, naming the blocking Session, Action and candidate", () => {
    const hold = statusBlockers.find((b) => b.code === "foreign_resumable_candidate");
    expect(hold?.actionKey).toBe(world.actionKey(waiting));
    expect(hold?.reason).toContain(heldWorktree);
    expect(hold?.reason).toContain(blocker);
  });
  it("raises exactly one WAIT ping for the episode after 15 minutes, naming the blocker and the remedy", () => {
    expect(holdPings).toHaveLength(1);
    expect(holdPings[0]).toContain("discard");
  });
  it("launches the waiting Action exactly once after the hold is lifted, still with zero attempts spent", () => {
    expect(launchesForWaiting).toBe(1);
    expect(attemptsAfterLaunch).toBeUndefined();
  });
});
