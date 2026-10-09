import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDocsSyncCommand } from "../src/commands/docs.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { discoverDocs } from "../src/docs/discover.js";
import type { PlanActionDoc } from "../src/docs/types.js";
import { developmentLineageRemedy } from "../src/production/tick.js";
import { allocateSessionRoleAttempt, latestRoleAttempt, recordSessionRoleAttemptTerminal } from "../src/sessions/enrollment.js";
import { getActiveActionClaim, releaseSupersededActionClaim, type AgentSession } from "../src/sessions/index.js";
import { beginDevelopmentAttempt, planDevelopmentAttempt, requirementIdentity, sessionDevelopedForSupersededInput } from "../src/sessions/roleLineage.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { git, LINE_A, Rehearsal } from "./helpers/rehearsalHarness.js";

/**
 * Rehearsal run 2 reuses the run-1 fixture. Run 1 left a passed development
 * attempt for write-start-marker and an unmerged, preserved candidate whose
 * worktree still claims the Action. The reset operator script
 * (reset-three-action-rehearsal-fixture-2026-10-05) rewrites only that Action's
 * next_action line. These cases prove, with Arcadia's real discovery, lineage
 * and worker tick, that the amendment gives the Action a fresh lineage that
 * the launch gate admits, that the tick dispatches it even though run 1's
 * attempts and candidate remain, and that run 1's candidate is left untouched.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
const library = path.join(repoRoot, "artifacts", "generated", "operator-scripts");
const RESET = "reset-three-action-rehearsal-fixture-2026-10-05";
const G1 = "prepare-three-action-rehearsal-fixture-2026-10-04";
const source = (id: string) => readFileSync(path.join(library, `${id}.sh`), "utf8");
const shellConstant = (script: string, name: string) => {
  const match = script.match(new RegExp(`^${name}='([^']*)'$`, "m"));
  expect(match, `${name} is a single-quoted constant`).not.toBeNull();
  return match![1];
};
const OLD_LINE = shellConstant(source(RESET), "OLD_NEXT_ACTION");
const NEW_LINE = shellConstant(source(RESET), "NEW_NEXT_ACTION");
/** The reset's amendment: the original sentence, its final period replaced by the run-2 note. */
const RUN2_NOTE = NEW_LINE.slice(OLD_LINE.length - 1);

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

describe("the reset's one-line amendment of write-start-marker", () => {
  it("is exactly the original sentence plus a run-2 note, and changes only that Action's requirement input revision", () => {
    expect(NEW_LINE.startsWith(OLD_LINE.slice(0, -1))).toBe(true);
    expect(RUN2_NOTE).toMatch(/^ \(rehearsal run 2, .*\)\.$/);
    const genesis = renderG1Fixture(path.join(temp("arcadia-run2-genesis-"), "fixture"));
    const amended = renderG1Fixture(path.join(temp("arcadia-run2-amended-"), "fixture"));
    const plan = readFileSync(path.join(amended, PLAN_FILE), "utf8");
    expect(plan.split("\n").filter((line) => line === OLD_LINE)).toHaveLength(1);
    // As the reset writes it: the one next_action line, plus the Plan's updated: date so docs sync applies it.
    writeFileSync(path.join(amended, PLAN_FILE), plan.replace(OLD_LINE, NEW_LINE).replace(/^updated: 2026-10-04$/m, "updated: 2026-10-05"));
    const before = planActions(genesis);
    const after = planActions(amended);
    expect(discoverDocs(amended).errors).toEqual([]);
    // Only next_action of the first Action differs; title, criteria and the other Actions are identical.
    expect(after.map((action) => action.id)).toEqual(before.map((action) => action.id));
    expect(after.slice(1)).toEqual(before.slice(1));
    expect({ ...after[0], nextAction: null }).toEqual({ ...before[0], nextAction: null });
    expect(after[0].nextAction).toBe(`${before[0].nextAction.slice(0, -1)}${RUN2_NOTE}`);
    expect(after[0].title).toBe(before[0].title);
    expect(after[0].acceptanceCriteria).toContain('MARKER.md exists and contains exactly the line "three-action rehearsal start" followed by a trailing newline, with no other content.');
    const [a0, a1] = [identity(before[0]), identity(after[0])];
    expect(a1.requirementId).toBe(a0.requirementId);
    expect(a1.inputRevision).not.toBe(a0.inputRevision);
    expect(a1.criteriaFingerprint).toBe(a0.criteriaFingerprint);
    expect(after.slice(1).map(identity)).toEqual(before.slice(1).map(identity));
  });
});

describe("the launch gate gives the amended Action a fresh lineage although run 1's attempts remain", () => {
  it("refuses relaunching the unchanged input after a passed attempt, and allocates development ordinal 1 for the amended input", () => {
    const genesis = renderG1Fixture(path.join(temp("arcadia-run2-gate-"), "fixture"));
    const before = identity(planActions(genesis)[0]);
    writeFileSync(path.join(genesis, PLAN_FILE), readFileSync(path.join(genesis, PLAN_FILE), "utf8").replace(OLD_LINE, NEW_LINE));
    const after = identity(planActions(genesis)[0]);
    const workspace = path.join(temp("arcadia-run2-gate-ws-"), "workspace");
    initWorkspace(workspace);
    const now = new Date("2026-10-04T17:02:45.000Z");
    withDatabase(workspace, (db) => {
      // Run 1 as the live workspace records it: development ordinal 1 passed, code review ordinal 1 failed.
      const run1 = beginDevelopmentAttempt(db, { requirement: before, requestId: "worker-tick-launch-run-1", retryAuthorized: true, now }).attempt;
      recordSessionRoleAttemptTerminal(db, { requestId: run1.request_id, actorId: run1.actor_id, status: "passed", targetHead: "58bcd9155cf64836994045ca63a7707d8b9ebe75", receipt: { sessionId: "session_run_1" }, now });
      const review = allocateSessionRoleAttempt(db, {
        requirementId: before.requirementId, inputRevision: before.inputRevision, role: "code-review", requestId: "code-review-run-1-0001", actorId: "code-review-reviewer:independent",
        mutationOwner: false, authorityCurrent: true, now,
        binding: { targetHead: "58bcd9155cf64836994045ca63a7707d8b9ebe75", criteriaFingerprint: before.criteriaFingerprint, evidenceFingerprint: "e".repeat(64) }
      });
      recordSessionRoleAttemptTerminal(db, { requestId: review.request_id, actorId: review.actor_id, status: "failed", targetHead: "58bcd9155cf64836994045ca63a7707d8b9ebe75", criteriaFingerprint: before.criteriaFingerprint, evidenceFingerprint: "e".repeat(64), receipt: { verdict: "fail" }, now });

      // Before the reset: exactly the refusal the tick escalates.
      let refusal: { details?: Record<string, unknown> } | null = null;
      try { planDevelopmentAttempt(db, { requirement: before, retryAuthorized: true }); } catch (error) { refusal = error as { details?: Record<string, unknown> }; }
      expect(refusal?.details).toMatchObject({ code: "attempt_retry_not_authorized", status: "passed" });
      expect(developmentLineageRemedy("attempt_retry_not_authorized", refusal?.details)).toMatch(/governed amendment of the Action/);

      // After the reset: a fresh lineage, nothing superseded, ordinal 1.
      expect(planDevelopmentAttempt(db, { requirement: after, retryAuthorized: true })).toEqual({ kind: "allocate", supersedes: null });
      expect(latestRoleAttempt(db, after.requirementId, after.inputRevision, "code-review")).toBeNull();
      const fresh = beginDevelopmentAttempt(db, { requirement: after, requestId: "worker-tick-launch-run-2", retryAuthorized: true, now: new Date("2026-10-05T16:30:00.000Z") });
      expect(fresh).toMatchObject({ resumed: false, attempt: { ordinal: 1, status: "pending", mutation_owner: 1, input_revision: after.inputRevision } });
      // Run 1's attempts are kept exactly as they were.
      expect(latestRoleAttempt(db, before.requirementId, before.inputRevision, "development")).toMatchObject({ ordinal: 1, status: "passed", request_id: run1.request_id });
      expect(latestRoleAttempt(db, before.requirementId, before.inputRevision, "code-review")).toMatchObject({ ordinal: 1, status: "failed" });
    });
  });
});

describe("the worker tick dispatches the amended Action past run 1's unmerged candidate", () => {
  const PLAN = path.join("docs", "plans", "two-action-rehearsal-bootstrap.md");
  const CRITERIA_A = [`MARKER.md exists and contains exactly the line "${LINE_A}" followed by a trailing newline, with no other content.`];
  const HARNESS_LINE = `    next_action: Implement MARKER.md containing exactly the line "${LINE_A}" plus a trailing newline.`;

  /** Run 1: A passes and is preserved, but never integrates; its worktree, branch and claim remain. */
  function afterRun1() {
    const rehearsal = new Rehearsal({ independentReviewers: false });
    rehearsals.push(rehearsal);
    rehearsal.createFixtureRepository();
    rehearsal.approve(rehearsal.registerProject());
    rehearsal.activate("run-1-grant");
    rehearsal.tickUntil((r) => r.launch?.outcome === "launched" && r.launch.actionKey === rehearsal.actionA, 3);
    const a = rehearsal.lease()!;
    rehearsal.agentEdit(a, "MARKER.md", `${LINE_A}\n`);
    rehearsal.agentFinish(a, CRITERIA_A);
    rehearsal.tmux.exit(a.tmux_session_name);
    expect(rehearsal.tick().reconciled[0]?.outcome).toBe("accepted_completion");
    rehearsal.deactivate("run-1-terminal-off");
    const run1 = withReadOnlyDatabase(rehearsal.workspace, (db) => db.prepare("SELECT * FROM agent_sessions WHERE id = ?").get(a.id) as AgentSession);
    const tip = git(rehearsal.repo, ["rev-parse", `refs/heads/${run1.branch}`]).trim();
    return { rehearsal, run1, tip };
  }
  const amend = (rehearsal: Rehearsal) => {
    const file = path.join(rehearsal.repo, PLAN);
    const plan = readFileSync(file, "utf8");
    expect(plan.split("\n").filter((line) => line === HARNESS_LINE)).toHaveLength(1);
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(file, plan.replace(HARNESS_LINE, `${HARNESS_LINE.slice(0, -1)}${RUN2_NOTE}`).replace(/^updated: \d{4}-\d{2}-\d{2}$/m, `updated: ${today}`));
    git(rehearsal.repo, ["-c", "user.name=Arcadia Rehearsal Fixture", "-c", "user.email=rehearsal@localhost", "commit", "-qam", "Reset write-marker-a for rehearsal run 2"]);
    const sync = runDocsSyncCommand({ workspace: rehearsal.workspace, project: rehearsal.projectSlug, apply: true });
    expect((sync.data as unknown as { errorCount?: number }).errorCount ?? 0).toBe(0);
    // The amended Action really synced (not skipped as older than its record), so the dispatch below sees the new text.
    const changes = (sync.data as unknown as { projects: Array<{ changes: Array<{ entity: string; ref: string; action: string }> }> }).projects[0].changes;
    expect(changes.find((c) => c.entity === "action" && c.ref.endsWith("#write-marker-a"))?.action).toBe("update");
  };
  const claimOf = (rehearsal: Rehearsal, worktree: string) => withReadOnlyDatabase(rehearsal.workspace, (db) =>
    db.prepare("SELECT action_id, claim_generation FROM agent_worktree_reservations WHERE worktree_path = ?").get(realPath(worktree)) as { action_id: string | null; claim_generation: string | null } | undefined);
  const realPath = (value: string) => spawnSync("sh", ["-c", 'cd "$1" && pwd -P', "sh", value], { encoding: "utf8" }).stdout.trim();

  it("never relaunches the unchanged Action, then launches a fresh development ordinal 1 after the amendment, leaving run 1's candidate exactly as it was", () => {
    const { rehearsal, run1, tip } = afterRun1();
    const run1Attempts = rehearsal.attempts("write-marker-a");
    expect(run1Attempts.map((x) => [x.role, x.ordinal, x.status])).toEqual([["development", 1, "passed"]]);

    // Without the amendment, a second run never launches A.
    rehearsal.activate("run-2-grant-unamended");
    const unamended = [rehearsal.tick(), rehearsal.tick(), rehearsal.tick()];
    expect(unamended.some((r) => r.launch?.outcome === "launched")).toBe(false);
    expect(rehearsal.attempts("write-marker-a")).toEqual(run1Attempts);
    rehearsal.deactivate("run-2-unamended-off");

    // The reset's amendment, then a fresh run-2 activation.
    amend(rehearsal);
    rehearsal.activate("run-2-grant");
    const launched = rehearsal.tickUntil((r) => r.launch?.outcome === "launched", 3).at(-1)!;
    expect(launched.launch).toMatchObject({ outcome: "launched", actionKey: rehearsal.actionA });
    const lineage = rehearsal.attempts("write-marker-a");
    expect(lineage[0]).toEqual(run1Attempts[0]);
    expect(lineage.slice(1).map((x) => [x.role, x.ordinal, x.status, x.mutation_owner])).toEqual([["development", 1, "running", 1]]);
    expect(lineage[1].input_revision).not.toBe(run1Attempts[0].input_revision);
    const run2 = rehearsal.lease()!;
    expect(run2.id).not.toBe(run1.id);
    expect(run2.worktree_path).not.toBe(run1.worktree_path);
    expect(rehearsal.log.join("\n")).toContain(`Terminal candidate of Session ${run1.id}`);

    // Run 1's candidate: branch tip, worktree and its reservation row untouched; only its Action claim was released.
    expect(git(rehearsal.repo, ["rev-parse", `refs/heads/${run1.branch}`]).trim()).toBe(tip);
    expect(existsSync(run1.worktree_path)).toBe(true);
    expect(git(run1.worktree_path, ["status", "--porcelain"]).trim()).toBe("");
    expect(claimOf(rehearsal, run1.worktree_path)).toEqual({ action_id: null, claim_generation: null });
    expect(withReadOnlyDatabase(rehearsal.workspace, (db) => db.prepare("SELECT status FROM agent_sessions WHERE id = ?").get(run1.id))).toEqual({ status: run1.status });
  });

  it("reports run 1's superseded terminal candidate once, not on every tick (Issue #1158)", () => {
    const { rehearsal, run1 } = afterRun1();
    // A dirty worktree keeps dispatch refused, so the same candidate is met again on every tick.
    mkdirSync(path.join(run1.worktree_path, "notes"), { recursive: true });
    writeFileSync(path.join(run1.worktree_path, "notes", "unsaved.md"), "uncommitted\n");
    amend(rehearsal);
    rehearsal.activate("run-2-grant");
    const results = [rehearsal.tick(), rehearsal.tick(), rehearsal.tick()];
    expect(results.some((r) => r.launch?.outcome === "launched")).toBe(false);
    const reported = rehearsal.log.filter((line) => line.includes(`Terminal candidate of Session ${run1.id}`) && line.includes("superseded input"));
    expect(reported).toHaveLength(1);
  });

  it("releases run 1's claim and skips its handoff only for a finished, clean, preserved candidate of a superseded input", () => {
    const { rehearsal, run1 } = afterRun1();
    const held = () => withDatabase(rehearsal.workspace, (db) => getActiveActionClaim(db, rehearsal.repo, rehearsal.projectSlug, "write-marker-a", rehearsal.now));
    const superseded = () => withDatabase(rehearsal.workspace, (db) => sessionDevelopedForSupersededInput(db, run1, rehearsal.repo));
    const tryRelease = () => withDatabase(rehearsal.workspace, (db) => releaseSupersededActionClaim(db, held()!));
    expect(held()).not.toBeNull();
    // The current input: its candidate still claims both.
    expect(superseded()).toBe(false);
    expect(tryRelease()).toBe(false);
    amend(rehearsal);
    const sql = (statement: string, ...args: unknown[]) => withDatabase(rehearsal.workspace, (db) => db.prepare(statement).run(...args));
    // A live holder keeps the claim.
    sql("UPDATE agent_sessions SET status = 'running' WHERE id = ?", run1.id);
    expect(tryRelease()).toBe(false);
    sql("UPDATE agent_sessions SET status = ? WHERE id = ?", run1.status, run1.id);
    // A passed attempt settled by another Session is not this candidate's own.
    const attempt = rehearsal.attempts("write-marker-a")[0];
    sql("UPDATE session_role_attempts SET terminal_receipt_json = ? WHERE id = ?", JSON.stringify({ ...JSON.parse(attempt.terminal_receipt_json ?? "{}"), sessionId: "session_other" }), attempt.id);
    expect(superseded()).toBe(false);
    expect(tryRelease()).toBe(false);
    sql("UPDATE session_role_attempts SET terminal_receipt_json = ? WHERE id = ?", attempt.terminal_receipt_json, attempt.id);
    // An unpreserved candidate gets its preservation first.
    const preserved = withReadOnlyDatabase(rehearsal.workspace, (db) => db.prepare("SELECT * FROM candidate_preservation_receipts WHERE request_id = ?").get(`worker-tick-preserve-${run1.id}`) as Record<string, unknown>);
    expect(preserved).toBeTruthy();
    sql("UPDATE candidate_preservation_receipts SET request_id = ? WHERE request_id = ?", `moved-${run1.id}`, `worker-tick-preserve-${run1.id}`);
    expect(superseded()).toBe(false);
    expect(tryRelease()).toBe(false);
    sql("UPDATE candidate_preservation_receipts SET request_id = ? WHERE request_id = ?", `worker-tick-preserve-${run1.id}`, `moved-${run1.id}`);
    // A dirty worktree keeps the claim.
    writeFileSync(path.join(run1.worktree_path, "unsaved.md"), "uncommitted\n");
    expect(superseded()).toBe(true);
    expect(tryRelease()).toBe(false);
    rmSync(path.join(run1.worktree_path, "unsaved.md"));
    expect(held()).not.toBeNull();
    // Finished, clean, preserved and superseded: released, fenced on its generation.
    expect(tryRelease()).toBe(true);
    expect(held()).toBeNull();
    expect(git(rehearsal.repo, ["rev-parse", `refs/heads/${run1.branch}`]).trim()).toBeTruthy();
  });

  it("the reset's read-only lineage probe names run 1's finished, worker-preserved Session against a real workspace", () => {
    const { rehearsal, run1 } = afterRun1();
    const program = source(RESET).split(`cat > "$RUN_DIR/probe-lineage.mjs" <<'NODE'\n`)[1].split("\nNODE")[0];
    const attempt = rehearsal.attempts("write-marker-a")[0];
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.VITEST;
    const probe = () => {
      const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-", rehearsal.workspace, attempt.requirement_id, attempt.input_revision, "f".repeat(64)], { cwd: repoRoot, input: program, env, encoding: "utf8", timeout: 60_000 });
      expect(run.status, run.stderr).toBe(0);
      return JSON.parse(run.stdout);
    };
    expect(probe()).toEqual({
      attempts: [{ input: "previous", role: "development", ordinal: 1, status: "passed" }],
      holders: [{ sessionId: run1.id, status: run1.status, worktree: run1.worktree_path, preserved: true }]
    });
    withDatabase(rehearsal.workspace, (db) => db.prepare("UPDATE candidate_preservation_receipts SET request_id = ? WHERE request_id = ?").run(`moved-${run1.id}`, `worker-tick-preserve-${run1.id}`));
    expect(probe().holders[0].preserved).toBe(false);
  });

  it("keeps run 1's claim, and dispatches nothing, while its worktree holds uncommitted work", () => {
    const { rehearsal, run1 } = afterRun1();
    mkdirSync(path.join(run1.worktree_path, "notes"), { recursive: true });
    writeFileSync(path.join(run1.worktree_path, "notes", "unsaved.md"), "uncommitted\n");
    amend(rehearsal);
    rehearsal.activate("run-2-grant");
    const results = [rehearsal.tick(), rehearsal.tick()];
    expect(results.some((r) => r.launch?.outcome === "launched")).toBe(false);
    // The prepared-worktree guard refuses first; the claim is the backstop behind it.
    expect(results.map((r) => r.launch?.reason ?? "").join("\n")).toMatch(/already holds uncommitted changes|already claimed by a live worktree/);
    expect(rehearsal.attempts("write-marker-a").map((x) => [x.ordinal, x.status])).toEqual([[1, "passed"]]);
    expect(claimOf(rehearsal, run1.worktree_path)?.action_id).toBe("write-marker-a");
    expect(readFileSync(path.join(run1.worktree_path, "notes", "unsaved.md"), "utf8")).toBe("uncommitted\n");
  });
});
